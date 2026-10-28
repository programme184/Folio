import { describe, expect, it } from 'vitest'
import { localOnlyServerUrl, parseServerConnectionLink, serverConnectionLink } from './server-connection-link'

const details = { name: '工作电脑 & QA', serverUrl: 'https://server.example:7851',
  accessToken: 'synthetic+token&?#=', serverIdentity: 'fixture-server' }

describe('server connection QR contract', () => {
  it('round-trips credentials and Unicode names in a versioned fragment without query parameters', () => {
    const link = serverConnectionLink(details)
    expect(new URL(link).search).toBe('')
    expect(parseServerConnectionLink(link)).toEqual(details)
  })
  it.each(['javascript:alert(1)', 'https://user:password@server.example', 'http://host/?token=secret', 'http://host/#secret'])('rejects unsafe server addresses: %s', serverUrl => {
    expect(() => serverConnectionLink({ ...details, serverUrl })).toThrow()
  })
  it.each(['v=2&url=http://host&token=x', 'v=1&url=http://host&token=x&token=y', 'v=1&url=http://host&token=x&unknown=y', 'v=1&url=http://host&token='])('rejects unsupported or ambiguous payloads: %s', fragment => {
    expect(() => parseServerConnectionLink(`agentsdock://connect#${fragment}`)).toThrow()
  })
  it('limits QR size and does not accept other deep-link routes', () => {
    expect(() => serverConnectionLink({ ...details, accessToken: 'x'.repeat(2000) })).toThrow('too long')
    expect(() => parseServerConnectionLink('agentsdock://secure-peer/join#v=1')).toThrow()
  })
  it.each(['http://localhost:7851', 'http://127.1:7851', 'http://[::1]:7851', 'http://0.0.0.0:7851', 'http://[::]:7851'])('identifies unusable phone addresses: %s', value => {
    expect(localOnlyServerUrl(value)).toBe(true)
  })
  it.each(['http://192.168.1.20:7851', 'http://100.64.0.20:7851', 'https://server.example'])('does not mistake a network address for localhost: %s', value => {
    expect(localOnlyServerUrl(value)).toBe(false)
  })
})
