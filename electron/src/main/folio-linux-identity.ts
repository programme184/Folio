import { chmodSync, closeSync, existsSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const LAUNCH_SHIM_MARK = '# folio-electron-shim'
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46])

/** True when Chromium's setuid sandbox helper can actually run. */
export function sandboxHelperIsReady(stat: { uid: number; mode: number; isFile: () => boolean } | null): boolean {
  return !!stat && stat.isFile() && stat.uid === 0 && (stat.mode & 0o4755) === 0o4755
}

export function chromeSandboxHelperReady(execPath: string): boolean {
  try {
    return sandboxHelperIsReady(statSync(join(dirname(execPath), 'chrome-sandbox')))
  } catch {
    return false
  }
}

/**
 * Unprivileged user namespaces are usable only when the kernel allows them
 * and AppArmor is not blocking them. A missing knob means this platform
 * does not apply that restriction.
 */
export function unprivilegedNamespacesFromSysctl(apparmorRestrict: string | null, usernsClone: string | null): boolean {
  if (apparmorRestrict === '1') return false
  if (usernsClone === '0') return false
  return true
}

export function readSysctl(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return null
  }
}

/** Electron aborts instead of starting when neither sandbox path works. */
export function folioDesktopNeedsNoSandbox(helperReady: boolean, unprivilegedNamespaces: boolean): boolean {
  return !helperReady && !unprivilegedNamespaces
}

export function folioLinuxDesktopCommand(input: {
  packaged: boolean
  execPath: string
  appPath: string
  noSandbox: boolean
}): string {
  const parts = [quoteDesktopField(input.execPath)]
  if (input.noSandbox) parts.push('--no-sandbox')
  if (!input.packaged) parts.push(quoteDesktopField(input.appPath))
  return parts.join(' ')
}

export function folioLinuxDesktopEntry(command: string, iconPath: string): string {
  return `[Desktop Entry]
Version=1.0
Type=Application
Name=Folio
Comment=Folio
Exec=${command}
Icon=${iconPath}
StartupWMClass=folio
Terminal=false
Categories=Office;
`
}

/** Script placed in front of Electron so a menu that drops --no-sandbox still starts. */
export function electronLaunchShimScript(realName: string): string {
  return `#!/bin/sh
${LAUNCH_SHIM_MARK}
exec "$(dirname "$0")/${realName}" --no-sandbox "$@"
`
}

/**
 * The application menu can keep an old command that runs the Electron binary
 * directly. That command aborts when the sandbox helper cannot run. A shim at
 * the same path adds --no-sandbox before the real binary starts.
 * Returns the path the menu should execute.
 */
export function installElectronLaunchShim(execPath: string): string {
  const dir = dirname(execPath)
  const base = basename(execPath)
  if (base.endsWith('.real')) {
    const shim = join(dir, base.slice(0, -'.real'.length))
    if (!existsSync(shim)) writeLaunchShim(shim, base)
    return existsSync(shim) ? shim : execPath
  }
  const header = readPrefix(execPath)
  if (header.includes(LAUNCH_SHIM_MARK)) return execPath
  if (!header.subarray(0, ELF_MAGIC.length).equals(ELF_MAGIC)) return execPath
  const realName = `${base}.real`
  const realPath = join(dir, realName)
  if (!existsSync(realPath)) renameSync(execPath, realPath)
  else return execPath
  writeLaunchShim(execPath, realName)
  return execPath
}

function writeLaunchShim(shimPath: string, realName: string): void {
  writeFileSync(shimPath, electronLaunchShimScript(realName), { mode: 0o755 })
  chmodSync(shimPath, 0o755)
}

function readPrefix(path: string): Buffer {
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const buffer = Buffer.alloc(128)
    const read = readSync(fd, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, read)
  } catch {
    return Buffer.alloc(0)
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

function quoteDesktopField(value: string): string {
  return `"${value.replace(/(["\\`$])/g, '\\$1')}"`
}
