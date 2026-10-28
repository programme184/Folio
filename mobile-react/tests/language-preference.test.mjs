import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { create } from 'zustand'

const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
const compile = filename => ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: options }).outputText
const localeExports = {}
vm.runInNewContext(compile('src/i18n/locale.ts'), { exports: localeExports })
const storeSource = compile('src/store/useLanguageStore.ts')

function fixture(storage = {}, { nativeLocaleUnavailable = false } = {}) {
  const exports = {}, writes = []
  let deviceLanguage = 'en-US'
  vm.runInNewContext(storeSource, { exports, require(name) {
    if (name === 'zustand') return { create }
    if (name === '../i18n/locale') return localeExports
    if (name === 'expo-localization') {
      if (nativeLocaleUnavailable) throw new Error('Native localization module is not in this older Dev build')
      return { getLocales: () => [{ languageTag: deviceLanguage }] }
    }
    assert.equal(name, '@react-native-async-storage/async-storage')
    return { __esModule: true, default: { getItem: async () => null, setItem: async (key, value) => writes.push([key, value]), ...storage } }
  } })
  return { store: exports.useLanguageStore, writes, setDeviceLanguage: value => { deviceLanguage = value } }
}

test('older Dev binaries can start before the new native module is installed', async () => {
  const { store } = fixture({}, { nativeLocaleUnavailable: true })
  await store.getState().hydrate()
  assert.equal(store.getState().locale, 'en')
})

test('a saved language loads independently of the device language', async () => {
  const { store, setDeviceLanguage } = fixture({ getItem: async () => 'zh-CN' })
  setDeviceLanguage('en-US')
  await store.getState().hydrate()
  assert.equal(store.getState().preference, 'zh-CN')
  assert.equal(store.getState().locale, 'zh-CN')
  setDeviceLanguage('zh-TW')
  store.getState().refreshSystemLocale()
  assert.equal(store.getState().locale, 'zh-CN')
})

test('System follows device language and manual English overrides it', async () => {
  const { store, setDeviceLanguage, writes } = fixture()
  await store.getState().hydrate()
  setDeviceLanguage('zh-Hans-CN')
  store.getState().refreshSystemLocale()
  assert.equal(store.getState().locale, 'zh-CN')
  await store.getState().setPreference('en')
  assert.equal(store.getState().locale, 'en')
  await store.getState().setPreference('system')
  assert.equal(store.getState().locale, 'zh-CN')
  assert.deepEqual(writes.map(([, value]) => value), ['en', 'system'])
  assert.ok(writes.every(([key]) => key === 'agentsdock.react.language'))
})

test('a delayed saved preference cannot replace a newer tap', async () => {
  let finish
  const { store } = fixture({ getItem: () => new Promise(resolve => { finish = resolve }) })
  const loading = store.getState().hydrate()
  await store.getState().setPreference('zh-CN')
  finish('en')
  await loading
  assert.equal(store.getState().preference, 'zh-CN')
  assert.equal(store.getState().locale, 'zh-CN')
})

test('storage errors keep the current language usable and permit retry', async () => {
  let fail = true
  const { store } = fixture({
    getItem: async () => { throw new Error('unavailable') },
    setItem: async () => { if (fail) throw new Error('unavailable') },
  })
  await store.getState().hydrate()
  assert.match(store.getState().error, /load/)
  await store.getState().setPreference('zh-CN')
  assert.equal(store.getState().locale, 'zh-CN')
  assert.match(store.getState().error, /save/)
  fail = false
  await store.getState().setPreference('zh-CN')
  assert.equal(store.getState().error, null)
})
