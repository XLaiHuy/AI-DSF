import 'reflect-metadata'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { z } from 'zod'
import { AppModule } from './app.module'
import { ApiExceptionFilter } from './common/api-exception.filter'

const port = z.coerce.number().int().min(1).max(65535)
const mib = 1024 * 1024

export async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())

  try {
    const config = app.get(ConfigService)
    const uploadMax = z.coerce.number().int().positive().parse(config.get('UPLOAD_MAX_MB', '20'))
    await app.register(cookie, { secret: config.getOrThrow<string>('JWT_SECRET') })
    await app.register(multipart, { limits: { files: 6, fileSize: uploadMax * mib }, throwFileSizeLimit: false })
    const webPort = port.parse(config.get('WEB_PORT', '3000'))
    const appOrigin = new URL(config.get('APP_BASE_URL') || `http://localhost:${webPort}`).origin
    const allowedOrigins = new Set([appOrigin])
    if (process.env.NODE_ENV !== 'production') {
      allowedOrigins.add(`http://localhost:${webPort}`)
      allowedOrigins.add(`http://127.0.0.1:${webPort}`)
    }
    app.enableCors({
      origin: [...allowedOrigins],
      credentials: true,
    })
    app.getHttpAdapter().getInstance().addHook('onRequest', async (request, reply) => {
      const { method, headers } = request
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) &&
        (headers.origin ? !allowedOrigins.has(headers.origin) : headers['sec-fetch-site'] === 'cross-site')) {
        return reply.code(403).send({
          statusCode: 403, errorCode: 'ERR_FORBIDDEN', message: 'Nguồn của yêu cầu không được phép.',
        })
      }
    })
    app.setGlobalPrefix('api/v1')
    app.useGlobalFilters(new ApiExceptionFilter())
    app.enableShutdownHooks()
    await app.listen(port.parse(config.get('API_PORT', '4000')), '::')
    return app
  } catch (error) {
    await app.close()
    throw error
  }
}

if (require.main === module) {
  void bootstrap().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'API startup failed')
    process.exitCode = 1
  })
}
