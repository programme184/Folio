import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { create } from 'zustand'

const { outputText } = ts.transpileModule(fs.readFileSync('src/store/useAppearanceStore.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
function fixture(storage = {}) {
  const calls = [], writes = [], exports = {}
  vm.runInNewContext(outputText, { exports, require(name) {
    if (name === 'zustand') return { create }
    if (name === 'react-native') return { Appearance: { setColorScheme: value => calls.push(value) } }
    assert.equal(name, '@react-native-async-storage/async-storage')
    return { __esModule: true, default: { getItem: async () => null, setItem: async (key, value) => writes.push([key, value]), ...storage } }
  } })
  return { store: exports.useAppearanceStore, calls, writes }
}

test('saved light/dark loads; missing or unknown values use native system appearance', async () => {
  for (const saved of [null, 'light', 'dark', 'obsolete']) {
    const { store, calls } = fixture({ getItem: async () => saved })
    await store.getState().hydrate()
    const expected = saved === 'light' || saved === 'dark' ? saved : 'system'
    assert.equal(store.getState().preference, expected)
    assert.equal(store.getState().hydrated, true)
    assert.deepEqual(calls, [expected === 'system' ? 'unspecified' : expected])
    await store.getState().hydrate()
    assert.equal(calls.length, 1)
  }
})

test('theme changes apply immediately and persist independently of server profiles', async () => {
  const { store, calls, writes } = fixture()
  const dark = store.getState().setPreference('dark')
  assert.equal(store.getState().preference, 'dark')
  assert.deepEqual(calls, ['dark'])
  await Promise.all([dark, store.getState().setPreference('light'), store.getState().setPreference('system')])
  assert.deepEqual(writes.map(([, value]) => value), ['dark', 'light', 'system'])
  assert.ok(writes.every(([key]) => key === 'agentsdock.react.appearance'))
  assert.equal(store.getState().preference, 'system')
  assert.equal(calls.at(-1), 'unspecified')
})

test('a delayed startup read never overwrites a newer user choice', async () => {
  let finish
  const { store, calls } = fixture({ getItem: () => new Promise(resolve => { finish = resolve }) })
  const loading = store.getState().hydrate()
  await store.getState().setPreference('dark')
  finish('light')
  await loading
  assert.equal(store.getState().preference, 'dark')
  assert.deepEqual(calls, ['dark'])
})

test('storage failure is reported without blocking theme changes and the next selection retries', async () => {
  let fail = true
  const { store } = fixture({
    getItem: async () => { throw new Error('unavailable') },
    setItem: async () => { if (fail) throw new Error('unavailable') },
  })
  await store.getState().hydrate()
  assert.match(store.getState().error, /load/)
  await store.getState().setPreference('dark')
  assert.equal(store.getState().preference, 'dark')
  assert.match(store.getState().error, /save/)
  fail = false
  await store.getState().setPreference('dark')
  assert.equal(store.getState().error, null)
})
