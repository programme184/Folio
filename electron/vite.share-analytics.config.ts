import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: { legalComments: 'inline' },
  build: {
    outDir: resolve(__dirname, 'out/share-analytics'), emptyOutDir: true, minify: true,
    rollupOptions: { output: { banner: `/*! @noble/hashes\n${readFileSync(resolve(__dirname, 'node_modules/@noble/hashes/LICENSE'), 'utf8')}\n*/` } },
    lib: { entry: resolve(__dirname, 'src/renderer/src/shared-chat/snapshot-analytics.ts'),
      formats: ['iife'], name: 'AgentsDockSnapshotAnalytics', fileName: () => 'snapshot-analytics.js' }
  }
})
