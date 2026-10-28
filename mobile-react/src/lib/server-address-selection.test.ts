import assert from 'node:assert/strict'
import test from 'node:test'
import { selectServerAddress } from './server-address-selection'

const urls = ['http://100.64.0.2:7852', 'http://192.168.1.2:7852']
const ready = { ok: true, server_identity: 'same-server' }
const options = { timeoutMs: 100, staggerMs: 5 }

test('a stalled preferred address does not block the reachable alternative; losers are canceled', async () => {
  let aborted = false
  const result = await selectServerAddress(urls, 'same-server', (url, signal) => {
    if (url === urls[1]) return Promise.resolve(ready)
    signal.addEventListener('abort', () => { aborted = true })
    return new Promise(() => {})
  }, options)
  assert.equal(result.serverURL, urls[1])
  assert.equal(aborted, true)
})

test('a fast preferred address avoids unnecessary alternate probes', async () => {
  const called: string[] = []
  const result = await selectServerAddress(urls, 'same-server', async url => { called.push(url); return ready }, options)
  await new Promise(resolve => setTimeout(resolve, 15))
  assert.deepEqual(called, [urls[0]])
  assert.equal(result.serverURL, urls[0])
})

test('wrong identity, authentication errors and unreachable hosts do not mask a later match', async () => {
  for (const failure of ['identity', 'auth', 'network']) {
    const result = await selectServerAddress(urls, 'same-server', async url => {
      if (url === urls[1]) return ready
      if (failure === 'identity') return { ok: true, server_identity: 'foreign' }
      throw new Error('private-token must not be shown')
    }, options)
    assert.equal(result.serverURL, urls[1])
  }
})

test('all failures produce one safe error; timeouts bound even non-abortable transports', async () => {
  await assert.rejects(selectServerAddress(urls, 'same-server', async () => { throw new Error('secret') }, options), /Could not connect using any server address/)
  await assert.rejects(selectServerAddress(urls, 'same-server', async () => ({ ok: true, server_identity: 'foreign' }), options), /None of the addresses matched/)
  await assert.rejects(selectServerAddress(urls, 'same-server', () => new Promise(() => {}), { ...options, timeoutMs: 15 }), /Could not connect/)
})

test('canceling aborts active work and prevents delayed probes or late successes', async () => {
  const controller = new AbortController()
  let finish: (value: typeof ready) => void = () => {}
  const calls: string[] = []
  const pending = selectServerAddress(urls, 'same-server', (url, signal) => {
    calls.push(url)
    assert.equal(signal.aborted, false)
    return new Promise(resolve => { finish = resolve })
  }, { ...options, signal: controller.signal })
  await Promise.resolve()
  controller.abort()
  await assert.rejects(pending, /canceled/)
  finish(ready)
  await new Promise(resolve => setTimeout(resolve, 15))
  assert.deepEqual(calls, [urls[0]])
})
