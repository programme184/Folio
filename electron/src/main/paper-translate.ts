const BING_PAGE = 'https://cn.bing.com/translator'
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const MAX_CHARS = 6000
const CHUNK_CHARS = 1800

export interface BingSession {
  key: string
  token: string
  ig: string
  iid: string
  cookie: string
  expiresAt: number
}

let session: BingSession | null = null
const translations = new Map<string, string>()

export function resetPaperTranslator(): void {
  session = null
  translations.clear()
}

export function readBingSession(html: string, now = Date.now()): BingSession | null {
  const helper = html.match(/params_AbusePreventionHelper = \[(\d+),"([^"]+)",(\d+)\]/)
  const ig = html.match(/IG:"([A-F0-9]+)"/)
  const iid = html.match(/data-iid="(translator\.[^"]+)"/)
  if (!helper || !ig || !iid) return null
  const ttl = Number(helper[3])
  return {
    key: helper[1],
    token: helper[2],
    ig: ig[1],
    iid: iid[1],
    cookie: '',
    expiresAt: now + (Number.isFinite(ttl) && ttl > 0 ? ttl : 600_000) - 60_000
  }
}

export function readBingTranslation(payload: unknown): string {
  if (!Array.isArray(payload) || payload.length === 0) throw new Error('translate_failed')
  const entry = payload[0] as { translations?: Array<{ text?: unknown }>; statusCode?: unknown }
  if (typeof entry?.statusCode === 'number') throw new Error('translate_failed')
  const text = entry?.translations?.[0]?.text
  if (typeof text !== 'string' || text.trim().length === 0) throw new Error('translate_failed')
  return text.trim()
}

export async function translateToChinese(text: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const source = text.replace(/\s+/g, ' ').trim()
  if (!source) throw new Error('translate_failed')
  const clipped = Array.from(source).slice(0, MAX_CHARS).join('')
  const cached = translations.get(clipped)
  if (cached) return cached
  const parts: string[] = []
  for (const part of chunks(clipped)) parts.push(await translateChunk(part, fetchImpl))
  const translated = parts.join('')
  translations.set(clipped, translated)
  if (translations.size > 200) {
    const oldest = translations.keys().next().value
    if (oldest) translations.delete(oldest)
  }
  return translated
}

async function translateChunk(text: string, fetchImpl: typeof fetch, retry = true): Promise<string> {
  const current = await sessionFor(fetchImpl)
  const url = `https://cn.bing.com/ttranslatev3?isVertical=1&IG=${current.ig}&IID=${encodeURIComponent(current.iid)}.1`
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      referer: BING_PAGE,
      'user-agent': USER_AGENT,
      ...(current.cookie ? { cookie: current.cookie } : {})
    },
    body: new URLSearchParams({
      fromLang: 'en',
      to: 'zh-Hans',
      text,
      token: current.token,
      key: current.key
    })
  })
  if (!response.ok) {
    session = null
    if (retry) return translateChunk(text, fetchImpl, false)
    throw new Error('translate_failed')
  }
  const payload: unknown = await response.json()
  try {
    return readBingTranslation(payload)
  } catch (error) {
    session = null
    if (retry) return translateChunk(text, fetchImpl, false)
    throw error
  }
}

async function sessionFor(fetchImpl: typeof fetch): Promise<BingSession> {
  if (session && session.expiresAt > Date.now()) return session
  const response = await fetchImpl(BING_PAGE, { headers: { 'user-agent': USER_AGENT, 'accept-language': 'zh-CN,zh;q=0.9' } })
  if (!response.ok) throw new Error('translate_failed')
  const next = readBingSession(await response.text())
  if (!next) throw new Error('translate_failed')
  next.cookie = cookieHeader(response)
  session = next
  return next
}

function cookieHeader(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const cookies = headers.getSetCookie?.() ?? []
  return cookies.map(item => item.split(';')[0]).filter(Boolean).join('; ')
}

function chunks(text: string): string[] {
  const chars = Array.from(text)
  if (chars.length <= CHUNK_CHARS) return [text]
  const parts: string[] = []
  let start = 0
  while (start < chars.length) {
    let end = Math.min(chars.length, start + CHUNK_CHARS)
    if (end < chars.length) {
      const window = chars.slice(start, end).join('')
      const breakAt = Math.max(window.lastIndexOf('. '), window.lastIndexOf('。'))
      if (breakAt > CHUNK_CHARS * 0.5) end = start + breakAt + 1
    }
    parts.push(chars.slice(start, end).join('').trim())
    start = end
  }
  return parts.filter(Boolean)
}
