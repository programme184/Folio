import { expect, it } from 'vitest'
import { doubaoLabel, isDoubaoEndpoint } from './doubao'

it('names Ark agent-plan endpoints per runtime and ignores everything else', () => {
  expect(doubaoLabel('opencode', 'https://ark.cn-beijing.volces.com/api/plan/v3')).toBe('Doubao (OpenCode)')
  expect(doubaoLabel('claude', 'https://ark.cn-beijing.volces.com/api/plan')).toBe('Doubao (Claude Code)')
  expect(doubaoLabel('opencode', 'https://openrouter.ai/api/v1')).toBeNull()
  expect(doubaoLabel('cursor', 'https://ark.cn-beijing.volces.com/api/plan')).toBeNull()
  expect([isDoubaoEndpoint('not a url'), isDoubaoEndpoint(null)]).toEqual([false, false])
})
