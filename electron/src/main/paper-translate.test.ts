import { describe, expect, it } from 'vitest'
import { readBingSession, readBingTranslation, resetPaperTranslator, translateToChinese } from './paper-translate'

const page = [
  'IG:"ABCDEF0123456789ABCDEF0123456789"',
  'data-iid="translator.5023"',
  'params_AbusePreventionHelper = [1793016457552,"session-token",3600000];'
].join(' ')

describe('paper translation', () => {
  it('reads a Bing translator session and a translation payload', () => {
    expect(readBingSession(page, 1_000)?.token).toBe('session-token')
    expect(readBingSession(page, 1_000)?.ig).toBe('ABCDEF0123456789ABCDEF0123456789')
    expect(readBingSession('no session')).toBeNull()
    expect(readBingTranslation([{ translations: [{ text: ' 我们的关键见解。 ' }] }])).toBe('我们的关键见解。')
    expect(() => readBingTranslation({ statusCode: 205 })).toThrow('translate_failed')
  })

  it('translates through Bing and reuses the result', async () => {
    resetPaperTranslator()
    const calls: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/translator')) return new Response(page)
      return new Response(JSON.stringify([{ translations: [{ text: '补偿力场。' }] }]))
    }) as typeof fetch
    await expect(translateToChinese('compensatory force field', fetchImpl)).resolves.toBe('补偿力场。')
    await expect(translateToChinese('compensatory force field', fetchImpl)).resolves.toBe('补偿力场。')
    expect(calls.filter(url => url.includes('ttranslatev3'))).toHaveLength(1)
    expect(calls.some(url => url.startsWith('https://cn.bing.com/translator'))).toBe(true)
  })
})
