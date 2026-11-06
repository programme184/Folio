import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles.css'),
  'utf8'
)

describe('terminal appearance styles', () => {
  it('uses inset, rounded, translucent terminal chrome', () => {
    expect(styles).toMatch(
      /\.terminal-dock-shell > \.terminal-workspace \{[^}]*max-height: calc\(var\(--terminal-dock-height\) - 12px\);[^}]*right: 12px;[^}]*left: 12px;[^}]*\}/s
    )
    expect(styles).toMatch(
      /\.terminal-workspace \{[^}]*background: color-mix\([^;]*transparent\);[^}]*border-radius: 14px;[^}]*backdrop-filter: blur\(16px\)[^}]*\}/s
    )
    expect(styles).toMatch(
      /\.terminal-window-tab \{[^}]*height: 30px;[^}]*border-radius: 8px;[^}]*\}/s
    )
    expect(styles).toMatch(
      /\.terminal-window-tabs > \.terminal-ports-tab \{[^}]*height: 30px;[^}]*border-radius: 8px;[^}]*\}/s
    )
  })

  it('overrides xterm viewport backgrounds in both app themes', () => {
    expect(styles).toMatch(
      /\.terminal-host \.xterm-viewport \{[^}]*background: #111212;[^}]*\}/s
    )
    expect(styles).toMatch(
      /:root\[data-theme="light"\] \.terminal-host \.xterm-viewport \{ background: var\(--surface\); \}/
    )
  })

  it('keeps xterm DOM glyph measurement text off-screen without disabling measurement', () => {
    expect(styles).toMatch(
      /\.terminal-host \.xterm-width-cache-measure-container \{[^}]*position: absolute !important;[^}]*top: -50000px !important;[^}]*visibility: hidden !important;[^}]*\}/s
    )
    expect(styles).toMatch(
      /\.terminal-host \.xterm-char-measure-element \{[^}]*position: absolute !important;[^}]*left: -9999em !important;[^}]*visibility: hidden !important;[^}]*\}/s
    )
    expect(styles).not.toMatch(
      /\.terminal-host \.xterm-(?:width-cache-measure-container|char-measure-element) \{[^}]*display: none/s
    )
  })
})
