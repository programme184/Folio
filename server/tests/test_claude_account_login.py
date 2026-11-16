"""Claude browser sign-in drives the CLI and never returns CLI output. Fake CLI only."""
import os
import stat
import tempfile
import textwrap
import unittest
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import claude_account_login as login

URL = "https://claude.com/cai/oauth/authorize?code=true&client_id=test&state=abc"
CODE = "AbCdEf123456#stateTOKEN"


def fake_cli(directory: Path, *, accept: str = CODE, banner: str = URL) -> str:
    path = directory / "claude"
    path.write_text(textwrap.dedent(f"""\
        #!/usr/bin/env python3
        import sys
        print("Opening browser to sign in...", flush=True)
        print("If the browser didn't open, visit: {banner}", flush=True)
        sys.stdout.write("Paste code here if prompted > "); sys.stdout.flush()
        line = sys.stdin.readline().strip()
        print("secret-account-detail user@example.com")
        sys.exit(0 if line == {accept!r} else 1)
    """))
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return str(path)


class AuthorizeUrlTests(unittest.TestCase):
    def test_accepts_only_anthropic_authorize_links(self):
        self.assertEqual(login.authorize_url(f"visit: {URL}\n"), URL)
        self.assertIsNone(login.authorize_url("https://evil.example/cai/oauth/authorize"))
        self.assertIsNone(login.authorize_url("http://claude.com/cai/oauth/authorize"))
        self.assertIsNone(login.authorize_url("https://claude.com/other"))


class RouterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.signed_in = 0

    def client(self, executable: str, authorize=lambda request: None):
        manager = login.ClaudeLoginManager(executable=lambda: executable, environment=lambda: dict(os.environ))
        app = FastAPI()
        def on_signed_in():
            self.signed_in += 1
        app.include_router(login.create_router(authorize=authorize, manager=manager, on_signed_in=on_signed_in))
        return TestClient(app)

    def test_start_then_complete_signs_in_without_echoing_cli_output(self):
        with self.client(fake_cli(Path(self.temp.name))) as client:
            started = client.post("/api/admin/claude/auth/login", json={})
            self.assertEqual(started.status_code, 200)
            self.assertEqual(started.json()["url"], URL)
            done = client.post("/api/admin/claude/auth/login/complete",
                               json={"login_id": started.json()["login_id"], "code": CODE})
            self.assertEqual(done.status_code, 200)
            self.assertEqual(done.json(), {"signed_in": True})
            self.assertNotIn("secret-account-detail", done.text)
        self.assertEqual(self.signed_in, 1)

    def test_wrong_code_is_rejected_generically(self):
        with self.client(fake_cli(Path(self.temp.name))) as client:
            started = client.post("/api/admin/claude/auth/login", json={}).json()
            bad = client.post("/api/admin/claude/auth/login/complete",
                              json={"login_id": started["login_id"], "code": "WrongCode123456#x"})
            self.assertEqual(bad.status_code, 422)
            self.assertNotIn("secret-account-detail", bad.text)
            again = client.post("/api/admin/claude/auth/login/complete",
                                json={"login_id": started["login_id"], "code": CODE})
            self.assertEqual(again.status_code, 409)
        self.assertEqual(self.signed_in, 0)

    def test_unknown_login_id_and_malformed_code(self):
        with self.client(fake_cli(Path(self.temp.name))) as client:
            started = client.post("/api/admin/claude/auth/login", json={}).json()
            self.assertEqual(client.post("/api/admin/claude/auth/login/complete",
                json={"login_id": "x" * 24, "code": CODE}).status_code, 409)
            for code in ("short", "has space in it 123456", "a" * 600, 7, None):
                reply = client.post("/api/admin/claude/auth/login/complete",
                                    json={"login_id": started["login_id"], "code": code})
                self.assertEqual(reply.status_code, 400, code)

    def test_cli_without_sign_in_link_fails_cleanly(self):
        with self.client(fake_cli(Path(self.temp.name), banner="https://evil.example/authorize")) as client:
            self.assertEqual(client.post("/api/admin/claude/auth/login", json={}).status_code, 502)

    def test_missing_cli_and_cancel(self):
        with self.client(str(Path(self.temp.name) / "absent")) as client:
            self.assertEqual(client.post("/api/admin/claude/auth/login", json={}).status_code, 503)
        with self.client(fake_cli(Path(self.temp.name))) as client:
            started = client.post("/api/admin/claude/auth/login", json={}).json()
            self.assertEqual(client.delete("/api/admin/claude/auth/login").status_code, 200)
            self.assertEqual(client.post("/api/admin/claude/auth/login/complete",
                json={"login_id": started["login_id"], "code": CODE}).status_code, 409)

    def test_authorization_is_enforced_on_every_route(self):
        def deny(request):
            raise HTTPException(403, "forbidden")
        with self.client(fake_cli(Path(self.temp.name)), authorize=deny) as client:
            self.assertEqual(client.post("/api/admin/claude/auth/login", json={}).status_code, 403)
            self.assertEqual(client.post("/api/admin/claude/auth/login/complete", json={}).status_code, 403)
            self.assertEqual(client.delete("/api/admin/claude/auth/login").status_code, 403)


if __name__ == "__main__":
    unittest.main()
