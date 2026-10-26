"""Native Codex authentication with synthetic transports; never import/start the server."""
from __future__ import annotations

import ast
import asyncio
import base64
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import stat
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

import codex_auth
import side_questions
from codex_app_server import CodexAppServerClient, CodexAppServerRequestError, CodexAppServerTimeout
from tests import test_codex_subagents_admin_isolated as admin_fixture
from tests.test_codex_app_server import FakeProcessFactory, NO_RESPONSE, wait_until


SOURCE = (Path(__file__).resolve().parents[1] / "agent_server.py")
NAMES = {"codex_auth_operation", "reserve_codex_goals_reconfiguration",
         "release_codex_goals_reconfiguration", "active_codex_work_labels", "queued_turn_backend",
         "acquire_codex_control_thread"}
nodes = [node for node in ast.parse(SOURCE.read_text()).body
         if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in NAMES]
assert {node.name for node in nodes} == NAMES
OPERATION_CODE = compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), "exec")
NATIVE = {"X-AgentsDock-Token": "synthetic-native-token"}
SECRET = "sk-synthetic-auth-test-only-not-a-real-key"
ACCOUNT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
REFRESH = "rt.synthetic-refresh-token-not-a-real-credential"


def synthetic_jwt(account=ACCOUNT):
    payload = json.dumps({"sub": "auth0|synthetic", "auth_time": 1700000000,
        "https://api.openai.com/auth": {"chatgpt_account_id": account}}, separators=(",", ":")).encode()
    body = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    header = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').decode().rstrip("=")
    return f"{header}.{body}.e30"


def synthetic_auth(**overrides):
    document = {"auth_mode": "chatgpt", "OPENAI_API_KEY": None, "tokens": {
        "id_token": synthetic_jwt(), "access_token": synthetic_jwt(),
        "refresh_token": REFRESH, "account_id": ACCOUNT}, "last_refresh": "2026-01-02T03:04:05.000000Z"}
    document.update(overrides)
    return document


class CodexAuthTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        fixture = admin_fixture.CodexSubagentsAdminTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.ns = fixture.ns
        self.manager = SimpleNamespace(request=AsyncMock(return_value={"type": "apiKey"}),
            client=SimpleNamespace(_turns_by_thread={}))
        self.ns.update({"asynccontextmanager": asynccontextmanager, "codex_auth": codex_auth,
            "CodexAppServerManager": object, "ensure_session_not_deleting": lambda session_id: None,
            "CODEX_AUTH_LOCK": asyncio.Lock(), "ACTIVE_LOCK": asyncio.Lock(), "QUEUE_LOCK": asyncio.Lock(),
            "managed_server_update_admission_blocker": lambda: None, "DEFAULT_BACKEND": "codex",
            "BACKEND_CODEX": "codex", "STORE": SimpleNamespace(sessions={}),
            "UNSAFE_HTTP_MUTATION_TASKS": {},
            "UNSAFE_HTTP_MUTATION_ADMISSION_LOCK": asyncio.Lock(),
            "request_route_parses_body": lambda request: False,
            "unsafe_http_mutation_blocked_response": lambda **kwargs: None,
            "register_unsafe_http_mutation_locked": lambda task: ("synthetic-lease", task, {}),
            "release_unsafe_http_mutation": lambda *args: None,
            "UnsafeMutationAdmissionRejected": type("UnsafeMutationAdmissionRejected", (RuntimeError,), {}),
            "BUSY_SESSIONS": set(), "CURRENT_TURNS": {}, "ACTIVE": {}, "QUEUED_TURNS": {}, "RUN_NOW_TURNS": {},
            "SERVER_MAINTENANCE_SESSIONS": set(), "CODEX_NATIVE_ACTION_TASKS": {}, "CODEX_PENDING_INTERACTIONS": {},
            "CODEX_SUBAGENT_INDEX_LOCK": threading.RLock(), "CODEX_SUBAGENT_STATE": {},
            "codex_subagent_has_live_owner": lambda thread, state: state.get("live") is True,
            "SIDE_QUESTIONS": side_questions.SideQuestions(), "codex_app_server_manager": AsyncMock(return_value=self.manager)})
        self.ns["codex_app_server_managers"] = lambda: (self.manager,)
        self.ns["refresh_codex_app_server_login"] = AsyncMock()
        exec(OPERATION_CODE, self.ns)
        self.home = tempfile.TemporaryDirectory(prefix="codex-auth-import-")
        self.addCleanup(self.home.cleanup)
        self.codex_home = Path(self.home.name) / ".codex"
        self.refresh_login = AsyncMock()
        self.app = FastAPI()
        self.app.middleware("http")(self.ns["require_agent_token"])
        self.auth_router = codex_auth.create_router(authorize=self.ns["require_native_admin_control"],
            operation=self.ns["codex_auth_operation"], available=lambda: self.ns["CODEX_TRANSPORT"] != "exec",
            import_auth=lambda document: codex_auth.install_chatgpt_auth(
                {"HOME": self.home.name, "CODEX_HOME": str(self.codex_home)}, self.home.name, document),
            refresh_login=self.refresh_login)
        self.app.include_router(self.auth_router)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def login(self, body=None, headers=None):
        return self.client.post("/api/admin/codex/auth/api-key", headers=NATIVE if headers is None else headers,
            json={"api_key": SECRET} if body is None else body)

    def test_legacy_login_rejected_without_native_access_or_restart(self):
        result = self.login()
        self.assertEqual(result.status_code, 409, result.text)
        self.assertIn("Custom endpoint", result.json()["detail"])
        self.assertIn("shared Codex CLI login", result.json()["detail"])
        self.assertNotIn(SECRET, result.text)
        self.assertEqual(result.headers["cache-control"], "no-store")
        self.manager.request.assert_not_awaited()
        self.ns["codex_app_server_manager"].assert_not_awaited()
        self.assertFalse(self.ns["CODEX_GOALS_RECONFIGURING"])
        self.ns["close_codex_app_server_manager"].assert_not_called()
        self.assertFalse(codex_auth.capability(available=True)["api_key_login"])
        self.assertTrue(codex_auth.capability(available=True)["auth_import"])

    def test_status_projects_api_key_chatgpt_signed_out_and_future_mode(self):
        cases = [(None, "none", None), ({"type": "apiKey", "apiKey": SECRET, "email": SECRET}, "apiKey", None),
            ({"type": "chatgpt", "email": "test@example.invalid", "planType": "pro", "accessToken": SECRET}, "chatgpt", "test@example.invalid"),
            ({"type": "future", "token": SECRET}, "other", None)]
        for account, mode, email in cases:
            with self.subTest(mode=mode):
                self.manager.request.reset_mock()
                self.manager.request.return_value = {"account": account, "requiresOpenaiAuth": True, "secret": SECRET}
                response = self.client.get("/api/admin/codex/auth", headers=NATIVE)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["auth_mode"], mode)
                self.assertEqual(response.json()["email"], email)
                self.assertNotIn(SECRET, response.text)
                self.manager.request.assert_awaited_once_with("account/read", {"refreshToken": False}, timeout=30.0)

    def test_rejected_body_never_echoes_secret_or_reaches_native(self):
        cases = [{}, {"api_key": SECRET, "extra": SECRET}, {"api_key": [SECRET]}, {"api_key": 123},
            {"api_key": True}, {"api_key": ""}, {"api_key": SECRET + " "}, {"api_key": SECRET + "\n"},
            {"api_key": SECRET + "é"}, {"api_key": SECRET * 150}, [SECRET]]
        for body in cases:
            response = self.login(body)
            self.assertIn(response.status_code, (409, 413), response.text)
            self.assertNotIn(SECRET, response.text)
        self.manager.request.assert_not_awaited()
        response = self.client.post("/api/admin/codex/auth/api-key", headers={**NATIVE, "Content-Type": "application/json"}, content='{"api_key":"' + SECRET)
        self.assertEqual(response.status_code, 409)
        self.assertNotIn(SECRET, response.text)

    async def test_rejected_route_never_reads_submitted_key(self):
        request = Request({"type": "http", "method": "POST", "path": "/api/admin/codex/auth/api-key",
            "headers": [(b"x-agentsdock-token", b"synthetic-native-token")], "query_string": b""},
            receive=AsyncMock(side_effect=AssertionError("body read")))
        endpoint = next(route.endpoint for route in self.auth_router.routes
            if getattr(route, "path", None) == "/api/admin/codex/auth/api-key")
        with self.assertRaises(HTTPException) as rejected:
            await endpoint(request)
        self.assertEqual(rejected.exception.status_code, 409)
        self.manager.request.assert_not_awaited()
        self.ns["codex_app_server_manager"].assert_not_awaited()

    def test_authentication_and_transport_rejected_before_body_or_provider(self):
        cases = [({}, 401), ({"Authorization": "Bearer synthetic-native-token"}, 401),
            ({**NATIVE, "Origin": "https://example.invalid"}, 403),
            ({**NATIVE, "Cookie": "x=1"}, 403), ({**NATIVE, "Sec-Fetch-Mode": "cors"}, 403)]
        for headers, status in cases:
            response = self.login(headers=headers)
            self.assertEqual(response.status_code, status, response.text)
        self.manager.request.reset_mock()
        self.assertEqual(self.client.options("/api/admin/codex/auth", headers=NATIVE).status_code, 403)
        self.assertEqual(self.client.get("/api/admin/codex/auth?token=synthetic-native-token").status_code, 401)
        response = self.client.post("/api/admin/codex/auth/api-key", headers=NATIVE, content=SECRET)
        self.assertEqual(response.status_code, 415)
        self.manager.request.assert_not_awaited()
        self.ns["AGENT_TOKEN"] = ""
        self.assertEqual(self.login().status_code, 503)

    def test_loopback_without_operator_token_can_replace_file_login(self):
        self.ns["AGENT_TOKEN"] = ""
        # Production request_authorized is open when the server has no token.
        # This fixture otherwise uses the stricter native-header check.
        exact = self.ns["request_authorized"]
        self.ns["request_authorized"] = lambda request: True if not self.ns["AGENT_TOKEN"] else exact(request)
        local = TestClient(self.app, client=("127.0.0.1", 9))
        self.addCleanup(local.close)
        response = local.post("/api/admin/codex/auth/import", json=synthetic_auth())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"imported": True})
        self.assertNotIn(REFRESH, response.text)
        self.assertNotIn(ACCOUNT, response.text)
        path = self.codex_home / "auth.json"
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.refresh_login.assert_awaited_once()
        remote = TestClient(self.app, client=("192.0.2.10", 9))
        self.addCleanup(remote.close)
        denied = remote.post("/api/admin/codex/auth/import", json=synthetic_auth())
        self.assertEqual(denied.status_code, 503, denied.text)
        self.assertNotIn(REFRESH, denied.text)
        browser = local.post("/api/admin/codex/auth/import",
            headers={"Origin": "http://127.0.0.1:7850"}, json=synthetic_auth())
        self.assertEqual(browser.status_code, 403, browser.text)
        other = local.post("/api/admin/codex/auth/api-key", json={"api_key": SECRET})
        self.assertEqual(other.status_code, 503, other.text)
        self.assertNotIn(SECRET, other.text)
        self.manager.request.return_value = {"account": {"type": "chatgpt", "email": "test@example.invalid",
            "planType": "pro"}, "requiresOpenaiAuth": True}
        status = local.get("/api/admin/codex/auth")
        self.assertEqual(status.status_code, 200, status.text)
        self.assertEqual(status.json()["auth_mode"], "chatgpt")
        self.assertEqual(status.json()["email"], "test@example.invalid")
        self.ns["AGENT_TOKEN"] = "synthetic-native-token"
        still_closed = local.post("/api/admin/codex/auth/import", json=synthetic_auth())
        self.assertEqual(still_closed.status_code, 401, still_closed.text)

    def test_loopback_side_chat_is_open_without_an_operator_token(self):
        self.ns["AGENT_TOKEN"] = ""

        def request(path, method, client, headers=None):
            return Request({"type": "http", "method": method, "path": path, "scheme": "http",
                "server": ("127.0.0.1", 7850), "client": client, "headers": headers or [],
                "query_string": b""})

        guard = self.ns["require_native_admin_control"]
        for path, method in (
            ("/api/sessions/chat-a/side-questions", "POST"),
            ("/api/sessions/chat-a/side-questions/request-a", "DELETE"),
            ("/api/sessions/chat-a/side-chat", "GET"),
            ("/api/sessions/chat-a/side-chat", "POST"),
            ("/api/sessions/chat-a/side-chat/requests/request-a", "DELETE"),
            ("/api/sessions/chat-a/side-chat/side-a", "DELETE"),
            ("/api/sessions/chat-a/side-chats/side-a", "DELETE"),
        ):
            guard(request(path, method, ("127.0.0.1", 9)))
        guard(request("/api/sessions/chat-a/side-chat", "GET", ("::1", 9)))
        with self.assertRaises(HTTPException) as remote:
            guard(request("/api/sessions/chat-a/side-questions", "POST", ("192.0.2.10", 9)))
        self.assertEqual(remote.exception.status_code, 503)
        with self.assertRaises(HTTPException) as browser:
            guard(request("/api/sessions/chat-a/side-questions", "POST", ("127.0.0.1", 9),
                [(b"origin", b"http://127.0.0.1:7850")]))
        self.assertEqual(browser.exception.status_code, 403)
        with self.assertRaises(HTTPException) as other:
            guard(request("/api/admin/codex/goals", "GET", ("127.0.0.1", 9)))
        self.assertEqual(other.exception.status_code, 503)
        self.ns["AGENT_TOKEN"] = "synthetic-native-token"
        with self.assertRaises(HTTPException) as locked:
            guard(request("/api/sessions/chat-a/side-questions", "POST", ("127.0.0.1", 9)))
        self.assertEqual(locked.exception.status_code, 401)

    def test_saved_file_keeps_chatgpt_status_when_account_read_fails(self):
        self.codex_home.mkdir()
        codex_auth.install_chatgpt_auth(
            {"HOME": self.home.name, "CODEX_HOME": str(self.codex_home)}, self.home.name, synthetic_auth())
        self.manager.request.side_effect = TimeoutError("synthetic-account-read-failed")
        with patch.dict(os.environ, {"CODEX_HOME": str(self.codex_home), "HOME": self.home.name}, clear=False):
            response = self.client.get("/api/admin/codex/auth", headers=NATIVE)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"available": True, "auth_mode": "chatgpt", "email": None,
            "plan_type": None, "requires_openai_auth": True})
        self.assertNotIn(REFRESH, response.text)
        self.assertNotIn(ACCOUNT, response.text)

    async def test_framing_and_duplicate_tokens_rejected_without_body_read(self):
        native = (b"x-agentsdock-token", b"synthetic-native-token")
        json_type = (b"content-type", b"application/json")
        cases = [([native, native], 401), ([native, json_type], 411),
            ([native, json_type, (b"content-length", b"8193")], 413),
            ([native, json_type, (b"content-length", b"2"), (b"transfer-encoding", b"chunked")], 400)]
        for headers, expected in cases:
            request = Request({"type": "http", "method": "POST", "path": "/api/admin/codex/auth/api-key",
                "scheme": "http", "server": ("127.0.0.1", 1), "client": ("127.0.0.1", 2),
                "headers": headers, "query_string": b""}, receive=AsyncMock(side_effect=AssertionError("body read")))
            next_handler = AsyncMock()
            response = await self.ns["require_agent_token"](request, next_handler)
            self.assertEqual(response.status_code, expected)
            next_handler.assert_not_called()

    def test_status_failures_are_sanitized_without_retry(self):
        isolated = patch.dict(os.environ, {"CODEX_HOME": str(self.codex_home), "HOME": self.home.name}, clear=False)
        isolated.start()
        self.addCleanup(isolated.stop)
        for failure in (RuntimeError(SECRET), asyncio.TimeoutError(SECRET)):
            self.manager.request.reset_mock(side_effect=True)
            self.manager.request.side_effect = failure
            response = self.client.get("/api/admin/codex/auth", headers=NATIVE)
            self.assertEqual(response.status_code, 503)
            self.assertNotIn(SECRET, response.text)
            self.manager.request.assert_awaited_once()
            self.assertFalse(self.ns["CODEX_GOALS_RECONFIGURING"])
        self.manager.request.side_effect = None
        for ack in (None, {}, {"account": SECRET, "requiresOpenaiAuth": True}):
            self.manager.request.return_value = ack
            response = self.client.get("/api/admin/codex/auth", headers=NATIVE)
            self.assertEqual(response.status_code, 502)
            self.assertNotIn(SECRET, response.text)

    def test_unavailable_transport_never_starts_provider(self):
        self.ns["CODEX_TRANSPORT"] = "exec"
        response = self.client.get("/api/admin/codex/auth", headers=NATIVE)
        self.assertFalse(response.json()["available"])
        self.assertEqual(self.login().status_code, 409)
        self.ns["codex_app_server_manager"].assert_not_awaited()

    async def test_busy_active_queue_goal_side_chat_subagent_and_native_turn_are_preserved(self):
        session = {"backend": "codex"}
        self.ns["STORE"].sessions["chat"] = session
        busy_cases = [(self.ns["BUSY_SESSIONS"], "chat"),
            (self.ns["QUEUED_TURNS"], ("chat", [{"queued_id": "queued"}])),
            (self.ns["RUN_NOW_TURNS"], ("chat", {})),
            (session, ("codex_goal", {"status": "active"})),
            (self.ns["CODEX_SUBAGENT_STATE"], ("child", {"live": True})),
            (self.manager.client._turns_by_thread, ("thread", SimpleNamespace(_completed=False)))]
        for container, value in busy_cases:
            if isinstance(container, set):
                container.add(value)
            else:
                container[value[0]] = value[1]
            with self.assertRaises(HTTPException) as raised:
                async with self.ns["codex_auth_operation"](mutate=True):
                    self.fail("busy operation admitted")
            self.assertEqual(raised.exception.status_code, 409)
            self.assertFalse(self.ns["CODEX_GOALS_RECONFIGURING"])
            if isinstance(container, set):
                self.assertIn(value, container)
                container.remove(value)
            else:
                self.assertIs(container.pop(value[0]), value[1])
        waiting = asyncio.create_task(asyncio.Event().wait())
        self.ns["SIDE_QUESTIONS"].receipts[("owner", "chat", "request")] = SimpleNamespace(task=waiting)
        try:
            with self.assertRaises(HTTPException) as raised:
                async with self.ns["codex_auth_operation"](mutate=True):
                    self.fail("side chat admitted")
            self.assertEqual(raised.exception.status_code, 409)
            self.assertFalse(waiting.done())
        finally:
            waiting.cancel()
            await asyncio.gather(waiting, return_exceptions=True)
        synced_waiting = asyncio.create_task(asyncio.Event().wait())
        self.ns["SIDE_QUESTIONS"].synced = SimpleNamespace(tasks={("owner", "chat"): synced_waiting})
        try:
            with self.assertRaises(HTTPException):
                async with self.ns["codex_auth_operation"](mutate=True):
                    self.fail("synced side chat admitted an authentication mutation")
            self.assertFalse(synced_waiting.done())
        finally:
            synced_waiting.cancel()
            await asyncio.gather(synced_waiting, return_exceptions=True)
        self.manager.request.assert_not_awaited()

    async def test_admission_remains_reserved_until_login_settles_and_releases_on_cancellation(self):
        self.ns["STORE"].sessions["chat"] = {"backend": "codex"}
        started = asyncio.Event()
        async def work():
            async with self.ns["codex_auth_operation"](mutate=True):
                started.set()
                await asyncio.Event().wait()
        task = asyncio.create_task(work())
        await started.wait()
        self.assertTrue(self.ns["CODEX_GOALS_RECONFIGURING"])
        with self.assertRaises(HTTPException) as blocked_control:
            await self.ns["acquire_codex_control_thread"]("chat")
        self.assertEqual(blocked_control.exception.status_code, 409)
        with self.assertRaises(HTTPException):
            await self.ns["reserve_codex_goals_reconfiguration"]()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        self.assertFalse(self.ns["CODEX_GOALS_RECONFIGURING"])

    def test_chatgpt_file_import_writes_private_auth_and_requests_handoff(self):
        response = self.client.post("/api/admin/codex/auth/import", headers=NATIVE, json=synthetic_auth())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"imported": True})
        self.assertNotIn(REFRESH, response.text)
        self.assertNotIn(ACCOUNT, response.text)
        path = self.codex_home / "auth.json"
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        saved = json.loads(path.read_text())
        self.assertEqual(saved["auth_mode"], "chatgpt")
        self.assertIsNone(saved["OPENAI_API_KEY"])
        self.assertEqual(saved["tokens"]["account_id"], ACCOUNT)
        self.assertEqual(saved["tokens"]["refresh_token"], REFRESH)
        env = {"HOME": self.home.name, "CODEX_HOME": str(self.codex_home)}
        self.assertIsNotNone(codex_auth.native_login_revision(env, cwd=self.home.name))
        self.refresh_login.assert_awaited_once()
        self.ns["codex_app_server_manager"].assert_not_awaited()

    def test_import_rejects_api_keys_symlinks_and_secrets_never_echo(self):
        rejected = synthetic_auth(OPENAI_API_KEY=SECRET)
        response = self.client.post("/api/admin/codex/auth/import", headers=NATIVE, json=rejected)
        self.assertEqual(response.status_code, 400, response.text)
        self.assertNotIn(SECRET, response.text)
        self.assertNotIn(REFRESH, response.text)
        self.assertFalse((self.codex_home / "auth.json").exists())
        self.refresh_login.assert_not_awaited()
        self.codex_home.mkdir()
        link = self.codex_home / "auth.json"
        link.symlink_to(self.codex_home / "elsewhere")
        response = self.client.post("/api/admin/codex/auth/import", headers=NATIVE, json=synthetic_auth())
        self.assertEqual(response.status_code, 422, response.text)
        self.assertTrue(link.is_symlink())
        self.assertNotIn(REFRESH, response.text)
        self.refresh_login.assert_not_awaited()

    def test_import_leaves_environment_and_non_file_stores_unchanged(self):
        original = codex_auth.install_chatgpt_auth
        calls = []
        def guarded(env, cwd, value):
            calls.append(env)
            return original(env, cwd, value)
        app = FastAPI()
        app.middleware("http")(self.ns["require_agent_token"])
        app.include_router(codex_auth.create_router(authorize=self.ns["require_native_admin_control"],
            operation=self.ns["codex_auth_operation"], available=lambda: True,
            import_auth=lambda document: guarded(
                {"HOME": self.home.name, "CODEX_HOME": str(self.codex_home), "OPENAI_API_KEY": SECRET},
                self.home.name, document),
            refresh_login=self.refresh_login))
        client = TestClient(app)
        self.addCleanup(client.close)
        response = client.post("/api/admin/codex/auth/import", headers=NATIVE, json=synthetic_auth())
        self.assertEqual(response.status_code, 422, response.text)
        self.assertNotIn(SECRET, response.text)
        self.assertNotIn(REFRESH, response.text)
        self.assertEqual(len(calls), 1)
        self.assertFalse((self.codex_home / "auth.json").exists())
        config = self.codex_home
        config.mkdir()
        (config / "config.toml").write_text('cli_auth_credentials_store = "keyring"\n')
        response = self.client.post("/api/admin/codex/auth/import", headers=NATIVE, json=synthetic_auth())
        self.assertEqual(response.status_code, 422, response.text)
        self.assertFalse((self.codex_home / "auth.json").exists())
        self.refresh_login.assert_not_awaited()

    def test_busy_codex_work_blocks_import_before_writing(self):
        self.ns["STORE"].sessions["chat"] = {"backend": "codex", "codex_goal": {"status": "active"}}
        response = self.client.post("/api/admin/codex/auth/import", headers=NATIVE, json=synthetic_auth())
        self.assertEqual(response.status_code, 409, response.text)
        self.assertNotIn(REFRESH, response.text)
        self.assertFalse((self.codex_home / "auth.json").exists())
        self.refresh_login.assert_not_awaited()
        self.ns["codex_app_server_manager"].assert_not_awaited()

    def test_exec_transport_rejects_import_before_writing(self):
        self.ns["CODEX_TRANSPORT"] = "exec"
        response = self.client.post("/api/admin/codex/auth/import", headers=NATIVE, json=synthetic_auth())
        self.assertEqual(response.status_code, 409, response.text)
        self.assertFalse((self.codex_home / "auth.json").exists())
        self.refresh_login.assert_not_awaited()


class CodexAuthTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_auth_write_timeout_does_not_retire_shared_provider_or_repeat_request(self):
        for method, params in (("account/read", {"refreshToken": False}),
                ("account/login/start", {"type": "apiKey", "apiKey": SECRET})):
            factory = FakeProcessFactory()
            client = CodexAppServerClient("synthetic-codex", cwd="/tmp", env_factory=lambda: {},
                process_factory=factory, request_timeout=1)
            self.addAsyncCleanup(client.close)
            await client.start()
            async def blocked_drain():
                await asyncio.Event().wait()
            factory.process.stdin.drain = blocked_drain
            with self.assertRaises(CodexAppServerTimeout):
                await client.request(method, params, timeout=0.01)
            self.assertIsNone(factory.process.returncode)
            self.assertTrue(client.ready)
            self.assertEqual(len(factory.calls), 1)
            self.assertEqual(len([item for item in factory.process.messages if item.get("method") == method]), 1)

    async def test_auth_errors_notifications_and_delayed_stderr_do_not_retain_secret(self):
        factory = FakeProcessFactory()
        client = CodexAppServerClient("synthetic-codex", cwd="/tmp", env_factory=lambda: {},
            process_factory=factory, request_timeout=1)
        self.addAsyncCleanup(client.close)
        seen = []
        client.add_notification_handler(lambda item: seen.append(item))
        def reject(message):
            factory.process.feed_stderr(SECRET)
            factory.process.feed({"method": "account/login/completed", "params": {"error": SECRET}})
            factory.process.feed({"id": message["id"], "error": {"code": -1, "message": SECRET, "data": SECRET}})
            return NO_RESPONSE
        factory.process.responders["account/login/start"] = reject
        with self.assertRaises(CodexAppServerRequestError) as raised:
            await client.request("account/login/start", {"type": "apiKey", "apiKey": SECRET})
        self.assertNotIn(SECRET, str(raised.exception))
        self.assertNotIn(SECRET, repr(raised.exception.error))
        factory.process.feed_stderr("delayed " + SECRET)
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        self.assertEqual(client.stderr_tail, [])
        self.assertEqual(seen, [])
        rate_limits = {"method": "account/rateLimits/updated", "params": {"rateLimits": {"limitId": "codex"}}}
        client._route_notification(rate_limits)
        self.assertEqual(seen, [rate_limits])
        self.assertEqual(len([item for item in factory.process.messages if item.get("method") == "account/login/start"]), 1)


if __name__ == "__main__":
    unittest.main()
