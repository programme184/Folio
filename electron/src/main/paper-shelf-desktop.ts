import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, dialog } from 'electron'
import { createPaperShelfWith, type PaperShelf } from './paper-shelf'

export function createDesktopPaperShelf(): PaperShelf {
  const file = () => join(app.getPath('userData'), 'paper-shelf.json')
  return createPaperShelfWith({
    readRoot() {
      try {
        const parsed = JSON.parse(readFileSync(file(), 'utf8')) as { root?: unknown }
        return typeof parsed.root === 'string' ? parsed.root : null
      } catch {
        return null
      }
    },
    writeRoot(root) {
      mkdirSync(dirname(file()), { recursive: true })
      writeFileSync(file(), `${JSON.stringify({ root })}\n`)
    },
    async chooseDirectory(defaultPath) {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath })
      if (result.canceled) return null
      return result.filePaths[0] ?? null
    }
  })
}
