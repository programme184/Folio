"""Read-only native Codex authentication; custom keys belong to codex_provider."""
from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import stat
import tomllib

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse


MAX_BODY_BYTES = 8192
IMPORT_MAX_BODY_BYTES = 32 * 1024
MAX_API_KEY_CHARS = 4096
_ACCOUNT_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_LAST_REFRESH = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$")
_REFRESH_TOKEN = re.compile(r"^[A-Za-z0-9._~-]{20,2048}$")
_ENV_LOGIN_KEYS = ("CODEX_ACCESS_TOKEN", "CODEX_API_KEY", "OPENAI_API_KEY", "OPENAI_IDENTITY_TOKEN_FILE")
_IMPORT_INVALID = "Paste a ChatGPT Codex auth.json."
AUTH_TIMEOUT_SECONDS = 30.0
BUSY_MESSAGE = "Wait for Codex chats, goals, queued turns and Side chat requests to finish before changing authentication."
HANDOFF_MESSAGE = (
    "Codex sign-in changed or was explicitly reloaded. This chat is waiting for "
    "its running work, approvals, goals or background terminals before switching. "
    "Your running work has not been stopped and this message has not been sent. "
    "Retry after that work finishes."
)
_REVISION_KEY = secrets.token_bytes(32)
_MAX_AUTH_BYTES = 128 * 1024

# Native ChatGPT sign-in only. API-key and custom-provider availability is
# provider-owned. Keep old IDs in saved conversations; this is picker/admission
# policy, not transcript cleanup. Source: https://learn.chatgpt.com/docs/models
CHATGPT_RETIRED_MODELS = frozenset({
    "gpt-5.2", "gpt-5.2-codex", "gpt-5.3-codex", "gpt-5.3-codex-spark",
    "gpt-5.4", "gpt-5.4-mini", "gpt-5.5",
})


def native_model_auth_mode(env: dict[str, str], *, cwd: str, observed_mode: str = "") -> str:
    """Read only the auth kind for model policy, never authenticate or refresh.

    An opaque store may use the existing native login-status probe. A file
    store is checked directly so a switch to an API key cannot inherit a cached
    ChatGPT restriction. Unknown/managed providers are never globally banned.
    """
    try:
        root, config = _native_login_config(env, cwd)
        profile = config.get("profile")
        profiles = config.get("profiles")
        selected_profile = profiles.get(profile, {}) if isinstance(profiles, dict) and isinstance(profile, str) else {}
        if not isinstance(selected_profile, dict):
            return "unknown"
        provider = selected_profile.get("model_provider", config.get("model_provider", "openai"))
        if provider != "openai":
            return "custom"
        providers = config.get("model_providers") or {}
        override = providers.get("openai") if isinstance(providers, dict) else None
        if env.get("OPENAI_BASE_URL") or isinstance(override, dict) and override.get("base_url"):
            return "custom"
        if any(env.get(key) for key in ("CODEX_API_KEY", "OPENAI_API_KEY", "OPENAI_IDENTITY_TOKEN_FILE")):
            return "apiKey"
        if env.get("CODEX_ACCESS_TOKEN"):
            return "unknown"
        store = config.get("cli_auth_credentials_store", "file")
        if store != "file":
            return observed_mode if store in {"keyring", "auto"} and observed_mode in {"chatgpt", "apiKey"} else "unknown"
        data = json.loads(_bounded_file(root / "auth.json"))
        if not isinstance(data, dict):
            return "unknown"
        if isinstance(data.get("OPENAI_API_KEY"), str) and data["OPENAI_API_KEY"]:
            return "apiKey"
        if data.get("auth_mode") in (None, "chatgpt") and isinstance(data.get("tokens"), dict):
            return "chatgpt"
    except (OSError, ValueError, TypeError, RecursionError):
        pass
    return "unknown"


@dataclass(frozen=True)
class LoginRevision:
    # Process-private change detection only, never authentication evidence.
    # Do not put paths, account IDs, credentials or digests in repr/logs/API.
    value: bytes = field(repr=False)


def _bounded_file(path: Path) -> bytes:
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > _MAX_AUTH_BYTES:
            raise ValueError("unsupported credential file")
        raw = stream.read(_MAX_AUTH_BYTES + 1)
        after = os.fstat(stream.fileno())
        if len(raw) > _MAX_AUTH_BYTES or (before.st_mtime_ns, before.st_size) != (after.st_mtime_ns, after.st_size):
            raise ValueError("credential file changed during read")
        return raw


def _native_login_config(env: dict[str, str], cwd: str) -> tuple[Path, dict]:
    home = env.get("HOME")
    location = env.get("CODEX_HOME")
    if not location and not home:
        raise ValueError("native home unavailable")
    if location and location.startswith("~/"):
        if not home:
            raise ValueError("native home unavailable")
        location = str(Path(home) / location[2:])
    root = Path(location) if location else Path(home) / ".codex"
    if not root.is_absolute():
        root = Path(cwd) / root
    try:
        config = tomllib.loads(_bounded_file(root / "config.toml").decode())
    except FileNotFoundError:
        config = {}
    return root, config


def native_login_handoff_supported(env: dict[str, str], *, cwd: str) -> bool:
    try:
        _, config = _native_login_config(env, cwd)
        # A process-only login cannot be recovered by starting a replacement.
        # A malformed config must not retire an otherwise working generation.
        return config.get("cli_auth_credentials_store", "file") in {"file", "keyring", "auto"}
    except (OSError, ValueError, TypeError, RecursionError):
        return False


def native_login_revision(env: dict[str, str], *, cwd: str) -> LoginRevision | None:
    """Conservative file-store signal; native Codex still owns all credentials.

    Ignore rotating access/refresh tokens and last_refresh. OIDC auth_time is
    stable across refresh but changes on an interactive authentication. Without
    it we can detect an account switch, not prove a same-account re-login.
    Explicit native-admin reload can hand off opaque/keyring logins; an
    unchanged known revision remains observational even on explicit reload.
    Missing/malformed files are not evidence of a new login. No secret survives
    this bounded read except a process-keyed comparison digest.
    """
    try:
        root, config = _native_login_config(env, cwd)
        if config.get("cli_auth_credentials_store", "file") != "file":
            return None  # Never infer keyring/auto/ephemeral state from a leftover file.
        if any(env.get(key) for key in ("CODEX_ACCESS_TOKEN", "CODEX_API_KEY", "OPENAI_API_KEY", "OPENAI_IDENTITY_TOKEN_FILE")):
            return None
        data = json.loads(_bounded_file(root / "auth.json"))
        if not isinstance(data, dict):
            return None
        key = data.get("OPENAI_API_KEY")
        if isinstance(key, str) and key:
            identity = ("apiKey", key)
        else:
            tokens = data.get("tokens")
            if not isinstance(tokens, dict) or data.get("auth_mode") not in (None, "chatgpt"):
                return None
            encoded = tokens.get("id_token")
            if not isinstance(encoded, str) or len(encoded) > 32768:
                return None
            parts = encoded.split(".")
            if len(parts) != 3:
                return None
            claims = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
            if not isinstance(claims, dict):
                return None
            details = claims.get("https://api.openai.com/auth") or {}
            if not isinstance(details, dict):
                return None
            account = tokens.get("account_id") or details.get("chatgpt_account_id")
            subject = claims.get("sub")
            if not isinstance(account, str) or not account or not isinstance(subject, str) or not subject:
                return None
            auth_time = claims.get("auth_time")
            if auth_time is not None and (isinstance(auth_time, bool) or not isinstance(auth_time, int)):
                return None
            # Unverified claims are a change hint, never permission/account proof.
            identity = ("chatgpt", account, subject, auth_time)
        raw = json.dumps((str(root.resolve()), identity), separators=(",", ":")).encode()
        return LoginRevision(hmac.new(_REVISION_KEY, raw, hashlib.sha256).digest())
    except (OSError, ValueError, TypeError, RecursionError):
        return None


def capability(*, available: bool) -> dict:
    return {"available": available, "version": 1, "native_only": True,
            "api_key_login": False, "auth_import": True, "max_api_key_chars": MAX_API_KEY_CHARS}


def _jwt_object(token: object) -> dict:
    if not isinstance(token, str) or not 20 <= len(token) <= 8192:
        raise HTTPException(400, _IMPORT_INVALID)
    parts = token.split(".")
    if len(parts) != 3 or any(not re.fullmatch(r"[A-Za-z0-9_-]+", part) for part in parts):
        raise HTTPException(400, _IMPORT_INVALID)
    try:
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(400, _IMPORT_INVALID) from None
    if not isinstance(payload, dict):
        raise HTTPException(400, _IMPORT_INVALID)
    return payload


def _claimed_account(payload: dict) -> str | None:
    details = payload.get("https://api.openai.com/auth")
    if not isinstance(details, dict):
        return None
    account = details.get("chatgpt_account_id")
    if account is None:
        return None
    if not isinstance(account, str) or not _ACCOUNT_ID.fullmatch(account.lower()):
        raise HTTPException(400, _IMPORT_INVALID)
    return account.lower()


def validate_chatgpt_auth_import(value: object) -> dict:
    """Keep only the ChatGPT file Codex writes. Never echo or retain the input."""
    if not isinstance(value, dict):
        raise HTTPException(400, _IMPORT_INVALID)
    if value.get("auth_mode") not in (None, "chatgpt"):
        raise HTTPException(400, _IMPORT_INVALID)
    if "OPENAI_API_KEY" in value and value.get("OPENAI_API_KEY") is not None:
        raise HTTPException(400, "API keys stay on Custom endpoint. Paste a ChatGPT Codex auth.json.")
    tokens = value.get("tokens")
    if not isinstance(tokens, dict):
        raise HTTPException(400, _IMPORT_INVALID)
    account = tokens.get("account_id")
    refresh = tokens.get("refresh_token")
    if not isinstance(account, str) or not _ACCOUNT_ID.fullmatch(account.lower()):
        raise HTTPException(400, _IMPORT_INVALID)
    if not isinstance(refresh, str) or not _REFRESH_TOKEN.fullmatch(refresh):
        raise HTTPException(400, _IMPORT_INVALID)
    account = account.lower()
    for field in ("id_token", "access_token"):
        claimed = _claimed_account(_jwt_object(tokens.get(field)))
        if claimed is not None and claimed != account:
            raise HTTPException(400, _IMPORT_INVALID)
    raw_refresh = value.get("last_refresh")
    if isinstance(raw_refresh, str) and _LAST_REFRESH.fullmatch(raw_refresh):
        last_refresh = raw_refresh[:-6] + "Z" if raw_refresh.endswith("+00:00") else raw_refresh
    else:
        last_refresh = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    return {
        "auth_mode": "chatgpt",
        "OPENAI_API_KEY": None,
        "tokens": {
            "id_token": tokens["id_token"],
            "access_token": tokens["access_token"],
            "refresh_token": refresh,
            "account_id": account,
        },
        "last_refresh": last_refresh,
    }


def _write_private_file(path: Path, payload: bytes) -> None:
    directory = path.parent
    directory.mkdir(parents=True, exist_ok=True)
    try:
        existing = path.lstat()
    except FileNotFoundError:
        existing = None
    else:
        if stat.S_ISLNK(existing.st_mode) or not stat.S_ISREG(existing.st_mode):
            raise HTTPException(422, "Codex auth.json is not a regular file.")
    temporary = directory / f".auth-{secrets.token_hex(8)}.tmp"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
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
    directory_fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def install_chatgpt_auth(env: dict[str, str], cwd: str, value: object) -> None:
    """Replace the server user's file-backed Codex login. Other stores are unchanged."""
    document = validate_chatgpt_auth_import(value)
    if any(env.get(key) for key in _ENV_LOGIN_KEYS):
        raise HTTPException(422, "This server supplies Codex credentials through its environment.")
    try:
        root, config = _native_login_config(env, cwd)
    except (OSError, ValueError, TypeError, RecursionError):
        raise HTTPException(422, "Codex login storage is unavailable on this server.") from None
    if config.get("cli_auth_credentials_store", "file") != "file":
        raise HTTPException(422, "This Codex installation stores login outside a file. Use the Codex CLI on the server.")
    payload = (json.dumps(document, separators=(",", ":")) + "\n").encode()
    try:
        _write_private_file(root / "auth.json", payload)
    except HTTPException:
        raise
    except OSError:
        raise HTTPException(503, "Could not save the Codex login.") from None


def account_summary(result: object) -> dict:
    """Project only account kind and bounded display metadata; never return tokens."""
    if not isinstance(result, dict) or not isinstance(result.get("requiresOpenaiAuth"), bool):
        raise HTTPException(502, "Codex returned an invalid authentication status.")
    account = result.get("account")
    if account is not None and not isinstance(account, dict):
        raise HTTPException(502, "Codex returned an invalid authentication status.")
    mode = "none" if account is None else account.get("type")
    if mode not in ("none", "apiKey", "chatgpt"):
        mode = "other"
    email = plan = None
    if mode == "chatgpt":
        raw_email = account.get("email")
        if isinstance(raw_email, str) and len(raw_email) <= 254 and all(33 <= ord(char) <= 126 for char in raw_email) and re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", raw_email):
            email = raw_email
        raw_plan = account.get("planType")
        if raw_plan in ("free", "go", "plus", "pro", "team", "business", "enterprise", "edu", "unknown"):
            plan = raw_plan
    return {"available": True, "auth_mode": mode, "email": email,
            "plan_type": plan, "requires_openai_auth": result["requiresOpenaiAuth"]}


def validate_api_key(value: object) -> str:
    # Manual validation deliberately never serializes an invalid secret input,
    # unlike a framework validation error's standard `input` property.
    if not isinstance(value, dict) or set(value) != {"api_key"}:
        raise HTTPException(400, "Provide only an API key.")
    key = value["api_key"]
    if not isinstance(key, str) or not 1 <= len(key) <= MAX_API_KEY_CHARS or any(ord(char) < 33 or ord(char) > 126 for char in key):
        raise HTTPException(400, "API key must contain 1 to 4096 printable characters without whitespace.")
    return key


def saved_file_status(env: dict[str, str] | None = None, cwd: str | None = None) -> dict | None:
    """Report only that a ChatGPT file login is stored. Never return tokens or claims."""
    source = os.environ if env is None else env
    try:
        root, config = _native_login_config(source, cwd or os.getcwd())
        if config.get("cli_auth_credentials_store", "file") != "file":
            return None
        if any(source.get(key) for key in _ENV_LOGIN_KEYS):
            return None
        data = json.loads(_bounded_file(root / "auth.json"))
    except (OSError, ValueError, TypeError, RecursionError, json.JSONDecodeError):
        return None
    tokens = data.get("tokens") if isinstance(data, dict) else None
    if (not isinstance(data, dict) or data.get("auth_mode") != "chatgpt" or not isinstance(tokens, dict)
            or not isinstance(tokens.get("refresh_token"), str) or not isinstance(tokens.get("account_id"), str)):
        return None
    return {"available": True, "auth_mode": "chatgpt", "email": None,
            "plan_type": None, "requires_openai_auth": True}


async def read_account(manager) -> dict:
    try:
        result = await manager.request("account/read", {"refreshToken": False}, timeout=AUTH_TIMEOUT_SECONDS)
    except Exception:
        saved = saved_file_status()
        if saved is not None:
            return saved
        raise HTTPException(503, "Codex authentication status is unavailable. Check Codex on this server and refresh.") from None
    return account_summary(result)


def create_router(*, authorize, operation, available, import_auth=None, refresh_login=None, reload_login=None) -> APIRouter:
    router = APIRouter()

    @router.get("/api/admin/codex/auth")
    async def status(request: Request):
        authorize(request)
        if not available():
            return JSONResponse({"available": False, "auth_mode": "none", "email": None,
                "plan_type": None, "requires_openai_auth": True,
                "message": "Codex authentication controls require the app-server transport."},
                headers={"Cache-Control": "no-store"})
        try:
            async with operation(mutate=False) as manager:
                result = await read_account(manager)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, "Codex authentication status is unavailable.") from None
        return JSONResponse({**result, "login_reload_available": reload_login is not None},
                            headers={"Cache-Control": "no-store"})

    @router.post("/api/admin/codex/auth/reload")
    async def reload(request: Request):
        authorize(request)
        if not available() or reload_login is None:
            raise HTTPException(501, "Native Codex sign-in reload is unavailable.")
        # No credential input; no handoff from GET, mounting a page or polling.
        try:
            body = await request.json()
        except ValueError:
            raise HTTPException(400, "Send an empty JSON object to reload Codex sign-in.") from None
        if body != {}:
            raise HTTPException(400, "Send an empty JSON object to reload Codex sign-in.")
        pending = await reload_login()
        response = await status(request)
        result = json.loads(response.body)
        return JSONResponse({**result, "login_reload_pending": pending},
                            headers={"Cache-Control": "no-store"})

    @router.post("/api/admin/codex/auth/import")
    async def import_login(request: Request):
        authorize(request)
        if import_auth is None or refresh_login is None:
            raise HTTPException(501, "Update AgentsServer to import a Codex login.",
                headers={"Cache-Control": "no-store"})
        if not available():
            raise HTTPException(409, "Codex login import requires the app-server transport.",
                headers={"Cache-Control": "no-store"})
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
        document = validate_chatgpt_auth_import(parsed)
        try:
            async with operation(mutate=True, start_manager=False):
                await asyncio.to_thread(import_auth, document)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, "Could not save the Codex login.") from None
        try:
            await refresh_login()
        except Exception:
            raise HTTPException(503, "The Codex login was saved. Use Recheck CLIs before the next chat.") from None
        return JSONResponse({"imported": True}, headers={"Cache-Control": "no-store"})

    @router.post("/api/admin/codex/auth/api-key")
    async def login(request: Request):
        authorize(request)
        # Older clients must not replace the login shared by every normal
        # Codex chat and the host CLI. Do not read a key or open the manager.
        raise HTTPException(409,
            "API key sign-in is disabled because it changes the shared Codex CLI login. "
            "Configure Custom endpoint with its base URL, model and API key, then select "
            "Codex · Custom endpoint for a new chat. Manage normal Codex sign-in in the server's CLI.",
            headers={"Cache-Control": "no-store"})

    return router
