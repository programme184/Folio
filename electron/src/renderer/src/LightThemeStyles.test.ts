import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
const light = styles.match(/:root\[data-theme="light"\]\s*\{([^}]+)\}/)?.[1] ?? ''
const properties = Object.fromEntries(
  [...light.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()])
)

describe('Gruvbox Light eye-care backgrounds', () => {
  it('uses a warm cream canvas and olive ink', () => {
    expect(properties).toMatchObject({
      '--bg': '#fbf1c7',
      '--surface': '#fbf1c7',
      '--surface-2': '#f2e5bc',
      '--surface-3': '#ebdbb2',
      '--border': '#d5c4a1',
      '--text': '#3c3836'
    })
  })

  it('uses olive and warm semantic colors', () => {
    expect(properties).toMatchObject({
      '--accent': '#79740e',
      '--accent-hover': '#98971a',
      '--green': '#79740e',
      '--danger': '#9d0006',
      '--danger-strong': '#9d0006',
      '--danger-highlight': '#cc241d',
      '--danger-text': '#9d0006'
    })
    expect(styles).toContain(':root[data-theme="light"] .composer-editor > textarea::selection { background: #bdae9388; }')
    expect(styles).toContain(':root[data-theme="light"] .dialog-form .job-reference-editor > textarea::selection { background: #bdae9388; }')
  })

  it('keeps sent messages green instead of overriding them with neutral surfaces', () => {
    expect(properties).toMatchObject({ '--green-surface': '#ebdbb2', '--green-border': '#bdae93' })
    const bubble = styles.match(/^\.message-row\.user \.message-surface \{([^}]*)\}/m)?.[1] ?? ''
    expect(bubble).toContain('background: var(--green-surface);')
    expect(bubble).toContain('border: 1px solid var(--green-border);')
    expect(styles).not.toMatch(/:root\[data-theme="light"\] \.message-row\.user \.message-surface \{[^}]*background:/)
    expect(styles).toContain(':root[data-theme="light"] .cross-chat-queued-message.right .cross-chat-queued-bubble { background: #e7e0b8; border-color: #c6b88a; }')
    expect(contrast(properties['--text'], properties['--green-surface'])).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps send neutral-dark and disabled neutral, independently of the blue accent', () => {
    expect(styles).toContain(':root[data-theme="light"] .send-button { color: var(--text-on-accent); background: var(--text); }')
    expect(styles).toContain(':root[data-theme="light"] .send-button:hover:not(:disabled) { background: color-mix(in srgb, var(--text) 90%, #fff); }')
    expect(styles).toContain(':root[data-theme="light"] .send-button:disabled { color: var(--faint); background: var(--surface-3); }')
  })

  it('keeps supporting copy and the send icon at normal-text contrast', () => {
    expect(contrast(properties['--muted'], properties['--surface-2'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(properties['--text-on-accent'], properties['--text'])).toBeGreaterThanOrEqual(4.5)
    const hover = rgb(properties['--text']).map(channel => Math.round(channel * 0.9 + 255 * 0.1))
    expect(contrastChannels(rgb(properties['--text-on-accent']), hover)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps hover neutral and separate from action and message colors', () => {
    expect(properties['--interaction-hover']).toBe('rgb(60 56 54 / 7%)')
    expect(properties['--interaction-pressed']).toBe('rgb(60 56 54 / 12%)')
    expect(styles).toMatch(/:root\[data-theme="light"\] \.session-row:hover \{ background: #f2e5bc; \}/)
    expect(styles).toMatch(/:root\[data-theme="light"\] \.session-row\.selected \{[^}]*background: var\(--surface-3\);/)
  })

  it('keeps light chip, folder-button, and checked-switch states above their base overrides', () => {
    const chipBase = ':root[data-theme="light"] .codex-permission-chip { color: var(--muted); background: var(--surface-2); }'
    const chipHover = ':root[data-theme="light"] :is(.runtime-chip, .backend-chip, .codex-permission-chip):not(:disabled):is(:hover, [data-state="open"]) { color: var(--text); background: var(--interaction-hover); }'
    const folderBase = ':root[data-theme="light"] .working-directory-picker-location > button { color: var(--accent); background: var(--surface-2); }'
    const folderHover = ':root[data-theme="light"] .working-directory-picker-location > button:hover:not(:disabled) { color: var(--accent); background: var(--surface-3); }'
    const switchBase = ':root[data-theme="light"] .settings-switch { background: #d5c4a1; }'
    const switchChecked = ':root[data-theme="light"] .settings-switch[data-state="checked"] { background: var(--accent); }'

    for (const [base, state] of [[chipBase, chipHover], [folderBase, folderHover], [switchBase, switchChecked]]) {
      expect(styles).toContain(base)
      expect(styles).toContain(state)
      expect(styles.indexOf(state)).toBeGreaterThan(styles.indexOf(base))
    }
  })
})

function rgb(hex: string): number[] {
  const value = hex.length === 4 ? hex.slice(1).split('').map(channel => channel + channel).join('') : hex.slice(1)
  return [0, 2, 4].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16))
}

function contrast(foreground: string, background: string): number {
  return contrastChannels(rgb(foreground), rgb(background))
}

function contrastChannels(foreground: number[], background: number[]): number {
  const luminance = (channels: number[]): number => channels.reduce((sum, value, index) => {
    const channel = value / 255
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    return sum + linear * [0.2126, 0.7152, 0.0722][index]
  }, 0)
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b)
  return (values[1] + 0.05) / (values[0] + 0.05)
}
