import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${process.env.WEB_PORT ?? '3000'}`

export default defineConfig({
  testDir: '.',
  use: { baseURL, ...devices['Desktop Chrome'] },
})
