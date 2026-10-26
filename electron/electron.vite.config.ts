import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

function copyFolioIcon(): Plugin {
  const source = resolve(__dirname, 'src/renderer/src/assets/folio-icon.png')
  return {
    name: 'copy-folio-icon',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'folio-icon.png', source: readFileSync(source) })
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyFolioIcon()],
    build: {
      minify: true,
      sourcemap: false,
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
        external: ['electron']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      minify: true,
      sourcemap: false,
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
        external: ['electron'],
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      minify: true,
      sourcemap: false,
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
})
