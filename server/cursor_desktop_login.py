"""Share a desktop Cursor sign-in with the CLI auth file.

The IDE stores ``cursorAuth/accessToken`` and ``cursorAuth/refreshToken`` in
``state.vscdb``. Linux and Windows CLIs read a separate ``auth.json``. When
that file is missing, copy only those two session tokens into it. An existing
CLI login is left untouched. This does not refresh tokens, write the desktop
database, or return credential values.
"""
from __future__ import annotations

import base64
import json
import os
import secrets
import sqlite3
import stat
import sys
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

_ISSUER = "https://authentication.cursor.sh"
_ACCESS_KEY = "cursorAuth/accessToken"
_REFRESH_KEY = "cursorAuth/refreshToken"
_MAX_DB_BYTES = 1 << 30
_MAX_CLI_BYTES = 65536
_MAX_TOKEN_CHARS = 8192
IMPORT_MAX_BODY_BYTES = _MAX_CLI_BYTES
_IMPORT_INVALID = "Paste a Cursor CLI auth.json."


def cli_auth_path(env: dict | None = None) -> Path:
    """CLI credential file for this OS user. Not the IDE database."""
    env = os.environ if env is None else env
    home = Path(env.get("HOME") or env.get("USERPROFILE") or Path.home())
    if sys.platform == "darwin":
        return home / ".cursor" / "auth.json"
    if os.name == "nt":
        return Path(env.get("APPDATA") or home / "AppData" / "Roaming") / "Cursor" / "auth.json"
    config = Path(env.get("XDG_CONFIG_HOME") or home / ".config")
    return config / "cursor" / "auth.json"


def desktop_state_path(env: dict | None = None) -> Path:
    """IDE global storage database that holds ``cursorAuth/*`` items."""
    env = os.environ if env is None else env
    home = Path(env.get("HOME") or env.get("USERPROFILE") or Path.home())
    if sys.platform == "darwin":
        root = home / "Library" / "Application Support"
    elif os.name == "nt":
        root = Path(env.get("APPDATA") or home / "AppData" / "Roaming")
    else:
        root = Path(env.get("XDG_CONFIG_HOME") or home / ".config")
    return root / "Cursor" / "User" / "globalStorage" / "state.vscdb"


def cli_credentials_present(env: dict | None = None) -> bool:
    """True when the CLI file already holds a login. Does not read the IDE."""
    try:
        return _cli_document(cli_auth_path(env)) is not None
    except OSError:
        return False


def share_desktop_login(env: dict | None = None) -> str:
    """Return ``present``, ``shared``, or ``absent``. Never raises."""
    try:
        return _share(os.environ if env is None else env)
    except Exception:
        return "absent"


def _owned_regular(path: Path, *, max_size: int) -> bool:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        return False
    if info.st_nlink != 1 or info.st_size <= 0 or info.st_size > max_size:
        return False
    if hasattr(os, "getuid") and info.st_uid != os.getuid():
        return False
    if info.st_mode & 0o022:
        return False
    return True


def _stored_secret(value: object) -> bool:
    return (
        isinstance(value, str)
        and 1 <= len(value) <= _MAX_TOKEN_CHARS
        and not any(ch.isspace() or ord(ch) < 32 or ord(ch) == 127 for ch in value)
    )


def _session_token(value: object) -> bool:
    """A still-valid Cursor session JWT. Rejects opaque or expired values."""
    if not _stored_secret(value) or not isinstance(value, str):
        return False
    parts = value.split(".")
    if len(parts) != 3 or not all(parts):
        return False
    try:
        payload = parts[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (ValueError, TypeError, json.JSONDecodeError):
        return False
    if not isinstance(claims, dict) or claims.get("iss") != _ISSUER:
        return False
    expiry = claims.get("exp")
    return isinstance(expiry, (int, float)) and expiry > time.time() + 60


def _cli_document(path: Path) -> dict | None:
    try:
        if not _owned_regular(path, max_size=_MAX_CLI_BYTES):
            return None
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        return None
    try:
        with os.fdopen(descriptor, "rb") as source:
            raw = source.read(_MAX_CLI_BYTES + 1)
    except OSError:
        return None
    if len(raw) > _MAX_CLI_BYTES:
        return None
    try:
        data = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    if _stored_secret(data.get("apiKey")):
        return data
    if _stored_secret(data.get("accessToken")) and _stored_secret(data.get("refreshToken")):
        return data
    return None


def _desktop_tokens(path: Path) -> tuple[str, str] | None:
    if not _owned_regular(path, max_size=_MAX_DB_BYTES):
        return None
    absolute = path if path.is_absolute() else path.absolute()
    connection = sqlite3.connect(f"{absolute.as_uri()}?mode=ro", uri=True, timeout=1.0)
    try:
        connection.execute("PRAGMA query_only=ON")
        rows = connection.execute(
            "SELECT key, value FROM ItemTable WHERE key IN (?, ?)",
            (_ACCESS_KEY, _REFRESH_KEY),
        ).fetchall()
    finally:
        connection.close()
    found: dict[str, str] = {}
    for key, value in rows:
        if isinstance(value, bytes):
            value = value.decode("utf-8", "strict")
        if key in (_ACCESS_KEY, _REFRESH_KEY) and isinstance(value, str):
            found[str(key)] = value
    access, refresh = found.get(_ACCESS_KEY), found.get(_REFRESH_KEY)
    if not _session_token(access) or not _session_token(refresh):
        return None
    return access, refresh


def _share(env: dict) -> str:
    destination = cli_auth_path(env)
    if _cli_document(destination) is not None:
        return "present"
    try:
        destination.lstat()
    except FileNotFoundError:
        pass
    else:
        # A symlink, empty file, or unrecognized login stays where the user put it.
        return "absent"
    tokens = _desktop_tokens(desktop_state_path(env))
    if tokens is None:
        return "absent"
    parent = destination.parent
    try:
        info = parent.lstat()
    except FileNotFoundError:
        parent.mkdir(mode=0o700)
        os.chmod(parent, 0o700)
    else:
        if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
            return "absent"
        if hasattr(os, "getuid") and info.st_uid != os.getuid():
            return "absent"
    payload = json.dumps(
        {"accessToken": tokens[0], "refreshToken": tokens[1]},
        separators=(",", ":"),
    ).encode()
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(destination, flags, 0o600)
    except FileExistsError:
        return "present" if _cli_document(destination) is not None else "absent"
    try:
        os.fchmod(descriptor, 0o600)
        os.write(descriptor, payload)
        os.fsync(descriptor)
    except Exception:
        os.close(descriptor)
        try:
            os.unlink(destination)
        except OSError:
            pass
        raise
    os.close(descriptor)
    return "shared"


def validate_cli_auth_import(value: object) -> dict:
    """Keep a Cursor CLI session or API key. Never echo the submitted document."""
    if not isinstance(value, dict):
        raise HTTPException(400, _IMPORT_INVALID)
    api_key = value.get("apiKey")
    access = value.get("accessToken")
    refresh = value.get("refreshToken")
    if api_key is not None and (access is not None or refresh is not None):
        raise HTTPException(400, _IMPORT_INVALID)
    if _stored_secret(api_key) and access is None and refresh is None:
        return {"apiKey": api_key}
    if _session_token(access) and _session_token(refresh):
        return {"accessToken": access, "refreshToken": refresh}
    raise HTTPException(400, _IMPORT_INVALID)


def install_cli_auth(env: dict | None, value: object) -> None:
    """Replace the CLI auth file. Desktop database and other stores stay unchanged."""
    document = validate_cli_auth_import(value)
    path = cli_auth_path(env)
    parent = path.parent
    try:
        info = parent.lstat()
    except FileNotFoundError:
        parent.mkdir(parents=True, mode=0o700)
        os.chmod(parent, 0o700)
    else:
        if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
            raise HTTPException(422, "Cursor CLI auth.json is not a regular file.")
    try:
        existing = path.lstat()
    except FileNotFoundError:
        existing = None
    else:
        if stat.S_ISLNK(existing.st_mode) or not stat.S_ISREG(existing.st_mode):
            raise HTTPException(422, "Cursor CLI auth.json is not a regular file.")
    payload = json.dumps(document, separators=(",", ":")).encode()
    temporary = parent / f".auth-{secrets.token_hex(8)}.tmp"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(temporary, flags, 0o600)
    try:
        os.write(descriptor, payload)
        os.fsync(descriptor)
    except Exception:
        os.close(descriptor)
        temporary.unlink(missing_ok=True)
        raise
    os.close(descriptor)
    try:
        os.replace(temporary, path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    os.chmod(path, 0o600)


def create_import_router(*, authorize, install=None) -> APIRouter:
    router = APIRouter()
    writer = install or (lambda document: install_cli_auth(None, document))

    @router.post("/api/admin/cursor/auth/import")
    async def import_login(request: Request):
        authorize(request)
        try:
            raw = await request.body()
        except Exception:
            raise HTTPException(400, _IMPORT_INVALID) from None
        if len(raw) > IMPORT_MAX_BODY_BYTES:
            raise HTTPException(413, "The auth file is too large.")
        try:
            parsed = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise HTTPException(400, _IMPORT_INVALID) from None
        try:
            writer(parsed)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, "Could not save the Cursor CLI login.") from None
        return JSONResponse({"imported": True}, headers={"Cache-Control": "no-store"})

    return router
