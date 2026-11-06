import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const LAUNCH_SHIM_MARK = '# folio-electron-shim'
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46])

interface ElectronCommandLine {
  hasSwitch(name: string): boolean
  appendSwitch(name: string, value?: string): void
}

/**
 * Select a real credential store before Electron becomes ready on Linux.
 * Chromium's `detect` mode needs a desktop hint; launchers that omit it can
 * silently select `basic_text` even while the Secret Service is available.
 * Settings deliberately rejects that backend because it is only obfuscation,
 * not secure token storage. KDE retains Chromium's KWallet detection while
 * GNOME and desktop-hint-free launches use the freedesktop Secret Service.
 */
export function configureLinuxPasswordStore(
  platform: NodeJS.Platform,
  commandLine: ElectronCommandLine,
  desktop = process.env.XDG_CURRENT_DESKTOP
): boolean {
  if (platform !== 'linux' || commandLine.hasSwitch('password-store')) return false
  commandLine.appendSwitch('password-store', /(?:^|:)KDE(?:$|:)/i.test(desktop ?? '') ? 'detect' : 'gnome-libsecret')
  return true
}

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
  /** True when this process was started by passing the app to the Electron binary. */
  defaultApp?: boolean
}): string {
  const parts = [quoteDesktopField(input.execPath)]
  if (input.noSandbox) parts.push('--no-sandbox')
  // Electron 43 reports app.isPackaged for that default-app launch. The raw
  // binary then opens its own welcome window unless the menu repeats the app
  // directory. A packaged Folio executable already finds the app beside itself.
  if (!input.packaged || input.defaultApp) parts.push(quoteDesktopField(input.appPath))
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

/**
 * Desktop shells cannot resolve an image nested inside Electron's app.asar.
 * Copy it to a normal per-user icon path before referencing it from the
 * generated desktop entry.
 */
export function installFolioLinuxIcon(sourcePath: string, homePath: string): string {
  const iconDirectory = join(homePath, '.local', 'share', 'icons', 'hicolor', '512x512', 'apps')
  const iconPath = join(iconDirectory, 'folio.png')
  mkdirSync(iconDirectory, { recursive: true })
  writeFileSync(iconPath, readFileSync(sourcePath), { mode: 0o644 })
  chmodSync(iconPath, 0o644)
  return iconPath
}

/**
 * Script placed in front of Electron so a menu command still starts Folio.
 * The menu can keep an old command that has --no-sandbox, or no arguments at
 * all. Either one opens Electron's welcome window unless this script supplies
 * the app directory.
 */
export function electronLaunchShimScript(realName: string, appPath?: string): string {
  const fallback = appPath
    ? `app_dir=${shellSingleQuote(appPath)}
has_app=0
for arg in "$@"; do
  case "$arg" in
    -*) ;;
    *) has_app=1; break ;;
  esac
done
if [ "$has_app" -eq 0 ]; then
  set -- "$@" "$app_dir"
fi
`
    : ''
  return `#!/bin/sh
${LAUNCH_SHIM_MARK}
${fallback}exec "$(dirname "$0")/${realName}" --no-sandbox "$@"
`
}

/**
 * The application menu can keep an old command that runs the Electron binary
 * directly. After the first launcher starts, that command is often the
 * `electron.real` path shown in Electron's welcome window. Both names need
 * to add --no-sandbox and the Folio directory before the real binary runs.
 * Returns the path the menu should execute.
 */
export function installElectronLaunchShim(execPath: string, appPath?: string): string {
  const dir = dirname(execPath)
  const elf = ensureElectronElf(dir, execPath)
  if (!elf) return execPath
  const realName = basename(elf)
  for (const name of ['electron', 'electron.real']) {
    if (name === realName) continue
    writeLaunchShim(join(dir, name), realName, appPath)
  }
  const menu = join(dir, 'electron')
  return existsSync(menu) ? menu : execPath
}

function ensureElectronElf(dir: string, execPath: string): string | null {
  const bin = join(dir, 'electron.bin')
  if (isElf(bin)) return bin
  for (const candidate of [execPath, join(dir, 'electron.real'), join(dir, 'electron')]) {
    if (candidate === bin || !isElf(candidate)) continue
    renameSync(candidate, bin)
    return bin
  }
  return null
}

function isElf(path: string): boolean {
  return readPrefix(path).subarray(0, ELF_MAGIC.length).equals(ELF_MAGIC)
}

function writeLaunchShim(shimPath: string, realName: string, appPath?: string): void {
  const script = electronLaunchShimScript(realName, appPath)
  try {
    if (readFileSync(shimPath, 'utf8') === script) return
  } catch {
    // The shim is not there yet.
  }
  writeFileSync(shimPath, script, { mode: 0o755 })
  chmodSync(shimPath, 0o755)
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
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
