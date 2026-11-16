"""Browser sign-in for the Claude Code CLI on the server host.

Drives the CLI's own ``claude auth login --claudeai`` (Claude subscription,
not API billing). The CLI prints an authorization URL and then waits for the
code that the browser page shows. The desktop opens the URL, the user pastes
the code back, and this module feeds it to the CLI, which stores its own
credentials. Nothing here reads, writes or returns credential files, and CLI
output is never echoed to clients because it may contain account details.
"""
from __future__ import annotations

import asyncio
import os
import re
import secrets
import signal
import time
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

START_TIMEOUT_SECONDS = 20.0
COMPLETE_TIMEOUT_SECONDS = 60.0
LOGIN_TTL_SECONDS = 600.0
MAX_BODY_BYTES = 4096
MAX_OUTPUT_BYTES = 65536
_CODE_RE = re.compile(r"^[A-Za-z0-9._~+/#=-]{8,512}$")
_URL_RE = re.compile(r"https://[^\s\"'<>]+")
_LOGIN_ID_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
_AUTHORIZE_HOSTS = frozenset({"claude.com", "claude.ai", "platform.claude.com"})
_CACHE = {"Cache-Control": "no-store"}


def authorize_url(text: str) -> str | None:
    """First Anthropic authorization URL in CLI output, or ``None``."""
    for match in _URL_RE.finditer(text):
        parts = urlsplit(match.group(0))
        if parts.scheme == "https" and parts.hostname in _AUTHORIZE_HOSTS and parts.path.endswith("/authorize"):
            return match.group(0)
    return None


class ClaudeLoginSession:
    def __init__(self, process: asyncio.subprocess.Process, login_id: str) -> None:
        self.process = process
        self.login_id = login_id
        self.expires_at = time.monotonic() + LOGIN_TTL_SECONDS
        self.used = False


class ClaudeLoginManager:
    """At most one pending browser login per server."""

    def __init__(self, *, executable: Callable[[], str], environment: Callable[[], dict[str, str]]) -> None:
        self._executable = executable
        self._environment = environment
        self._session: ClaudeLoginSession | None = None
        self._lock = asyncio.Lock()

    async def start(self) -> dict[str, str]:
        async with self._lock:
            await self._discard()
            try:
                process = await asyncio.create_subprocess_exec(
                    self._executable(), "auth", "login", "--claudeai",
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    env=self._environment(),
                    start_new_session=True,
                )
            except OSError:
                raise HTTPException(503, "Claude Code is not available on this server.") from None
            try:
                url = await asyncio.wait_for(self._read_url(process), START_TIMEOUT_SECONDS)
            except (asyncio.TimeoutError, OSError):
                url = None
            if url is None:
                await _terminate(process)
                raise HTTPException(502, "Claude Code did not offer a sign-in link.")
            session = ClaudeLoginSession(process, secrets.token_urlsafe(24))
            self._session = session
            return {"login_id": session.login_id, "url": url}

    @staticmethod
    async def _read_url(process: asyncio.subprocess.Process) -> str | None:
        assert process.stdout is not None
        seen = b""
        while len(seen) < MAX_OUTPUT_BYTES:
            chunk = await process.stdout.read(1024)
            if not chunk:
                return None
            seen += chunk
            found = authorize_url(seen.decode("utf-8", "replace"))
            if found is not None:
                return found
        return None

    async def complete(self, login_id: str, code: str) -> None:
        async with self._lock:
            session = self._session
            if session is None or not secrets.compare_digest(session.login_id, login_id):
                raise HTTPException(409, "The sign-in expired. Start again.")
            if time.monotonic() > session.expires_at or session.used or session.process.returncode is not None:
                await self._discard()
                raise HTTPException(409, "The sign-in expired. Start again.")
            session.used = True
            process = session.process
            assert process.stdin is not None
            try:
                process.stdin.write(code.encode() + b"\n")
                await process.stdin.drain()
                process.stdin.close()
            except OSError:
                await self._discard()
                raise HTTPException(409, "The sign-in expired. Start again.") from None
            try:
                returncode = await asyncio.wait_for(self._drain(process), COMPLETE_TIMEOUT_SECONDS)
            except asyncio.TimeoutError:
                await self._discard()
                raise HTTPException(504, "Claude Code did not finish signing in.") from None
            self._session = None
            if returncode != 0:
                raise HTTPException(422, "Claude Code rejected the code.")

    @staticmethod
    async def _drain(process: asyncio.subprocess.Process) -> int:
        assert process.stdout is not None
        while await process.stdout.read(4096):
            pass
        return await process.wait()

    async def cancel(self) -> None:
        async with self._lock:
            await self._discard()

    async def _discard(self) -> None:
        session, self._session = self._session, None
        if session is not None:
            await _terminate(session.process)


async def _terminate(process: asyncio.subprocess.Process) -> None:
    if process.returncode is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError, OSError):
            pass
        try:
            await asyncio.wait_for(process.wait(), 3)
        except asyncio.TimeoutError:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError, OSError):
                pass
            await process.wait()


def create_router(
    *,
    authorize: Callable[[Request], None],
    manager: ClaudeLoginManager,
    on_signed_in: Callable[[], Awaitable[None] | None] | None = None,
) -> APIRouter:
    router = APIRouter()

    @router.post("/api/admin/claude/auth/login")
    async def start_login(request: Request):
        authorize(request)
        return JSONResponse(await manager.start(), headers=_CACHE)

    @router.post("/api/admin/claude/auth/login/complete")
    async def complete_login(request: Request):
        authorize(request)
        try:
            raw = await request.body()
        except Exception:
            raise HTTPException(400, "Paste the code from the Claude page.") from None
        if len(raw) > MAX_BODY_BYTES:
            raise HTTPException(413, "The code is too large.")
        try:
            import json
            body = json.loads(raw)
        except ValueError:
            raise HTTPException(400, "Paste the code from the Claude page.") from None
        login_id = body.get("login_id") if isinstance(body, dict) else None
        code = body.get("code") if isinstance(body, dict) else None
        if not isinstance(login_id, str) or not _LOGIN_ID_RE.match(login_id):
            raise HTTPException(400, "Paste the code from the Claude page.")
        if not isinstance(code, str) or not _CODE_RE.match(code.strip()):
            raise HTTPException(400, "Paste the code from the Claude page.")
        await manager.complete(login_id, code.strip())
        if on_signed_in is not None:
            outcome = on_signed_in()
            if outcome is not None:
                await outcome
        return JSONResponse({"signed_in": True}, headers=_CACHE)

    @router.delete("/api/admin/claude/auth/login")
    async def cancel_login(request: Request):
        authorize(request)
        await manager.cancel()
        return JSONResponse({"cancelled": True}, headers=_CACHE)

    return router
