import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import type { NextConfig } from 'next'

const envPath = resolve(__dirname, '../../.env')
if (existsSync(envPath)) loadEnvFile(envPath)

const config: NextConfig = {
  devIndicators: false,
  async rewrites() {
    return [{
      source: '/api/v1/:path*',
      destination: `http://localhost:${process.env.API_PORT ?? '4000'}/api/v1/:path*`,
    }]
  },
}

export default config
