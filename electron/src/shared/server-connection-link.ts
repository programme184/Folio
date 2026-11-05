/** Versioned pairing payload. Mobile clients must confirm and authenticate before saving it. */
export interface ServerConnectionDetails {
  serverUrl: string
  serverUrls?: string[]
  accessToken: string
  name: string
  serverIdentity: string | null
}

export interface ServerConnectionQr {
  dataUrl: string
  serverUrl: string
  localOnly: boolean
  revision: number
}

function checkedDetails(value: ServerConnectionDetails): ServerConnectionDetails {
  const urls = normalizeConnectionURLs(value.serverUrls ?? [value.serverUrl])
  if (!value.accessToken || [value.accessToken, value.name, value.serverIdentity ?? ''].some(field => /[\x00-\x1f\x7f]/.test(field))) throw new Error('Invalid connection details.')
  if (value.serverUrls && !value.serverIdentity?.trim()) throw new Error('Multi-address QR requires a server identity.')
  return { ...value, serverUrl: urls[0], ...(value.serverUrls ? { serverUrls: urls } : {}) }
}

export function normalizeConnectionURLs(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 6) throw new Error('Invalid server addresses.')
  return [...new Set(value.map(item => {
    if (typeof item !== 'string' || /[\x00-\x20\x7f]/.test(item)) throw new Error('Invalid server address.')
    let url: URL
    try { url = new URL(item) } catch { throw new Error('Invalid server address.') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid server address.')
    return url.toString().replace(/\/$/, '')
  }))]
}

/** Prefer a directly reachable private LAN before public/DNS and Tailscale CGNAT routes. */
export function prioritizeConnectionURLs(value: unknown): string[] {
  return sortConnectionURLs(normalizeConnectionURLs(value))
}

export function mergeConnectionURLs(...groups: unknown[]): string[] {
  const combined = [...new Set(groups.flatMap(group => normalizeConnectionURLs(group)))]
  return sortConnectionURLs(combined).slice(0, 6)
}

function sortConnectionURLs(urls: string[]): string[] {
  return urls
    .map((url, index) => ({ url, index, preference: connectionURLPreference(url) }))
    .sort((left, right) => left.preference - right.preference || left.index - right.index)
    .map(candidate => candidate.url)
}

function connectionURLPreference(value: string): number {
  const hostname = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname.endsWith('.local')) return 0
  if (hostname === 'fd7a:115c:a1e0::' || hostname.startsWith('fd7a:115c:a1e0:')) return 2
  if (hostname.includes(':')) {
    if (hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe8') || hostname.startsWith('fe9') || hostname.startsWith('fea') || hostname.startsWith('feb')) return 0
    return 1
  }
  const octets = hostname.split('.').map(part => Number(part))
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return 1
  const [first, second] = octets
  if (first === 100 && second >= 64 && second <= 127) return 2
  if (first === 10 || first === 192 && second === 168 || first === 172 && second >= 16 && second <= 31 || first === 169 && second === 254 || first === 127) return 0
  return 1
}

export function serverConnectionLink(value: ServerConnectionDetails): string {
  const details = checkedDetails(value)
  const params = new URLSearchParams(details.serverUrls
    ? { v: '2', urls: JSON.stringify(details.serverUrls), token: details.accessToken, name: details.name }
    : { v: '1', url: details.serverUrl, token: details.accessToken, name: details.name })
  if (details.serverIdentity) params.set('identity', details.serverIdentity)
  const result = `agentsdock://connect#${params}`
  if (new TextEncoder().encode(result).length > 1800) throw new Error('Connection details are too long for a QR code.')
  return result
}

export function parseServerConnectionLink(value: string): ServerConnectionDetails {
  if (new TextEncoder().encode(value).length > 1800) throw new Error('Connection link is too long.')
  const link = new URL(value)
  if (link.protocol !== 'agentsdock:' || link.hostname !== 'connect' || link.pathname || link.search || link.username || link.password || link.port) {
    throw new Error('Invalid server connection link.')
  }
  const params = new URLSearchParams(link.hash.slice(1))
  const version = params.get('v')
  if (version !== '1' && version !== '2') throw new Error('Unsupported connection link version.')
  for (const key of params.keys()) {
    if (!['v', version === '2' ? 'urls' : 'url', 'token', 'name', 'identity'].includes(key) || params.getAll(key).length !== 1) throw new Error('Invalid connection field.')
  }
  let urls: string[] | undefined
  if (version === '2') {
    try { urls = normalizeConnectionURLs(JSON.parse(params.get('urls') ?? '')) }
    catch { throw new Error('Invalid server addresses.') }
  }
  return checkedDetails({ serverUrl: urls?.[0] ?? params.get('url') ?? '', ...(urls ? { serverUrls: urls } : {}), accessToken: params.get('token') ?? '',
    name: params.get('name') ?? '', serverIdentity: params.get('identity') || null })
}

export function localOnlyServerUrl(value: string): boolean {
  const host = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host.endsWith('.localhost') || host.startsWith('127.')
    || host === '0.0.0.0' || host === '::1' || host === '::' || host.startsWith('::ffff:7f')
}
