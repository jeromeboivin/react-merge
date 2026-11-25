import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    environment: 'node',
    setupFiles: ['src/__tests__/setup.ts'],
    restoreMocks: true,
    testTimeout: process.env.CI ? 30_000 : 5_000
  }
})
