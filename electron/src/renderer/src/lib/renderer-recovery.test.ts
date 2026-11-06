import { describe, expect, it, vi } from 'vitest'
import { isChunkLoadError, reloadForStaleBundle } from './renderer-recovery'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) }
}

describe('stale renderer bundle recovery', () => {
  it('recognizes lazy chunk load failures only', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: file:///app/CodeMirrorEditor-abc.js'))).toBe(true)
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })

  it('reloads once, then leaves repeated failures to the caller', () => {
    const storage = memoryStorage()
    const reload = vi.fn()
    expect(reloadForStaleBundle(storage, reload, 1_000)).toBe(true)
    expect(reloadForStaleBundle(storage, reload, 5_000)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(reloadForStaleBundle(storage, reload, 40_000)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('does not reload when the loop guard cannot be stored', () => {
    const reload = vi.fn()
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(reloadForStaleBundle(broken, reload)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
