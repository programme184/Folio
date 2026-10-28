import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Separate web entry: the Electron main/preload and desktop startup are never executed.
export default defineConfig({
  esbuild: { legalComments: 'inline' },
  root: resolve(__dirname, 'src/renderer'),
  base: '/interactive-chat/',
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src'), '@shared': resolve(__dirname, 'src/shared') } },
  build: { outDir: resolve(__dirname, 'out/shared-chat'), emptyOutDir: true, sourcemap: false,
    rollupOptions: { input: resolve(__dirname, 'src/renderer/shared-chat.html'),
      output: { banner: `/*! @noble/hashes\n${readFileSync(resolve(__dirname, 'node_modules/@noble/hashes/LICENSE'), 'utf8')}\n*/` } } }
})
