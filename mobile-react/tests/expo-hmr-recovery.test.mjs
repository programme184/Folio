import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const entry = path.join(path.dirname(require.resolve('expo/package.json')), 'src/async-require/hmr.ts')

async function fixture(platform) {
  const state = { reloads: 0, messages: [], client: null }
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node',
    define: { 'process.env.EXPO_OS': JSON.stringify(platform) },
    plugins: [{
      name: 'hmr-transport-fixture',
      setup(context) {
        context.onResolve({ filter: /^(\.\/hmrUtils|pretty-format|@expo\/metro\/metro-runtime\/modules\/HMRClient)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
        context.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
          loader: 'js', contents: args.path === './hmrUtils' ? `
            export const reload = () => globalThis.fixture.reloads++;
            export const getFullBundlerUrl = () => 'http://localhost:8081/index.bundle';
            export const getConnectionError = () => 'Disconnected';
            export const handleCompileError = () => {};
            export const hideLoading = () => {};
            export const resetErrorOverlay = () => {};
            export const showLoading = () => {};
          ` : args.path === 'pretty-format' ? `
            export default value => String(value);
            export const plugins = {};
          ` : `
            export default class Client {
              handlers = new Map(); enabled = false;
              constructor() { globalThis.fixture.client = this; }
              on(name, handler) { this.handlers.set(name, handler); }
              emit(name, value) { this.handlers.get(name)?.(value); }
              send(value) { globalThis.fixture.messages.push(JSON.parse(value)); }
              enable() { this.enabled = true; }
              disable() { this.enabled = false; }
              isEnabled() { return this.enabled; }
              hasPendingUpdates() { return false; }
              close() { this.emit('close', {code: 1000}); }
            }
          `,
        }))
      },
    }],
  })
  const context = vm.createContext({
    exports: {}, module: { exports: {} }, fixture: state, console,
    setTimeout: () => 0,
    window: platform === 'web' ? { location: { host: 'localhost:8081', protocol: 'http:' } } : {},
  })
  vm.runInContext(result.outputFiles[0].text, context)
  const hmr = context.module.exports.default
  if (platform === 'web') hmr.setup({ isEnabled: true })
  else hmr.setup(platform, 'index', 'localhost', 8081, true)
  return { hmr, state }
}

for (const platform of ['ios', 'android', 'web']) {
  test(`${platform}: a healthy lazy bundle registers without reloading`, async () => {
    const { hmr, state } = await fixture(platform)
    hmr.registerBundle('http://localhost:8081/viewer.bundle')
    assert.equal(state.reloads, 0)
    assert.deepEqual([...state.messages.at(-1).entryPoints], ['http://localhost:8081/viewer.bundle'])
  })

  for (const failure of ['socket-close', 'GraphNotFoundError', 'RevisionNotFoundError']) {
    test(`${platform}: ${failure} uses the platform reload when opening a lazy viewer`, async () => {
      const { hmr, state } = await fixture(platform)
      if (failure === 'socket-close') state.client.close()
      else hmr._onMetroError({ type: failure })
      assert.doesNotThrow(() => hmr.registerBundle('http://localhost:8081/viewer.bundle'))
      assert.equal(state.reloads, 1)
    })
  }
}
