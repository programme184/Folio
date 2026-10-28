import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { loadExpoPlist } = require('../plugins/withIosNoAnalyticsPrivacy.cjs')

const read = relative => fs.readFileSync(path.resolve(relative), 'utf8')
const config = JSON.parse(read('app.json')).expo
const iosDirectory = path.resolve('ios')
const projects = fs.existsSync(iosDirectory)
  ? fs.readdirSync(iosDirectory)
    .filter(name => !name.startsWith('.') && name.endsWith('.xcodeproj'))
    .map(name => path.join(iosDirectory, name, 'project.pbxproj'))
    .filter(file => fs.existsSync(file))
  : []

test('Expo defines valid iOS release metadata', () => {
  assert.match(config.version, /^\d+\.\d+\.\d+$/)
  assert.match(config.ios.buildNumber, /^[1-9]\d*$/)
  assert.equal(typeof config.ios.bundleIdentifier, 'string')
  assert.ok(config.ios.bundleIdentifier.length > 0)
})

test('generated iOS release metadata matches the Expo build number', {
  skip: projects.length === 0 ? 'Native iOS project has not been generated' : false,
}, () => {
  for (const projectPath of projects) {
    const project = fs.readFileSync(projectPath, 'utf8')
    const infoPlistFiles = [...project.matchAll(/INFOPLIST_FILE = "?([^";]+)"?;/g)]
      .map(match => match[1])
    assert.ok(infoPlistFiles.length > 0)
    for (const file of new Set(infoPlistFiles)) {
      const info = loadExpoPlist().parse(read(path.join(iosDirectory, file)))
      // Expo may write a literal version rather than use Xcode's default variable.
      if (info.CFBundleVersion === '$(CURRENT_PROJECT_VERSION)') {
        const projectBuildNumbers = [...project.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)]
          .map(match => match[1])
        assert.ok(projectBuildNumbers.length > 0)
        assert.deepEqual(new Set(projectBuildNumbers), new Set([config.ios.buildNumber]))
      } else {
        assert.equal(info.CFBundleVersion, config.ios.buildNumber)
      }
    }
  }
})
