import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

// Deliberately separate from desktop analytics: no install ID, SDK, pageview,
// shared URL, token, user agent, or caller-supplied event properties.
export const SHARED_CHAT_EVENTS = [
  'shared_chat_snapshot_activated',
  'shared_chat_interactive_activated',
  'shared_chat_message_sent'
] as const
type SharedChatEvent = typeof SHARED_CHAT_EVENTS[number]
const storageKey = 'agentsdock:shared-analytics-seen:v1'
const memory = new Set<string>()

export function trackSharedChatEvent(event: SharedChatEvent, scope: string, receipt = ''): void {
  try {
    if (!SHARED_CHAT_EVENTS.includes(event)
      || !/^\/(?:interactive-chat\/interactive_[a-f0-9]{32}|shared-chat\/share_[a-f0-9]{32}|share\/[A-Za-z0-9_-]{43})$/.test(scope)
      || (event === 'shared_chat_message_sent' && !/^[A-Za-z0-9_-]{16,128}$/.test(receipt))) return
    if (navigator.doNotTrack === '1' || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl
      || localStorage.getItem('agentsdock:analytics-consent:v1') === 'denied') return
    // These one-way markers stay in this tab only. Never send a share/request
    // ID (or its hash). Reopening in another tab is another activation, not a
    // unique-person count. If storage is unavailable, skip rather than recount.
    const marker = bytesToHex(sha256(utf8ToBytes(JSON.stringify([event, scope, receipt]))))
    const parsed: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]')
    const seen = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item)) : []
    if (memory.has(marker) || seen.includes(marker)) return
    // Bound storage without evicting old receipts and recounting replayed sends.
    if (seen.length >= 4096) return
    sessionStorage.setItem(storageKey, JSON.stringify([...seen, marker]))
    memory.add(marker)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      void fetch('https://api.mixpanel.com/track?ip=0', {
        method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify([{ event, properties: {
          token: '66b4fef625e5750d5527870f0ca96d5e', distinct_id: '',
          platform: 'shared_web', time: Math.floor(Date.now() / 1000)
        } }])
      }).catch(() => undefined).finally(() => clearTimeout(timeout))
    } catch { clearTimeout(timeout) }
  } catch { /* Analytics is best effort and must never block access or sending. */ }
}
