import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  folioDesktopNeedsNoSandbox,
  folioLinuxDesktopCommand,
  folioLinuxDesktopEntry,
  installElectronLaunchShim,
  sandboxHelperIsReady,
  unprivilegedNamespacesFromSysctl
} from './folio-linux-identity'

const file = (uid: number, mode: number) => ({ uid, mode, isFile: () => true })

describe('Folio linux launcher', () => {
  it('treats only a root setuid chrome-sandbox as ready', () => {
    expect(sandboxHelperIsReady(file(0, 0o104755))).toBe(true)
    expect(sandboxHelperIsReady(file(0, 0o100755))).toBe(false)
    expect(sandboxHelperIsReady(file(1000, 0o104755))).toBe(false)
    expect(sandboxHelperIsReady(null)).toBe(false)
  })

  it('needs --no-sandbox only when both sandbox paths are blocked', () => {
    expect(unprivilegedNamespacesFromSysctl('1', '1')).toBe(false)
    expect(unprivilegedNamespacesFromSysctl(null, '0')).toBe(false)
    expect(unprivilegedNamespacesFromSysctl(null, '1')).toBe(true)
    expect(unprivilegedNamespacesFromSysctl(null, null)).toBe(true)
    expect(folioDesktopNeedsNoSandbox(false, false)).toBe(true)
    expect(folioDesktopNeedsNoSandbox(true, false)).toBe(false)
    expect(folioDesktopNeedsNoSandbox(false, true)).toBe(false)
  })

  it('keeps the sandbox for a working helper and adds --no-sandbox for the menu launch that would otherwise abort', () => {
    const blocked = folioLinuxDesktopCommand({
      packaged: false,
      execPath: '/opt/electron',
      appPath: '/work/electron',
      noSandbox: true
    })
    expect(blocked).toBe('"/opt/electron" --no-sandbox "/work/electron"')
    const packaged = folioLinuxDesktopCommand({
      packaged: true,
      execPath: '/opt/Folio/folio',
      appPath: '/opt/Folio/resources/app',
      noSandbox: false
    })
    expect(packaged).toBe('"/opt/Folio/folio"')
    expect(packaged).not.toContain('--no-sandbox')
    expect(folioLinuxDesktopEntry(blocked, '/opt/folio-icon.png')).toContain(`Exec=${blocked}`)
  })

  it('puts a shim in front of the Electron binary so a menu command without --no-sandbox still starts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'folio-shim-'))
    const binary = join(dir, 'electron')
    writeFileSync(binary, Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from('binary')]))
    expect(installElectronLaunchShim(binary)).toBe(binary)
    expect(readFileSync(binary, 'utf8')).toContain('electron.real" --no-sandbox')
    expect(readFileSync(join(dir, 'electron.real')).subarray(0, 4)).toEqual(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    expect(installElectronLaunchShim(binary)).toBe(binary)
    expect(installElectronLaunchShim(join(dir, 'electron.real'))).toBe(binary)
  })
})