import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatWorkspaceGrid.css'), 'utf8')

describe('chat workspace project browser styles', () => {
  it('limits full-width chat-row styles to direct project children', () => {
    expect(styles).toContain('.empty-pane-project > button {')
    expect(styles).not.toMatch(/\.empty-pane-chat-list button\s*\{/)
    expect(styles).toContain('.empty-pane-chat-list { overflow-y: auto; overflow-x: hidden;')
  })
})
