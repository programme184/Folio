import { randomUUID } from 'node:crypto'

const MAX_CANVAS_DOCUMENT_BYTES = 2 * 1024 * 1024
const MAX_CANVAS_DOCUMENTS = 24
const CANVAS_DOCUMENT_TTL_MS = 30 * 60 * 1000

interface CanvasDocument {
  html: string
  scriptId: string
  createdAt: number
}

export class CanvasPreviewStore {
  private readonly documents = new Map<string, CanvasDocument>()
  private readonly scripts = new Map<string, string>()

  register(html: string): string {
  const source = String(html ?? '')
  if (!source || Buffer.byteLength(source, 'utf8') > MAX_CANVAS_DOCUMENT_BYTES) {
    throw new Error('Canvas preview document is empty or too large.')
  }
  this.prune()
  while (this.documents.size >= MAX_CANVAS_DOCUMENTS) {
    const oldestId = this.documents.keys().next().value as string
    const oldest = this.documents.get(oldestId)
    this.documents.delete(oldestId)
    if (oldest) this.scripts.delete(oldest.scriptId)
  }
  const scriptMatch = source.match(/<script>([\s\S]*)<\/script>/i)
  if (!scriptMatch) throw new Error('Canvas preview document has no runtime script.')
  const id = randomUUID()
  const scriptId = randomUUID()
  const documentHtml = source.replace(scriptMatch[0], `<script src="agentsdock-canvas://preview/${id}/${scriptId}.js"></script>`)
  this.documents.set(id, { html: documentHtml, scriptId, createdAt: Date.now() })
  this.scripts.set(scriptId, scriptMatch[1] ?? '')
  return `agentsdock-canvas://preview/${id}`
  }

  release(url: string): void {
  const id = canvasPreviewId(url)
  const document = id ? this.documents.get(id) : undefined
  if (id) this.documents.delete(id)
  if (document) this.scripts.delete(document.scriptId)
  }

  response(url: string): Response {
  const parsed = canvasPreviewResource(url)
  if (parsed?.kind === 'script') {
    const script = this.scripts.get(parsed.id)
    if (script === undefined) return new Response('Canvas script not found.', { status: 404, headers: canvasHeaders('text/plain; charset=utf-8') })
    return new Response(script, { status: 200, headers: canvasHeaders('text/javascript; charset=utf-8') })
  }
  const document = parsed?.kind === 'document' ? this.documents.get(parsed.id) : undefined
  if (!document) return new Response('Canvas preview not found.', { status: 404, headers: canvasHeaders('text/plain; charset=utf-8') })
  return new Response(document.html, { status: 200, headers: canvasHeaders('text/html; charset=utf-8') })
  }

  private prune(now = Date.now()): void {
    for (const [id, document] of this.documents) {
      if (now - document.createdAt > CANVAS_DOCUMENT_TTL_MS) {
        this.documents.delete(id)
        this.scripts.delete(document.scriptId)
      }
    }
  }
}
const defaultCanvasPreviewStore = new CanvasPreviewStore()
export const registerCanvasPreview = (html: string): string => defaultCanvasPreviewStore.register(html)
export const releaseCanvasPreview = (url: string): void => defaultCanvasPreviewStore.release(url)
export const canvasPreviewResponse = (url: string): Response => defaultCanvasPreviewStore.response(url)
function canvasPreviewId(value: string): string | null {
  const resource = canvasPreviewResource(value)
  return resource?.kind === 'document' ? resource.id : null
}

function canvasPreviewResource(value: string): { kind: 'document' | 'script'; id: string } | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'agentsdock-canvas:') return null
    if (url.hostname !== 'preview') return null
    const parts = url.pathname.replace(/^\//, '').split('/')
    if (parts.length === 1 && /^[0-9a-f-]{36}$/i.test(parts[0] ?? '')) return { kind: 'document', id: parts[0] as string }
    const scriptId = parts.length === 2 ? (parts[1] ?? '').replace(/\.js$/i, '') : ''
    if (parts.length === 2 && /^[0-9a-f-]{36}$/i.test(parts[0] ?? '') && /^[0-9a-f-]{36}$/i.test(scriptId) && parts[1]?.endsWith('.js')) {
      return { kind: 'script', id: scriptId }
    }
    return null
  } catch {
    return null
  }
}

function canvasHeaders(contentType: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; script-src agentsdock-canvas:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none';",
    'Content-Type': contentType,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  }
}
