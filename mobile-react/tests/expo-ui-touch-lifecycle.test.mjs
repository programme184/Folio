import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const uiPackagePath = require.resolve('@expo/ui/package.json')
const uiPackage = JSON.parse(readFileSync(uiPackagePath, 'utf8'))

// Expo #47713: RNHostView handlers must not follow recycled views into Settings.
test('Expo UI includes the iOS hosted-view touch cleanup fix', () => {
  const [major, minor, patch] = uiPackage.version.split('.').map(Number)
  assert.ok(major > 57 || (major === 57 && (minor > 0 || patch >= 5)),
    `@expo/ui ${uiPackage.version} leaks native touch handlers; 57.0.5+ is required`)
  const host = readFileSync(path.join(path.dirname(uiPackagePath), 'ios/RNHostView.swift'), 'utf8')
  assert.equal((host.match(/\.onDisappear\s*\{\s*touchHandler\.detach\(\)/g) ?? []).length, 2,
    'Both content-sized and fill hosts must release their touch handler')
  assert.match(host, /deinit\s*\{\s*detach\(\)/, 'Teardown must also release the handler')
  const helper = readFileSync(path.join(path.dirname(uiPackagePath), 'ios/ExpoUITouchHandlerHelper.mm'), 'utf8')
  assert.match(helper, /detachFromView:view/, 'Cleanup must detach from the native view, not just drop the reference')
})

test('Expo UI builds against this app\'s native Expo runtime', () => {
  const app = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.ok(app.expo.autolinking.ios.buildFromSource.includes('@expo/ui'))
})
