// Regenerate the offline CLI renderer from the reviewed desktop dependency lock.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(path.join(root, 'electron/package.json'))
if (require('qrcode/package.json').version !== '1.5.4') throw new Error('Expected qrcode 1.5.4')
const { buildSync } = createRequire(require.resolve('vite/package.json'))('esbuild')
buildSync({ entryPoints: [require.resolve('qrcode/lib/server.js')],
  outfile: path.join(root, 'server/npm/agentsdock/qr-renderer.cjs'), platform: 'node', format: 'cjs',
  bundle: true, minify: true, legalComments: 'none',
  banner: { js: '// Generated from qrcode 1.5.4; see QR-NOTICES.txt. Regenerate: node scripts/build_cli_qr.mjs' },
})
