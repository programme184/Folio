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

  it('keeps the embedded chat in the single available conversation row', () => {
    // The global stylesheet's later `.conversation-pane` rule defines two rows.
    // This compound selector must remain more specific or the composer is laid
    // out below the short intrinsic first row and disappears from the webview.
    expect(styles).toMatch(/\.conversation-pane\.embedded-pane-conversation \{[^}]*grid-template-rows: minmax\(0, 1fr\);/)
    expect(styles).not.toMatch(/^\.embedded-pane-conversation \{/m)
    expect(styles).toMatch(/\.embedded-pane-conversation > \.chat-pane \{[^}]*height: 100%;/)
  })
})
