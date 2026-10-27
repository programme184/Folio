import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { createPaperMarkStore, type PaperMarkStore } from './paper-marks'

export function createDesktopPaperMarkStore(): PaperMarkStore {
  const file = () => join(app.getPath('userData'), 'paper-marks.json')
  return createPaperMarkStore({
    read() {
      try {
        return readFileSync(file(), 'utf8')
      } catch {
        return null
      }
    },
    write(contents) {
      mkdirSync(dirname(file()), { recursive: true })
      writeFileSync(file(), contents)
    }
  })
}
