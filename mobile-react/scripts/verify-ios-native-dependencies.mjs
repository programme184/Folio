import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { resolveIosWorkspace } from './resolve-ios-workspace.mjs'

const root = process.cwd()
const appPackagePath = path.join(root, 'package.json')
const packagePath = path.join(root, 'node_modules', 'expo-video', 'package.json')
const playerPath = path.join(root, 'node_modules', 'expo-video', 'ios', 'VideoPlayer.swift')
const podLockPath = path.join(root, 'ios', 'Podfile.lock')
const manifestPath = path.join(root, 'ios', 'Pods', 'Manifest.lock')
const localPodspecPath = path.join(root, 'ios', 'Pods', 'Local Podspecs', 'ExpoVideo.podspec.json')
const podsProjectPath = path.join(root, 'ios', 'Pods', 'Pods.xcodeproj', 'project.pbxproj')
const workspacePath = resolveIosWorkspace(path.join(root, 'ios'))
const nativeVideoViewPath = path.join(root, 'modules', 'agentsdock-native-video', 'ios', 'AgentsDockNativeVideoView.swift')
const nativeVideoConfigPath = path.join(root, 'modules', 'agentsdock-native-video', 'expo-module.config.json')

for (const required of [appPackagePath, packagePath, playerPath, podLockPath, manifestPath, localPodspecPath, podsProjectPath, workspacePath, nativeVideoViewPath, nativeVideoConfigPath]) {
  assert.ok(fs.existsSync(required), `Missing required iOS dependency input: ${path.relative(root, required)}`)
}

const appPackage = JSON.parse(fs.readFileSync(appPackagePath, 'utf8'))
const packageVersion = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version
const localPodVersion = JSON.parse(fs.readFileSync(localPodspecPath, 'utf8')).version
const podLock = fs.readFileSync(podLockPath, 'utf8')
const manifest = fs.readFileSync(manifestPath, 'utf8')
const player = fs.readFileSync(playerPath, 'utf8')
const podsProject = fs.readFileSync(podsProjectPath, 'utf8')
const workspace = fs.readFileSync(workspacePath, 'utf8')
const nativeVideoView = fs.readFileSync(nativeVideoViewPath, 'utf8')
const nativeVideoConfig = JSON.parse(fs.readFileSync(nativeVideoConfigPath, 'utf8'))

assert.match(packageVersion, /^\d+\.\d+\.\d+$/, 'expo-video package version is invalid')
assert.ok(
  appPackage.expo?.autolinking?.ios?.buildFromSource?.includes('expo-video'),
  'expo-video must build from source to stay ABI-compatible with the installed ExpoModulesCore',
)
assert.equal(localPodVersion, packageVersion, 'ExpoVideo local podspec does not match the installed JavaScript package')
assert.match(podLock, new RegExp(`^  - ExpoVideo \\(${escapeRegExp(packageVersion)}\\):$`, 'm'), 'Podfile.lock does not match expo-video')
assert.match(manifest, new RegExp(`^  - ExpoVideo \\(${escapeRegExp(packageVersion)}\\):$`, 'm'), 'Pods/Manifest.lock does not match expo-video')
assert.match(player, /override func sharedObjectWillRelease\(\)/, 'ExpoVideo is missing shared-object lifecycle cleanup')
assert.match(player, /!self\.hasBeenReleased/, 'ExpoVideo is missing released-player observer guards')
assert.match(podsProject, /VideoPlayer\.swift in Sources/, 'ExpoVideo is not compiled from its installed Swift source')
assert.doesNotMatch(podsProject, /ExpoVideo\.xcframework/, 'ExpoVideo still references the ABI-incompatible precompiled XCFramework')
assert.ok(
  appPackage.expo?.autolinking?.ios?.buildFromSource?.includes('expo-camera'),
  'expo-camera must build from source to stay ABI-compatible with the installed ExpoModulesCore',
)
const cameraVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'expo-camera', 'package.json'), 'utf8')).version
const cameraPod = JSON.parse(fs.readFileSync(path.join(root, 'ios', 'Pods', 'Local Podspecs', 'ExpoCamera.podspec.json'), 'utf8'))
assert.equal(cameraPod.version, cameraVersion, 'ExpoCamera local podspec does not match the installed JavaScript package')
assert.match(podLock, new RegExp(`^  - ExpoCamera \\(${escapeRegExp(cameraVersion)}\\):$`, 'm'), 'Podfile.lock does not match expo-camera')
assert.match(manifest, new RegExp(`^  - ExpoCamera \\(${escapeRegExp(cameraVersion)}\\):$`, 'm'), 'Pods/Manifest.lock does not match expo-camera')
assert.match(podsProject, /CameraViewModule\.swift in Sources/, 'ExpoCamera is not compiled from its installed Swift source')
assert.doesNotMatch(podsProject, /ExpoCamera\.xcframework/, 'ExpoCamera still references the ABI-incompatible precompiled XCFramework')
const uiVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', '@expo', 'ui', 'package.json'), 'utf8')).version
const mediaVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'expo-media-library', 'package.json'), 'utf8')).version
const mediaPod = JSON.parse(fs.readFileSync(path.join(root, 'ios', 'Pods', 'Local Podspecs', 'ExpoMediaLibrary.podspec.json'), 'utf8'))
assert.ok(appPackage.expo?.autolinking?.ios?.buildFromSource?.includes('expo-media-library'), 'Photo saving must build against the installed ExpoModulesCore')
assert.equal(mediaPod.version, mediaVersion, 'Photo-saving native code must match its JavaScript package')
assert.match(podLock, new RegExp(`^  - ExpoMediaLibrary \\(${escapeRegExp(mediaVersion)}\\):$`, 'm'), 'Podfile.lock is missing the matching photo-saving module')
assert.match(manifest, new RegExp(`^  - ExpoMediaLibrary \\(${escapeRegExp(mediaVersion)}\\):$`, 'm'), 'Pods/Manifest.lock is missing the matching photo-saving module')
assert.match(podsProject, /MediaLibraryNextModule\.swift in Sources/, 'Photo saving must compile from its installed Swift source')
assert.doesNotMatch(podsProject, /ExpoMediaLibrary\.xcframework/, 'Photo saving must not use an ABI-incompatible precompiled framework')
const uiPod = JSON.parse(fs.readFileSync(path.join(root, 'ios', 'Pods', 'Local Podspecs', 'ExpoUI.podspec.json'), 'utf8'))
assert.ok(appPackage.expo?.autolinking?.ios?.buildFromSource?.includes('@expo/ui'), 'ExpoUI must build against the installed ExpoModulesCore')
assert.equal(uiPod.version, uiVersion, 'ExpoUI native code must match the installed touch-lifecycle fix; reload alone is insufficient')
assert.match(podLock, new RegExp(`^  - ExpoUI \\(${escapeRegExp(uiVersion)}\\):$`, 'm'), 'Podfile.lock does not match @expo/ui')
assert.match(manifest, new RegExp(`^  - ExpoUI \\(${escapeRegExp(uiVersion)}\\):$`, 'm'), 'Pods/Manifest.lock does not match @expo/ui')
assert.match(podsProject, /RNHostView\.swift in Sources/, 'ExpoUI must compile the hosted-view touch lifecycle fix')
assert.doesNotMatch(podsProject, /ExpoUI\.xcframework/, 'ExpoUI must not use a precompiled framework from another Expo runtime')
assert.equal(
  (workspace.match(/location = "group:Pods\/Pods\.xcodeproj"/g) ?? []).length,
  1,
  'The iOS workspace must contain exactly one local Pods project reference',
)
assert.doesNotMatch(workspace, /\.\.\/\.\.\/\.\.\/ZenithDock\//, 'The iOS workspace still references the legacy development path')
assert.equal(appPackage.dependencies?.['agentsdock-native-video'], 'file:modules/agentsdock-native-video', 'The Apple-native video module is not pinned as a local dependency')
assert.deepEqual(nativeVideoConfig.platforms, ['apple'], 'The Apple-native video view must stay Apple-only')
assert.match(podLock, /^  - AgentsDockNativeVideo \(1\.0\.0\):$/m, 'Podfile.lock is missing the app-owned Apple video module')
assert.match(manifest, /^  - AgentsDockNativeVideo \(1\.0\.0\):$/m, 'Pods/Manifest.lock is missing the app-owned Apple video module')
assert.match(podsProject, /AgentsDockNativeVideoView\.swift in Sources/, 'The app-owned Apple video view is not compiled by CocoaPods')
assert.match(nativeVideoView, /private let playerLayer = AVPlayerLayer\(\)/, 'The iOS player is not backed by AVPlayerLayer')
assert.match(nativeVideoView, /AgentsDockNativeVideoView: ExpoView, UIScrollViewDelegate/, 'The iOS player is missing its native zoom delegate')
assert.match(nativeVideoView, /private let videoScrollView = UIScrollView\(\)/, 'The iOS player is missing its persistent zoom surface')
assert.match(nativeVideoView, /private let videoContentView = UIView\(\)/, 'The iOS player is missing its isolated video canvas')
assert.match(nativeVideoView, /videoContentView\.layer\.addSublayer\(playerLayer\)/, 'AVPlayerLayer must remain attached only to the native zoom canvas')
assert.match(nativeVideoView, /viewForZooming\(in scrollView: UIScrollView\)[\s\S]*?videoContentView/, 'The iOS zoom delegate must return only the video canvas')
assert.match(nativeVideoView, /videoScrollView\.minimumZoomScale = 1/, 'The iOS video zoom minimum must remain 1x')
assert.match(nativeVideoView, /videoScrollView\.maximumZoomScale = 4/, 'The iOS video zoom maximum must remain 4x')
assert.match(nativeVideoView, /resetZoom\(animated: false\)[\s\S]*?clearPlayer\(\)/, 'A replacement source must reset zoom before player teardown')
assert.match(nativeVideoView, /accessibilityIdentifier(?::| =) "agentsdock-video-zoom-out"/, 'The iOS player is missing its Zoom Out control')
assert.match(nativeVideoView, /accessibilityIdentifier(?::| =) "agentsdock-video-zoom-in"/, 'The iOS player is missing its Zoom In control')
assert.doesNotMatch(nativeVideoView, /AVPlayerViewController/, 'The native zoom path must not restore AVPlayerViewController')
assert.match(nativeVideoView, /private let timelineSlider = UISlider\(\)/, 'The iOS player is missing its native timeline')
assert.match(nativeVideoView, /accessibilityIdentifier = "agentsdock-video-play-pause"/, 'The iOS player is missing its native play\/pause control')
assert.match(nativeVideoView, /VoiceOver adjusts UISlider/, 'The iOS video timeline must seek for accessible adjustments')
assert.match(nativeVideoView, /guard let url = URL\(string: value\), url\.isFileURL/, 'The Apple-native view must reject non-local video sources')

console.log(`iOS native dependency parity verified: source-built ExpoVideo ${packageVersion}, ExpoCamera ${cameraVersion}, ExpoUI ${uiVersion}, ExpoMediaLibrary ${mediaVersion}, and app-owned AVPlayer video`)

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
