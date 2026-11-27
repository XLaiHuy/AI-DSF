import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import type { NextConfig } from 'next'

const envPath = resolve(__dirname, '../../.env')
if (existsSync(envPath)) loadEnvFile(envPath)

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // Next.js 15 embeds its hydration data in inline scripts.
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
  "script-src-attr 'none'",
].join('; ')

const config: NextConfig = {
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Content-Security-Policy', value: csp },
      ],
    }]
  },
  devIndicators: false,
  experimental: { optimizePackageImports: ['lucide-react'] },
  async rewrites() {
    return [{
      source: '/api/v1/:path*',
      destination: `http://localhost:${process.env.API_PORT ?? '4000'}/api/v1/:path*`,
    }]
  },
}

export default config
