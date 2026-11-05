import { beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerSetupProgress, ServerSetupResult } from '../shared/types'

const fsHarness = vi.hoisted(() => ({
  mkdtemp: vi.fn<(prefix: string) => Promise<string>>(),
  rm: vi.fn<(path: string, options: { recursive: boolean; force: boolean }) => Promise<void>>()
}))

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    default: { ...actual, mkdtemp: fsHarness.mkdtemp, rm: fsHarness.rm },
    mkdtemp: fsHarness.mkdtemp,
    rm: fsHarness.rm
  }
})

import {
  createLineConsumer,
  createSSHPasswordPrompt,
  isRetryableLaunchdSetupFailure,
  localReleaseBootstrap,
  parseServerSetupResult,
  parseSSHConfigHosts,
  parseSSHConfigHostname,
  redactServerSetupLogLine,
  downloadVerifiedFile,
  parseRemoteStagePath,
  remoteCommandArgs,
  remoteFallbackURL,
  remoteReleaseBootstrap,
  remoteShellArgs,
  remoteStageReceiveCommand,
  stageSSHIdentity,
  uvReleaseAsset,
  expandSSHConfigHome,
  createUserSSHConfig,
  serverSetupCapabilities,
  SERVER_SETUP_HOST_PREP_SCRIPT,
  SERVER_SETUP_PATH_BOOTSTRAP,
  SERVER_SETUP_PREFLIGHT_SCRIPT,
  REMOTE_EXISTING_SERVER_DISCOVERY_SCRIPT,
  ServerSetupManager,
  type ServerSetupTimings,
  serverSetupFailureMessage,
  serverSetupProcessPath,
  validateServerSetupInput
} from './server-setup'

// Signed-release resolution has separate coverage. Bootstrap tests use explicit fixtures.
const STABLE_RELEASE = { track: 'stable' as const, version: '1.0.3',
  url: 'https://github.com/ZhengyiLuo/AgentsServer/releases/download/v1.0.3/agents-server-1.0.3.tar.gz', sha256: 'a'.repeat(64) }
const BETA_RELEASE = { track: 'beta' as const, version: '1.0.7-beta.1',
  url: 'https://github.com/ZhengyiLuo/AgentsServer/releases/download/v1.0.7-beta.1/agents-server-1.0.7-beta.1.tar.gz', sha256: 'b'.repeat(64) }
const LOCAL_RELEASE_BOOTSTRAP = localReleaseBootstrap(STABLE_RELEASE)
const REMOTE_BOOTSTRAP = remoteReleaseBootstrap(STABLE_RELEASE)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

type ServerSetupManagerHarness = {
  connectExistingRemote(sshHost: string, port: number, progress: (value: ServerSetupProgress) => void, sshPassword?: string, sshIdentityPath?: string): Promise<ServerSetupResult | null>
  runLocal(port: number, progress: (value: ServerSetupProgress) => void, teamHubHost?: boolean, release?: unknown): Promise<ServerSetupResult>
  runRemote(sshHost: string, port: number, progress: (value: ServerSetupProgress) => void, teamHubHost?: boolean, release?: unknown, sshPassword?: string, sshIdentityPath?: string): Promise<ServerSetupResult>
  stageRemoteInstallFiles(): Promise<{ archive: boolean; uv: boolean }>
  streamFileToRemote(sshHost: string, localPath: string, filename: string): Promise<string>
  remotePlatform: string
  runProcess(
    command: string,
    args: string[],
    stdin: string | undefined,
    progress: (value: ServerSetupProgress) => void,
    expectResult: boolean,
    options?: { phase?: ServerSetupProgress['phase']; message?: string; environment?: NodeJS.ProcessEnv }
  ): Promise<ServerSetupResult | null>
  state: 'idle' | 'running' | 'failed' | 'completed' | 'cancelled'
}

function testTimings(patch: Partial<Omit<ServerSetupTimings, 'stageTimeoutMs'>> & {
  stageTimeoutMs?: Partial<ServerSetupTimings['stageTimeoutMs']>
} = {}): ServerSetupTimings {
  return {
    overallTimeoutMs: patch.overallTimeoutMs ?? 2_000,
    inactivityTimeoutMs: patch.inactivityTimeoutMs ?? 1_000,
    heartbeatMs: patch.heartbeatMs ?? 20,
    terminateGraceMs: patch.terminateGraceMs ?? 10,
    stageTimeoutMs: {
      connect: 1_000,
      download: 1_000,
      runtime: 1_000,
      install: 1_000,
      service: 1_000,
      health: 1_000,
      diagnostics: 1_000,
      complete: 1_000,
      ...patch.stageTimeoutMs
    }
  }
}

beforeEach(() => {
  fsHarness.mkdtemp.mockReset().mockResolvedValue('/tmp/agents-server-setup-test')
  fsHarness.rm.mockReset().mockResolvedValue(undefined)
})

describe('server setup', () => {
  it('validates local and SSH setup without accepting shell input', () => {
    expect(validateServerSetupInput({ target: 'local', port: 7850 })).toEqual({ target: 'local', port: 7850, track: 'stable' })
    expect(validateServerSetupInput({ target: 'local', port: 7850, teamHubHost: false })).toEqual({ target: 'local', port: 7850, track: 'stable', teamHubHost: false })
    expect(validateServerSetupInput({ target: 'ssh', sshHost: 'user@server-01', port: 9000, track: 'beta', teamHubHost: true })).toEqual({ target: 'ssh', sshHost: 'user@server-01', port: 9000, track: 'beta', teamHubHost: true })
    expect(validateServerSetupInput({ target: 'ssh', sshHost: 'user@server-01', sshPassword: 'one time secret' })).toEqual({ target: 'ssh', sshHost: 'user@server-01', sshPassword: 'one time secret', port: 7850, track: 'stable' })
    expect(() => validateServerSetupInput({ target: 'ssh', sshHost: 'user@server; reboot', port: 7850 })).toThrow(/SSH host/)
    expect(() => validateServerSetupInput({ target: 'local', port: 70000 })).toThrow(/Port/)
    expect(() => validateServerSetupInput({ target: 'ssh', sshHost: 'user@server', port: 22 })).toThrow(/HTTP API port, not the SSH port/)
    expect(() => validateServerSetupInput({ target: 'local', port: 0 })).toThrow(/1024 and 65535/)
    expect(() => validateServerSetupInput({ target: 'local', track: 'nightly' as 'stable' })).toThrow(/Stable or Beta/)
    expect(() => validateServerSetupInput({ target: 'local', teamHubHost: 'true' as unknown as boolean })).toThrow(/Team Network/)
    expect(() => validateServerSetupInput({ target: 'ssh', sshHost: 'server', sshPassword: 'bad\nsecret' })).toThrow(/line break/)
    expect(() => validateServerSetupInput({ target: 'ssh', sshHost: 'server', sshPassword: 42 as unknown as string })).toThrow(/valid SSH password/)
    const identityDirectory = mkdtempSync(join(tmpdir(), 'agentsdock-identity-input-'))
    const identity = join(identityDirectory, 'id_ed25519')
    writeFileSync(identity, 'fixture-key\n', { mode: 0o600 })
    try {
      expect(validateServerSetupInput({ target: 'ssh', sshHost: 'ubuntu@192.0.2.10', sshIdentityPath: identity, sshPassword: 'unused' })).toEqual({
        target: 'ssh', sshHost: 'ubuntu@192.0.2.10', sshIdentityPath: identity, port: 7850, track: 'stable'
      })
      expect(() => validateServerSetupInput({ target: 'ssh', sshHost: 'ubuntu@192.0.2.10', sshIdentityPath: 'id_ed25519' })).toThrow(/private key/)
      expect(() => validateServerSetupInput({ target: 'ssh', sshHost: 'ubuntu@192.0.2.10', sshIdentityPath: '/tmp/missing-agentsdock-key' })).toThrow(/could not be read/)
    } finally {
      rmSync(identityDirectory, { recursive: true, force: true })
    }
  })

  it('lists concrete SSH aliases while ignoring wildcard and negated Host patterns', () => {
    expect(parseSSHConfigHosts(`
Host github-ashlot2002
  HostName github.com
Host Synria jump
Host *.internal !blocked A800
Host synria # duplicate aliases are case-insensitive
Host RTX6000
`)).toEqual(['github-ashlot2002', 'Synria', 'jump', 'A800', 'RTX6000'])
  })

  it('explains the intentionally remote-only Windows server setup without exposing win32 jargon', () => {
    const originalPlatform = process.platform
    try {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
      expect(serverSetupCapabilities()).toEqual({
        available: false,
        local: false,
        ssh: false,
        reason: 'One-click setup is not available on Windows.'
      })
    } finally {
      Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
    }
  })

  it('uses the resolved immutable release without mixing channels', () => {
    const stableLocal = localReleaseBootstrap(STABLE_RELEASE)
    const betaLocal = localReleaseBootstrap(BETA_RELEASE)
    const stableRemote = remoteReleaseBootstrap(STABLE_RELEASE)
    const betaRemote = remoteReleaseBootstrap(BETA_RELEASE)
    expect(stableLocal).toContain(`VERSION="${STABLE_RELEASE.version}"`)
    expect(stableLocal).toContain(STABLE_RELEASE.url)
    expect(stableLocal).toContain(STABLE_RELEASE.sha256)
    expect(stableLocal).not.toContain(BETA_RELEASE.url)
    expect(betaLocal).toContain(`VERSION="${BETA_RELEASE.version}"`)
    expect(betaLocal).toContain(BETA_RELEASE.url)
    expect(betaLocal).toContain(BETA_RELEASE.sha256)
    expect(betaLocal).not.toContain(STABLE_RELEASE.url)
    expect(stableRemote).toContain(STABLE_RELEASE.url)
    expect(stableRemote).not.toContain(BETA_RELEASE.url)
    expect(betaRemote).toContain(BETA_RELEASE.url)
    expect(betaRemote).not.toContain(STABLE_RELEASE.url)
  })

  it('parses the private installer result without exposing it as progress', () => {
    expect(parseServerSetupResult('ordinary progress')).toBeNull()
    expect(parseServerSetupResult('AGENTSDOCK_SETUP_RESULT={"server_url":"http://100.64.0.10:7850","access_token":"0123456789abcdef0123456789abcdef","service":"systemd-user","tailscale_ip":"100.64.0.10","server_version":"0.1.0"}')).toEqual({
      serverUrl: 'http://100.64.0.10:7850',
      accessToken: '0123456789abcdef0123456789abcdef',
      service: 'systemd-user',
      tailscaleIP: '100.64.0.10',
      serverVersion: '0.1.0'
    })
  })

  it('builds a remote fallback URL from a safe SSH destination', () => {
    expect(remoteFallbackURL('user@server.local', 7850)).toBe('http://server.local:7850')
    expect(remoteFallbackURL('dev@2001:db8::1', 7850)).toBe('http://[2001:db8::1]:7850')
    expect(remoteFallbackURL('user@lab-alias', 7850, '100.64.0.20')).toBe('http://100.64.0.20:7850')
  })

  it('uses the HostName resolved by ssh -G for HTTP instead of an SSH-only alias', () => {
    expect(parseSSHConfigHostname(`
host lab-alias
user dev
hostname 100.64.0.20
port 22
`, 'dev@lab-alias')).toBe('100.64.0.20')
    expect(parseSSHConfigHostname('', 'dev@lab-alias')).toBe('lab-alias')
    expect(parseSSHConfigHostname('hostname bad/path', 'dev@lab-alias')).toBe('lab-alias')
  })

  it('does not tell users to run AgentsDock as root when launchd reports a restart race', () => {
    expect(serverSetupFailureMessage([
      'Bootstrap failed: 5: Input/output error',
      'Try re-running the command as root for richer errors.'
    ], 5)).toBe('macOS could not restart AgentsServer. Wait a moment and try again; running AgentsDock as root is not required.')
  })

  it('preserves the last useful installer error instead of a generic privilege hint', () => {
    expect(serverSetupFailureMessage([
      '[4/7] Installing the user service',
      'launchctl: service configuration is invalid',
      'Try re-running the command as root for richer errors.'
    ], 1)).toBe('launchctl: service configuration is invalid')
  })

  it('surfaces the real server bind error instead of later benign shutdown output', () => {
    expect(serverSetupFailureMessage([
      '[5/7] Waiting for authenticated health',
      "Jul 30 15:39:52 352279b-lcedt python[1553570]: ERROR: [Errno 13] error while attempting to bind on address ('0.0.0.0', 22): permission denied",
      'Jul 30 15:39:52 352279b-lcedt python[1553570]: INFO: Shutting down',
      'Jul 30 15:39:52 352279b-lcedt python[1553570]: INFO: Waiting for application shutdown.',
      'Jul 30 15:39:52 352279b-lcedt python[1553570]: INFO: Application shutdown complete.',
      "Jul 30 15:39:52 352279b-lcedt systemd[1500]: agents-server.service: Failed with result 'exit-code'.",
      'The previous release was restored.'
    ], 1)).toBe("ERROR: [Errno 13] error while attempting to bind on address ('0.0.0.0', 22): permission denied")
  })

  it('ignores benign lifecycle output but preserves an unknown legitimate service error', () => {
    expect(serverSetupFailureMessage([
      'launchctl: service configuration is invalid',
      'Active: failed (Result: exit-code) since Thu 2026-07-30 15:39:52 PDT; 1s ago',
      'Jul 30 15:39:52 studio python[100]: INFO: Application shutdown complete.'
    ], 1)).toBe('launchctl: service configuration is invalid')
  })

  it('surfaces an actionable prerequisite failure as the final setup error', () => {
    const actionable = 'Missing guided-setup prerequisites: curl bash. Install them with this server\'s package manager, then retry guided setup; do not run the installer with sudo.'
    expect(serverSetupFailureMessage([
      'Checking remote prerequisites',
      `AGENTSDOCK_PREFLIGHT_ERROR=${actionable}`,
      'Connection to server closed.',
      'Try re-running the command as root for richer errors.'
    ], 78)).toBe(actionable)
  })

  it('retries only the known launchd service-removal race', () => {
    expect(isRetryableLaunchdSetupFailure(new Error(serverSetupFailureMessage([
      'Bootstrap failed: 5: Input/output error',
      'Try re-running the command as root for richer errors.'
    ], 5)))).toBe(true)
    expect(isRetryableLaunchdSetupFailure(new Error('Bootstrap failed: 78: Invalid property list'))).toBe(false)
    expect(isRetryableLaunchdSetupFailure(new Error('Authentication failed'))).toBe(false)
  })

  it('keeps the local installer checkout until the installer process finishes', async () => {
    const manager = new ServerSetupManager() as unknown as ServerSetupManagerHarness
    const installer = deferred<ServerSetupResult | null>()
    const result: ServerSetupResult = {
      serverUrl: 'http://127.0.0.1:7850',
      accessToken: '0123456789abcdef0123456789abcdef',
      service: 'launchd-user',
      tailscaleIP: ''
    }
    const runProcess = vi.spyOn(manager, 'runProcess')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockReturnValueOnce(installer.promise)

    const setup = manager.runLocal(7850, vi.fn(), true, STABLE_RELEASE)
    await vi.waitFor(() => expect(runProcess).toHaveBeenCalledTimes(4))

    expect(runProcess.mock.calls[0]).toEqual([
      '/bin/sh',
      ['-s', '--'],
      SERVER_SETUP_PREFLIGHT_SCRIPT,
      expect.any(Function),
      false,
      { phase: 'runtime', message: 'Checking local setup prerequisites…' }
    ])
    expect(runProcess.mock.calls[1]?.slice(0, 3)).toEqual([
      '/bin/sh',
      ['-s', '--', '/tmp/agents-server-setup-test/AgentsServer'],
      LOCAL_RELEASE_BOOTSTRAP
    ])
    expect(runProcess.mock.calls[2]?.slice(0, 3)).toEqual([
      '/bin/sh',
      ['-s', '--', '/tmp/agents-server-setup-test/compat-bin', '/tmp/agents-server-setup-test/AgentsServer/install.sh'],
      SERVER_SETUP_HOST_PREP_SCRIPT
    ])
    expect(runProcess.mock.calls[3]?.[1]).toEqual([
      '/tmp/agents-server-setup-test/AgentsServer/install.sh',
      '--non-interactive', '--port', '7850', '--team-hub-host'
    ])
    expect(runProcess.mock.calls[3]?.[5]).toMatchObject({
      phase: 'runtime',
      message: 'Preparing the AgentsServer runtime…',
      environment: { PATH: expect.stringMatching(/^\/tmp\/agents-server-setup-test\/compat-bin:/) }
    })
    expect(fsHarness.rm).not.toHaveBeenCalled()

    installer.resolve(result)
    await expect(setup).resolves.toEqual(result)
    expect(fsHarness.rm).toHaveBeenCalledOnce()
    expect(fsHarness.rm).toHaveBeenCalledWith('/tmp/agents-server-setup-test', { recursive: true, force: true })
  })

  it('stops local setup before creating a checkout when prerequisite preflight fails', async () => {
    const manager = new ServerSetupManager() as unknown as ServerSetupManagerHarness
    const runProcess = vi.spyOn(manager, 'runProcess').mockRejectedValueOnce(new Error('Install tmux, then retry guided setup.'))

    await expect(manager.runLocal(7850, vi.fn(), false, STABLE_RELEASE)).rejects.toThrow('Install tmux')

    expect(runProcess).toHaveBeenCalledOnce()
    expect(runProcess.mock.calls[0]?.slice(0, 3)).toEqual(['/bin/sh', ['-s', '--'], SERVER_SETUP_PREFLIGHT_SCRIPT])
    expect(fsHarness.mkdtemp).not.toHaveBeenCalled()
    expect(fsHarness.rm).not.toHaveBeenCalled()
  })

  it('keeps ProxyJump and identity files in the HOME ssh config when ssh would otherwise read /root', () => {
    const home = mkdtempSync(join(tmpdir(), 'agentsdock-ssh-home-'))
    mkdirSync(join(home, '.ssh'), { mode: 0o700 })
    writeFileSync(join(home, '.ssh', 'config'), [
      'Host jump',
      '  HostName 203.0.113.10',
      '  User ec2-user',
      '  IdentityFile ~/.ssh/id_ed25519',
      'Host gpu',
      '  HostName 100.64.0.8',
      '  User ubuntu',
      '  ProxyJump jump',
      '  IdentityFile ~/.ssh/id_ed25519',
      '  IdentitiesOnly yes',
      'Host plain',
      '  HostName 192.0.2.8',
      '  User ubuntu',
      ''
    ].join('\n'), { mode: 0o600 })
    writeFileSync(join(home, '.ssh', 'id_ed25519'), 'fixture-key\n', { mode: 0o600 })
    const created = createUserSSHConfig(home)
    expect(created).not.toBeNull()
    try {
      const text = readFileSync(created!.file, 'utf8')
      expect(text.indexOf('Host gpu')).toBeLessThan(text.lastIndexOf('Host *'))
      expect(text).toContain(`IdentityFile ${home}/.ssh/id_ed25519`)
      expect(text).not.toContain('~/.ssh')
      expect(text).toContain(`UserKnownHostsFile ${join(home, '.ssh', 'known_hosts')}`)
      const listed = execFileSync('ssh', ['-F', created!.file, '-G', 'gpu'], { encoding: 'utf8' })
      expect(listed).toMatch(/proxyjump jump/i)
      expect(listed).toMatch(/hostname 100\.64\.0\.8/i)
      expect(listed).toMatch(/identitiesonly yes/i)
      const plain = execFileSync('ssh', ['-F', created!.file, '-G', 'plain'], { encoding: 'utf8' })
      expect(plain).toMatch(new RegExp(`identityfile ${home}/\\.ssh/id_ed25519`, 'i'))
      expect(expandSSHConfigHome('IdentityFile ~/.ssh/id_ed25519\n', home)).toBe(`IdentityFile ${home}/.ssh/id_ed25519\n`)
    } finally {
      rmSync(created!.directory, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('uses BatchMode for remote preflight and installer bootstrap', async () => {
    const manager = new ServerSetupManager() as unknown as ServerSetupManagerHarness
    const result: ServerSetupResult = {
      serverUrl: 'http://100.64.0.10:7850',
      accessToken: '0123456789abcdef0123456789abcdef',
      service: 'systemd-user',
      tailscaleIP: '100.64.0.10'
    }
    const runProcess = vi.spyOn(manager, 'runProcess')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(result)
    vi.spyOn(manager, 'stageRemoteInstallFiles').mockResolvedValue({ archive: false, uv: false })

    await expect(manager.runRemote('user@server', 7850, vi.fn(), true, STABLE_RELEASE)).resolves.toEqual(result)

    expect(runProcess).toHaveBeenCalledTimes(2)
    const preflightArgs = runProcess.mock.calls[0]?.[1] as string[]
    const installArgs = runProcess.mock.calls[1]?.[1] as string[]
    const config = preflightArgs[0] === '-F' ? preflightArgs[1] : undefined
    expect(preflightArgs).toEqual(remoteShellArgs('user@server', 'sh', config))
    expect(runProcess.mock.calls[0]?.[2]).toBe(SERVER_SETUP_PREFLIGHT_SCRIPT)
    expect(runProcess.mock.calls[0]?.[4]).toBe(false)
    expect(installArgs).toEqual([...remoteShellArgs('user@server', 'sh', config), '7850', 'true'])
    expect(runProcess.mock.calls[1]?.[2]).toBe(REMOTE_BOOTSTRAP)
    expect(runProcess.mock.calls[1]?.[4]).toBe(true)
    expect(runProcess.mock.calls.every(call => call[1].includes('BatchMode=yes'))).toBe(true)
    expect(runProcess.mock.calls.every(call => call[1].includes('ServerAliveInterval=15'))).toBe(true)
    expect(runProcess.mock.calls.every(call => call[1].includes('ServerAliveCountMax=4'))).toBe(true)
  })

  it('uses a one-shot askpass helper for password SSH without exposing the secret in arguments', async () => {
    const manager = new ServerSetupManager() as unknown as ServerSetupManagerHarness
    const result: ServerSetupResult = {
      serverUrl: 'http://192.0.2.10:7850',
      accessToken: '0123456789abcdef0123456789abcdef',
      service: 'systemd-user',
      tailscaleIP: ''
    }
    const runProcess = vi.spyOn(manager, 'runProcess')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(result)
    vi.spyOn(manager, 'stageRemoteInstallFiles').mockResolvedValue({ archive: false, uv: false })

    await expect(manager.runRemote('user@server', 7850, vi.fn(), false, STABLE_RELEASE, 'one time secret')).resolves.toEqual(result)

    expect(runProcess).toHaveBeenCalledTimes(2)
    for (const call of runProcess.mock.calls) {
      expect(call[1]).toContain('BatchMode=no')
      expect(call[1]).toContain('PreferredAuthentications=password,keyboard-interactive')
      expect(JSON.stringify(call.slice(0, 3))).not.toContain('one time secret')
      const environment = call[5]?.environment
      expect(environment).toMatchObject({ SSH_ASKPASS_REQUIRE: 'force' })
      expect(environment?.SSH_ASKPASS).toMatch(/agentsdock-ssh-password-/)
      expect(environment?.AGENTSDOCK_SSH_PASSWORD_FILE).toMatch(/agentsdock-ssh-password-/)
    }
    const promptDirectory = runProcess.mock.calls[0]?.[5]?.environment?.SSH_ASKPASS
      ?.replace(/\/askpass$/, '')
    expect(promptDirectory && existsSync(promptDirectory)).toBe(false)
  })

  it('connects with the chosen private key and does not put the key material on the command line', async () => {
    const manager = new ServerSetupManager() as unknown as ServerSetupManagerHarness
    const keyDirectory = mkdtempSync(join(tmpdir(), 'agentsdock-chosen-key-'))
    const keyPath = join(keyDirectory, 'laptop_ed25519')
    writeFileSync(keyPath, 'BEGIN OPENSSH PRIVATE KEY fixture-material\n', { mode: 0o644 })
    const result: ServerSetupResult = {
      serverUrl: 'http://192.0.2.27:7850',
      accessToken: '0123456789abcdef0123456789abcdef',
      service: 'systemd-user',
      tailscaleIP: ''
    }
    const stagedKey = stageSSHIdentity(keyPath)
    expect(statSync(stagedKey.file).mode & 0o077).toBe(0)
    expect(readFileSync(stagedKey.file, 'utf8')).toContain('fixture-material')
    rmSync(stagedKey.directory, { recursive: true, force: true })
    const runProcess = vi.spyOn(manager, 'runProcess')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(result)
    vi.spyOn(manager, 'stageRemoteInstallFiles').mockResolvedValue({ archive: false, uv: false })
    try {
      await expect(manager.runRemote('ubuntu@192.0.2.27', 7850, vi.fn(), false, STABLE_RELEASE, 'unused password', keyPath)).resolves.toEqual(result)
      const serialized = JSON.stringify(runProcess.mock.calls)
      expect(serialized).not.toContain('fixture-material')
      expect(serialized).not.toContain('unused password')
      for (const call of runProcess.mock.calls) {
        expect(call[1]).toContain('IdentitiesOnly=yes')
        expect(call[1]).toContain('BatchMode=yes')
        expect(call[1]).not.toContain('PubkeyAuthentication=no')
        const identity = (call[1] as string[])[(call[1] as string[]).indexOf('-i') + 1]
        expect(identity).toMatch(/id_key$/)
      }
    } finally {
      rmSync(keyDirectory, { recursive: true, force: true })
    }
    const identityArgument = runProcess.mock.calls[0]?.[1] as string[]
    expect(existsSync(identityArgument[identityArgument.indexOf('-i') + 1])).toBe(false)
  })

  it('uploads a verified archive and uv over SSH when the server cannot reach GitHub', async () => {
    let payloadDir = ''
    fsHarness.mkdtemp.mockImplementation(async (prefix: string) => {
      payloadDir = mkdtempSync(prefix)
      return payloadDir
    })
    const downloadFile = vi.fn(async (url: string, destination: string) => {
      if (url.includes('/uv-')) {
        const root = mkdtempSync(join(tmpdir(), 'agentsdock-uv-fixture-'))
        const nested = join(root, 'uv-x86_64-unknown-linux-gnu')
        mkdirSync(nested)
        writeFileSync(join(nested, 'uv'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 0, 0, 0]))
        execFileSync('tar', ['-czf', destination, '-C', root, 'uv-x86_64-unknown-linux-gnu'])
        rmSync(root, { recursive: true, force: true })
        return
      }
      writeFileSync(destination, 'archive-bytes')
    })
    const manager = new ServerSetupManager(undefined, undefined, downloadFile) as unknown as ServerSetupManagerHarness
    const result: ServerSetupResult = {
      serverUrl: 'http://192.0.2.27:7850',
      accessToken: '0123456789abcdef0123456789abcdef',
      service: 'systemd-user',
      tailscaleIP: ''
    }
    const progress = vi.fn()
    const runProcess = vi.spyOn(manager, 'runProcess').mockImplementation(async (_command, _args, stdin, _progress, expectResult) => {
      if (!expectResult && typeof stdin === 'string' && stdin.includes('AGENTSDOCK_REMOTE_PLATFORM')) {
        manager.remotePlatform = 'Linux x86_64'
        return null
      }
      return result
    })
    const stream = vi.spyOn(manager, 'streamFileToRemote').mockImplementation(async (_host, _local, filename) => (
      `/home/ubuntu/.cache/agentsdock-setup/${filename}`
    ))
    try {
      await expect(manager.runRemote('ubuntu@192.0.2.27', 7850, progress, false, STABLE_RELEASE)).resolves.toEqual(result)
      expect(downloadFile).toHaveBeenCalledWith(
        STABLE_RELEASE.url,
        expect.stringMatching(/agents-server\.tar\.gz$/),
        expect.objectContaining({ sha256: STABLE_RELEASE.sha256 })
      )
      expect(downloadFile).toHaveBeenCalledWith(
        'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz',
        expect.stringMatching(/uv\.tar\.gz$/),
        expect.objectContaining({ maxBytes: 80 * 1024 * 1024 })
      )
      expect(stream.mock.calls.map(call => call[2])).toEqual(['agents-server.tar.gz', 'uv'])
      const installArgs = runProcess.mock.calls[1]?.[1] as string[]
      const config = installArgs[0] === '-F' ? installArgs[1] : undefined
      expect(installArgs).toEqual([
        ...remoteShellArgs('ubuntu@192.0.2.27', 'sh', config),
        '7850', 'false', 'true', 'true'
      ])
      expect(progress.mock.calls.some(([value]) => /on this computer/.test(value.message))).toBe(true)
      expect(progress.mock.calls.some(([value]) => /Copying AgentsServer/.test(value.message))).toBe(true)
    } finally {
      if (payloadDir) rmSync(payloadDir, { recursive: true, force: true })
    }
  })

  it('reports an SSH copy failure instead of asking the server to download the archive', async () => {
    const created: string[] = []
    fsHarness.mkdtemp.mockImplementation(async (prefix: string) => {
      const directory = mkdtempSync(prefix)
      created.push(directory)
      return directory
    })
    const downloadFile = vi.fn(async (_url: string, destination: string) => {
      writeFileSync(destination, 'archive-bytes')
    })
    const manager = new ServerSetupManager(undefined, undefined, downloadFile) as unknown as ServerSetupManagerHarness
    vi.spyOn(manager, 'runProcess').mockResolvedValue(null)
    vi.spyOn(manager, 'streamFileToRemote').mockRejectedValue(new Error('connection reset'))
    try {
      await expect(manager.runRemote('ubuntu@192.0.2.27', 7850, vi.fn(), false, STABLE_RELEASE)).rejects.toThrow(/Could not copy AgentsServer to ubuntu@192.0.2.27: connection reset/)
    } finally {
      for (const directory of created) rmSync(directory, { recursive: true, force: true })
    }
  })

  it('creates a private askpass helper that emits only the requested password', () => {
    const prompt = createSSHPasswordPrompt('spaces and $ymbols')
    try {
      expect(statSync(prompt.directory).mode & 0o777).toBe(0o700)
      expect(statSync(prompt.environment.AGENTSDOCK_SSH_PASSWORD_FILE!).mode & 0o777).toBe(0o600)
      expect(execFileSync(prompt.environment.SSH_ASKPASS!, [], {
        encoding: 'utf8', env: prompt.environment
      })).toBe('spaces and $ymbols\n')
    } finally {
      rmSync(prompt.directory, { recursive: true, force: true })
    }
  })

  it('does not launch the remote clone or installer after preflight failure', async () => {
    const manager = new ServerSetupManager() as unknown as ServerSetupManagerHarness
    const runProcess = vi.spyOn(manager, 'runProcess').mockRejectedValueOnce(new Error('The systemctl --user session is unavailable.'))

    await expect(manager.runRemote('user@server', 7850, vi.fn(), false, STABLE_RELEASE)).rejects.toThrow('systemctl --user')

    expect(runProcess).toHaveBeenCalledOnce()
    const preflightArgs = runProcess.mock.calls[0]?.[1] as string[]
    const config = preflightArgs[0] === '-F' ? preflightArgs[1] : undefined
    expect(preflightArgs).toEqual(remoteShellArgs('user@server', 'sh', config))
    expect(runProcess.mock.calls[0]?.[2]).toBe(SERVER_SETUP_PREFLIGHT_SCRIPT)
  })

  it('parses only the saved PATH value without sourcing other env-file content', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentsdock-preflight-path-'))
    const config = join(directory, 'config')
    const customBin = join(directory, 'custom-bin')
    const marker = join(directory, 'must-not-exist')
    mkdirSync(config, { recursive: true })
    mkdirSync(customBin, { recursive: true })
    writeFileSync(join(config, 'env'), `AGENTSDOCK_AGENT_TOKEN=secret\nDONT_SOURCE=\$(touch "${marker}")\nPATH=${customBin}\n`)
    try {
      const output = execFileSync('/bin/sh', ['-c', `${SERVER_SETUP_PATH_BOOTSTRAP}\nprintf '%s' "$PATH"`], {
        encoding: 'utf8',
        env: { HOME: directory, PATH: '/usr/bin:/bin', AGENTS_SERVER_CONFIG_DIR: config }
      })
      expect(output.split(':')[0]).toBe(customBin)
      expect(output).toContain('/opt/homebrew/bin')
      expect(existsSync(marker)).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('prepares uv, Python 3.12, and missing-unit output across supported systemd versions', () => {
    const home = mkdtempSync(join(tmpdir(), 'folio-host-prep-'))
    const bin = join(home, 'bin')
    const compat = join(home, 'compat-bin')
    const installer = join(home, 'install.sh')
    mkdirSync(bin)
    writeFileSync(installer, "uv sync --python '>=3.10'\n")
    writeFileSync(join(bin, 'uv'), `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo uv-test
  exit 0
fi
if [ "$1" = "--show-proxy" ]; then
  printf '%s\\n' "$HTTPS_PROXY"
  exit 0
fi
if [ "$1" = "python" ] && [ "$2" = "find" ]; then
  if [ -x "$HOME/py/python3.12" ]; then
    printf '%s\\n' "$HOME/py/python3.12"
    exit 0
  fi
  exit 1
fi
if [ "$1" = "python" ] && [ "$2" = "install" ]; then
  mkdir -p "$HOME/py"
  printf '#!/bin/sh\\n' > "$HOME/py/python3.12"
  chmod 775 "$HOME/py/python3.12"
  exit 0
fi
echo "unexpected uv args: $*" >&2
exit 1
`)
    chmodSync(join(bin, 'uv'), 0o755)
    try {
      expect(() => execFileSync('/bin/sh', ['-n'], { input: SERVER_SETUP_HOST_PREP_SCRIPT })).not.toThrow()
      const prepared = spawnSync('/bin/sh', ['-s', '--', compat, installer], {
        input: SERVER_SETUP_HOST_PREP_SCRIPT,
        encoding: 'utf8',
        env: {
          HOME: home,
          PATH: `${bin}:/usr/bin:/bin`,
          HTTPS_PROXY: 'http://127.0.0.1:9',
          http_proxy: 'http://127.0.0.1:9\nrm -rf /'
        }
      })
      expect(prepared.status, prepared.stderr).toBe(0)
      expect(readFileSync(installer, 'utf8')).toContain("--python '>=3.11'")
      expect(statSync(join(home, 'py', 'python3.12')).mode & 0o022).toBe(0)
      const systemctl = spawnSync(join(compat, 'systemctl'), ['--user', 'is-enabled', 'folio-missing-unit.service'], { encoding: 'utf8' })
      expect([1, 4], systemctl.stderr).toContain(systemctl.status)
      expect(systemctl.stdout.trim()).toBe('not-found')
      const wrapped = spawnSync('/usr/bin/env', ['-i', `PATH=${compat}:/usr/bin:/bin`, join(compat, 'uv'), '--show-proxy'], { encoding: 'utf8' })
      expect(wrapped.status, wrapped.stderr).toBe(0)
      expect(wrapped.stdout.trim()).toBe('http://127.0.0.1:9')
      const wrapper = readFileSync(join(compat, 'uv'), 'utf8')
      expect(wrapper).toContain("export HTTPS_PROXY='http://127.0.0.1:9'")
      expect(wrapper).not.toContain('rm -rf')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('keeps the evaluated preflight and remote bootstrap shell syntax valid', () => {
    expect(() => execFileSync('/bin/sh', ['-n'], { input: SERVER_SETUP_PREFLIGHT_SCRIPT })).not.toThrow()
    expect(() => execFileSync('/bin/sh', ['-n'], { input: REMOTE_EXISTING_SERVER_DISCOVERY_SCRIPT })).not.toThrow()
    expect(() => execFileSync('/bin/sh', ['-n'], { input: LOCAL_RELEASE_BOOTSTRAP })).not.toThrow()
    expect(() => execFileSync('/bin/sh', ['-n'], { input: REMOTE_BOOTSTRAP })).not.toThrow()
    expect(LOCAL_RELEASE_BOOTSTRAP).toContain('if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]')
    expect(REMOTE_BOOTSTRAP).toContain('if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]')
    expect(LOCAL_RELEASE_BOOTSTRAP).not.toContain('git clone')
    expect(REMOTE_BOOTSTRAP).not.toContain('git clone')
    expect(remoteStageReceiveCommand('agents-server.tar.gz')).toContain('"$HOME/.cache/agentsdock-setup/agents-server.tar.gz"')
    const keyedShell = remoteShellArgs('ubuntu@192.0.2.27', 'sh', '/tmp/config', false, '/tmp/id_key')
    expect(remoteCommandArgs('ubuntu@192.0.2.27', remoteStageReceiveCommand('uv'), '/tmp/config', false, '/tmp/id_key')).toEqual([
      ...keyedShell.slice(0, -3),
      remoteStageReceiveCommand('uv')
    ])
    expect(uvReleaseAsset('Linux x86_64')).toBe('https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz')
    expect(uvReleaseAsset('Linux arm64')).toBe('https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-unknown-linux-gnu.tar.gz')
    expect(uvReleaseAsset('Darwin arm64')).toBe('https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-apple-darwin.tar.gz')
    expect(uvReleaseAsset('Linux ppc64le')).toBeNull()
    expect(parseRemoteStagePath('ready\n/home/ubuntu/.cache/agentsdock-setup/uv\n', 'uv')).toBe('/home/ubuntu/.cache/agentsdock-setup/uv')
    expect(() => parseRemoteStagePath('/tmp/agents-server.tar.gz', 'agents-server.tar.gz')).toThrow(/uploaded installer/)
  })

  it('discovers and authenticates an existing compatible AgentsServer without installing', async () => {
    const home = mkdtempSync(join(tmpdir(), 'agentsdock-existing-server-'))
    const installRoot = join(home, 'install')
    const configRoot = join(home, 'config')
    const pythonBin = join(installRoot, 'current', '.venv', 'bin')
    const token = 'a'.repeat(64)
    mkdirSync(pythonBin, { recursive: true })
    mkdirSync(configRoot)
    const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim()
    symlinkSync(python, join(pythonBin, 'python'))
    const server = createServer((request, response) => {
      const authenticated = request.url === '/api/health'
        ? request.headers.authorization === `Bearer ${token}`
        : request.headers['x-agentsdock-token'] === token
      if (!authenticated) {
        response.writeHead(401).end()
        return
      }
      response.setHeader('Content-Type', 'application/json')
      if (request.url === '/api/health') {
        response.end(JSON.stringify({
          ok: true,
          api_contract_version: 15,
          server_version: '1.0.11',
          server_identity: 'server-existing'
        }))
        return
      }
      if (request.url === '/api/connection-addresses') {
        response.end(JSON.stringify({
          version: 1,
          server_identity: 'server-existing',
          urls: [`http://100.64.0.8:${port}`, `http://192.168.1.8:${port}`]
        }))
        return
      }
      response.writeHead(404).end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    writeFileSync(join(configRoot, 'env'), [
      'AGENTSDOCK_AGENT_BIND=0.0.0.0',
      `AGENTSDOCK_AGENT_PORT=${port}`,
      `AGENTSDOCK_AGENT_TOKEN=${token}`,
      ''
    ].join('\n'), { mode: 0o600 })
    try {
      const output = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn('/bin/sh', ['-s', '--', '7850', '8'], {
          env: { ...process.env, HOME: home, AGENTS_SERVER_INSTALL_DIR: installRoot, AGENTS_SERVER_CONFIG_DIR: configRoot },
          stdio: ['pipe', 'pipe', 'pipe']
        })
        const stdout: Buffer[] = []
        const stderr: Buffer[] = []
        child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
        child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
        child.on('error', reject)
        child.on('close', code => resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }))
        child.stdin.end(REMOTE_EXISTING_SERVER_DISCOVERY_SCRIPT)
      })
      expect(output.code, output.stderr).toBe(0)
      const resultLine = output.stdout.split(/\r?\n/).find(line => line.startsWith('AGENTSDOCK_SETUP_RESULT='))
      expect(resultLine && parseServerSetupResult(resultLine)).toEqual({
        serverUrl: `http://127.0.0.1:${port}`,
        serverUrls: [`http://192.168.1.8:${port}`, `http://100.64.0.8:${port}`],
        accessToken: token,
        service: 'existing-ssh',
        tailscaleIP: '',
        serverVersion: '1.0.11'
      })
      expect(existsSync(join(home, 'install-marker'))).toBe(false)
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('installs an uploaded archive without curling GitHub from the server', () => {
    const home = mkdtempSync(join(tmpdir(), 'agentsdock-staged-release-'))
    const stage = join(home, '.cache', 'agentsdock-setup')
    const sourceName = `agents-server-${STABLE_RELEASE.version}`
    const source = join(home, sourceName)
    const fakeBin = join(home, 'fake-bin')
    mkdirSync(stage, { recursive: true })
    mkdirSync(source)
    mkdirSync(fakeBin)
    writeFileSync(join(source, 'VERSION'), `${STABLE_RELEASE.version}\n`)
    writeFileSync(join(source, 'install.sh'), [
      '#!/bin/sh',
      'printf \'%s\\n\' "$@" > "$HOME/install-args"',
      'case " $* " in *" --team-hub-host "*) echo "unexpected Team Network activation" >&2; exit 1 ;; esac',
      'touch "$HOME/install-marker"',
      'exit 0',
      ''
    ].join('\n'))
    chmodSync(join(source, 'install.sh'), 0o755)
    const archive = join(stage, 'agents-server.tar.gz')
    execFileSync('tar', ['-czf', archive, '-C', home, sourceName])
    const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex')
    writeFileSync(join(fakeBin, 'curl'), '#!/bin/sh\ntouch "$HOME/curl-called"\nexit 28\n')
    chmodSync(join(fakeBin, 'curl'), 0o755)
    writeFileSync(join(stage, 'uv'), `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo uv-test
  exit 0
fi
if [ "$1" = "python" ] && [ "$2" = "find" ]; then
  if [ -x "$HOME/py/python3.12" ]; then
    printf '%s\\n' "$HOME/py/python3.12"
    exit 0
  fi
  exit 1
fi
if [ "$1" = "python" ] && [ "$2" = "install" ]; then
  mkdir -p "$HOME/py"
  printf '#!/bin/sh\\n' > "$HOME/py/python3.12"
  chmod 755 "$HOME/py/python3.12"
  exit 0
fi
echo "unexpected uv args: $*" >&2
exit 1
`)
    chmodSync(join(stage, 'uv'), 0o755)
    const script = REMOTE_BOOTSTRAP.replace(STABLE_RELEASE.sha256, sha256)
    try {
      const installed = spawnSync('/bin/sh', ['-s', '--', '7850', 'false', 'true', 'true'], {
        input: script,
        encoding: 'utf8',
        env: { HOME: home, PATH: `${fakeBin}:/usr/bin:/bin`, AGENTS_SERVER_CONFIG_DIR: join(home, 'config') }
      })
      expect(installed.status, `${installed.stdout}\n${installed.stderr}`).toBe(0)
      expect(existsSync(join(home, 'install-marker'))).toBe(true)
      expect(readFileSync(join(home, 'install-args'), 'utf8')).toBe('--non-interactive\n--port\n7850\n')
      expect(existsSync(join(home, 'curl-called'))).toBe(false)
      expect(existsSync(archive)).toBe(false)
      const rejected = spawnSync('/bin/sh', ['-s', '--', '7850', 'false', 'true; touch "$HOME/curl-called"'], {
        input: REMOTE_BOOTSTRAP,
        encoding: 'utf8',
        env: { HOME: home, PATH: `${fakeBin}:/usr/bin:/bin` }
      })
      expect(rejected.status).toBe(2)
      expect(rejected.stderr).toContain('Invalid staged archive choice.')
      expect(existsSync(join(home, 'curl-called'))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('verifies the archive on this computer before uploading it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentsdock-local-download-'))
    const destination = join(directory, 'agents-server.tar.gz')
    const bytes = Buffer.from('agents-server-fixture')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(new Response(bytes, { status: 200 }))
    try {
      await expect(downloadVerifiedFile('https://example.test/agents-server.tar.gz', destination, {
        fetchImpl, sha256, maxBytes: 1024, attempts: 2
      })).resolves.toBeUndefined()
      expect(readFileSync(destination).equals(bytes)).toBe(true)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      const mismatch = join(directory, 'mismatch.tar.gz')
      fetchImpl.mockResolvedValueOnce(new Response(bytes, { status: 200 }))
      await expect(downloadVerifiedFile('https://example.test/agents-server.tar.gz', mismatch, {
        fetchImpl, sha256: '0'.repeat(64), maxBytes: 1024, attempts: 2
      })).rejects.toThrow(/verification failed/)
      expect(existsSync(mismatch)).toBe(false)
      expect(fetchImpl).toHaveBeenCalledTimes(3)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects an unsafe remote Team Network host position before running downloaded code', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentsdock-host-flag-'))
    const marker = join(directory, 'must-not-exist')
    try {
      const result = spawnSync('/bin/sh', ['-s', '--', '7850', `true; touch ${marker}`], {
        input: REMOTE_BOOTSTRAP,
        encoding: 'utf8',
        env: { ...process.env, HOME: directory, AGENTS_SERVER_CONFIG_DIR: join(directory, 'config') }
      })
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('Invalid Team Network host choice.')
      expect(existsSync(marker)).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('carries the validated Team Network host choice into the selected installer path', async () => {
    const resolveRelease = vi.fn().mockResolvedValue(STABLE_RELEASE)
    const actual = new ServerSetupManager(undefined, resolveRelease)
    const manager = actual as unknown as ServerSetupManagerHarness
    const progress = vi.fn()
    const result: ServerSetupResult = {
      serverUrl: 'http://127.0.0.1:7850',
      accessToken: '0123456789abcdef0123456789abcdef',
      service: 'launchd-user',
      tailscaleIP: ''
    }
    const runLocal = vi.spyOn(manager, 'runLocal').mockResolvedValue(result)

    await expect(actual.run({ target: 'local', port: 7850, teamHubHost: true }, progress)).resolves.toEqual(result)

    expect(runLocal).toHaveBeenCalledWith(7850, progress, true, STABLE_RELEASE)
    expect(resolveRelease).toHaveBeenCalledExactlyOnceWith('stable', expect.any(AbortSignal))
  })

  it('connects to an existing compatible SSH server before release discovery or installation', async () => {
    const resolveRelease = vi.fn().mockResolvedValue(STABLE_RELEASE)
    const actual = new ServerSetupManager(undefined, resolveRelease)
    const manager = actual as unknown as ServerSetupManagerHarness
    const progress = vi.fn()
    const result: ServerSetupResult = {
      serverUrl: 'http://192.0.2.27:7850',
      accessToken: '0123456789abcdef0123456789abcdef',
      service: 'existing-ssh',
      tailscaleIP: '',
      serverVersion: '1.0.11'
    }
    const connectExisting = vi.spyOn(manager, 'connectExistingRemote').mockResolvedValue(result)
    const runRemote = vi.spyOn(manager, 'runRemote')

    await expect(actual.run({ target: 'ssh', sshHost: 'ubuntu@192.0.2.27' }, progress)).resolves.toEqual(result)

    expect(connectExisting).toHaveBeenCalledWith('ubuntu@192.0.2.27', 7850, progress, undefined, undefined)
    expect(resolveRelease).not.toHaveBeenCalled()
    expect(runRemote).not.toHaveBeenCalled()
  })

  it('does not connect or install when release verification fails', async () => {
    const actual = new ServerSetupManager(undefined, async () => { throw new Error('Invalid release signature') })
    const manager = actual as unknown as ServerSetupManagerHarness
    vi.spyOn(manager, 'connectExistingRemote').mockResolvedValue(null)
    const runRemote = vi.spyOn(manager, 'runRemote')
    await expect(actual.run({ target: 'ssh', sshHost: 'qa-server' }, vi.fn())).rejects.toThrow('Invalid release signature')
    expect(runRemote).not.toHaveBeenCalled()
    expect(actual.diagnostics().state).toBe('failed')
  })

  it('cancels release discovery before starting an installer', async () => {
    let signal: AbortSignal | undefined
    const actual = new ServerSetupManager(undefined, async (_track, discoverySignal) => {
      signal = discoverySignal
      await new Promise((_, reject) => discoverySignal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      return STABLE_RELEASE
    })
    const runLocal = vi.spyOn(actual as unknown as ServerSetupManagerHarness, 'runLocal')
    const pending = actual.run({ target: 'local' }, vi.fn())
    expect(actual.cancel()).toBe(true)
    await expect(pending).rejects.toThrow(/cancelled/)
    expect(signal?.aborted).toBe(true)
    expect(runLocal).not.toHaveBeenCalled()
    expect(actual.diagnostics().state).toBe('cancelled')
  })

  it('verifies and extracts the pinned release archive before exposing it to the installer', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentsdock-release-bootstrap-'))
    const source = join(directory, `agents-server-${STABLE_RELEASE.version}`)
    const archive = join(directory, 'release.tar.gz')
    const destination = join(directory, 'verified-release')
    mkdirSync(source)
    writeFileSync(join(source, 'VERSION'), `${STABLE_RELEASE.version}\n`)
    writeFileSync(join(source, 'install.sh'), '#!/bin/sh\nexit 0\n')
    execFileSync('tar', ['-czf', archive, '-C', directory, `agents-server-${STABLE_RELEASE.version}`])
    const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex')
    const script = LOCAL_RELEASE_BOOTSTRAP
      .replace(STABLE_RELEASE.url, `file://${archive}`)
      .replace(STABLE_RELEASE.sha256, sha256)
    try {
      execFileSync('/bin/sh', ['-s', '--', destination], {
        input: script,
        env: { ...process.env, HOME: directory, AGENTS_SERVER_CONFIG_DIR: join(directory, 'config') }
      })
      expect(readFileSync(join(destination, 'VERSION'), 'utf8').trim()).toBe(STABLE_RELEASE.version)
      expect(existsSync(join(destination, 'install.sh'))).toBe(true)

      const rejected = join(directory, 'rejected-release')
      const rejectedScript = script.replace(sha256, '0'.repeat(64))
      expect(() => execFileSync('/bin/sh', ['-s', '--', rejected], {
        input: rejectedScript,
        env: { ...process.env, HOME: directory, AGENTS_SERVER_CONFIG_DIR: join(directory, 'config') },
        stdio: ['pipe', 'pipe', 'pipe']
      })).toThrow()
      expect(existsSync(rejected)).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('continues with a capability warning when the tmux version probe is unusable', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentsdock-preflight-probe-'))
    const config = join(directory, 'config')
    const fakeBin = join(directory, 'bin')
    mkdirSync(config, { recursive: true })
    mkdirSync(fakeBin, { recursive: true })
    for (const command of ['curl', 'bash', 'tar', 'systemctl']) {
      const path = join(fakeBin, command)
      writeFileSync(path, '#!/bin/sh\nexit 0\n')
      chmodSync(path, 0o755)
    }
    const uname = join(fakeBin, 'uname')
    writeFileSync(uname, '#!/bin/sh\nprintf Linux\n')
    chmodSync(uname, 0o755)
    const brokenTmux = join(fakeBin, 'tmux')
    writeFileSync(brokenTmux, '#!/bin/sh\nexit 69\n')
    chmodSync(brokenTmux, 0o755)
    writeFileSync(join(config, 'env'), `PATH=${fakeBin}\n`)
    try {
      const result = spawnSync('/bin/sh', ['-s'], {
        input: SERVER_SETUP_PREFLIGHT_SCRIPT,
        encoding: 'utf8',
        env: { HOME: directory, PATH: '/usr/bin:/bin', AGENTS_SERVER_CONFIG_DIR: config }
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('AGENTSDOCK_PREFLIGHT_WARNING=tmux is unavailable.')
      expect(result.stderr).not.toContain('AGENTSDOCK_PREFLIGHT_ERROR=')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('adds common Finder and Homebrew locations to spawned setup commands', () => {
    const path = serverSetupProcessPath('/finder-only/bin')
    expect(path.split(':')).toEqual(expect.arrayContaining([
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/home/linuxbrew/.linuxbrew/bin',
      '/usr/bin',
      '/bin',
      '/finder-only/bin'
    ]))
  })

  it('treats carriage returns as progress line boundaries', () => {
    const lines: string[] = []
    const consume = createLineConsumer(line => lines.push(line))
    consume('Downloading 10%\rDownloading 50%')
    consume('\r\nInstalling\nReady')
    consume.flush()
    expect(lines.filter(Boolean)).toEqual([
      'Downloading 10%',
      'Downloading 50%',
      'Installing',
      'Ready'
    ])
  })

  it('redacts setup results, environment tokens, and bearer credentials from diagnostics', () => {
    expect(redactServerSetupLogLine(
      'AGENTSDOCK_SETUP_RESULT={"server_url":"http://localhost","access_token":"super-secret"}'
    )).toBe('AGENTSDOCK_SETUP_RESULT=[connection details redacted]')
    expect(redactServerSetupLogLine('AGENTSDOCK_AGENT_TOKEN=super-secret')).toBe('AGENTSDOCK_AGENT_TOKEN=[REDACTED]')
    expect(redactServerSetupLogLine('AGENTSDOCK_AGENT_TOKEN="super-secret"')).toBe('AGENTSDOCK_AGENT_TOKEN="[REDACTED]"')
    expect(redactServerSetupLogLine('Access token: super-secret')).toBe('Access token: [REDACTED]')
    expect(redactServerSetupLogLine('Access token = "super-secret"')).toBe('Access token = "[REDACTED]"')
    expect(redactServerSetupLogLine('  Access token  super-secret')).toBe('  Access token  [REDACTED]')
    expect(redactServerSetupLogLine('Authorization: Bearer super-secret')).toBe('Authorization: Bearer [REDACTED]')
    expect(redactServerSetupLogLine("Authorization: Bearer 'super-secret'")).toBe("Authorization: Bearer '[REDACTED]'")
  })

  it('shows optional preflight warnings as clean progress text', async () => {
    const manager = new ServerSetupManager(testTimings()) as unknown as ServerSetupManagerHarness
    const progress = vi.fn()
    await expect(manager.runProcess(
      '/bin/sh',
      ['-c', 'printf "%s\\n" "AGENTSDOCK_PREFLIGHT_WARNING=tmux is unavailable." >&2'],
      undefined,
      progress,
      false,
      { phase: 'runtime', message: 'Checking prerequisites…' }
    )).resolves.toBeNull()
    expect(progress).toHaveBeenCalledWith({ phase: 'runtime', message: 'tmux is unavailable.' })
  })

  it('emits progress heartbeats while a quiet setup process is still healthy', async () => {
    const manager = new ServerSetupManager(testTimings({ heartbeatMs: 20 })) as unknown as ServerSetupManagerHarness
    const progress = vi.fn()
    await expect(manager.runProcess(
      '/bin/sh',
      ['-c', 'sleep 0.09'],
      undefined,
      progress,
      false,
      { phase: 'install', message: 'Installing dependencies…' }
    )).resolves.toBeNull()
    expect(progress.mock.calls.some(([value]) => /Still working: Installing dependencies/.test(value.message))).toBe(true)
  })

  it('stops and explains a setup process that becomes inactive', async () => {
    const manager = new ServerSetupManager(testTimings({
      inactivityTimeoutMs: 45,
      heartbeatMs: 15,
      terminateGraceMs: 5
    })) as unknown as ServerSetupManagerHarness
    await expect(manager.runProcess(
      '/bin/sh',
      ['-c', 'sleep 5'],
      undefined,
      vi.fn(),
      false,
      { phase: 'download', message: 'Downloading…' }
    )).rejects.toThrow(/produced no output/)
  })

  it('enforces a per-stage setup deadline separately from inactivity', async () => {
    const manager = new ServerSetupManager(testTimings({
      inactivityTimeoutMs: 1_000,
      heartbeatMs: 15,
      stageTimeoutMs: { service: 45 }
    })) as unknown as ServerSetupManagerHarness
    await expect(manager.runProcess(
      '/bin/sh',
      ['-c', 'while :; do echo waiting; sleep 0.01; done'],
      undefined,
      vi.fn(),
      false,
      { phase: 'service', message: 'Starting service…' }
    )).rejects.toThrow(/service setup step exceeded/)
  })

  it('cancels the active process tree and records a cancelled state', async () => {
    const actual = new ServerSetupManager(testTimings(), async () => STABLE_RELEASE)
    const manager = actual as unknown as ServerSetupManagerHarness
    vi.spyOn(manager, 'runLocal').mockImplementation((_port, progress) =>
      manager.runProcess(
        '/bin/sh',
        ['-c', 'sleep 5 & wait'],
        undefined,
        progress,
        false,
        { phase: 'install', message: 'Installing…' }
      ).then(() => {
        throw new Error('The cancelled process unexpectedly completed.')
      })
    )
    const running = actual.run({ target: 'local', port: 7850 }, vi.fn())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(actual.cancel()).toBe(true)
    expect(actual.diagnostics().state).toBe('running')
    await expect(actual.run({ target: 'local', port: 7850 }, vi.fn())).rejects.toThrow(/already running/)
    await expect(running).rejects.toThrow(/cancelled/)
    expect(actual.diagnostics().state).toBe('cancelled')
    expect(actual.cancel()).toBe(false)
  })
})
