import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const [input, output] = process.argv.slice(2)
if (!input || !output?.endsWith('.py')) throw new Error('Usage: node scripts/package_shared_chat_analytics.mjs <snapshot-analytics.js> <output.py>')
const script = (await readFile(input, 'utf8')).trim()
if (/<\/script/i.test(script)) throw new Error('Unsafe inline script boundary')
const hash = createHash('sha256').update(script).digest('base64')
await writeFile(output, `"""Generated from the limited shared-chat analytics entry; do not edit by hand."""\nimport json\n\nSCRIPT = json.loads(${JSON.stringify(JSON.stringify(script))})\nCSP_HASH = ${JSON.stringify(hash)}\n`)
console.log(JSON.stringify({ bytes: script.length, csp_hash: hash }))
