const STALE_BUNDLE_RELOAD_KEY = 'agentsdock.stale-bundle-reload'
const STALE_BUNDLE_RELOAD_WINDOW_MS = 30_000

const CHUNK_LOAD_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError/i

/** A lazy chunk that vanished or changed after the window loaded its entry bundle. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { name, message } = error as { name?: unknown; message?: unknown }
  return CHUNK_LOAD_ERROR.test(`${typeof name === 'string' ? name : ''} ${typeof message === 'string' ? message : ''}`)
}

/**
 * Reload once when the loaded bundle no longer matches the files on disk, for
 * example after the renderer was rebuilt while this window stayed open. A
 * second failure inside the window is a real fault, so it is left to the
 * caller instead of reloading in a loop.
 */
export function reloadForStaleBundle(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeSessionStorage(),
  reload: () => void = () => window.location.reload(),
  now: number = Date.now()
): boolean {
  try {
    const last = Number(storage?.getItem(STALE_BUNDLE_RELOAD_KEY))
    if (Number.isFinite(last) && last > 0 && now - last < STALE_BUNDLE_RELOAD_WINDOW_MS) return false
    storage?.setItem(STALE_BUNDLE_RELOAD_KEY, String(now))
  } catch {
    // Without storage the loop guard is unavailable; do not risk reloading forever.
    return false
  }
  reload()
  return true
}

export function installStaleBundleRecovery(target: Pick<Window, 'addEventListener'> = window): void {
  // Vite emits this when a dynamic import or its CSS preload fails.
  target.addEventListener('vite:preloadError', event => {
    if (reloadForStaleBundle()) event.preventDefault()
  })
}

function safeSessionStorage(): Storage | null {
  try { return window.sessionStorage } catch { return null }
}
