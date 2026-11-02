import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared'), '@': resolve(import.meta.dirname, 'src/renderer/src') } },
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'], testTimeout: 120_000 },
})
