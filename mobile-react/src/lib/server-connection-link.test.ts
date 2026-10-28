import assert from 'node:assert/strict'
import test from 'node:test'
import { parseServerConnectionLink } from './server-connection-link'
import { serverConnectionLink, parseServerConnectionLink as desktopParse } from '../../../electron/src/shared/server-connection-link'
import { createRequire } from 'node:module'
import path from 'node:path'

const fields = { v: '1', url: 'http://192.168.1.2:7852', token: 'fixture+&?#=', name: 'My server', identity: 'fixture-server' }
const qr = (patch = {}) => `agentsdock://connect#${new URLSearchParams({ ...fields, ...patch })}`

test('the CLI QR contract round-trips credentials, name, URL and identity', () => {
  assert.deepEqual(parseServerConnectionLink(qr()), {
    serverUrl: fields.url, accessToken: fields.token, name: fields.name, serverIdentity: fields.identity,
  })
  assert.equal(parseServerConnectionLink(qr({ url: 'https://[fd7a::1]:7852/' })).serverUrl, 'https://[fd7a::1]:7852')
  assert.equal(parseServerConnectionLink(qr({ identity: '' })).serverIdentity, null)
})

test('desktop and CLI v2 payloads retain all addresses and round-trip through both parsers', () => {
  const { connectionLink } = createRequire(import.meta.url)(path.resolve('../server/npm/agentsdock/pair.cjs'))
  const details = { serverUrl: fields.url, serverUrls: [fields.url, 'http://100.64.0.2:7852'], accessToken: fields.token, name: fields.name, serverIdentity: fields.identity }
  for (const encode of [serverConnectionLink, connectionLink]) {
    const link = encode(details)
    assert.deepEqual(parseServerConnectionLink(link), details)
    assert.deepEqual(desktopParse(link), details)
    assert.throws(() => encode({ ...details, serverIdentity: null }))
  }
})

test('v2 rejects missing identity, malformed, ambiguous, oversized and unsafe candidate lists', () => {
  const valid = { v: '2', urls: JSON.stringify([fields.url, 'http://100.64.0.2:7852']), token: fields.token, identity: fields.identity }
  const link = patch => `agentsdock://connect#${new URLSearchParams({ ...valid, ...patch })}`
  for (const value of [link({ identity: '' }), link({ urls: 'not-json' }), link({ urls: '{}' }), link({ urls: '[]' }),
    link({ urls: JSON.stringify(Array(7).fill(fields.url)) }), link({ url: fields.url }), link({ urls: '[null]' }),
    link({ urls: JSON.stringify(['https://user:pw@host']) }), link({ urls: JSON.stringify(['http://host?token=x']) })]) {
    assert.throws(() => parseServerConnectionLink(value))
    assert.throws(() => desktopParse(value))
  }
})

test('rejects unknown versions, duplicate fields, ordinary QR codes and unsafe URLs without echoing tokens', () => {
  for (const link of ['https://example.com', 'not-a-url', qr({ v: '2' }), `${qr()}&token=another`, `${qr()}&extra=field`,
    qr({ url: 'file:///tmp/server' }), qr({ url: 'http://user:pass@server' }), qr({ url: 'http://server?token=secret' }),
    qr({ url: 'http://server#fragment' }), qr({ token: '' }), qr({ token: 'secret\n' }), qr({ name: '\u001b[31m' }),
    qr({ identity: 'private\nidentity' }), qr({ token: 'private'.repeat(400) }), qr().replace('connect#', 'connect/path#'),
    qr().replace('connect#', 'connect?extra=1#')]) {
    assert.throws(() => parseServerConnectionLink(link), error => !String(error).includes(fields.token))
  }
})
