import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { APP_GUARD, NestFactory, Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiExceptionFilter } from './api-exception.filter'
import { authCookie } from './guest-session.guard'
import { registerHttpSecurity } from './http-security'
import type { PrismaService } from './prisma.service'
import { RateLimitGuard } from './rate-limit.guard'
import { RedisService } from './redis.service'
import { AiGatewayService } from '../modules/ai-gateway/ai-gateway.service'
import { ForensicController } from '../modules/forensic/forensic.controller'
import { ForensicService } from '../modules/forensic/forensic.service'
import { OAuthService } from '../modules/profile-auth/oauth.service'
import { ProfileAuthController, PublicAvatarController } from '../modules/profile-auth/profile-auth.controller'
import { ProfileAuthService } from '../modules/profile-auth/profile-auth.service'
import { ProfileCopilotController } from '../modules/profile-auth/profile-copilot.controller'

const origin = 'http://localhost:3000'
const userId = randomUUID()
const ownerId = randomUUID()
const auditId = randomUUID()
const signingSecret = 'local-test-signing-secret'

describe('security boundaries', () => {
  let app: NestFastifyApplication | undefined
  afterEach(async () => { await app?.close() })

  async function setup() {
    const config = new ConfigService()
    vi.spyOn(config, 'get').mockReturnValue(undefined)
    const jwt = new JwtService({ secret: signingSecret })
    const update = vi.fn()
    const findFirst = vi.fn(({ where }) => where.userId === ownerId ? { id: auditId } : null)
    const createFeedback = vi.fn()
    const image = Buffer.from('RIFFtestWEBP')
    const prisma = {
      user: { update, findUnique: vi.fn().mockResolvedValue({ avatarData: image.toString('base64') }) },
      forensicAudit: { findFirst },
      $transaction: (operation: (tx: unknown) => unknown) => operation({
        $queryRaw: vi.fn(), forensicAudit: { findFirst }, threatFeedbackExample: { create: createFeedback },
      }),
    } as unknown as PrismaService
    const generateStructured = vi.fn().mockResolvedValue({
      summary: 'Mức availableForNewEmiVnd có trong hồ sơ.',
      actions: ['Giữ quỹ dự phòng.', 'Đối chiếu khoản trả góp.', 'Xem lại mục tiêu.'],
    })
    const ai = { generateStructured } as unknown as AiGatewayService
    Reflect.defineMetadata('design:paramtypes', [ForensicService], ForensicController)
    Reflect.defineMetadata('design:paramtypes', [ProfileAuthService, OAuthService, JwtService], ProfileAuthController)
    Reflect.defineMetadata('design:paramtypes', [ProfileAuthService], PublicAvatarController)
    Reflect.defineMetadata('design:paramtypes', [AiGatewayService], ProfileCopilotController)
    @Module({
      controllers: [ForensicController, ProfileAuthController, PublicAvatarController, ProfileCopilotController],
      providers: [
        { provide: ForensicService, useValue: new ForensicService(prisma, ai, config) },
        { provide: ProfileAuthService, useValue: new ProfileAuthService(prisma) },
        { provide: OAuthService, useValue: new OAuthService(config) },
        { provide: AiGatewayService, useValue: ai },
        { provide: JwtService, useValue: jwt },
        { provide: RedisService, useValue: new RedisService(config) },
        { provide: APP_GUARD, inject: [RedisService, Reflector], useFactory: (redis: RedisService, reflector: Reflector) => new RateLimitGuard(redis, reflector) },
      ],
    })
    class TestModule {}
    app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter(), { logger: false, abortOnError: false })
    await app.register(cookie, { secret: signingSecret })
    await app.register(multipart)
    app.setGlobalPrefix('api/v1')
    app.useGlobalFilters(new ApiExceptionFilter())
    const server: FastifyInstance = app.getHttpAdapter().getInstance()
    registerHttpSecurity(server, new Set([origin]))
    await app.init()
    await server.ready()
    const signedAuth = server.signCookie(await jwt.signAsync({}, { subject: userId, algorithm: 'HS256' }))
    return { server, signedAuth, update, findFirst, createFeedback, generateStructured }
  }

  it.each([
    { paths: ['auth/login'], limit: 10, seconds: 900 },
    { paths: ['auth/register'], limit: 5, seconds: 3600 },
    { paths: ['forensic/audit', 'forensic/audit/stream'], limit: 20, seconds: 600 },
    { paths: ['profile/avatar'], limit: 10, seconds: 900 },
  ])('returns 429 with bounded Retry-After on $paths', async ({ paths, limit, seconds }) => {
    const { server } = await setup()
    const post = (index: number) => server.inject({ method: 'POST', url: '/api/v1/' + paths[index % paths.length], payload: {} })
    for (let index = 0; index < limit; index++) expect((await post(index)).statusCode).toBeLessThan(429)
    const blocked = await post(limit)
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json()).toMatchObject({ errorCode: 'ERR_RATE_LIMITED' })
    const retry = Number(blocked.headers['retry-after'])
    expect(retry).toBeGreaterThan(0)
    expect(retry).toBeLessThanOrEqual(seconds)
  })

  it('rejects a different Origin with 403 and returns API security headers', async () => {
    const { server } = await setup()
    const response = await server.inject({
      method: 'POST', url: '/api/v1/auth/login', headers: { origin: 'https://other.example.test' }, payload: {},
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ errorCode: 'ERR_FORBIDDEN' })
    expect(response.headers).toMatchObject({
      'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    })
  })

  it('scopes report read and feedback to the session owner and has no report delete route', async () => {
    const { server, signedAuth, findFirst, createFeedback } = await setup()
    const url = '/api/v1/forensic/audits/' + auditId
    const cookies = { [authCookie]: signedAuth }
    expect((await server.inject({ method: 'GET', url, cookies })).statusCode).toBe(404)
    expect((await server.inject({ method: 'DELETE', url, cookies })).statusCode).toBe(404)
    expect((await server.inject({ method: 'POST', url: url + '/feedback', cookies, payload: { assessment: 'ACCURATE' } })).statusCode).toBe(404)
    expect(findFirst).toHaveBeenCalledTimes(2)
    for (const [query] of findFirst.mock.calls) expect(query.where).toEqual({ id: auditId, userId })
    expect(createFeedback).not.toHaveBeenCalled()
  })

  it('rejects an invalid avatar and serves the processed image with same-site, private caching', async () => {
    const { server, signedAuth, update } = await setup()
    const form = new FormData()
    form.set('avatar', new Blob(['ordinary text'], { type: 'image/png' }), 'test.png')
    const request = new Request('https://local.example.test', { method: 'POST', body: form })
    const upload = await server.inject({
      method: 'POST', url: '/api/v1/profile/avatar', cookies: { [authCookie]: signedAuth },
      headers: { 'content-type': request.headers.get('content-type') ?? '' }, payload: Buffer.from(await request.arrayBuffer()),
    })
    expect(upload.statusCode).toBe(400)
    expect(update).not.toHaveBeenCalled()
    const image = await server.inject('/api/v1/profile/avatar/' + userId)
    expect(image.statusCode).toBe(200)
    expect(image.headers).toMatchObject({
      'cache-control': 'private, max-age=86400', 'cross-origin-resource-policy': 'same-site',
      'content-type': 'image/webp', 'x-content-type-options': 'nosniff',
    })
  })

  it('uses grounded Vietnamese fallback when a coach response exposes an internal identifier', async () => {
    const { server, generateStructured } = await setup()
    const response = await server.inject({
      method: 'POST', url: '/api/v1/profile/coach', payload: {
        monthlyIncomeVnd: '18000000', monthlyExpenseVnd: '8000000', existingDebtPaymentVnd: '2000000',
        liquidSavingsVnd: '67000000', primaryGoal: 'BORROW_SAFE', riskAppetite: 'CONSERVATIVE',
      },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ source: 'DETERMINISTIC', summary: expect.stringContaining('6,7 tháng') })
    expect(response.body).not.toContain('availableForNewEmiVnd')
    expect(response.body).toContain('Mức trả góp thêm an toàn tối đa là')
    expect(generateStructured).toHaveBeenCalledOnce()
  })
})
