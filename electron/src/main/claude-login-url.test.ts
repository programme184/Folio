import { describe, expect, it } from 'vitest'
import { safeClaudeLoginUrl } from './server-client'

describe('safeClaudeLoginUrl', () => {
  it('accepts only Anthropic HTTPS authorization pages', () => {
    expect(safeClaudeLoginUrl('https://claude.com/cai/oauth/authorize?code=true&state=a')).toContain('https://claude.com/cai/oauth/authorize')
    expect(safeClaudeLoginUrl('https://platform.claude.com/oauth/authorize')).not.toBeNull()
    for (const bad of ['http://claude.com/cai/oauth/authorize', 'https://evil.example/oauth/authorize', 'https://claude.com.evil.example/authorize',
      'https://user:pw@claude.com/authorize', 'https://claude.com/other', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url']) {
      expect(safeClaudeLoginUrl(bad), bad).toBeNull()
    }
  })
})
