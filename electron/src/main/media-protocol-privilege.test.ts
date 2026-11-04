import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('private media protocol privileges', () => {
  it('supports secure streaming media without exposing the renderer Fetch API or CORS', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const registration = source.slice(
      source.indexOf('protocol.registerSchemesAsPrivileged(['),
      source.indexOf('])', source.indexOf('protocol.registerSchemesAsPrivileged([')) + 2
    )
    const mediaRegistration = registration.split('\n').find(line => line.includes("scheme: 'agentsdock-media'")) ?? ''

    expect(mediaRegistration).toContain("scheme: 'agentsdock-media'")
    expect(mediaRegistration).toContain('standard: true')
    expect(mediaRegistration).toContain('secure: true')
    expect(mediaRegistration).toContain('stream: true')
    expect(mediaRegistration).not.toContain('supportFetchAPI')
    expect(mediaRegistration).not.toContain('corsEnabled')
    expect(mediaRegistration).not.toContain('bypassCSP')
  })
})
