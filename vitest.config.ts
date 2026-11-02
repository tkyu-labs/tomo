import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared'), '@': resolve(import.meta.dirname, 'src/renderer/src') } },
  // files run one after another: integration tests start real Hermes gateways and a real Chrome
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'], testTimeout: 120_000, fileParallelism: false },
})
