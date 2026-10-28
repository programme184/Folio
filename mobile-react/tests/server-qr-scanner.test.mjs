import assert from 'node:assert/strict'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import path from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const fixture = globalThis.__cameraFixture = { permission: { granted: true, canAskAgain: true }, requests: 0, settings: 0, refreshes: 0 }
const mocks = {
  'react-native': `export const ActivityIndicator='Spinner',Pressable='Button',View='View'; export const StyleSheet={create:x=>x,absoluteFill:{},hairlineWidth:1};
    export const AppState={currentState:'active',addEventListener:(_,fn)=>{globalThis.__cameraFixture.change=fn;return {remove:()=>{globalThis.__cameraFixture.change=null}}}};
    export const Linking={openSettings:async()=>{globalThis.__cameraFixture.settings++}};`,
  'expo-modules-core': `export const requireOptionalNativeModule=()=>({});`,
  'lucide-react-native': `export const QrCode='QrCode';`,
  'expo-camera': `export const CameraView='Camera'; const request=async()=>{globalThis.__cameraFixture.requests++}; const get=async()=>{globalThis.__cameraFixture.refreshes++};
    export const useCameraPermissions=()=>[globalThis.__cameraFixture.permission,request,get];`,
  '../theme': `export const radius={md:8},spacing={md:12,lg:16},typography={}; export const usePalette=()=>({text:'#111',muted:'#666',red:'#a00'});`,
  './AppText': `export const Text='Text';`,
}
const outfile = path.resolve('build/tmp', `server-qr-scanner-${process.pid}.mjs`)
await fs.mkdir(path.dirname(outfile), { recursive: true })
await build({ entryPoints: ['src/components/ServerQrScanner.tsx'], outfile, bundle: true, format: 'esm',
  platform: 'node', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], logLevel: 'silent',
  plugins: [{ name: 'native-hosts', setup(context) {
    context.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined)
    context.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }))
  } }],
})
after(async () => { delete globalThis.__cameraFixture; await fs.unlink(outfile) })
const { ServerQrScanner } = await import(pathToFileURL(outfile).href)
const { connectionLink } = createRequire(import.meta.url)('../../server/npm/agentsdock/pair.cjs')
const link = connectionLink({ serverUrl: 'http://192.168.1.2:7852', accessToken: 'synthetic-token', name: 'QR fixture', serverIdentity: 'fixture-id' })
const press = (tree, label) => tree.root.findByProps({ accessibilityLabel: label }).props.onPress()
const render = async onScanned => {
  let tree
  await act(async () => { tree = TestRenderer.create(React.createElement(ServerQrScanner, { onScanned })) })
  return tree
}

test('camera keeps a responsive square viewport with source and network guidance', async () => {
  const tree = await render(() => {})
  try {
    const preview = tree.root.findByProps({ testID: 'server-camera-preview' })
    const style = Object.assign({}, ...preview.props.style)
    assert.equal(style.aspectRatio, 1)
    assert.equal(style.width, '100%')
    assert.equal(style.maxWidth, undefined, 'cap the parent width before resolving the child aspect ratio')
    assert.equal(preview.parent.props.style.maxWidth, 360)
    assert.equal(style.height, undefined)
    assert.equal(style.overflow, 'hidden')
    assert.match(JSON.stringify(tree.toJSON()), /server terminal or AgentsDock desktop/)
    assert.match(JSON.stringify(tree.toJSON()), /Wi-Fi.*Tailscale/)
    assert.ok(tree.root.findAllByType('QrCode').length)
  } finally { await act(async () => tree.unmount()) }
})

test('actual server payload scans once even when the camera repeats it 100 times', async () => {
  fixture.permission = { granted: true, canAskAgain: true }
  const received = [], tree = await render(value => received.push(value))
  try {
    const camera = tree.root.findByType('Camera')
    assert.deepEqual(camera.props.barcodeScannerSettings, { barcodeTypes: ['qr'] })
    await act(async () => { for (let i = 0; i < 100; i++) camera.props.onBarcodeScanned({ data: link }) })
    assert.equal(received.length, 1)
    assert.equal(received[0].accessToken, 'synthetic-token')
    assert.equal(received[0].serverIdentity, 'fixture-id')
  } finally { await act(async () => tree.unmount()) }
})

test('invalid QR hides camera, never echoes its contents, and can be retried', async () => {
  const received = [], tree = await render(value => received.push(value))
  try {
    await act(async () => tree.root.findByType('Camera').props.onBarcodeScanned({ data: 'private-invalid-qr' }))
    assert.equal(tree.root.findAllByType('Camera').length, 0)
    assert.doesNotMatch(JSON.stringify(tree.toJSON()), /private-invalid-qr/)
    assert.equal(received.length, 0)
    await act(async () => press(tree, 'Try scanning again'))
    await act(async () => tree.root.findByType('Camera').props.onBarcodeScanned({ data: link }))
    assert.equal(received.length, 1)
  } finally { await act(async () => tree.unmount()) }
})

test('camera is released in the background and after dismissal; returning rechecks permission', async () => {
  const received = [], tree = await render(value => received.push(value))
  const refreshes = fixture.refreshes
  await act(async () => fixture.change('background'))
  assert.equal(tree.root.findAllByType('Camera').length, 0)
  await act(async () => fixture.change('active'))
  assert.equal(fixture.refreshes, refreshes + 1)
  const callback = tree.root.findByType('Camera').props.onBarcodeScanned
  await act(async () => tree.unmount())
  callback({ data: link })
  assert.equal(received.length, 0)
  assert.equal(fixture.change, null)
})

test('permission requests happen on scanner entry only; denial exposes Settings without a camera', async () => {
  fixture.permission = { granted: false, canAskAgain: true }
  const before = fixture.requests, tree = await render(() => {})
  assert.equal(fixture.requests, before + 1)
  assert.equal(tree.root.findAllByType('Camera').length, 0)
  await act(async () => tree.update(React.createElement(ServerQrScanner, { onScanned: () => {} })))
  assert.equal(fixture.requests, before + 1)
  fixture.permission = { granted: false, canAskAgain: false }
  await act(async () => tree.update(React.createElement(ServerQrScanner, { onScanned: () => {} })))
  await act(async () => press(tree, 'Open camera settings'))
  assert.equal(fixture.settings, 1)
  await act(async () => tree.unmount())
  fixture.permission = { granted: true, canAskAgain: true }
})

test('camera mounting failure keeps manual connection possible and supports a retry', async () => {
  const tree = await render(() => {})
  try {
    await act(async () => tree.root.findByType('Camera').props.onMountError({ message: 'native private detail' }))
    assert.equal(tree.root.findAllByType('Camera').length, 0)
    assert.match(JSON.stringify(tree.toJSON()), /physical phone/)
    assert.doesNotMatch(JSON.stringify(tree.toJSON()), /native private detail/)
    await act(async () => press(tree, 'Try scanning again'))
    assert.equal(tree.root.findAllByType('Camera').length, 1)
  } finally { await act(async () => tree.unmount()) }
})
