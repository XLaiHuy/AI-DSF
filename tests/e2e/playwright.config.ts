import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${process.env.WEB_PORT ?? '3000'}`
const phaseTwoApiPort = process.env.PLAYWRIGHT_PHASE_TWO_API_PORT ?? '4401'

export default defineConfig({
  testDir: '.',
  use: { baseURL, ...devices['Desktop Chrome'] },
  webServer: [
    {
      command: 'pnpm -C ../.. --filter api exec nest start',
      url: `http://127.0.0.1:${phaseTwoApiPort}/api/v1/health`,
      env: { API_PORT: phaseTwoApiPort, AI_PROVIDER_CHAIN: '' },
      timeout: 120_000,
      reuseExistingServer: process.env.PLAYWRIGHT_REUSE_EXISTING === '1',
    },
    {
      command: 'node mock-api.mjs',
      url: 'http://127.0.0.1:4400/api/v1/health',
      env: { PLAYWRIGHT_PHASE_TWO_API_PORT: phaseTwoApiPort },
      reuseExistingServer: process.env.PLAYWRIGHT_REUSE_EXISTING === '1',
    },
    {
      command: 'pnpm -C ../.. --filter web build && pnpm -C ../.. --filter web start',
      url: baseURL,
      timeout: 180_000,
      reuseExistingServer: process.env.PLAYWRIGHT_REUSE_EXISTING === '1',
      env: { API_PORT: '4400' },
    },
  ],
})
