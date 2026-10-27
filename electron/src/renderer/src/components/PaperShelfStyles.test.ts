import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/PaperShelf.css'), 'utf8')

describe('paper reader scroll styles', () => {
  it('reserves the scrollbar and does not blend each page during scroll', () => {
    expect(styles).toMatch(/\.paper-document-scroll,\s*\.paper-passage-view \{[^}]*overflow: auto;[^}]*overflow-anchor: none;[^}]*scrollbar-gutter: stable;/s)
    expect(styles).not.toContain('mix-blend-mode')
    expect(styles).toMatch(/\.paper-toolbar \{[^}]*pointer-events: none;/s)
    expect(styles).toMatch(/\.paper-toolbar-actions,\s*\.paper-translate-menu,\s*\.paper-answer \{[^}]*pointer-events: auto;/s)
  })
})
