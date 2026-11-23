import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${process.env.WEB_PORT ?? '3000'}`

export default defineConfig({
  testDir: '.',
  use: { baseURL, ...devices['Desktop Chrome'] },
  webServer: [
    {
      command: 'node mock-api.mjs',
      url: 'http://127.0.0.1:4400/api/v1/health',
      reuseExistingServer: process.env.PLAYWRIGHT_REUSE_EXISTING === '1',
    },
    {
      command: 'pnpm -C ../.. --filter web dev',
      url: baseURL,
      reuseExistingServer: process.env.PLAYWRIGHT_REUSE_EXISTING === '1',
      env: { API_PORT: '4400' },
    },
  ],
})
