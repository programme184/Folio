"""Desktop Cursor login is copied into a missing CLI auth file. Synthetic tokens only."""
import base64
import json
import os
import sqlite3
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import cursor_desktop_login as desktop
import provider_connections as connections
import title_generation as titles


def session_token(*, expiry=None, issuer="https://authentication.cursor.sh"):
    payload = base64.urlsafe_b64encode(json.dumps({
        "iss": issuer,
        "exp": int(time.time() + 3600 if expiry is None else expiry),
        "sub": "auth0|user_TEST",
    }).encode()).decode().rstrip("=")
    return f"header.{payload}.signature"


def write_database(path: Path, access: str, refresh: str, *, mode=0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() or path.is_symlink():
        path.unlink()
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)")
    connection.executemany(
        "INSERT INTO ItemTable (key, value) VALUES (?, ?)",
        (
            ("cursorAuth/accessToken", access),
            ("cursorAuth/refreshToken", refresh),
            ("cursorAuth/cachedEmail", "person@example.com"),
        ),
    )
    connection.commit()
    connection.close()
    os.chmod(path, mode)


class DesktopLoginTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.env = {"HOME": str(self.root), "XDG_CONFIG_HOME": str(self.root / "config")}
        self.access = session_token()
        self.refresh = session_token()

    def tearDown(self):
        self.temp.cleanup()

    def database(self, access=None, refresh=None, **kwargs):
        write_database(
            desktop.desktop_state_path(self.env),
            self.access if access is None else access,
            self.refresh if refresh is None else refresh,
            **kwargs,
        )

    def test_cli_import_replaces_the_file_and_drops_extra_fields(self):
        path = desktop.cli_auth_path(self.env)
        desktop.install_cli_auth(self.env, {"accessToken": self.access, "refreshToken": self.refresh, "email": "person@example.com"})
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(json.loads(path.read_text()), {"accessToken": self.access, "refreshToken": self.refresh})
        with self.assertRaises(HTTPException) as rejected:
            desktop.install_cli_auth(self.env, {"accessToken": "not-a-token", "refreshToken": self.refresh})
        self.assertEqual(rejected.exception.status_code, 400)
        self.assertEqual(json.loads(path.read_text())["accessToken"], self.access)
        app = FastAPI()
        app.include_router(desktop.create_import_router(authorize=lambda request: None,
            install=lambda document: desktop.install_cli_auth(self.env, document)))
        client = TestClient(app)
        self.addCleanup(client.close)
        response = client.post("/api/admin/cursor/auth/import", json={"accessToken": self.access, "refreshToken": self.refresh})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"imported": True})
        self.assertNotIn(self.access, response.text)
        echoed = client.post("/api/admin/cursor/auth/import", json={"apiKey": "not a token"})
        self.assertEqual(echoed.status_code, 400, echoed.text)
        self.assertNotIn("not a token", echoed.text)

    def test_missing_desktop_login_creates_nothing(self):
        self.assertEqual(desktop.share_desktop_login(self.env), "absent")
        self.assertFalse(desktop.cli_auth_path(self.env).exists())

    def test_desktop_session_is_copied_once_without_profile_fields(self):
        self.database()
        before = desktop.desktop_state_path(self.env).read_bytes()
        self.assertEqual(desktop.share_desktop_login(self.env), "shared")
        path = desktop.cli_auth_path(self.env)
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)
        saved = json.loads(path.read_text())
        self.assertEqual(saved, {"accessToken": self.access, "refreshToken": self.refresh})
        self.assertNotIn("person@example.com", path.read_text())
        self.assertEqual(desktop.desktop_state_path(self.env).read_bytes(), before)
        self.assertEqual(desktop.share_desktop_login(self.env), "present")
        self.assertEqual(json.loads(path.read_text()), saved)

    def test_existing_cli_login_is_not_replaced(self):
        self.database()
        path = desktop.cli_auth_path(self.env)
        path.parent.mkdir(mode=0o700)
        original = {"accessToken": session_token(), "refreshToken": session_token()}
        path.write_text(json.dumps(original))
        os.chmod(path, 0o600)
        self.assertEqual(desktop.share_desktop_login(self.env), "present")
        self.assertEqual(json.loads(path.read_text()), original)

    def test_api_key_file_is_left_alone(self):
        self.database()
        path = desktop.cli_auth_path(self.env)
        path.parent.mkdir(mode=0o700)
        path.write_text(json.dumps({"apiKey": "synthetic-cursor-key"}))
        os.chmod(path, 0o600)
        self.assertEqual(desktop.share_desktop_login(self.env), "present")
        self.assertEqual(json.loads(path.read_text())["apiKey"], "synthetic-cursor-key")

    def test_expired_or_foreign_tokens_are_not_copied(self):
        for access, refresh in (
            (session_token(expiry=time.time() - 10), session_token()),
            (session_token(issuer="https://example.invalid"), session_token()),
            ("opaque-access-token", "opaque-refresh-token"),
        ):
            with self.subTest(access=access[:12]):
                write_database(desktop.desktop_state_path(self.env), access, refresh)
                self.assertEqual(desktop.share_desktop_login(self.env), "absent")
                self.assertFalse(desktop.cli_auth_path(self.env).exists())

    def test_symlink_and_group_writable_database_are_ignored(self):
        real = self.root / "real.vscdb"
        write_database(real, self.access, self.refresh)
        link = desktop.desktop_state_path(self.env)
        link.parent.mkdir(parents=True)
        link.symlink_to(real)
        self.assertEqual(desktop.share_desktop_login(self.env), "absent")
        link.unlink()
        write_database(link, self.access, self.refresh, mode=0o666)
        self.assertEqual(desktop.share_desktop_login(self.env), "absent")
        self.assertFalse(desktop.cli_auth_path(self.env).exists())

    def test_symlink_auth_file_is_not_followed(self):
        self.database()
        outside = self.root / "outside.json"
        outside.write_text('{"replaced":true}')
        path = desktop.cli_auth_path(self.env)
        path.parent.mkdir(mode=0o700)
        path.symlink_to(outside)
        self.assertEqual(desktop.share_desktop_login(self.env), "absent")
        self.assertEqual(outside.read_text(), '{"replaced":true}')

    def test_title_profile_uses_the_shared_file_and_not_the_environment(self):
        home = self.root / "original"
        home.mkdir()
        target = self.root / "isolated"
        target.mkdir()
        env = {"HOME": str(home), "PATH": "/bin"}
        write_database(desktop.desktop_state_path(env), self.access, self.refresh)
        _workspace, isolated = titles.cursor_profile(target, env)
        copied = json.loads((target / "home" / ".config" / "cursor" / "auth.json").read_text())
        self.assertEqual(copied["accessToken"], self.access)
        self.assertNotIn("person@example.com", json.dumps(copied))
        self.assertEqual(isolated["AGENT_CLI_CREDENTIAL_STORE"], "file")
        self.assertNotIn(self.access, json.dumps({k: v for k, v in isolated.items() if k != "AGENT_CLI_CREDENTIAL_STORE"}))

    def test_presence_follows_the_cli_file_and_not_an_explicit_logout(self):
        self.database()
        self.assertEqual(desktop.share_desktop_login(self.env), "shared")
        with patch.dict(os.environ, self.env, clear=True):
            self.assertFalse(connections.native_credentials_present("cursor", {"installed": False}))
            self.assertFalse(connections.native_credentials_present("cursor", {"installed": True, "authenticated": False}))
            self.assertTrue(connections.native_credentials_present("cursor", {"installed": True, "authenticated": None}))


class ProbeTests(unittest.TestCase):
    def test_status_probe_shares_before_asking_the_cli(self):
        import agent_server

        calls = []

        def share(env):
            calls.append(("share", env))
            return "shared"

        def command(args):
            calls.append(("command", args))
            return subprocess.CompletedProcess(args, 0, stdout="Logged in as user@example.com\n", stderr="")

        with patch.object(agent_server, "cursor_api_key_configured", return_value=False), patch.object(
            desktop, "share_desktop_login", side_effect=share
        ), patch.object(agent_server, "runner_env", return_value={"HOME": "/fixture"}), patch.object(
            agent_server, "runtime_command", side_effect=command
        ):
            self.assertEqual(agent_server.cursor_auth_probe_state("/bin/agent"), "ready")
        self.assertEqual(calls[0], ("share", {"HOME": "/fixture"}))
        self.assertEqual(calls[1][1][1], "status")

    def test_api_key_probe_does_not_import_the_desktop_login(self):
        import agent_server

        with patch.object(agent_server, "cursor_api_key_configured", return_value=True), patch.object(
            desktop, "share_desktop_login"
        ) as share, patch.object(
            agent_server, "runtime_command",
            return_value=subprocess.CompletedProcess(["/bin/agent", "--list-models"], 0, stdout="auto\n", stderr=""),
        ):
            self.assertEqual(agent_server.cursor_auth_probe_state("/bin/agent"), "ready")
        share.assert_not_called()
