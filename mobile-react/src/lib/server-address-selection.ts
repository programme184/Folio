import { normalizeConnectionURLs } from './server-connection-link'

/** Race only explicitly shared addresses, with bounded probes and cancellation. */
export function selectServerAddress<T extends { ok: boolean; server_identity?: string | null }>(
  addresses: string[],
  identity: string,
  probe: (url: string, signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal; timeoutMs?: number; staggerMs?: number } = {},
): Promise<{ serverURL: string; health: T }> {
  const urls = normalizeConnectionURLs(addresses)
  if (!identity.trim()) return Promise.reject(new Error('A server identity is required for automatic connection.'))
  return new Promise((resolve, reject) => {
    const controllers = urls.map(() => new AbortController())
    const timers: Array<ReturnType<typeof setTimeout>> = []
    let settled = false, failures = 0, mismatch = false
    const finish = (error: Error | null, value?: { serverURL: string; health: T }) => {
      if (settled) return
      settled = true
      timers.forEach(clearTimeout)
      controllers.forEach(controller => controller.abort())
      options.signal?.removeEventListener('abort', cancel)
      if (error) reject(error)
      else resolve(value!)
    }
    const cancel = () => finish(new Error('Connection check canceled.'))
    if (options.signal?.aborted) { cancel(); return }
    options.signal?.addEventListener('abort', cancel, { once: true })
    urls.forEach((serverURL, index) => {
      const start = () => {
        if (settled) return
        let ended = false
        const fail = () => {
          if (settled || ended) return
          ended = true
          controllers[index].abort()
          failures++
          if (failures === urls.length) finish(new Error(mismatch
            ? 'None of the addresses matched this server. Generate a fresh QR from the intended server.'
            : 'Could not connect using any server address. Check Wi-Fi or Tailscale, server availability, and the access token.'))
        }
        const timer = setTimeout(fail, options.timeoutMs ?? 5000)
        timers.push(timer)
        void Promise.resolve().then(() => probe(serverURL, controllers[index].signal)).then(health => {
          if (settled || ended) return
          if (health.ok !== true || health.server_identity !== identity) {
            mismatch ||= health.ok === true && health.server_identity !== identity
            fail()
          } else finish(null, { serverURL, health })
        }, fail).finally(() => clearTimeout(timer))
      }
      if (index === 0) start()
      else timers.push(setTimeout(start, index * (options.staggerMs ?? 200)))
    })
  })
}
