import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Dexie round-trip tests need an IndexedDB implementation in Node.
    setupFiles: ['src/test/setup.ts'],
  },
})
