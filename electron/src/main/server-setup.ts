import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app, net } from 'electron'
import type {
  ServerSetupCapabilities,
  ServerSetupDiagnostics,
  ServerSetupInput,
  ServerSetupProgress,
  ServerSetupResult
} from '../shared/types'
import { mergeConnectionURLs, prioritizeConnectionURLs } from '../shared/server-connection-link'
import { appLog } from './logger'
import { resolveServerSetupRelease, serverSetupVersionGuard, type PinnedServerRelease } from './server-setup-release'
const RESULT_PREFIX = 'AGENTSDOCK_SETUP_RESULT='
const PREFLIGHT_ERROR_PREFIX = 'AGENTSDOCK_PREFLIGHT_ERROR='
const PREFLIGHT_WARNING_PREFIX = 'AGENTSDOCK_PREFLIGHT_WARNING='
const LAUNCHD_RESTART_FAILURE = 'macOS could not restart AgentsServer.'
const LAUNCHD_STOPPING_FAILURE = 'macOS is still stopping the previous AgentsServer service.'
const LAUNCHD_RETRY_DELAY_MS = 600
const SETUP_LOG_MAX_BYTES = 2 * 1024 * 1024
const SETUP_LOG_TAIL_LINES = 100
const MINIMUM_DIRECT_CONNECT_API_CONTRACT = 8
const electronFetch = ((input: URL | RequestInfo, init?: RequestInit) => (
  net.fetch(input instanceof URL ? input.toString() : input, init)
)) as typeof fetch
const DEFAULT_TIMINGS: ServerSetupTimings = Object.freeze({
  // The packaged installer allows up to 5 minutes for uv installation and
  // 20 minutes for dependency resolution. Keep the enclosing watchdog above
  // those bounded stages so AgentsDock never kills a still-valid install first.
  overallTimeoutMs: 40 * 60_000,
  inactivityTimeoutMs: 6 * 60_000,
  heartbeatMs: 15_000,
  terminateGraceMs: 2_000,
  stageTimeoutMs: {
    connect: 60_000,
    download: 6 * 60_000,
    runtime: 26 * 60_000,
    install: 6 * 60_000,
    service: 4 * 60_000,
    health: 4 * 60_000,
    diagnostics: 4 * 60_000,
    complete: 60_000
  }
})

type SetupDownload = (
  url: string,
  destination: string,
  options: { sha256?: string; maxBytes: number; signal?: AbortSignal }
) => Promise<void>

export interface ServerSetupTimings {
  overallTimeoutMs: number
  inactivityTimeoutMs: number
  heartbeatMs: number
  terminateGraceMs: number
  stageTimeoutMs: Record<ServerSetupProgress['phase'], number>
}

interface ProcessRunOptions {
  phase?: ServerSetupProgress['phase']
  message?: string
  environment?: NodeJS.ProcessEnv
}
export const SERVER_SETUP_PATH_BOOTSTRAP = `AGENTSDOCK_PREFLIGHT_CONFIG_DIR="\${AGENTS_SERVER_CONFIG_DIR:-$HOME/.config/agents-server}"
AGENTSDOCK_PREFLIGHT_ENV_FILE="$AGENTSDOCK_PREFLIGHT_CONFIG_DIR/env"
AGENTSDOCK_PREFLIGHT_SAVED_PATH=""
AGENTSDOCK_PREFLIGHT_LINE=""
if [ -r "$AGENTSDOCK_PREFLIGHT_ENV_FILE" ]; then
  while IFS= read -r AGENTSDOCK_PREFLIGHT_LINE || [ -n "$AGENTSDOCK_PREFLIGHT_LINE" ]; do
    case "$AGENTSDOCK_PREFLIGHT_LINE" in
      PATH=*) AGENTSDOCK_PREFLIGHT_SAVED_PATH="\${AGENTSDOCK_PREFLIGHT_LINE#PATH=}" ;;
    esac
  done < "$AGENTSDOCK_PREFLIGHT_ENV_FILE"
fi
export PATH="\${AGENTSDOCK_PREFLIGHT_SAVED_PATH:+$AGENTSDOCK_PREFLIGHT_SAVED_PATH:}$HOME/.local/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/home/linuxbrew/.linuxbrew/bin:/usr/bin:/bin:/usr/sbin:/sbin\${PATH:+:$PATH}"
`
export const REMOTE_EXISTING_SERVER_DISCOVERY_SCRIPT = `set -u
AGENTSDOCK_DISCOVERY_PORT="\${1:-7850}"
AGENTSDOCK_DISCOVERY_MINIMUM_API="\${2:-8}"
case "$AGENTSDOCK_DISCOVERY_PORT" in *[!0-9]*|'') exit 0 ;; esac
case "$AGENTSDOCK_DISCOVERY_MINIMUM_API" in *[!0-9]*|'') exit 0 ;; esac
AGENTSDOCK_DISCOVERY_INSTALL_ROOT="\${AGENTS_SERVER_INSTALL_DIR:-$HOME/.local/share/agents-server}"
AGENTSDOCK_DISCOVERY_CONFIG_ROOT="\${AGENTS_SERVER_CONFIG_DIR:-$HOME/.config/agents-server}"
AGENTSDOCK_DISCOVERY_PYTHON="$AGENTSDOCK_DISCOVERY_INSTALL_ROOT/current/.venv/bin/python"
AGENTSDOCK_DISCOVERY_ENV="$AGENTSDOCK_DISCOVERY_CONFIG_ROOT/env"
if [ ! -x "$AGENTSDOCK_DISCOVERY_PYTHON" ] || [ ! -f "$AGENTSDOCK_DISCOVERY_ENV" ]; then
  exit 0
fi
"$AGENTSDOCK_DISCOVERY_PYTHON" - "$AGENTSDOCK_DISCOVERY_ENV" "$AGENTSDOCK_DISCOVERY_PORT" "$AGENTSDOCK_DISCOVERY_MINIMUM_API" <<'PY'
import ipaddress
import json
import os
import stat
import sys
import urllib.request
import urllib.parse


def unavailable():
    raise SystemExit(0)


try:
    env_path = sys.argv[1]
    requested_port = int(sys.argv[2])
    minimum_api = int(sys.argv[3])
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(env_path, flags)
    try:
        before = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != os.geteuid()
            or before.st_nlink != 1
            or stat.S_IMODE(before.st_mode) & 0o022
            or not 1 <= before.st_size <= 65536
        ):
            unavailable()
        payload = b""
        while len(payload) <= 65536:
            chunk = os.read(descriptor, min(8192, 65537 - len(payload)))
            if not chunk:
                break
            payload += chunk
        after = os.fstat(descriptor)
        linked = os.stat(env_path, follow_symlinks=False)
        if (
            len(payload) != before.st_size
            or bytes([0]) in payload
            or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
            != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
            or (before.st_dev, before.st_ino) != (linked.st_dev, linked.st_ino)
        ):
            unavailable()
    finally:
        os.close(descriptor)

    values = {}
    for line in payload.decode("utf-8", "strict").splitlines():
        name, separator, value = line.partition("=")
        if separator and name in {
            "AGENTSDOCK_AGENT_BIND",
            "AGENTSDOCK_AGENT_PORT",
            "AGENTSDOCK_AGENT_TOKEN",
        }:
            values[name] = value
    token = values.get("AGENTSDOCK_AGENT_TOKEN", "")
    if not 32 <= len(token) <= 512 or not token.isascii() or any(character.isspace() for character in token):
        unavailable()
    port = int(values.get("AGENTSDOCK_AGENT_PORT", str(requested_port)))
    if not 1 <= port <= 65535:
        unavailable()
    bind = ipaddress.ip_address(values.get("AGENTSDOCK_AGENT_BIND", "0.0.0.0"))
    if bind.is_loopback:
        # A loopback-only server needs a durable SSH forwarding profile, which
        # guided setup does not create yet. Keep the installer fallback honest.
        unavailable()
    if bind.is_unspecified:
        probe_host = "127.0.0.1"
        result_host = "127.0.0.1"
    else:
        probe_host = f"[{bind}]" if bind.version == 6 else str(bind)
        result_host = probe_host
    request = urllib.request.Request(
        f"http://{probe_host}:{port}/api/health",
        headers={"Accept": "application/json", "Authorization": f"Bearer {token}"},
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=5) as response:
        if response.status != 200:
            unavailable()
        body = response.read(65537)
    if len(body) > 65536:
        unavailable()
    health = json.loads(body)
    api_contract = health.get("api_contract_version")
    if health.get("ok") is not True or not isinstance(api_contract, int) or api_contract < minimum_api:
        unavailable()
    server_identity = health.get("server_identity")
    if not isinstance(server_identity, str) or not 1 <= len(server_identity) <= 256:
        unavailable()
    address_request = urllib.request.Request(
        f"http://{probe_host}:{port}/api/connection-addresses",
        headers={"Accept": "application/json", "X-AgentsDock-Token": token},
    )
    with opener.open(address_request, timeout=5) as response:
        if response.status != 200:
            unavailable()
        address_body = response.read(8193)
    if len(address_body) > 8192:
        unavailable()
    advertised = json.loads(address_body)
    addresses = advertised.get("urls")
    if advertised.get("version") != 1 or advertised.get("server_identity") != server_identity or not isinstance(addresses, list) or not 1 <= len(addresses) <= 6:
        unavailable()
    checked_addresses = []
    for address in addresses:
        if not isinstance(address, str) or not 1 <= len(address) <= 2048 or any(character.isspace() for character in address):
            unavailable()
        parsed = urllib.parse.urlsplit(address)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            unavailable()
        checked_addresses.append(address.rstrip("/"))
    version = health.get("server_version")
    if not isinstance(version, str) or not 1 <= len(version) <= 128:
        version = None
    result = {
        "server_url": f"http://{result_host}:{port}",
        "access_token": token,
        "service": "existing-ssh",
        "tailscale_ip": "",
        "server_urls": checked_addresses,
    }
    if version is not None:
        result["server_version"] = version
    print("[AgentsDock setup] Existing compatible AgentsServer is healthy; connecting without reinstalling.")
    print("AGENTSDOCK_SETUP_RESULT=" + json.dumps(result, ensure_ascii=True, separators=(",", ":")))
except (OSError, UnicodeError, ValueError, TypeError, json.JSONDecodeError):
    unavailable()
PY
`
export const SERVER_SETUP_PREFLIGHT_SCRIPT = `set -u
${SERVER_SETUP_PATH_BOOTSTRAP}
agentsdock_preflight_fail() {
  printf '${PREFLIGHT_ERROR_PREFIX}%s\n' "$1" >&2
  exit 78
}
AGENTSDOCK_PREFLIGHT_MISSING=""
agentsdock_preflight_require() {
  AGENTSDOCK_PREFLIGHT_TOOL="$1"
  shift
  if ! command -v "$AGENTSDOCK_PREFLIGHT_TOOL" >/dev/null 2>&1 || ! "$@" >/dev/null 2>&1; then
    AGENTSDOCK_PREFLIGHT_MISSING="\${AGENTSDOCK_PREFLIGHT_MISSING:+$AGENTSDOCK_PREFLIGHT_MISSING }$AGENTSDOCK_PREFLIGHT_TOOL"
  fi
}
agentsdock_preflight_require curl curl --version
agentsdock_preflight_require bash bash --version
agentsdock_preflight_require tar tar --version
if ! command -v tmux >/dev/null 2>&1 || ! tmux -V >/dev/null 2>&1; then
  printf '${PREFLIGHT_WARNING_PREFIX}%s\n' "tmux is unavailable. Guided setup will continue, but background terminal sessions will remain disabled until tmux is installed." >&2
fi
if command -v shasum >/dev/null 2>&1 && shasum -a 256 /dev/null >/dev/null 2>&1; then
  :
elif command -v sha256sum >/dev/null 2>&1 && sha256sum /dev/null >/dev/null 2>&1; then
  :
else
  AGENTSDOCK_PREFLIGHT_MISSING="\${AGENTSDOCK_PREFLIGHT_MISSING:+$AGENTSDOCK_PREFLIGHT_MISSING }SHA-256"
fi
AGENTSDOCK_PREFLIGHT_OS="$(uname -s 2>/dev/null || printf unknown)"
if [ -n "$AGENTSDOCK_PREFLIGHT_MISSING" ]; then
  case "$AGENTSDOCK_PREFLIGHT_OS" in
    Darwin) agentsdock_preflight_fail "Missing guided-setup prerequisites: $AGENTSDOCK_PREFLIGHT_MISSING. Install them with Homebrew (brew install $AGENTSDOCK_PREFLIGHT_MISSING), then retry guided setup; do not run AgentsDock as root." ;;
    Linux) agentsdock_preflight_fail "Missing guided-setup prerequisites: $AGENTSDOCK_PREFLIGHT_MISSING. Install them with this server's package manager, then retry guided setup; do not run the installer with sudo." ;;
    *) agentsdock_preflight_fail "Missing guided-setup prerequisites on $AGENTSDOCK_PREFLIGHT_OS: $AGENTSDOCK_PREFLIGHT_MISSING. Install them, then retry guided setup." ;;
  esac
fi
case "$AGENTSDOCK_PREFLIGHT_OS" in
  Darwin)
    AGENTSDOCK_PREFLIGHT_UID="$(id -u)"
    if ! /bin/launchctl print "gui/$AGENTSDOCK_PREFLIGHT_UID" >/dev/null 2>&1; then
      agentsdock_preflight_fail "The macOS launchd GUI domain gui/$AGENTSDOCK_PREFLIGHT_UID is unavailable. Sign in to this Mac's desktop as the target user, verify 'launchctl print gui/$AGENTSDOCK_PREFLIGHT_UID', then retry guided setup; do not run AgentsDock as root."
    fi
    ;;
  Linux)
    if ! command -v systemctl >/dev/null 2>&1; then
      agentsdock_preflight_fail "The Linux systemctl command is unavailable. Guided setup requires systemd user services; install or enable systemd for this host, then retry without sudo."
    fi
    if ! systemctl --user show-environment >/dev/null 2>&1; then
      agentsdock_preflight_fail "The systemctl --user session is unavailable. Sign in as the target user or ask an administrator to enable that user's systemd manager, verify 'systemctl --user show-environment', then retry guided setup without sudo."
    fi
    ;;
    *) agentsdock_preflight_fail "Guided setup does not support $AGENTSDOCK_PREFLIGHT_OS. Use a macOS launchd GUI user session or a Linux systemd user session." ;;
esac
printf 'AGENTSDOCK_REMOTE_PLATFORM=%s %s\n' "$(uname -s 2>/dev/null || printf unknown)" "$(uname -m 2>/dev/null || printf unknown)" >&2
`
// The published installer still selects Python >=3.10, drops proxy variables,
// and treats systemd 249's silent is-enabled as an unknown service state.
// Prepare those three before running that installer. $1 is a private bin
// directory; $2 is the extracted install.sh when it should be patched.
export const SERVER_SETUP_HOST_PREP_SCRIPT = `set -eu
COMPAT_BIN="\${1:?}"
INSTALLER="\${2:-}"
PREBUILT_UV="\${3:-}"
mkdir -p "$COMPAT_BIN" "$HOME/.local/bin"
case "$PREBUILT_UV" in
  '') ;;
  /*) ;;
  *) echo "Invalid uv path." >&2; exit 1 ;;
esac
if [ -n "$PREBUILT_UV" ]; then
  if [ ! -f "$PREBUILT_UV" ]; then
    echo "The prepared uv program is missing." >&2
    exit 1
  fi
  install -m 755 "$PREBUILT_UV" "$HOME/.local/bin/uv"
  rm -f "$PREBUILT_UV"
fi

folio_safe_value() {
  case "$1" in
    *[[:space:]]*) return 1 ;;
  esac
  printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._~:/?@+,=%-]+$' || return 1
  printf '%s' "$1"
}

folio_safe_proxy() {
  case "$1" in
    http://*|https://*|socks5://*|socks5h://*) ;;
    *) return 1 ;;
  esac
  folio_safe_value "$1"
}

folio_install_uv() {
  folio_arch="$(uname -m)"
  folio_os="$(uname -s)"
  case "$folio_os:$folio_arch" in
    Linux:x86_64) folio_target="x86_64-unknown-linux-gnu" ;;
    Linux:aarch64|Linux:arm64) folio_target="aarch64-unknown-linux-gnu" ;;
    Darwin:arm64) folio_target="aarch64-apple-darwin" ;;
    Darwin:x86_64) folio_target="x86_64-apple-darwin" ;;
    *) echo "Guided setup cannot install uv on $folio_os $folio_arch." >&2; return 1 ;;
  esac
  folio_archive="$(mktemp)"
  folio_extract="$(mktemp -d)"
  curl --fail --location --silent --show-error --connect-timeout 15 --max-time 300 --retry 3 --retry-delay 2 \\
    "https://github.com/astral-sh/uv/releases/latest/download/uv-\${folio_target}.tar.gz" -o "$folio_archive"
  tar -xzf "$folio_archive" -C "$folio_extract"
  install -m 755 "$folio_extract"/uv-*/uv "$HOME/.local/bin/uv"
  rm -rf "$folio_archive" "$folio_extract"
}

if ! command -v uv >/dev/null 2>&1 || ! uv --version >/dev/null 2>&1; then
  folio_install_uv
fi
UV_BIN="$(command -v uv)"
if ! PY="$("$UV_BIN" python find 3.12 2>/dev/null)"; then
  "$UV_BIN" python install 3.12
  PY="$("$UV_BIN" python find 3.12)"
fi
PY_RESOLVED="$(readlink -f "$PY" 2>/dev/null || printf '%s' "$PY")"
case "$UV_BIN" in
  *[!A-Za-z0-9._~:/@+-]*) echo "Guided setup found uv at an unsupported path." >&2; exit 1 ;;
esac
if [ -O "$PY_RESOLVED" ]; then
  chmod go-w "$PY_RESOLVED"
fi

if [ "$(uname -s)" = "Linux" ]; then
  cat > "$COMPAT_BIN/systemctl" <<'EOF'
#!/bin/sh
if [ "$1" = "--user" ] && [ "$2" = "is-enabled" ]; then
  folio_err="$(mktemp)"
  folio_out="$(/usr/bin/systemctl "$@" 2>"$folio_err")"
  folio_code="$?"
  if [ -z "$folio_out" ] && [ "$folio_code" -eq 1 ] && grep -q "No such file or directory" "$folio_err"; then
    rm -f "$folio_err"
    echo not-found
    exit 1
  fi
  rm -f "$folio_err"
  if [ -n "$folio_out" ]; then
    printf '%s\\n' "$folio_out"
  fi
  exit "$folio_code"
fi
exec /usr/bin/systemctl "$@"
EOF
  chmod 755 "$COMPAT_BIN/systemctl"
fi

folio_proxy_script="$COMPAT_BIN/uv"
{
  printf '%s\\n' '#!/bin/sh'
  for folio_name in http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY no_proxy NO_PROXY; do
    eval "folio_value=\\\${$folio_name:-}"
    case "$folio_name" in
      no_proxy|NO_PROXY) folio_safe="$(folio_safe_value "$folio_value" 2>/dev/null || true)" ;;
      *) folio_safe="$(folio_safe_proxy "$folio_value" 2>/dev/null || true)" ;;
    esac
    if [ -n "$folio_safe" ]; then
      printf "export %s='%s'\\n" "$folio_name" "$folio_safe"
    fi
  done
  printf "exec '%s' \\"\\$@\\"\\n" "$UV_BIN"
} > "$folio_proxy_script"
chmod 755 "$folio_proxy_script"

if [ -n "$INSTALLER" ] && [ -f "$INSTALLER" ] && grep -q -- "--python '>=3.10'" "$INSTALLER"; then
  folio_tmp="$(mktemp)"
  sed "s/--python '>=3.10'/--python '>=3.11'/" "$INSTALLER" > "$folio_tmp"
  cat "$folio_tmp" > "$INSTALLER"
  rm -f "$folio_tmp"
fi
`
export function localReleaseBootstrap(release: PinnedServerRelease): string {
  return `set -eu
${SERVER_SETUP_PATH_BOOTSTRAP}
DESTINATION="$1"
VERSION="${release.version}"
RELEASE_URL="${release.url}"
EXPECTED_SHA="${release.sha256}"
WORK="\$(mktemp -d)"
trap 'rm -rf "\$WORK"' EXIT
ARCHIVE="\$WORK/agents-server.tar.gz"
printf '[AgentsDock setup] Downloading pinned AgentsServer %s\\n' "\$VERSION"
curl --fail --location --silent --show-error --connect-timeout 15 --max-time 300 --retry 3 --retry-delay 2 "\$RELEASE_URL" -o "\$ARCHIVE"
printf '[AgentsDock setup] Verifying downloaded archive\\n'
if command -v shasum >/dev/null 2>&1 && shasum -a 256 /dev/null >/dev/null 2>&1; then
  ACTUAL_SHA="\$(shasum -a 256 "\$ARCHIVE" | awk '{print \$1}')"
elif command -v sha256sum >/dev/null 2>&1 && sha256sum /dev/null >/dev/null 2>&1; then
  ACTUAL_SHA="\$(sha256sum "\$ARCHIVE" | awk '{print \$1}')"
else
  printf 'No working SHA-256 tool was found.\\n' >&2
  exit 2
fi
if [ "\$ACTUAL_SHA" != "\$EXPECTED_SHA" ]; then
  printf 'AgentsServer archive verification failed. Expected %s but received %s.\\n' "\$EXPECTED_SHA" "\$ACTUAL_SHA" >&2
  exit 2
fi
tar -xzf "\$ARCHIVE" -C "\$WORK"
SOURCE="\$WORK/agents-server-\$VERSION"
test "\$(tr -d '[:space:]' < "\$SOURCE/VERSION")" = "\$VERSION"
mv "\$SOURCE" "\$DESTINATION"
`
}

export function remoteReleaseBootstrap(release: PinnedServerRelease): string {
  return `set -eu
${SERVER_SETUP_PATH_BOOTSTRAP}
PORT="\${1:-7850}"
TEAM_HUB_HOST="\${2:-false}"
USE_LOCAL_ARCHIVE="\${3:-false}"
USE_LOCAL_UV="\${4:-false}"
case "$TEAM_HUB_HOST" in
  true|false) ;;
  *) printf 'Invalid Team Network host choice.\n' >&2; exit 2 ;;
esac
case "$USE_LOCAL_ARCHIVE" in
  true|false) ;;
  *) printf 'Invalid staged archive choice.\n' >&2; exit 2 ;;
esac
case "$USE_LOCAL_UV" in
  true|false) ;;
  *) printf 'Invalid staged runtime choice.\n' >&2; exit 2 ;;
esac
VERSION="${release.version}"
RELEASE_URL="${release.url}"
EXPECTED_SHA="${release.sha256}"
DIR="\$(mktemp -d)"
trap 'rm -rf "\$DIR"' EXIT
ARCHIVE="\$DIR/agents-server.tar.gz"
if [ "$USE_LOCAL_ARCHIVE" = true ]; then
  STAGED_ARCHIVE="$HOME/.cache/agentsdock-setup/agents-server.tar.gz"
  if [ ! -f "$STAGED_ARCHIVE" ]; then
    printf 'The AgentsServer archive uploaded over SSH is missing.\n' >&2
    exit 2
  fi
  printf '[AgentsDock setup] Installing pinned AgentsServer %s from this computer\\n' "\$VERSION"
  cp "$STAGED_ARCHIVE" "\$ARCHIVE"
  rm -f "$STAGED_ARCHIVE"
else
  printf '[AgentsDock setup] Downloading pinned AgentsServer %s\\n' "\$VERSION"
  if ! curl --fail --location --silent --show-error --connect-timeout 15 --max-time 300 --retry 3 --retry-delay 2 "\$RELEASE_URL" -o "\$ARCHIVE"; then
    printf 'The server could not download AgentsServer. Retry guided setup so this computer can upload the verified archive over SSH.\n' >&2
    exit 1
  fi
fi
printf '[AgentsDock setup] Verifying downloaded archive\\n'
if command -v shasum >/dev/null 2>&1 && shasum -a 256 /dev/null >/dev/null 2>&1; then
  ACTUAL_SHA="\$(shasum -a 256 "\$ARCHIVE" | awk '{print \$1}')"
elif command -v sha256sum >/dev/null 2>&1 && sha256sum /dev/null >/dev/null 2>&1; then
  ACTUAL_SHA="\$(sha256sum "\$ARCHIVE" | awk '{print \$1}')"
else
  printf 'No working SHA-256 tool was found.\\n' >&2
  exit 2
fi
if [ "\$ACTUAL_SHA" != "\$EXPECTED_SHA" ]; then
  printf 'AgentsServer archive verification failed. Expected %s but received %s.\\n' "\$EXPECTED_SHA" "\$ACTUAL_SHA" >&2
  exit 2
fi
tar -xzf "\$ARCHIVE" -C "\$DIR"
SOURCE="\$DIR/agents-server-\$VERSION"
test "\$(tr -d '[:space:]' < "\$SOURCE/VERSION")" = "\$VERSION"
INSTALL_PID=""
cancel_remote_install() {
  if [ -n "\$INSTALL_PID" ] && kill -0 "\$INSTALL_PID" >/dev/null 2>&1; then
    kill -TERM "\$INSTALL_PID" >/dev/null 2>&1 || true
    wait "\$INSTALL_PID" 2>/dev/null || true
  fi
  exit 130
}
trap cancel_remote_install HUP INT TERM
mkdir -p "\$DIR/compat-bin"
cat > "\$DIR/host-prep.sh" <<'AGENTSDOCK_HOST_PREP'
${SERVER_SETUP_HOST_PREP_SCRIPT}AGENTSDOCK_HOST_PREP
AGENTSDOCK_STAGED_UV=""
if [ "$USE_LOCAL_UV" = true ]; then
  AGENTSDOCK_STAGED_UV="$HOME/.cache/agentsdock-setup/uv"
  if [ ! -f "$AGENTSDOCK_STAGED_UV" ]; then
    printf 'The uv program uploaded over SSH is missing.\n' >&2
    exit 2
  fi
fi
/bin/sh "\$DIR/host-prep.sh" "\$DIR/compat-bin" "\$SOURCE/install.sh" "$AGENTSDOCK_STAGED_UV"
export PATH="\$DIR/compat-bin:\$PATH"
if [ "$TEAM_HUB_HOST" = "true" ]; then
  set -- --non-interactive --port "$PORT" --team-hub-host
else
  set -- --non-interactive --port "$PORT"
fi
"\$SOURCE/install.sh" "$@" &
INSTALL_PID="\$!"
INSTALL_STATUS=0
wait "\$INSTALL_PID" || INSTALL_STATUS="\$?"
INSTALL_PID=""
exit "\$INSTALL_STATUS"
`
}

export function serverSetupCapabilities(): ServerSetupCapabilities {
  const supportedPlatform = process.platform === 'darwin' || process.platform === 'linux'
  const sandboxed = Boolean(process.mas)
  return {
    available: supportedPlatform && !sandboxed,
    local: supportedPlatform && !sandboxed,
    ssh: supportedPlatform && !sandboxed,
    reason: sandboxed
      ? 'The App Store sandbox cannot install background services. Use the direct desktop build or the setup guide.'
      : supportedPlatform ? undefined : `One-click setup is not available on ${process.platform === 'win32' ? 'Windows' : process.platform}.`
  }
}

export function validateServerSetupInput(input: ServerSetupInput): Required<Pick<ServerSetupInput, 'target' | 'port' | 'track'>> & Pick<ServerSetupInput, 'teamHubHost'> & { sshHost?: string; sshPassword?: string; sshIdentityPath?: string } {
  const target = input.target
  if (target !== 'local' && target !== 'ssh') throw new Error('Choose where to install AgentsServer.')
  const track = input.track ?? 'stable'
  if (track !== 'stable' && track !== 'beta') throw new Error('Choose the Stable or Beta AgentsServer channel.')
  const teamHubHost = input.teamHubHost
  if (teamHubHost !== undefined && typeof teamHubHost !== 'boolean') {
    throw new Error('Choose whether this server should start a Team Network.')
  }
  const port = Number(input.port ?? 7850)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Port must be between 1024 and 65535. This is the AgentsServer HTTP API port, not the SSH port; SSH uses your SSH config.')
  }
  const hostChoice = teamHubHost === undefined ? {} : { teamHubHost }
  if (target === 'local') return { target, port, track, ...hostChoice }
  const sshHost = input.sshHost?.trim() || ''
  if (!sshHost || sshHost.startsWith('-') || !/^[A-Za-z0-9_.@%+:[\]-]+$/.test(sshHost)) {
    throw new Error('Enter an SSH host such as user@server or a configured SSH alias.')
  }
  if (input.sshPassword !== undefined && typeof input.sshPassword !== 'string') {
    throw new Error('Enter a valid SSH password.')
  }
  const sshPassword = input.sshPassword || undefined
  if (sshPassword && (Buffer.byteLength(sshPassword, 'utf8') > 4096 || /[\u0000\r\n]/.test(sshPassword))) {
    throw new Error('The SSH password is too long or contains an unsupported line break.')
  }
  const sshIdentityPath = validateSSHIdentityPath(input.sshIdentityPath)
  // A chosen private key authenticates by itself. Do not also submit a password.
  return {
    target,
    port,
    track,
    sshHost,
    ...(sshIdentityPath ? { sshIdentityPath } : sshPassword ? { sshPassword } : {}),
    ...hostChoice
  }
}

export function validateSSHIdentityPath(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string') throw new Error('Choose an SSH private key file.')
  const candidate = value.trim()
  if (!candidate.startsWith('/') || candidate.includes('\0') || /[\r\n]/.test(candidate)) {
    throw new Error('Choose an SSH private key file.')
  }
  let info: ReturnType<typeof statSync>
  try { info = statSync(candidate) } catch {
    throw new Error('The SSH private key file could not be read. Choose the key again.')
  }
  if (!info.isFile() || info.size < 1 || info.size > 1024 * 1024) {
    throw new Error('Choose an SSH private key file.')
  }
  return candidate
}

export function parseServerSetupResult(line: string): ServerSetupResult | null {
  if (!line.startsWith(RESULT_PREFIX)) return null
  const raw = JSON.parse(line.slice(RESULT_PREFIX.length)) as Record<string, unknown>
  const serverUrl = typeof raw.server_url === 'string' ? raw.server_url : ''
  const accessToken = typeof raw.access_token === 'string' ? raw.access_token : ''
  if (!/^https?:\/\//.test(serverUrl) || accessToken.length < 32) throw new Error('AgentsServer returned an invalid setup result.')
  let serverUrls: string[] | undefined
  if (raw.server_urls !== undefined) {
    try { serverUrls = prioritizeConnectionURLs(raw.server_urls) }
    catch { throw new Error('AgentsServer returned invalid connection addresses.') }
  }
  return {
    serverUrl,
    ...(serverUrls ? { serverUrls } : {}),
    accessToken,
    service: typeof raw.service === 'string' ? raw.service : 'user-service',
    tailscaleIP: typeof raw.tailscale_ip === 'string' ? raw.tailscale_ip : '',
    serverVersion: typeof raw.server_version === 'string' ? raw.server_version : undefined
  }
}

export function remoteFallbackURL(sshHost: string, port: number, resolvedHost?: string): string {
  let host = resolvedHost?.trim() || sshHost.slice(sshHost.lastIndexOf('@') + 1)
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`
  return `http://${host}:${port}`
}

export function parseSSHConfigHostname(output: string, sshHost: string): string {
  const configured = output
    .split(/\r\n|\r|\n/)
    .map(line => line.trim().match(/^hostname\s+(.+)$/i)?.[1]?.trim() || '')
    .find(Boolean)
  const fallback = sshHost.slice(sshHost.lastIndexOf('@') + 1).replace(/^\[|\]$/g, '')
  const candidate = configured || fallback
  return /^[A-Za-z0-9_.:%+-]+$/.test(candidate) ? candidate : fallback
}

export function serverSetupFailureMessage(lines: readonly string[], exitCode: number | null): string {
  const meaningful = lines.map(line => line.trim()).filter(Boolean)
  const preflight = [...meaningful].reverse().find(line => line.startsWith(PREFLIGHT_ERROR_PREFIX))
  if (preflight) return preflight.slice(PREFLIGHT_ERROR_PREFIX.length).trim()
  if (meaningful.some(line => /Bootstrap failed:\s*5:\s*Input\/output error/i.test(line))) {
    return `${LAUNCHD_RESTART_FAILURE} Wait a moment and try again; running AgentsDock as root is not required.`
  }
  if (meaningful.some(line => /Operation already in progress/i.test(line))) {
    return `${LAUNCHD_STOPPING_FAILURE} Wait a moment and try again; running AgentsDock as root is not required.`
  }
  const highPriority = [...meaningful].reverse().find(line => (
    /\bERROR\b|permission denied|address already in use|traceback|uncaught exception/i.test(serverSetupJournalMessage(line))
  ))
  if (highPriority) return serverSetupJournalMessage(highPriority)
  const detail = [...meaningful].reverse().find(line => !isBenignServerSetupFailureLine(line))
  return detail || `AgentsServer setup exited with status ${exitCode ?? 'unknown'}.`
}

function serverSetupJournalMessage(line: string): string {
  return line.trim().replace(
    /^[A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\S+\s+(?:python|systemd)(?:\[\d+\])?:\s*/i,
    ''
  )
}

export function isBenignServerSetupFailureLine(line: string): boolean {
  const value = line.trim()
  if (!value) return true
  if (/^Try re-running the command as root for richer errors\.?$/i.test(value)) return true
  if (/^The previous release(?: and service)? (?:was|were) restored\.?$/i.test(value)) return true
  if (/^[●○]\s+agents-server\.service\b/i.test(value)) return true
  if (/^(?:Loaded|Active|Main PID|Tasks|Memory|CPU|CGroup):\s+/i.test(value)) return true
  if (/^[├└]─\s*\d+\s+/i.test(value)) return true

  const journalMessage = serverSetupJournalMessage(value)
  return /^(?:INFO:\s*)?(?:Started server process \[\d+\]|Waiting for application startup\.?|Application startup complete\.?|Shutting down\.?|Waiting for application shutdown\.?|Application shutdown complete\.?|Finished server process \[\d+\])$/i.test(journalMessage)
    || /^(?:agents-server\.service:\s+)?Deactivated successfully\.?$/i.test(journalMessage)
    || /^(?:Started|Stopped)\s+AgentsServer\.?$/i.test(journalMessage)
}

export function isRetryableLaunchdSetupFailure(error: unknown): boolean {
  const value = error instanceof Error ? error.message : String(error)
  return value.startsWith(LAUNCHD_RESTART_FAILURE) || value.startsWith(LAUNCHD_STOPPING_FAILURE)
}

export class ServerSetupManager {
  private active: ChildProcessWithoutNullStreams | null = null
  private releaseAbort: AbortController | null = null
  private cancelRequested = false
  private overallDeadlineAt = 0
  private remotePlatform = ''
  private state: ServerSetupDiagnostics['state'] = 'idle'
  private diagnosticTail: string[] = []
  private startedAt?: string
  private updatedAt?: string
  private target?: ServerSetupInput['target']

  constructor(
    private readonly timings: ServerSetupTimings = DEFAULT_TIMINGS,
    private readonly resolveRelease: typeof resolveServerSetupRelease = (track, signal) => (
      resolveServerSetupRelease(track, signal, electronFetch)
    ),
    private readonly downloadFile: SetupDownload = (url, destination, options) => downloadVerifiedFile(url, destination, {
      ...options,
      fetchImpl: electronFetch
    })
  ) {}

  capabilities(): ServerSetupCapabilities { return serverSetupCapabilities() }

  configuredSSHHosts(): string[] { return configuredSSHHosts() }

  diagnostics(): ServerSetupDiagnostics {
    return {
      logPath: currentServerSetupLogPath(),
      state: this.state,
      tail: [...this.diagnosticTail],
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      target: this.target
    }
  }

  cancel(): boolean {
    if (this.state !== 'running') return false
    this.cancelRequested = true
    this.updatedAt = new Date().toISOString()
    this.recordDiagnostic('Cancellation requested by the user.')
    this.releaseAbort?.abort()
    if (this.active) terminateProcessTree(this.active, this.timings.terminateGraceMs)
    return true
  }

  async run(input: ServerSetupInput, progress: (value: ServerSetupProgress) => void): Promise<ServerSetupResult> {
    const capability = this.capabilities()
    if (!capability.available) throw new Error(capability.reason || 'One-click server setup is unavailable in this build.')
    if (this.state === 'running') throw new Error('AgentsServer setup is already running.')
    const validated = validateServerSetupInput(input)
    this.cancelRequested = false
    this.state = 'running'
    this.target = validated.target
    this.startedAt = new Date().toISOString()
    this.updatedAt = this.startedAt
    this.overallDeadlineAt = Date.now() + this.timings.overallTimeoutMs
    this.diagnosticTail = []
    this.releaseAbort = new AbortController()
    try {
      this.recordDiagnostic(`Setup started (${validated.target}, port ${validated.port}, ${validated.track} channel).`)
      appLog('server-setup', 'setup started', { target: validated.target, port: validated.port, track: validated.track })
      let release: PinnedServerRelease | null = null
      let result: ServerSetupResult | null = null
      if (validated.target === 'ssh' && validated.track === 'stable' && validated.teamHubHost !== true) {
        result = await this.connectExistingRemote(
          validated.sshHost!, validated.port, progress, validated.sshPassword, validated.sshIdentityPath
        )
      }
      if (!result) {
        this.emitProgress(progress, { phase: 'download', message: `Checking the latest ${validated.track === 'beta' ? 'Beta' : 'Stable'} AgentsServer release…` })
        release = await this.resolveRelease(validated.track, this.releaseAbort.signal)
        this.throwIfCancelled()
        result = validated.target === 'local'
          ? await this.runLocal(validated.port, progress, validated.teamHubHost, release)
          : await this.runRemote(validated.sshHost!, validated.port, progress, validated.teamHubHost, release, validated.sshPassword, validated.sshIdentityPath)
      }
      this.throwIfCancelled()
      this.state = 'completed'
      this.updatedAt = new Date().toISOString()
      this.recordDiagnostic(`Setup completed (${result.service}, AgentsServer ${result.serverVersion || release?.version || 'existing'}).`)
      appLog('server-setup', 'setup completed', { target: validated.target, service: result.service, tailscale: Boolean(result.tailscaleIP) })
      return result
    } catch (error) {
      const normalized = this.cancelRequested ? setupCancelledError() : normalizeError(error)
      this.state = this.cancelRequested ? 'cancelled' : 'failed'
      this.updatedAt = new Date().toISOString()
      this.recordDiagnostic(`${this.state === 'cancelled' ? 'Setup cancelled' : 'Setup failed'}: ${normalized.message}`)
      appLog('server-setup', 'setup failed', { target: validated.target, message: normalized.message, cancelled: this.cancelRequested })
      throw normalized
    } finally {
      this.releaseAbort = null
      this.active = null
      this.overallDeadlineAt = 0
    }
  }

  private async connectExistingRemote(
    sshHost: string,
    port: number,
    progress: (value: ServerSetupProgress) => void,
    sshPassword?: string,
    sshIdentityPath?: string
  ): Promise<ServerSetupResult | null> {
    const identity = sshIdentityPath ? stageSSHIdentity(sshIdentityPath) : null
    const sshConfig = identity ? createExplicitSSHConfig(identity.file) : createUserSSHConfig()
    const passwordPrompt = identity || !sshPassword ? null : createSSHPasswordPrompt(sshPassword)
    const usingPassword = Boolean(passwordPrompt)
    try {
      const resolvedHost = await resolveSSHConfigHost(sshHost, sshConfig?.file)
      this.emitProgress(progress, { phase: 'connect', message: `Connecting to ${sshHost}…` })
      const result = await this.runProcess(
        sshCommand(),
        remoteShellArgs(sshHost, 'sh', sshConfig?.file, usingPassword, identity?.file),
        REMOTE_EXISTING_SERVER_DISCOVERY_SCRIPT,
        progress,
        false,
        {
          phase: 'connect',
          message: `Checking for an existing AgentsServer on ${sshHost}…`,
          environment: passwordPrompt?.environment
        }
      )
      if (!result) {
        this.recordDiagnostic('No compatible healthy AgentsServer was found; continuing with guided installation.', 'connect')
        return null
      }
      if (result.serverUrl.startsWith('http://127.0.0.1:') && !result.tailscaleIP) {
        const discoveredPort = Number(new URL(result.serverUrl).port) || port
        result.serverUrl = remoteFallbackURL(sshHost, discoveredPort, resolvedHost)
      }
      if (result.serverUrls) result.serverUrls = mergeConnectionURLs(result.serverUrls, [result.serverUrl])
      this.emitProgress(progress, {
        phase: 'complete',
        message: `Connected to existing AgentsServer${result.serverVersion ? ` ${result.serverVersion}` : ''}; no installation was needed.`
      })
      return result
    } finally {
      if (identity) rmSync(identity.directory, { recursive: true, force: true })
      if (passwordPrompt) rmSync(passwordPrompt.directory, { recursive: true, force: true })
      if (sshConfig) rmSync(sshConfig.directory, { recursive: true, force: true })
    }
  }

  private async runLocal(
    port: number,
    progress: (value: ServerSetupProgress) => void,
    teamHubHost = false,
    release: PinnedServerRelease
  ): Promise<ServerSetupResult> {
    this.emitProgress(progress, { phase: 'runtime', message: 'Checking local setup prerequisites…' })
    await this.runProcess('/bin/sh', ['-s', '--'], SERVER_SETUP_PREFLIGHT_SCRIPT + serverSetupVersionGuard(release), progress, false, {
      phase: 'runtime',
      message: 'Checking local setup prerequisites…'
    })
    this.throwIfCancelled()
    const directory = await mkdtemp(join(tmpdir(), 'agents-server-setup-'))
    try {
      this.emitProgress(progress, { phase: 'download', message: `Downloading verified AgentsServer ${release.version}…` })
      await this.runProcess(
        '/bin/sh',
        ['-s', '--', join(directory, 'AgentsServer')],
        localReleaseBootstrap(release),
        progress,
        false,
        { phase: 'download', message: `Downloading verified AgentsServer ${release.version}…` }
      )
      this.throwIfCancelled()
      const compatBin = join(directory, 'compat-bin')
      this.emitProgress(progress, { phase: 'runtime', message: 'Preparing Python and installer compatibility…' })
      await this.runProcess(
        '/bin/sh',
        ['-s', '--', compatBin, join(directory, 'AgentsServer', 'install.sh')],
        SERVER_SETUP_HOST_PREP_SCRIPT,
        progress,
        false,
        { phase: 'runtime', message: 'Preparing Python and installer compatibility…' }
      )
      this.throwIfCancelled()
      return await this.runInstaller('/bin/bash', [
        join(directory, 'AgentsServer', 'install.sh'),
        '--non-interactive',
        '--port',
        String(port),
        ...(teamHubHost ? ['--team-hub-host'] : [])
      ], undefined, progress, {
        phase: 'runtime',
        message: 'Preparing the AgentsServer runtime…',
        environment: { PATH: `${compatBin}${delimiter}${serverSetupProcessPath(process.env.PATH)}` }
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  private async runRemote(
    sshHost: string,
    port: number,
    progress: (value: ServerSetupProgress) => void,
    teamHubHost = false,
    release: PinnedServerRelease,
    sshPassword?: string,
    sshIdentityPath?: string
  ): Promise<ServerSetupResult> {
    const identity = sshIdentityPath ? stageSSHIdentity(sshIdentityPath) : null
    const sshConfig = identity ? createExplicitSSHConfig(identity.file) : createUserSSHConfig()
    const passwordPrompt = identity || !sshPassword ? null : createSSHPasswordPrompt(sshPassword)
    const usingPassword = Boolean(passwordPrompt)
    try {
      const resolvedHost = await resolveSSHConfigHost(sshHost, sshConfig?.file)
      if (resolvedHost !== sshHost.slice(sshHost.lastIndexOf('@') + 1)) {
        this.recordDiagnostic(`Resolved the SSH destination to ${resolvedHost}.`, 'connect')
      }
      this.remotePlatform = ''
      this.emitProgress(progress, { phase: 'connect', message: `Connecting to ${sshHost}…` })
      const shellArgs = () => remoteShellArgs(sshHost, 'sh', sshConfig?.file, usingPassword, identity?.file)
      await this.runProcess(sshCommand(), shellArgs(), SERVER_SETUP_PREFLIGHT_SCRIPT + serverSetupVersionGuard(release), progress, false, {
        phase: 'connect',
        message: `Connecting to ${sshHost}…`,
        environment: passwordPrompt?.environment
      })
      this.throwIfCancelled()
      const staged = await this.stageRemoteInstallFiles(sshHost, release, progress, sshConfig?.file, usingPassword, identity?.file, passwordPrompt?.environment)
      this.throwIfCancelled()
      const result = await this.runInstaller(sshCommand(), [
        ...shellArgs(),
        String(port),
        teamHubHost ? 'true' : 'false',
        ...(staged.archive || staged.uv ? [staged.archive ? 'true' : 'false', staged.uv ? 'true' : 'false'] : [])
      ], remoteReleaseBootstrap(release), progress, {
        phase: 'download',
        message: staged.archive
          ? `Installing verified AgentsServer ${release.version} on ${sshHost}…`
          : `Downloading verified AgentsServer ${release.version} on ${sshHost}…`,
        environment: passwordPrompt?.environment
      })
      if (result.serverUrl.startsWith('http://127.0.0.1:') && !result.tailscaleIP) {
        result.serverUrl = remoteFallbackURL(sshHost, port, resolvedHost)
      }
      return result
    } finally {
      if (identity) rmSync(identity.directory, { recursive: true, force: true })
      if (passwordPrompt) rmSync(passwordPrompt.directory, { recursive: true, force: true })
      if (sshConfig) rmSync(sshConfig.directory, { recursive: true, force: true })
    }
  }

  private async stageRemoteInstallFiles(
    sshHost: string,
    release: PinnedServerRelease,
    progress: (value: ServerSetupProgress) => void,
    configFile: string | undefined,
    password: boolean,
    identityFile: string | undefined,
    environment: NodeJS.ProcessEnv | undefined
  ): Promise<{ archive: boolean; uv: boolean }> {
    const directory = await mkdtemp(join(tmpdir(), 'agentsdock-setup-payload-'))
    let archive = false
    let uv = false
    try {
      this.emitProgress(progress, { phase: 'download', message: `Downloading verified AgentsServer ${release.version} on this computer…` })
      const archivePath = join(directory, 'agents-server.tar.gz')
      let archiveReady = false
      try {
        await this.downloadFile(release.url, archivePath, {
          sha256: release.sha256,
          maxBytes: 200 * 1024 * 1024,
          signal: this.releaseAbort?.signal
        })
        archiveReady = true
        this.throwIfCancelled()
        this.emitProgress(progress, { phase: 'download', message: `Copying AgentsServer ${release.version} to ${sshHost}…` })
        await this.streamFileToRemote(sshHost, archivePath, 'agents-server.tar.gz', configFile, password, identityFile, environment)
        archive = true
      } catch (error) {
        if (this.cancelRequested || this.releaseAbort?.signal.aborted) throw error
        if (archiveReady) {
          throw new Error(`Could not copy AgentsServer to ${sshHost}: ${normalizeError(error).message}`)
        }
        this.recordDiagnostic(`Could not download AgentsServer on this computer: ${normalizeError(error).message} The server will try to download it directly.`, 'download')
      }
      const uvUrl = uvReleaseAsset(this.remotePlatform)
      if (!uvUrl) return { archive, uv }
      try {
        const uvArchive = join(directory, 'uv.tar.gz')
        this.emitProgress(progress, { phase: 'runtime', message: 'Downloading the Python installer on this computer…' })
        await this.downloadFile(uvUrl, uvArchive, {
          maxBytes: 80 * 1024 * 1024,
          signal: this.releaseAbort?.signal
        })
        this.throwIfCancelled()
        const uvBinary = await extractUvBinary(uvArchive, directory)
        this.emitProgress(progress, { phase: 'runtime', message: `Copying the Python installer to ${sshHost}…` })
        await this.streamFileToRemote(sshHost, uvBinary, 'uv', configFile, password, identityFile, environment)
        uv = true
      } catch (error) {
        if (this.cancelRequested || this.releaseAbort?.signal.aborted) throw error
        this.recordDiagnostic(`Could not prepare uv on this computer: ${normalizeError(error).message} The server will try to download it directly.`, 'runtime')
      }
      return { archive, uv }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  private streamFileToRemote(
    sshHost: string,
    localPath: string,
    filename: RemoteStageFilename,
    configFile: string | undefined,
    password: boolean,
    identityFile: string | undefined,
    environment: NodeJS.ProcessEnv | undefined
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.cancelRequested) {
        reject(setupCancelledError())
        return
      }
      const child = spawn(sshCommand(), remoteCommandArgs(sshHost, remoteStageReceiveCommand(filename), configFile, password, identityFile), {
        env: { ...process.env, PATH: serverSetupProcessPath(process.env.PATH), LC_ALL: 'C', LANG: 'C', ...environment },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32'
      })
      this.active = child
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let settled = false
      let terminalError: Error | null = null
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        clearInterval(cancelWatch)
        if (this.active === child) this.active = null
        callback()
      }
      const stop = (error: Error): void => {
        if (terminalError) return
        terminalError = error
        terminateProcessTree(child, this.timings.terminateGraceMs)
      }
      const timeout = setTimeout(() => {
        stop(new Error('Copying files to the server took too long. Check the SSH connection, then retry.'))
      }, this.timings.stageTimeoutMs.download)
      timeout.unref?.()
      const cancelWatch = setInterval(() => {
        if (this.cancelRequested) stop(setupCancelledError())
      }, 200)
      cancelWatch.unref?.()
      child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
      child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
      child.on('error', error => finish(() => reject(new Error(`Could not start ${sshCommand()}: ${error.message}`))))
      child.on('close', code => {
        if (terminalError) {
          finish(() => reject(terminalError!))
          return
        }
        if (this.cancelRequested) {
          finish(() => reject(setupCancelledError()))
          return
        }
        if (code !== 0) {
          const detail = Buffer.concat(stderr).toString('utf8').trim().split(/\r\n|\r|\n/).filter(Boolean).pop()
          finish(() => reject(new Error(detail || 'Could not copy the installer to the server.')))
          return
        }
        try {
          finish(() => resolve(parseRemoteStagePath(Buffer.concat(stdout).toString('utf8'), filename)))
        } catch (error) {
          finish(() => reject(normalizeError(error)))
        }
      })
      const source = createReadStream(localPath)
      source.on('error', error => stop(new Error(`Could not read the downloaded installer: ${error.message}`)))
      child.stdin.on('error', error => {
        if ((error as NodeJS.ErrnoException).code !== 'EPIPE') stop(new Error(`Could not send the installer to ${sshHost}: ${error.message}`))
      })
      source.pipe(child.stdin)
    })
  }

  private async runInstaller(
    command: string,
    args: string[],
    stdin: string | undefined,
    progress: (value: ServerSetupProgress) => void,
    options: ProcessRunOptions = { phase: 'runtime', message: 'Preparing the AgentsServer runtime…' }
  ): Promise<ServerSetupResult> {
    try {
      const result = await this.runProcess(command, args, stdin, progress, true, options)
      if (!result) throw new Error('AgentsServer setup completed without connection details.')
      return result
    } catch (error) {
      if (!isRetryableLaunchdSetupFailure(error)) throw error
      this.throwIfCancelled()
      this.emitProgress(progress, { phase: 'service', message: 'macOS is finishing the previous service restart; retrying safely…' })
      await new Promise<void>(resolve => setTimeout(resolve, LAUNCHD_RETRY_DELAY_MS))
      this.throwIfCancelled()
      const result = await this.runProcess(command, args, stdin, progress, true, {
        phase: 'service',
        message: 'Retrying the AgentsServer service restart…',
        environment: options.environment
      })
      if (!result) throw new Error('AgentsServer setup completed without connection details.')
      return result
    }
  }

  private runProcess(
    command: string,
    args: string[],
    stdin: string | undefined,
    progress: (value: ServerSetupProgress) => void,
    expectResult: boolean,
    options: ProcessRunOptions = {}
  ): Promise<ServerSetupResult | null> {
    return new Promise((resolve, reject) => {
      if (this.cancelRequested) {
        reject(setupCancelledError())
        return
      }
      const startedAt = Date.now()
      if (!this.overallDeadlineAt) this.overallDeadlineAt = startedAt + this.timings.overallTimeoutMs
      const child = spawn(command, args, {
        env: { ...process.env, PATH: serverSetupProcessPath(process.env.PATH), LC_ALL: 'C', LANG: 'C', ...options.environment },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32'
      })
      this.active = child
      let result: ServerSetupResult | null = null
      const tail: string[] = []
      let settled = false
      let terminalError: Error | null = null
      let lastActivityAt = startedAt
      let lastHeartbeatAt = startedAt
      let stageStartedAt = startedAt
      let currentPhase = options.phase || 'install'
      let lastMessage = options.message || 'Running AgentsServer setup…'

      const stop = (error: Error): void => {
        if (terminalError) return
        terminalError = error
        this.recordDiagnostic(error.message, currentPhase)
        terminateProcessTree(child, this.timings.terminateGraceMs)
      }
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        clearInterval(watchdog)
        if (this.active === child) this.active = null
        callback()
      }
      const updatePhase = (line: string): void => {
        const detected = detectSetupPhase(line)
        if (detected && phaseRank(detected) > phaseRank(currentPhase)) {
          currentPhase = detected
          stageStartedAt = Date.now()
        }
      }
      const consumeLine = (line: string): void => {
        lastActivityAt = Date.now()
        if (line.startsWith('AGENTSDOCK_REMOTE_PLATFORM=')) {
          const value = line.slice('AGENTSDOCK_REMOTE_PLATFORM='.length).trim()
          if (/^[A-Za-z0-9_.-]+ [A-Za-z0-9_.-]+$/.test(value)) this.remotePlatform = value
          return
        }
        updatePhase(line)
        try {
          const parsed = parseServerSetupResult(line)
          if (parsed) {
            result = parsed
            this.recordDiagnostic('AgentsServer returned connection details (access token redacted).', 'complete')
            return
          }
        } catch (error) {
          stop(normalizeError(error))
          return
        }
        if (!line.trim()) return
        const redacted = redactServerSetupLogLine(line)
        tail.push(redacted)
        if (tail.length > SETUP_LOG_TAIL_LINES) tail.shift()
        lastMessage = (
          redacted.startsWith(PREFLIGHT_ERROR_PREFIX)
            ? redacted.slice(PREFLIGHT_ERROR_PREFIX.length)
            : redacted.startsWith(PREFLIGHT_WARNING_PREFIX)
              ? redacted.slice(PREFLIGHT_WARNING_PREFIX.length)
              : redacted
        ).replace(/^\s+/, '')
        this.emitProgress(progress, { phase: currentPhase, message: lastMessage })
      }
      // stdout and stderr can each deliver partial lines. Keep their buffers
      // separate so a warning cannot splice itself into the private result line.
      const consumeStdout = createLineConsumer(consumeLine)
      const consumeStderr = createLineConsumer(consumeLine)
      child.stdout.on('data', chunk => consumeStdout(String(chunk)))
      child.stderr.on('data', chunk => consumeStderr(String(chunk)))
      child.on('error', error => {
        const failure = new Error(`Could not start ${command}: ${error.message}`)
        terminalError = failure
        finish(() => reject(failure))
      })
      child.on('close', code => {
        consumeStdout.flush()
        consumeStderr.flush()
        if (terminalError) {
          finish(() => reject(terminalError!))
          return
        }
        if (this.cancelRequested) {
          finish(() => reject(setupCancelledError()))
          return
        }
        if (code !== 0) {
          finish(() => reject(new Error(serverSetupFailureMessage(tail, code))))
          return
        }
        if (!result && expectResult) {
          finish(() => reject(new Error('AgentsServer setup completed without connection details.')))
          return
        }
        finish(() => resolve(result))
      })
      child.stdin.on('error', error => {
        if (!terminalError) stop(new Error(`Could not send setup instructions to ${command}: ${error.message}`))
      })
      const watchdog = setInterval(() => {
        const now = Date.now()
        if (this.cancelRequested) {
          stop(setupCancelledError())
          return
        }
        if (now >= this.overallDeadlineAt) {
          stop(new Error(`AgentsServer setup exceeded the ${formatDuration(this.timings.overallTimeoutMs)} overall limit. Retry and open the setup log if it happens again.`))
          return
        }
        const stageLimit = this.timings.stageTimeoutMs[currentPhase]
        if (now - stageStartedAt >= stageLimit) {
          stop(new Error(`AgentsServer setup stopped because the ${phaseLabel(currentPhase)} step exceeded ${formatDuration(stageLimit)}. Retry and open the setup log for details.`))
          return
        }
        if (now - lastActivityAt >= this.timings.inactivityTimeoutMs) {
          stop(new Error(`AgentsServer setup stopped because the ${phaseLabel(currentPhase)} step produced no output for ${formatDuration(this.timings.inactivityTimeoutMs)}. Check the network or remote host, then retry.`))
          return
        }
        if (now - lastHeartbeatAt >= this.timings.heartbeatMs) {
          lastHeartbeatAt = now
          this.emitProgress(progress, {
            phase: currentPhase,
            message: `Still working: ${lastMessage} (${formatDuration(now - startedAt)} elapsed)…`
          }, false)
        }
      }, Math.max(5, Math.min(this.timings.heartbeatMs, 1_000)))
      watchdog.unref?.()
      child.stdin.end(stdin || undefined)
    })
  }

  private emitProgress(
    progress: (value: ServerSetupProgress) => void,
    value: ServerSetupProgress,
    persist = true
  ): void {
    this.updatedAt = new Date().toISOString()
    if (persist) this.recordDiagnostic(value.message, value.phase)
    progress(value)
  }

  private recordDiagnostic(message: string, phase?: ServerSetupProgress['phase']): void {
    const redacted = redactServerSetupLogLine(message).trim()
    if (!redacted) return
    const entry = `${new Date().toISOString()}${phase ? ` [${phase}]` : ''} ${redacted}`
    this.diagnosticTail.push(entry)
    if (this.diagnosticTail.length > SETUP_LOG_TAIL_LINES) this.diagnosticTail.shift()
    appendServerSetupLog(entry)
  }

  private throwIfCancelled(): void {
    if (this.cancelRequested) throw setupCancelledError()
    if (this.overallDeadlineAt && Date.now() >= this.overallDeadlineAt) {
      throw new Error(`AgentsServer setup exceeded the ${formatDuration(this.timings.overallTimeoutMs)} overall limit. Retry and open the setup log if it happens again.`)
    }
  }
}

function sshCommand(): string { return process.platform === 'darwin' ? '/usr/bin/ssh' : 'ssh' }

/** Rewrite ~/… identity paths so they stay in HOME when ssh's account home is /root. */
export function expandSSHConfigHome(text: string, home: string): string {
  const root = home.replace(/\/+$/, '')
  return text.replace(/^(\s*(?:IdentityFile|CertificateFile|UserKnownHostsFile)\s+["']?)~/gim, `$1${root}`)
}

export function createUserSSHConfig(home = process.env.HOME?.trim() || ''): { directory: string; file: string } | null {
  const source = home ? join(home, '.ssh', 'config') : ''
  if (!source || !existsSync(source)) return null
  const directory = mkdtempSync(join(tmpdir(), 'agentsdock-ssh-'))
  const file = join(directory, 'config')
  try {
    const known = join(home, '.ssh', 'known_hosts')
    const expanded = expandSSHConfigHome(readFileSync(source, 'utf8'), home)
    const identities = ['id_ed25519', 'id_ecdsa', 'id_rsa']
      .map(name => join(home, '.ssh', name))
      .filter(path => existsSync(path))
      .map(path => `  IdentityFile ${path}`)
    const fallback = [
      'Host *',
      ...identities,
      `  UserKnownHostsFile ${known}`,
      '  GlobalKnownHostsFile /dev/null'
    ].join('\n')
    const body = `${expanded.endsWith('\n') ? expanded : `${expanded}\n`}${fallback}\n`
    writeFileSync(file, body, { mode: 0o600 })
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
  return { directory, file }
}

export function createExplicitSSHConfig(identityFile: string, home = process.env.HOME?.trim() || ''): { directory: string; file: string } {
  const directory = mkdtempSync(join(tmpdir(), 'agentsdock-ssh-'))
  const file = join(directory, 'config')
  const known = home ? join(home, '.ssh', 'known_hosts') : join(directory, 'known_hosts')
  try {
    writeFileSync(file, [
      'Host *',
      `  IdentityFile ${identityFile}`,
      '  IdentitiesOnly yes',
      '  PreferredAuthentications publickey',
      `  UserKnownHostsFile ${known}`,
      '  GlobalKnownHostsFile /dev/null',
      ''
    ].join('\n'), { mode: 0o600 })
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
  return { directory, file }
}

export function stageSSHIdentity(source: string): { directory: string; file: string } {
  const directory = mkdtempSync(join(tmpdir(), 'agentsdock-ssh-identity-'))
  const file = join(directory, 'id_key')
  try {
    const bytes = readFileSync(source)
    if (bytes.length < 1 || bytes.length > 1024 * 1024) throw new Error('Choose an SSH private key file.')
    writeFileSync(file, bytes, { mode: 0o600 })
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    if (error instanceof Error && error.message === 'Choose an SSH private key file.') throw error
    throw new Error('The SSH private key file could not be read. Choose the key again.')
  }
  return { directory, file }
}

/** Return concrete aliases from the user's primary SSH config without exposing other config values. */
export function parseSSHConfigHosts(text: string): string[] {
  const hosts: string[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r\n|\r|\n/)) {
    const match = line.match(/^\s*Host\s+(.+?)\s*(?:#.*)?$/i)
    if (!match) continue
    for (const host of match[1].trim().split(/\s+/)) {
      if (!host || host.startsWith('!') || /[*?]/.test(host) || !/^[A-Za-z0-9_.@%+:[\]-]+$/.test(host)) continue
      const key = host.toLocaleLowerCase('en-US')
      if (seen.has(key)) continue
      seen.add(key)
      hosts.push(host)
    }
  }
  return hosts
}

export function configuredSSHHosts(home = process.env.HOME?.trim() || ''): string[] {
  const source = home ? join(home, '.ssh', 'config') : ''
  if (!source || !existsSync(source)) return []
  try {
    return parseSSHConfigHosts(readFileSync(source, 'utf8'))
  } catch (error) {
    appLog('server-setup', 'could not read SSH host aliases', {
      message: error instanceof Error ? error.message : String(error)
    })
    return []
  }
}

export function createSSHPasswordPrompt(password: string): { directory: string; environment: NodeJS.ProcessEnv } {
  const directory = mkdtempSync(join(tmpdir(), 'agentsdock-ssh-password-'))
  const helper = join(directory, 'askpass')
  const secret = join(directory, 'secret')
  try {
    writeFileSync(secret, `${password}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    writeFileSync(helper, '#!/bin/sh\nexec /bin/cat "$AGENTSDOCK_SSH_PASSWORD_FILE"\n', {
      encoding: 'utf8', mode: 0o700, flag: 'wx'
    })
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
  return {
    directory,
    environment: {
      SSH_ASKPASS: helper,
      SSH_ASKPASS_REQUIRE: 'force',
      DISPLAY: process.env.DISPLAY || 'agentsdock-ssh-password:0',
      AGENTSDOCK_SSH_PASSWORD_FILE: secret
    }
  }
}

export function resolveSSHConfigHost(sshHost: string, configFile?: string): Promise<string> {
  return new Promise(resolve => {
    execFile(sshCommand(), [...(configFile ? ['-F', configFile] : []), '-G', sshHost], {
      encoding: 'utf8',
      env: { ...process.env, PATH: serverSetupProcessPath(process.env.PATH), LC_ALL: 'C', LANG: 'C' },
      timeout: 5_000,
      maxBuffer: 256 * 1024
    }, (_error, stdout) => {
      resolve(parseSSHConfigHostname(String(stdout || ''), sshHost))
    })
  })
}

function sshClientOptions(configFile?: string, password = false, identityFile?: string): string[] {
  return [
    ...(configFile ? ['-F', configFile] : []),
    ...(identityFile ? ['-i', identityFile, '-o', 'IdentitiesOnly=yes', '-o', 'PreferredAuthentications=publickey'] : []),
    '-o', `BatchMode=${password ? 'no' : 'yes'}`,
    ...(password ? [
      '-o', 'PreferredAuthentications=password,keyboard-interactive',
      '-o', 'PubkeyAuthentication=no',
      '-o', 'NumberOfPasswordPrompts=1'
    ] : []),
    '-o', 'ConnectTimeout=15',
    '-o', 'ConnectionAttempts=2',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=4',
    '-o', 'TCPKeepAlive=yes',
    '-o', 'StrictHostKeyChecking=accept-new'
  ]
}

export function remoteShellArgs(sshHost: string, shell: 'sh' | 'bash', configFile?: string, password = false, identityFile?: string): string[] {
  return [
    ...sshClientOptions(configFile, password, identityFile),
    sshHost,
    shell, '-s', '--'
  ]
}

export function remoteCommandArgs(sshHost: string, remoteCommand: string, configFile?: string, password = false, identityFile?: string): string[] {
  return [...sshClientOptions(configFile, password, identityFile), sshHost, remoteCommand]
}

export type RemoteStageFilename = 'agents-server.tar.gz' | 'uv'

export function remoteStageReceiveCommand(filename: RemoteStageFilename): string {
  return `mkdir -p "$HOME/.cache/agentsdock-setup" && umask 077 && cat > "$HOME/.cache/agentsdock-setup/${filename}" && chmod 600 "$HOME/.cache/agentsdock-setup/${filename}" && printf '%s\\n' "$HOME/.cache/agentsdock-setup/${filename}"`
}

export function parseRemoteStagePath(output: string, filename: RemoteStageFilename): string {
  const line = output.trim().split(/\r\n|\r|\n/).filter(Boolean).pop() || ''
  const suffix = `/.cache/agentsdock-setup/${filename}`
  if (!line.startsWith('/') || !line.endsWith(suffix) || !/^[A-Za-z0-9._~+:@/-]+$/.test(line)) {
    throw new Error('The server did not accept the uploaded installer.')
  }
  return line
}

export function uvReleaseAsset(platformLine: string): string | null {
  const match = platformLine.trim().match(/^(Darwin|Linux) (x86_64|aarch64|arm64)$/)
  if (!match) return null
  const arch = match[2] === 'x86_64' ? 'x86_64' : 'aarch64'
  const target = match[1] === 'Darwin' ? `${arch}-apple-darwin` : `${arch}-unknown-linux-gnu`
  return `https://github.com/astral-sh/uv/releases/latest/download/uv-${target}.tar.gz`
}

export async function downloadVerifiedFile(
  url: string,
  destination: string,
  options: {
    fetchImpl?: typeof fetch
    signal?: AbortSignal
    sha256?: string
    maxBytes: number
    attempts?: number
  }
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch
  const attempts = Math.max(1, options.attempts ?? 3)
  let failure: Error | null = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await downloadVerifiedFileOnce(url, destination, fetchImpl, options)
      return
    } catch (error) {
      failure = normalizeError(error)
      rmSync(destination, { force: true })
      if (options.signal?.aborted) throw failure
      if (/verification failed|size limit|HTTP 4\d\d/.test(failure.message) || attempt === attempts) throw failure
    }
  }
  throw failure || new Error('Download failed.')
}

async function downloadVerifiedFileOnce(
  url: string,
  destination: string,
  fetchImpl: typeof fetch,
  options: { signal?: AbortSignal; sha256?: string; maxBytes: number }
): Promise<void> {
  const timeout = AbortSignal.timeout(120_000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  let response: Response
  try {
    response = await fetchImpl(url, {
      signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'AgentsDock-Guided-Setup', Accept: 'application/octet-stream' }
    })
  } catch (error) {
    if (options.signal?.aborted) throw error
    if (timeout.aborted) throw new Error('Timed out downloading the file on this computer.')
    throw new Error('Could not download the file on this computer. Check this computer’s network or proxy, then retry.')
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`Download failed (HTTP ${response.status}).`)
  }
  if (!response.body) throw new Error('The download response was empty.')
  const hash = createHash('sha256')
  let size = 0
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length
      if (size > options.maxBytes) {
        callback(new Error('The download exceeds its size limit.'))
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    }
  })
  await pipeline(
    Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>),
    limiter,
    createWriteStream(destination, { mode: 0o600 })
  )
  if (options.sha256 && hash.digest('hex') !== options.sha256) {
    throw new Error('AgentsServer archive verification failed before it was sent to the server.')
  }
}

export async function extractUvBinary(archive: string, directory: string): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    execFile('tar', ['-xzf', archive, '-C', directory], { timeout: 60_000 }, error => error ? reject(error) : resolve())
  })
  const binary = findNamedFile(directory, 'uv')
  assertNativeExecutable(binary)
  return binary
}

function findNamedFile(directory: string, name: string): string {
  const pending = [directory]
  let seen = 0
  while (pending.length) {
    const current = pending.pop()!
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      seen += 1
      if (seen > 50) throw new Error('The uv archive has an unexpected layout.')
      const path = join(current, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile() && entry.name === name) return path
    }
  }
  throw new Error('The uv archive did not contain the uv program.')
}

function assertNativeExecutable(path: string): void {
  const header = Buffer.alloc(4)
  const descriptor = openSync(path, 'r')
  try {
    if (readSync(descriptor, header, 0, 4, 0) < 4) throw new Error('The downloaded uv program is not a supported executable.')
  } finally { closeSync(descriptor) }
  const elf = header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46
  const macho = (header[0] === 0xfe && header[1] === 0xed && header[2] === 0xfa && (header[3] === 0xce || header[3] === 0xcf))
    || (header[0] === 0xce && header[1] === 0xfa && header[2] === 0xed && header[3] === 0xfe)
    || (header[0] === 0xcf && header[1] === 0xfa && header[2] === 0xed && header[3] === 0xfe)
    || (header[0] === 0xca && header[1] === 0xfe && header[2] === 0xba && header[3] === 0xbe)
  if (!elf && !macho) throw new Error('The downloaded uv program is not a supported executable.')
}

export function serverSetupProcessPath(currentPath = ''): string {
  const common = [
    process.env.HOME ? `${process.env.HOME}/.local/bin` : '',
    process.env.HOME ? `${process.env.HOME}/.cargo/bin` : '',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/home/linuxbrew/.linuxbrew/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    ...currentPath.split(':')
  ]
  return [...new Set(common.filter(Boolean))].join(':')
}

function detectSetupPhase(line: string): ServerSetupProgress['phase'] | null {
  if (/\[1\/7\]|\[2\/7\]/i.test(line)) return 'runtime'
  if (/\[3\/7\]/i.test(line)) return 'install'
  if (/\[4\/7\]/i.test(line)) return 'service'
  if (/\[5\/7\]/i.test(line)) return 'health'
  if (/\[6\/7\]/i.test(line)) return 'diagnostics'
  if (/\[7\/7\]/i.test(line)) return 'complete'
  if (/dependenc|prerequisite|\btmux\b|\bcurl\b|launchd GUI|systemctl --user|\buv\b/i.test(line)) return 'runtime'
  if (/activating/i.test(line)) return 'install'
  if (/service/i.test(line)) return 'service'
  if (/health/i.test(line)) return 'health'
  if (/runtime diagnostics/i.test(line)) return 'diagnostics'
  if (/ready/i.test(line)) return 'complete'
  if (/download|archive/i.test(line)) return 'download'
  return null
}

export function createLineConsumer(onLine: (line: string) => void): ((chunk: string) => void) & { flush(): void } {
  let buffer = ''
  const consume = ((chunk: string) => {
    buffer += chunk
    const lines = buffer.split(/\r\n|\r|\n/)
    buffer = lines.pop() || ''
    for (const line of lines) onLine(line)
  }) as ((chunk: string) => void) & { flush(): void }
  consume.flush = () => {
    if (buffer) onLine(buffer)
    buffer = ''
  }
  return consume
}

export function redactServerSetupLogLine(line: string): string {
  if (line.startsWith(RESULT_PREFIX)) return `${RESULT_PREFIX}[connection details redacted]`
  return line
    .replace(/("access_token"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
    .replace(/\b(Access\s+token(?:\s*[:=]\s*|\s{2,}))(["']?)[^\s"'<>]+\2/gi, '$1$2[REDACTED]$2')
    .replace(/\b(AGENTSDOCK_[A-Z0-9_]*TOKEN\s*=\s*)(["']?)[^\s"'<>]+\2/gi, '$1$2[REDACTED]$2')
    .replace(/\b(Authorization\s*:\s*Bearer\s+)(["']?)[^\s"'<>]+\2/gi, '$1$2[REDACTED]$2')
    .replace(/([?&](?:access_)?token=)[^&\s]+/gi, '$1[REDACTED]')
}

export function currentServerSetupLogPath(): string {
  const override = process.env.AGENTSDOCK_SERVER_SETUP_LOG_PATH?.trim()
  if (override) return override
  try {
    if (app && typeof app.getPath === 'function') {
      return join(app.getPath('userData'), 'logs', 'server-setup.log')
    }
  } catch { /* Electron app paths are unavailable in isolated unit tests. */ }
  return join(tmpdir(), 'agentsdock-server-setup.log')
}

function appendServerSetupLog(entry: string): void {
  try {
    const path = currentServerSetupLogPath()
    mkdirSync(dirname(path), { recursive: true })
    if (existsSync(path) && statSync(path).size >= SETUP_LOG_MAX_BYTES) {
      try { renameSync(path, `${path}.1`) } catch { /* keep writing to the active log */ }
    }
    appendFileSync(path, `${entry}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch { /* setup diagnostics must never break setup */ }
}

function terminateProcessTree(child: ChildProcessWithoutNullStreams, graceMs: number): void {
  signalProcessTree(child, 'SIGTERM')
  const force = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) signalProcessTree(child, 'SIGKILL')
  }, Math.max(0, graceMs))
  force.unref?.()
}

function signalProcessTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (child.pid && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal)
      return
    } catch { /* fall through to the direct child */ }
  }
  try { child.kill(signal) } catch { /* it already exited */ }
}

function phaseLabel(phase: ServerSetupProgress['phase']): string {
  switch (phase) {
    case 'connect': return 'SSH connection'
    case 'download': return 'download and verification'
    case 'runtime': return 'runtime preparation'
    case 'install': return 'installation'
    case 'service': return 'service setup'
    case 'health': return 'health check'
    case 'diagnostics': return 'diagnostics'
    case 'complete': return 'completion'
  }
}

function phaseRank(phase: ServerSetupProgress['phase']): number {
  return ['connect', 'download', 'runtime', 'install', 'service', 'health', 'diagnostics', 'complete'].indexOf(phase)
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1_000))
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

function setupCancelledError(): Error {
  return new Error('AgentsServer setup was cancelled.')
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
