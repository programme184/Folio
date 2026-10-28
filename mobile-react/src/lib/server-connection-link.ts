export interface ServerConnectionDetails {
  serverUrl: string
  serverUrls?: string[]
  accessToken: string
  name: string
  serverIdentity: string | null
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

/** Parse only our versioned credential payload, never arbitrary QR URLs. */
export function parseServerConnectionLink(value: string): ServerConnectionDetails {
  if (new TextEncoder().encode(value).length > 1800) throw new Error('Connection QR is too long.')
  const link = new URL(value)
  if (link.protocol !== 'agentsdock:' || link.hostname !== 'connect' || link.pathname || link.search || link.username || link.password || link.port) {
    throw new Error('Invalid server connection QR.')
  }
  const params = new URLSearchParams(link.hash.slice(1))
  const version = params.get('v')
  if (version !== '1' && version !== '2') throw new Error('Unsupported connection QR version.')
  for (const key of params.keys()) {
    if (!['v', version === '2' ? 'urls' : 'url', 'token', 'name', 'identity'].includes(key) || params.getAll(key).length !== 1) throw new Error('Invalid connection field.')
  }
  let addresses: unknown
  try { addresses = version === '2' ? JSON.parse(params.get('urls') ?? '') : [params.get('url')] }
  catch { throw new Error('Invalid server addresses.') }
  const urls = normalizeConnectionURLs(addresses)
  const accessToken = params.get('token') ?? ''
  const name = params.get('name') ?? ''
  const serverIdentity = params.get('identity') || null
  if (!accessToken || (version === '2' && !serverIdentity?.trim()) || [accessToken, name, serverIdentity ?? ''].some(field => /[\x00-\x1f\x7f]/.test(field))) {
    throw new Error('Invalid connection details.')
  }
  return { serverUrl: urls[0], ...(version === '2' ? { serverUrls: urls } : {}), accessToken, name, serverIdentity }
}
