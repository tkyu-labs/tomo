import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: resolve(import.meta.dirname, 'src/main/index.ts') } } },
    resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') },
        // sandboxed preloads must be a single CommonJS file
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
    resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    build: { rollupOptions: { input: { index: resolve(import.meta.dirname, 'src/renderer/index.html') } } },
    resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared'), '@': resolve(import.meta.dirname, 'src/renderer/src') } },
    plugins: [react(), tailwindcss()],
  },
})
