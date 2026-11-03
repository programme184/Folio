import { describe, expect, it } from 'vitest'
import { canvasPreviewResponse, registerCanvasPreview, releaseCanvasPreview } from './canvas-preview'

describe('canvas preview protocol', () => {
  it('serves registered documents with an isolated no-network policy and releases them', async () => {
    const url = registerCanvasPreview('<!doctype html><script>document.body.textContent = "Canvas"</script>')
    const response = canvasPreviewResponse(url)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(response.headers.get('content-security-policy')).toContain('script-src agentsdock-canvas:')
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'none'")
    const html = await response.text()
    expect(html).not.toContain('<script>')
    const scriptUrl = html.match(/src="([^"]+)"/)?.[1]
    expect(scriptUrl).toMatch(/^agentsdock-canvas:\/\/preview\/[^/]+\/[^/]+\.js$/)
    expect(await canvasPreviewResponse(scriptUrl!).text()).toContain('Canvas')

    releaseCanvasPreview(url)
    expect(canvasPreviewResponse(url).status).toBe(404)
  })

  it('rejects unregistered and oversized preview documents', () => {
    expect(canvasPreviewResponse('agentsdock-canvas://preview/not-a-token').status).toBe(404)
    expect(() => registerCanvasPreview('x'.repeat(2 * 1024 * 1024 + 1))).toThrow('too large')
  })
})
