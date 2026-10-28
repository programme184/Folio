import assert from 'node:assert/strict'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { MediaGrid } from '../src/components/MediaGrid'
import { ArtifactFileViewerModal } from '../src/components/file-viewer/ArtifactFileViewerModal'
import { WorkspaceFileViewerModal } from '../src/components/file-viewer/WorkspaceFileViewerModal'
import { FileViewerContext } from '../src/components/file-viewer/FileViewerContext'
import { useFileTransfer } from '../src/components/file-viewer/useFileTransfer'
import { FileTransferNotice } from '../src/components/file-viewer/FileTransferNotice'
import { Directory, File, nativeTransfer, Platform, setTestWidth } from './file-transfer-mocks'
import { resetComponentStore, setTestClient, useAppStore } from './component-mocks/app-store'
import type { AgentFile, WorkspaceInfo } from '../src/types'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const insets = { top: 30, bottom: 20, left: 0, right: 0 }
const viewerContext = { viewerActive: false, openArtifacts() {}, openWorkspace() {}, closeViewer() {}, setPresentationBlocked() {} }
const workspaceEntry = { name: 'report.txt', path: 'folder/report.txt', kind: 'file' as const, size: 100 }
const baseFile: AgentFile = { id: 'file/one', session_id: 'session-a', filename: 'report.txt', size: 100 }
const connection = () => setTestClient({
  fileURL: (session, id) => `https://synthetic.invalid/api/sessions/${encodeURIComponent(session)}/files/${encodeURIComponent(id)}`,
  workspaceDownloadURL: (session, path) => `https://synthetic.invalid/api/sessions/${encodeURIComponent(session)}/workspace/download?path=${encodeURIComponent(path)}`,
  workspacePreviewURL: () => 'https://synthetic.invalid/preview',
  authHeaders: () => ({ Authorization: 'Bearer synthetic-test-token' }),
  workspaceInfo: async () => ({ root: '/server/workspace', name: 'Workspace', read_only: true, capability_version: 2, max_text_file_bytes: 1000 } as WorkspaceInfo),
  workspaceEntries: async () => ({ entries: [workspaceEntry], total: 1, has_more: false, path: '', offset: 0, limit: 500 }),
})
function reset() {
  nativeTransfer.reset()
  setTestWidth(390)
  resetComponentStore({ selectedSessionId: 'session-a', pins: [], profiles: [], serverURL: 'https://synthetic.invalid' })
  connection()
}
let renderer!: ReturnType<typeof create>
const host = (predicate: (node: ReactTestInstance) => boolean) => renderer.root.findAll(node => node.type === 'Pressable' && predicate(node))[0]
const label = (value: string) => host(node => node.props.accessibilityLabel === value)
const id = (value: string) => host(node => node.props.testID === value)
const rendered = () => JSON.stringify(renderer.toJSON())
const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve() })
const click = async (node: ReactTestInstance) => { assert(node, 'Expected a rendered tappable'); await act(async () => { node.props.onPress() }) }
async function chooseDownloadOption(option: string, twice = false) {
  const button = label(option)
  assert(button, `Expected ${option} in the download menu`)
  await act(async () => { button.props.onPress(); if (twice) button.props.onPress() })
}
async function clickDownload(button: ReactTestInstance) {
  await click(button)
  if (label('Save to Files')) await chooseDownloadOption('Save to Files')
}
async function savePhotos() {
  await click(label('Download file'))
  await chooseDownloadOption('Save to Photos')
}
const close = async () => { await act(async () => { renderer.unmount() }); await flush() }
type Variant = { name: string; family: 'media' | 'artifact' | 'workspace'; compact?: boolean; filename?: string; width?: number; fallback?: boolean; video?: boolean; platform?: 'ios' | 'android' }
const variants: Variant[] = [
  { name: 'timeline image tile', family: 'media', filename: 'image.png' },
  { name: 'timeline file row', family: 'media' },
  { name: 'unsupported file identity', family: 'media', filename: 'archive.zip', fallback: true },
  { name: 'inspector media tile', family: 'media', compact: true, filename: 'clip.mp4' },
  { name: 'inspector file row', family: 'media', compact: true },
  { name: 'artifact phone overflow', family: 'artifact' },
  { name: 'artifact iPad header', family: 'artifact', width: 1024 },
  { name: 'artifact preview fallback', family: 'artifact', fallback: true },
  { name: 'artifact video fallback', family: 'artifact', fallback: true, video: true, filename: 'clip.mp4' },
  { name: 'workspace phone download', family: 'workspace' },
  { name: 'workspace iPad download', family: 'workspace', width: 1024 },
  { name: 'workspace preview fallback', family: 'workspace', fallback: true },
]
async function mount(variant: Variant) {
  // Artifact folder/photo saves are Android choices; iOS uses its native share sheet.
  Platform.OS = variant.platform ?? (variant.family === 'artifact' ? 'android' : 'ios')
  setTestWidth(variant.width ?? 390)
  const file = { ...baseFile, filename: variant.filename ?? baseFile.filename }
  await act(async () => {
    renderer = create(variant.family === 'media'
      ? <FileViewerContext.Provider value={viewerContext}><MediaGrid files={[file]} sessionId="session-a" compact={variant.compact} /></FileViewerContext.Provider>
      : variant.family === 'artifact'
        ? <ArtifactFileViewerModal request={{ kind: 'artifacts', sessionId: 'session-a', files: [file], initialId: file.id, ownerKey: 'test' }} modalInsets={insets} onClose={() => {}} />
        : <WorkspaceFileViewerModal request={{ kind: 'workspace', sessionId: 'session-a' }} modalInsets={insets} onClose={() => {}} />)
  })
  if (variant.family === 'workspace') await click(label('Open file report.txt'))
  if (variant.family === 'artifact' && !variant.fallback && (variant.width ?? 390) < 700) await click(label('More file actions'))
  return variant.fallback
    ? variant.family === 'media' ? label(`Download ${file.filename}`) : id(variant.video ? 'video-fallback-download' : 'preview-fallback-download')
    : label(variant.family === 'media' ? 'Download' : 'Download file')
}

for (const filename of ['image.png', 'clip.mp4']) for (const width of [390, 1024]) {
  reset()
  await mount({ name: 'Photos', family: 'artifact', filename, ...(width === 1024 ? { width } : {}) })
  assert.equal(label('Save to Photos'), undefined, 'Photos must not occupy a separate toolbar button')
  const download = label('Download file')
  await act(async () => { download.props.onPress(); download.props.onPress() })
  assert.equal(renderer.root.findAll(node => node.type === 'Pressable' && node.props.accessibilityLabel === 'Save to Photos').length, 1)
  assert.equal(nativeTransfer.downloads.length, 0)
  await chooseDownloadOption('Save to Photos', true)
  await flush()
  assert.equal(nativeTransfer.photoSaves.length, 1, 'Repeated save taps must not duplicate the photo')
  assert.deepEqual(nativeTransfer.photoPermissionCalls, [[true, []]], 'Only add-only permission is queried')
  assert.equal(nativeTransfer.pickerCalls, 0)
  assert.equal(nativeTransfer.shares.length, 0)
  assert.equal(nativeTransfer.downloads[0].options.headers?.Authorization, 'Bearer synthetic-test-token')
  assert.match(rendered(), /Saved to Photos/)
  assert.equal(nativeTransfer.deleted.length, 1)
  await close()
  console.log(`PASS ${filename} ${width}: Photos action, add-only permission, authenticated bytes, native save and cleanup`)
}

reset()
await mount({ name: 'Photos denied', family: 'artifact', filename: 'image.png' })
nativeTransfer.photoPermission = { granted: false, canAskAgain: false }
await savePhotos()
await flush()
assert.equal(nativeTransfer.downloads.length, 0)
assert.match(rendered(), /Allow adding photos in Settings/)
await click(label('Open photo settings'))
assert.equal(nativeTransfer.settingsOpened, 1)
await close()

reset()
await mount({ name: 'Photos stale', family: 'artifact', filename: 'clip.mp4' })
const permission = deferred<{ granted: boolean; canAskAgain: boolean }>()
nativeTransfer.photoPermission = { granted: false, canAskAgain: true }
nativeTransfer.requestPhotoPermission = () => permission.promise
await savePhotos()
await act(async () => useAppStore.setState({ selectedSessionId: 'session-b' }))
await act(async () => permission.resolve({ granted: true, canAskAgain: true }))
await flush()
assert.equal(nativeTransfer.downloads.length, 0)
assert.equal(nativeTransfer.photoSaves.length, 0)
await close()

reset()
await mount({ name: 'Photos native failure', family: 'artifact', filename: 'clip.mp4' })
nativeTransfer.savePhoto = async () => { throw new Error('Storage is full') }
await savePhotos()
await flush()
assert.match(rendered(), /Storage is full/)
assert.doesNotMatch(rendered(), /Saved to Photos/)
assert.equal(nativeTransfer.deleted.length, 1)
await close()

for (const version of [28, 29, 33]) {
  reset()
  Platform.OS = 'android'; Platform.Version = version
  await mount({ name: 'Android Photos', family: 'artifact', filename: 'clip.mp4' })
  await savePhotos()
  await flush()
  assert.equal(nativeTransfer.photoSaves.length, 1)
  assert.deepEqual(nativeTransfer.photoPermissionCalls, version < 29 ? [[true, []]] : [])
  await close()
}

reset()
await mount({ name: 'Document', family: 'artifact', filename: 'report.pdf' })
assert.equal(label('Save to Photos'), undefined)
await click(label('Download file'))
assert.equal(label('Save to Photos'), undefined)
assert(label('Save to Files'))
assert(label('Share / Open in...'))
await chooseDownloadOption('Cancel download options')
assert.equal(nativeTransfer.downloads.length, 0)
assert.equal(nativeTransfer.pickerCalls, 0)
await close()

for (const platform of ['ios', 'android']) {
  reset()
  Platform.OS = platform
  await mount({ name: 'Download menu sharing', family: 'artifact', filename: 'image.png', platform: platform as 'ios' | 'android' })
  await click(label('Download file'))
  if (platform === 'android') {
    assert.equal(nativeTransfer.downloads.length, 0)
    await chooseDownloadOption('Share / Open in...')
  } else {
    assert.equal(label('Save to Photos'), undefined)
    assert.equal(label('Share / Open in...'), undefined, 'iOS must open the system sheet directly')
  }
  await flush()
  assert.equal(nativeTransfer.shares.length, 1)
  assert.equal(nativeTransfer.pickerCalls, 0)
  assert.equal(nativeTransfer.photoPermissionCalls.length, 0)
  assert.equal(nativeTransfer.deleted.length, 0, 'Shared file stays readable by the receiving app')
  await close()
}

reset()
await mount({ name: 'Stale download menu', family: 'artifact', filename: 'image.png' })
await click(label('Download file'))
const staleMenuPress = label('Save to Files').props.onPress
await act(async () => useAppStore.setState({ selectedSessionId: 'session-b' }))
assert.equal(label('Save to Files'), undefined)
await act(async () => staleMenuPress())
assert.equal(nativeTransfer.pickerCalls, 0)
assert.equal(nativeTransfer.downloads.length, 0)
await close()

reset()
Platform.OS = 'android'
await mount({ name: 'Android download menu cancel', family: 'artifact', filename: 'image.png' })
await click(label('Download file'))
await click(label('Cancel download options'))
assert.equal(label('Save to Photos'), undefined)
assert.equal(nativeTransfer.downloads.length, 0)
assert.equal(nativeTransfer.photoPermissionCalls.length, 0)
await close()
console.log('PASS native/Android download menu, cancel, share routing and stale menu dismissal')

for (const filename of ['image.png', 'clip.mp4', 'report.pdf']) for (const width of [390, 1024]) {
  reset()
  const pending = deferred<File>()
  nativeTransfer.download = () => pending.promise
  const download = await mount({ name: 'iOS system download sheet', family: 'artifact', platform: 'ios', filename, width })
  const button = download
  await act(async () => { button.props.onPress(); button.props.onPress() })
  assert.equal(nativeTransfer.downloads.length, 1)
  assert.equal(nativeTransfer.shares.length, 0, 'Do not present the OS sheet until bytes are ready')
  assert.equal(nativeTransfer.pickerCalls, 0)
  assert.equal(label('Save to Photos'), undefined)
  const current = nativeTransfer.downloads[0]
  assert.equal(current.options.headers?.Authorization, 'Bearer synthetic-test-token')
  await act(async () => { nativeTransfer.put(current.file.uri, 100); pending.resolve(current.file) })
  await flush()
  assert.equal(nativeTransfer.shares.length, 1)
  assert.equal(nativeTransfer.photoPermissionCalls.length, 0, 'iOS manages photo saving inside its system sheet')
  assert.equal(nativeTransfer.deleted.length, 0)
  assert.doesNotMatch(rendered(), /Saved to Photos/, 'Closing the system sheet cannot claim a save')
  await close()
}
console.log('PASS iOS Download directly opens the native sheet for image, video and PDF on phone/tablet')

// Real controls, hooks, notices and adapter are exercised for every entry point.
// Each delayed picker must appear before the first authenticated request.
for (const variant of variants) {
  reset()
  const picker = deferred<Directory>()
  const download = deferred<File>()
  nativeTransfer.picker = () => picker.promise
  nativeTransfer.download = file => {
    const signal = nativeTransfer.downloads.at(-1)!.options.signal!
    signal.addEventListener('abort', () => download.reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })), { once: true })
    return download.promise
  }
  const button = await mount(variant)
  await act(async () => { button.props.onPress(); button.props.onPress() })
  if (variant.family === 'artifact') {
    assert.equal(nativeTransfer.pickerCalls, 0, 'Menu selection precedes the folder picker')
    await chooseDownloadOption('Save to Files')
  }
  assert.equal(nativeTransfer.pickerCalls, 1, `${variant.name}: rapid repeated taps cannot present two pickers`)
  assert.equal(nativeTransfer.downloads.length, 0, `${variant.name}: location must be chosen before network`)
  assert.match(rendered(), /Choose a folder/, `${variant.name}: immediate visible response`)
  await act(async () => picker.resolve(new Directory('file:///user-selected-folder')))
  assert.equal(nativeTransfer.downloads.length, 1, variant.name)
  const current = nativeTransfer.downloads[0]
  assert.equal(current.options.headers?.Authorization, 'Bearer synthetic-test-token')
  assert.match(current.url, variant.family === 'workspace' ? /\/workspace\/download\?path=folder%2Freport.txt$/ : /\/sessions\/session-a\/files\/file%2Fone$/)
  await act(async () => current.options.onProgress!({ bytesWritten: 25, totalBytes: 100 }))
  assert.match(rendered(), /25%/, `${variant.name}: real progress callback reaches the visible notice`)
  assert(id('file-transfer-cancel'), `${variant.name}: cancellable transfer`)
  await act(async () => { nativeTransfer.put(current.file.uri, 100); download.resolve(current.file) })
  await flush()
  assert.match(rendered(), /Saved .* to the selected folder/, `${variant.name}: completion stays visible`)
  assert.equal(nativeTransfer.shares.length, 0, `${variant.name}: Download never falls through to Share`)
  assert.equal(nativeTransfer.copies.length, 1)
  assert.equal(nativeTransfer.copies[0].overwrite, false)
  assert.equal(nativeTransfer.deleted.length, 1, `${variant.name}: owned cache is removed after saving`)
  await close()
  console.log(`PASS ${variant.name}: picker first, repeated taps, authenticated request, progress, save, cleanup`)
}

for (const variant of [variants[0], variants[6], variants[9]]) {
  reset()
  const button = await mount(variant)
  nativeTransfer.download = () => Promise.reject(new Error('HTTP 403: access expired'))
  await clickDownload(button)
  await flush()
  assert.match(rendered(), /Could not download .*HTTP 403/, `${variant.family}: failure visible in current view`)
  assert.equal(nativeTransfer.copies.length, 0)
  assert.equal(nativeTransfer.shares.length, 0)
  assert.equal(nativeTransfer.deleted.length, 1)
  nativeTransfer.download = async file => { nativeTransfer.put(file.uri, 100); return file }
  await clickDownload(label(variant.family === 'media' ? 'Download' : 'Download file'))
  await flush()
  assert.match(rendered(), /Saved /, `${variant.family}: failure releases the action for retry`)
  await close()

  reset()
  const cancelButton = await mount(variant)
  nativeTransfer.download = file => new Promise((_resolve, reject) => {
    nativeTransfer.put(file.uri, 10)
    nativeTransfer.downloads.at(-1)!.options.signal!.addEventListener('abort', () => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })), { once: true })
  })
  await clickDownload(cancelButton)
  await click(id('file-transfer-cancel'))
  await flush()
  assert(nativeTransfer.downloads[0].options.signal!.aborted)
  assert.match(rendered(), /Download cancelled/)
  assert.equal(nativeTransfer.copies.length, 0)
  assert.equal(nativeTransfer.files().size, 0, `${variant.family}: partial download removed on Cancel`)
  await close()

  reset()
  const picker = deferred<Directory>()
  nativeTransfer.picker = () => picker.promise
  await clickDownload(await mount(variant))
  await act(async () => useAppStore.setState({ selectedSessionId: 'session-b' }))
  await act(async () => picker.resolve(new Directory('file:///user-selected-folder')))
  await flush()
  assert.equal(nativeTransfer.downloads.length, 0, `${variant.family}: a stale chooser cannot download another chat's file`)
  assert.equal(nativeTransfer.copies.length, 0)
  await close()

  reset()
  nativeTransfer.download = file => new Promise((_resolve, reject) => {
    nativeTransfer.put(file.uri, 12)
    nativeTransfer.downloads.at(-1)!.options.signal!.addEventListener('abort', () => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })), { once: true })
  })
  await clickDownload(await mount(variant))
  const previous = nativeTransfer.downloads[0]
  await act(async () => { connection(); useAppStore.setState({ profileGeneration: 2 }) })
  await flush()
  assert(previous.options.signal!.aborted, `${variant.family}: replacing the server cancels native work`)
  assert.equal(nativeTransfer.copies.length, 0)
  assert.equal(nativeTransfer.files().size, 0)
  assert.doesNotMatch(rendered(), /Could not download|Download cancelled|Downloading/, `${variant.family}: old connection cannot publish status into the replacement`)
  await close()
  console.log(`PASS ${variant.family}: visible error, retry, cancel, partial cleanup, stale chat and replaced client`)
}

reset()
nativeTransfer.picker = () => Promise.reject(Object.assign(new Error('File picking was cancelled by the user'), { code: 'ERR_FILE_PICKING_CANCELLED' }))
await click(await mount(variants[0]))
await flush()
assert.match(rendered(), /Download cancelled/)
assert.doesNotMatch(rendered(), /Could not download/)
assert.equal(nativeTransfer.downloads.length, 0)
await close()

// An unavailable native picker must fail visibly without consuming bandwidth.
reset()
const pickDirectory = Directory.pickDirectoryAsync
;(Directory as any).pickDirectoryAsync = undefined
await click(await mount(variants[0]))
await flush()
assert.match(rendered(), /Choosing a download folder is unavailable/)
assert.equal(nativeTransfer.downloads.length, 0)
Directory.pickDirectoryAsync = pickDirectory
await close()

// Collision copies retain the exact user-selected folder object, which matters
// for Android provider tree URIs and iOS security-scoped access.
reset()
nativeTransfer.picker = async () => new Directory('content://synthetic.provider/tree/picked-folder')
nativeTransfer.put('content://synthetic.provider/tree/picked-folder/report.txt', 37)
let copyAttempt = 0
nativeTransfer.copy = async (_source, destination) => {
  copyAttempt += 1
  if (copyAttempt === 2) {
    nativeTransfer.put(destination.uri, 42)
    throw Object.assign(new Error('NSCocoaErrorDomain Code=516 "localized collision"'), { code: 'ERR_UNEXPECTED' })
  }
}
await click(await mount(variants[1]))
await flush()
assert.match(rendered(), /Saved report.txt \(2\)|Saved report \(2\).txt/)
const saved = nativeTransfer.files()
assert.equal(saved.get('content://synthetic.provider/tree/picked-folder/report.txt'), 37)
assert.equal(saved.get('content://synthetic.provider/tree/picked-folder/report (1).txt'), 42)
assert.equal(saved.get('content://synthetic.provider/tree/picked-folder/report (2).txt'), 100)
assert(nativeTransfer.copies.every(copy => copy.overwrite === false && copy.directoryTarget), 'Native copies must target the picked Directory, never append names to provider tree URIs')
await close()

reset()
nativeTransfer.copy = async () => { throw new Error('Cloud folder access was revoked') }
await click(await mount(variants[1]))
await flush()
assert.match(rendered(), /Cloud folder access was revoked/)
assert.equal(nativeTransfer.copies.length, 1, 'Provider failures must not be treated as filename collisions')
assert.equal(nativeTransfer.deleted.length, 1)
await close()

reset()
const unknownDownload = deferred<File>()
nativeTransfer.download = () => unknownDownload.promise
await click(await mount(variants[9]))
const unknownRequest = nativeTransfer.downloads[0]
await act(async () => unknownRequest.options.onProgress!({ bytesWritten: 50, totalBytes: -1 }))
assert.match(rendered(), /50 B downloaded/)
assert.equal(renderer.root.findAll(node => node.props.accessibilityRole === 'progressbar').length, 0, 'Unknown content length must not invent a percentage')
await act(async () => { nativeTransfer.put(unknownRequest.file.uri, 100); unknownDownload.resolve(unknownRequest.file) })
await flush()
await close()

// Share remains a distinct action and waits until the local file is ready.
for (const variant of [variants[6], variants[9]]) {
  reset()
  await mount(variant)
  const transfer = deferred<File>()
  nativeTransfer.download = () => transfer.promise
  await click(label('Share file'))
  assert.equal(nativeTransfer.pickerCalls, 0)
  assert.equal(nativeTransfer.shares.length, 0)
  assert.match(rendered(), /Downloading/)
  const current = nativeTransfer.downloads[0]
  await act(async () => { nativeTransfer.put(current.file.uri, 100); transfer.resolve(current.file) })
  await flush()
  assert.equal(nativeTransfer.shares.length, 1)
  assert.equal(nativeTransfer.copies.length, 0)
  assert.equal(nativeTransfer.deleted.length, 0, 'Recipient may still read a shared file after chooser dismissal')
  await close()

  reset()
  nativeTransfer.sharingAvailable = false
  await mount(variant)
  await click(label('Share file'))
  await flush()
  assert.match(rendered(), /File sharing is unavailable/)
  assert.equal(nativeTransfer.downloads.length, 0)
  await close()
}

// Exercise a mounted hook across A -> B -> A while its first picker is still
// open. The old cancellation must not replace the newest action's visible error.
function TransferProbe({ scope }: { scope: string }) {
  const transfer = useFileTransfer(scope)
  return <><button onClick={() => void transfer.start({ action: 'download', filename: 'test.txt', title: 'test.txt', contentType: 'text/plain', source: () => ({ url: 'https://synthetic.invalid/test', headers: {} }), isCurrent: () => true })} /><FileTransferNotice state={transfer.state} onCancel={transfer.cancel} onDismiss={transfer.dismiss} /></>
}
reset()
const stalePicker = deferred<Directory>()
nativeTransfer.picker = () => stalePicker.promise
await act(async () => { renderer = create(<TransferProbe scope="a" />) })
await act(async () => renderer.root.findByType('button').props.onClick())
await act(async () => renderer.update(<TransferProbe scope="b" />))
await act(async () => renderer.update(<TransferProbe scope="a" />))
await act(async () => renderer.root.findByType('button').props.onClick())
assert.match(rendered(), /Another file is being saved/)
await act(async () => stalePicker.resolve(new Directory('file:///user-selected-folder')))
await flush()
assert.match(rendered(), /Another file is being saved/)
assert.doesNotMatch(rendered(), /Download cancelled/)
assert.equal(nativeTransfer.downloads.length, 0)
await close()

console.log('PASS picker cancellation, missing capability, provider collisions, cloud error, separate Share, A→B→A stale guard')
console.log('All rendered file transfer behavioral tests passed')
