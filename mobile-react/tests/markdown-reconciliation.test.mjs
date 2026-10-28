import assert from 'node:assert/strict'
import { mkdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { build } from 'esbuild'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = {
  'react-native': `export const View='View',Text='Text',ScrollView='ScrollView',TouchableWithoutFeedback='TouchableWithoutFeedback'; export const Platform={OS:'ios',select:x=>x.ios??x.default}; export const UIManager={hasViewManagerConfig:()=>true}; export const Linking={openURL:async()=>{}}; export const StyleSheet={create:x=>x,flatten:x=>Array.isArray(x)?Object.assign({},...x.filter(Boolean)):x};`,
  '@bsky.app/react-native-uitextview': `export const UITextView='SelectableText';`,
  'react-native-fit-image': `export default 'Image';`,
  'react-native-svg': `export const SvgXml='SvgXml';`,
  '../lib/tex-svg': `export const texToSvg=()=>null;`,
  '../theme': `const colors={text:'#eee',blue:'#28f',muted:'#999',raised:'#222',border:'#333',surface:'#111'}; export const usePalette=()=>colors; export const radius={sm:6};`,
}
const outfile = path.resolve('build/tmp', `markdown-reconciliation-${process.pid}.mjs`)
await mkdir(path.dirname(outfile), { recursive: true })
await build({
  entryPoints: ['src/components/MarkdownContent.tsx'], outfile, bundle: true, format: 'esm',
  platform: 'node', jsx: 'automatic', loader: { '.js': 'jsx' }, logLevel: 'silent',
  external: ['react', 'react/jsx-runtime'],
  banner: { js: `import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);` },
  plugins: [{ name: 'native-hosts-only', setup(context) {
    context.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'native-mock' } : undefined)
    context.onLoad({ filter: /.*/, namespace: 'native-mock' }, args => ({ contents: mocks[args.path], loader: 'js' }))
  } }],
})
after(async () => { await unlink(outfile) })
const { MarkdownContent } = await import(pathToFileURL(outfile).href)
const text = 'First **stable** paragraph.\n\nSecond paragraph.\n\nReply in progress'
const paragraphs = renderer => renderer.root.findAll(node => node.type === 'SelectableText' && node.props.uiTextView === true)

test('streaming appends retain existing native paragraphs, including the growing paragraph', async () => {
  let renderer
  await act(async () => { renderer = TestRenderer.create(React.createElement(MarkdownContent, { value: text })) })
  try {
    const before = paragraphs(renderer)
    assert.equal(before.length, 3)
    for (const suffix of [' one', ' one two', ' one two three']) {
      await act(async () => renderer.update(React.createElement(MarkdownContent, { value: text + suffix })))
      assert.ok(paragraphs(renderer).every((node, index) => node === before[index]), 'text updates must not unmount all UITextViews')
    }
    await act(async () => renderer.update(React.createElement(MarkdownContent, { value: text + ' done.\n\nNew paragraph.' })))
    assert.equal(paragraphs(renderer).length, 4)
    assert.ok(paragraphs(renderer).slice(0, 3).every((node, index) => node === before[index]))
    await act(async () => renderer.update(React.createElement(MarkdownContent, { value: text + ' done.\n\nNew paragraph.', fontScale: 1.2, color: '#abcdef' })))
    assert.ok(paragraphs(renderer).slice(0, 3).every((node, index) => node === before[index]), 'appearance changes update styles without replacing text views')
  } finally { await act(async () => renderer.unmount()) }
})

test('Markdown edits still change structure, links, code and math without stale content', async () => {
  let renderer
  await act(async () => { renderer = TestRenderer.create(React.createElement(MarkdownContent, { value: 'Before' })) })
  try {
    const value = '# Heading\n\n[Link](https://example.com) and $x^2$.\n\n```ts\nconst changed = true\n```\n\n- First\n- Second'
    await act(async () => renderer.update(React.createElement(MarkdownContent, { value })))
    const output = JSON.stringify(renderer.toJSON())
    assert.match(output, /Heading/)
    assert.match(output, /Link/)
    assert.match(output, /x\^2/)
    assert.match(output, /const changed = true/)
    assert.match(output, /Second/)
    assert.doesNotMatch(output, /Before/)
  } finally { await act(async () => renderer.unmount()) }
})

test('long Markdown retains all 160 native paragraphs through 300 streaming and appearance updates', async () => {
  const prefix = Array.from({ length: 159 }, (_, index) => `Paragraph ${index}. **Stable** text with [a link](https://example.com/${index}).`).join('\n\n')
  let value = `${prefix}\n\nGrowing reply:`
  let renderer
  await act(async () => { renderer = TestRenderer.create(React.createElement(MarkdownContent, { value })) })
  try {
    const before = paragraphs(renderer)
    assert.equal(before.length, 160)
    for (let index = 0; index < 300; index += 1) {
      value += ` word${index}`
      await act(async () => renderer.update(React.createElement(MarkdownContent, {
        value, fontScale: index % 2 ? 1 : 1.2, color: index % 2 ? '#eeeeee' : '#111111',
      })))
      const current = paragraphs(renderer)
      assert.equal(current.length, before.length)
      assert.ok(current.every((node, position) => node === before[position]), `native paragraph remount at update ${index}`)
    }
    assert.match(JSON.stringify(renderer.toJSON()), /word299/)
  } finally { await act(async () => renderer.unmount()) }
})
