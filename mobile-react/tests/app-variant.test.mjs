import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const configure = require('../app.config.js')
const production = JSON.parse(fs.readFileSync('app.json', 'utf8')).expo

function withVariant(value, callback) {
  const previous = process.env.AGENTSDOCK_APP_VARIANT
  try {
    if (value === undefined) delete process.env.AGENTSDOCK_APP_VARIANT
    else process.env.AGENTSDOCK_APP_VARIANT = value
    return callback()
  } finally {
    if (previous === undefined) delete process.env.AGENTSDOCK_APP_VARIANT
    else process.env.AGENTSDOCK_APP_VARIANT = previous
  }
}

test('default and production config preserve the shipping app unchanged', () => {
  for (const variant of [undefined, 'production']) {
    withVariant(variant, () => assert.deepEqual(configure({ config: structuredClone(production) }), production))
  }
})

test('development uses separate app identifiers and URL scheme without mutating production', () => {
  const input = structuredClone(production)
  const dev = withVariant('development', () => configure({ config: input }))
  assert.equal(dev.name, 'AgentsDock Dev')
  assert.equal(dev.ios.bundleIdentifier, `${production.ios.bundleIdentifier}.dev`)
  assert.equal(dev.android.package, `${production.android.package}.dev`)
  assert.equal(dev.scheme, 'agentsdock-dev')
  assert.notEqual(dev.scheme, production.scheme)
  assert.deepEqual(input, production)
  assert.deepEqual(dev.plugins, production.plugins)
  assert.deepEqual(dev.ios.infoPlist, production.ios.infoPlist)
})

test('a misspelled variant fails instead of silently targeting the shipping app', () => {
  withVariant('developmnt', () => assert.throws(() => configure({ config: production }), /Unknown AgentsDock app variant/))
})
