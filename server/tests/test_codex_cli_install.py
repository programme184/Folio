"""Install the official Codex CLI without contacting npm or writing a real login."""
from __future__ import annotations

import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

import codex_auth


def _npm(home: Path) -> None:
    directory = home / ".local" / "node" / "bin"
    directory.mkdir(parents=True)
    script = directory / "npm"
    script.write_text(
        "#!/bin/sh\n"
        "printf '%s\\n' \"$@\" > \"$HOME/npm-args\"\n"
        "prefix=\n"
        "previous=\n"
        "for arg in \"$@\"; do\n"
        "  if [ \"$previous\" = --prefix ]; then prefix=$arg; fi\n"
        "  previous=$arg\n"
        "done\n"
        "mkdir -p \"$prefix/bin\"\n"
        "printf '%s\\n' '#!/bin/sh' 'echo codex-test' > \"$prefix/bin/codex\"\n"
        "chmod 755 \"$prefix/bin/codex\"\n"
    )
    script.chmod(0o755)


class CodexCLIInstallTests(unittest.TestCase):
    def test_existing_command_is_reused(self):
        with tempfile.TemporaryDirectory() as raw:
            home = Path(raw)
            binary = home / ".local" / "bin" / "codex"
            binary.parent.mkdir(parents=True)
            binary.write_text("#!/bin/sh\necho already\n")
            binary.chmod(0o755)
            with patch("codex_auth.subprocess.run") as run:
                found = codex_auth.ensure_codex_cli({"HOME": str(home), "PATH": "/usr/bin:/bin"})
            run.assert_not_called()
            self.assertEqual(found, str(binary))

    def test_npm_installs_the_official_package_into_local_bin(self):
        with tempfile.TemporaryDirectory() as raw:
            home = Path(raw)
            _npm(home)
            found = codex_auth.ensure_codex_cli({"HOME": str(home), "PATH": "/usr/bin:/bin"})
            self.assertEqual(found, str(home / ".local" / "bin" / "codex"))
            self.assertTrue(os.access(found, os.X_OK))
            args = (home / "npm-args").read_text().splitlines()
            self.assertEqual(args[:3], ["install", "-g", "--prefix"])
            self.assertEqual(args[3], str(home / ".local"))
            self.assertEqual(args[4], "@openai/codex")
            self.assertEqual(stat.S_IMODE(Path(found).stat().st_mode) & 0o111, 0o111)

    def test_npm_failure_does_not_claim_the_command_exists(self):
        with tempfile.TemporaryDirectory() as raw:
            home = Path(raw)
            directory = home / ".local" / "node" / "bin"
            directory.mkdir(parents=True)
            npm = directory / "npm"
            npm.write_text("#!/bin/sh\nexit 7\n")
            npm.chmod(0o755)
            with self.assertRaises(codex_auth.CodexCLIInstallError) as raised:
                codex_auth.ensure_codex_cli({"HOME": str(home), "PATH": "/usr/bin:/bin"})
            self.assertIn("exited 7", str(raised.exception))
            self.assertFalse((home / ".local" / "bin" / "codex").exists())
