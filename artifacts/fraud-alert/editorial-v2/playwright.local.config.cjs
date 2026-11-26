const { defineConfig, devices } = require('@playwright/test')
const path = require('node:path')

module.exports = defineConfig({
  testDir: path.resolve(__dirname, '../../../tests/e2e'),
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3002', ...devices['Desktop Chrome'] },
  reporter: 'line',
  workers: 2,
})
