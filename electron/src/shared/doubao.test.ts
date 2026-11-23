import { expect, it } from 'vitest'
import { doubaoLabel, doubaoModelOptions, isDoubaoEndpoint } from './doubao'

it('names Ark agent-plan endpoints per runtime and ignores everything else', () => {
  expect(doubaoLabel('opencode', 'https://ark.cn-beijing.volces.com/api/plan/v3')).toBe('Doubao (OpenCode)')
  expect(doubaoLabel('claude', 'https://ark.cn-beijing.volces.com/api/plan')).toBe('Doubao (Claude Code)')
  expect(doubaoLabel('opencode', 'https://openrouter.ai/api/v1')).toBeNull()
  expect(doubaoLabel('cursor', 'https://ark.cn-beijing.volces.com/api/plan')).toBeNull()
  expect([isDoubaoEndpoint('not a url'), isDoubaoEndpoint(null)]).toEqual([false, false])
})

it('offers multiple public Ark model IDs while preserving discovered rows', () => {
  const options = doubaoModelOptions('https://ark.cn-beijing.volces.com/api/plan/v3', [
    { value: 'doubao-seed-2-0-mini-260428', label: 'Mini (live)' }
  ])
  expect(options.find(option => option.value === 'doubao-seed-2-0-mini-260428')?.label).toBe('Mini (live)')
  expect(options.map(option => option.value)).toEqual(expect.arrayContaining([
    'doubao-seed-evolving-latest-version',
    'doubao-seed-2-1-pro-260628',
    'doubao-seed-2-1-turbo-260628',
    'doubao-seed-2-0-lite-260428',
    'glm-5-2-260617'
  ]))
})
