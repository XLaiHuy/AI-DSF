import type { FastifyInstance } from 'fastify'

const changeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
} as const

export function registerHttpSecurity(server: FastifyInstance, allowedOrigins: ReadonlySet<string>) {
  server.addHook('onRequest', async (request, reply) => {
    const { method, headers } = request
    if (changeMethods.has(method) &&
      (headers.origin ? !allowedOrigins.has(headers.origin) : headers['sec-fetch-site'] === 'cross-site')) {
      return reply.code(403).send({
        statusCode: 403, errorCode: 'ERR_FORBIDDEN', message: 'Nguồn của yêu cầu không được phép.',
      })
    }
  })
  server.addHook('onSend', async (request, reply) => {
    if (!reply.hasHeader('cache-control') && /^\/api\/v1\/admin(?:[/?]|$)/.test(request.url)) {
      reply.header('Cache-Control', 'no-store')
    }
    for (const [key, value] of Object.entries(securityHeaders)) {
      if (!reply.hasHeader(key)) reply.header(key, value)
    }
  })
}
