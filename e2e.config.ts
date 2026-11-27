import { web } from '@e2e-dev/web'
import { defineConfig } from 'e2e'

export default defineConfig({
  tests: 'tests/ai-e2e/**/*.e2e.ts',
  output: 'test-results/ai-e2e',
  cache: 'read-only',
  workers: 1,
  targets: [{
    engine: web({ browser: 'chromium', viewport: { width: 1280, height: 800 } }),
    app: {
      url: 'http://127.0.0.1:0',
      command: {
        executable: process.execPath,
        args: ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '{port}'],
        cwd: 'apps/web',
      },
    },
  }],
})
