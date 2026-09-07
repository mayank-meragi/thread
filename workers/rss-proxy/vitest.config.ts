import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['workers/rss-proxy/test/**/*.test.ts'],
  },
})
