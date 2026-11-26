import 'reflect-metadata'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import { ForensicAuditStreamEventSchema, type SessionContext } from '@fincopilot/shared-types'
import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiExceptionFilter } from '../../common/api-exception.filter'
import { guestCookie } from '../../common/guest-session.guard'
import { PrismaService } from '../../common/prisma.service'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { ForensicController } from './forensic.controller'
import { ForensicService } from './forensic.service'

const session = { kind: 'guest', guestSessionId: '6efaf59b-554d-4bd8-80e9-c864ad513ceb' } satisfies SessionContext
const boundary = 'forensic-test-boundary'
const signingSecret = 'test-signing-secret'

function upload(buffer: Buffer, field = 'files', count = 1) {
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="rawText"\r\n\r\nMình xem lại hóa đơn tiền ăn.\r\n`),
      ...Array.from({ length: count }, () => [
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`),
        buffer, Buffer.from('\r\n'),
      ]).flat(),
      Buffer.from(`--${boundary}--\r\n`),
    ]),
  }
}

function events(body: string) {
  return body.trimEnd().split('\n\n').map((frame) => {
    expect(frame).toMatch(/^data: /)
    return ForensicAuditStreamEventSchema.parse(JSON.parse(frame.slice(6)))
  })
}

describe('audit stream route', () => {
  let app: NestFastifyApplication | undefined
  afterEach(async () => { await app?.close() })

  async function setup() {
    const config = new ConfigService()
    const prisma = new PrismaService()
    vi.spyOn(prisma.financialInstitution, 'findMany').mockResolvedValue([])
    vi.spyOn(prisma.threatIndicator, 'findMany').mockResolvedValue([])
    vi.spyOn(prisma.financialProfile, 'findFirst').mockResolvedValue(null)
    const create = vi.spyOn(prisma.forensicAudit, 'create').mockResolvedValue({} as Awaited<ReturnType<typeof prisma.forensicAudit.create>>)
    const ai = new AiGatewayService(config)
    const classify = vi.spyOn(ai, 'classifyForensicIntent').mockResolvedValue(null)
    const generate = vi.spyOn(ai, 'generateWithProvider').mockImplementation(async (task, schema) => {
      if (task !== 'FORENSIC_VISION_EXTRACT') throw new Error('offline')
      return { provider: 'fixture', output: schema.parse({
        claimedEntityName: null, visionBeneficiaryName: null, nominalAmountVnd: null, nominalAmountEvidenceQuote: null,
        termMonths: null, upfrontFees: [], quotedRatePct: null, rateMethod: null, redFlagPhrases: [],
        documentTranscript: null, repaymentMethod: null, repaymentMethodEvidenceQuote: null, ratePhases: null,
        recurringMonthlyFeeVnd: null, recurringFeeEvidenceQuote: null, stressTriggerCondition: null, stressMonthlyRatePct: null,
        stressEvidenceQuote: null, hasUncappedFloatingClause: false, uncappedFloatingQuote: null,
      }) }
    })
    const service = new ForensicService(prisma, ai, config)
    const audit = vi.spyOn(service, 'audit')
    Reflect.defineMetadata('design:paramtypes', [ForensicService], ForensicController)
    @Module({ controllers: [ForensicController], providers: [
      { provide: ForensicService, useValue: service },
      { provide: JwtService, useValue: new JwtService({ secret: signingSecret }) },
    ] })
    class TestModule {}
    app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter(), { logger: false, abortOnError: false })
    await app.register(cookie, { secret: signingSecret })
    await app.register(multipart, { limits: { files: 6, fileSize: 1024 }, throwFileSizeLimit: false })
    app.setGlobalPrefix('api/v1')
    app.useGlobalFilters(new ApiExceptionFilter())
    await app.init()
    const server: FastifyInstance = app.getHttpAdapter().getInstance()
    await server.ready()
    const inject = (input: ReturnType<typeof upload> | { payload: object }, path = 'audit/stream') => server.inject({
      method: 'POST', url: '/api/v1/forensic/' + path, ...input,
      cookies: { [guestCookie]: server.signCookie(session.guestSessionId) },
    })
    return { inject, audit, create, classify, generate }
  }

  it('streams real EASY stage pairs, returns the saved result, and zeroes the original upload', async () => {
    const { inject, audit, create } = await setup()
    const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#fff' } }).png().toBuffer()
    const response = await inject(upload(image))
    expect(response.statusCode).toBe(200)
    expect(response.headers).toMatchObject({
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no',
    })
    const result = events(response.body)
    expect(result.map((event) => event.type === 'stage' ? `${event.stage.step}:${event.stage.status}` : event.type)).toEqual([
      'EXTRACT:running', 'EXTRACT:done', 'RULES:running', 'RULES:done', 'NARRATIVE:running', 'NARRATIVE:done', 'result', 'done',
    ])
    expect(result[1]).toMatchObject({ stage: { detail: '1 tệp · 0 mã QR' } })
    expect(result.at(-2)).toMatchObject({ audit: { auditId: create.mock.lastCall?.[0].data.id, complexityTier: 'EASY' } })
    expect(audit.mock.lastCall?.[2][0].buffer).toEqual(Buffer.alloc(image.length))
  }, 15_000)

  it('adds REASONING when the service classifies the evidence above EASY', async () => {
    const { inject, classify } = await setup()
    classify.mockResolvedValue({ provider: 'fixture', recoveryScamProb: 0.72, biometricPhishingProb: 0, urgentCoercionProb: 0 })
    const response = await inject({ payload: { rawText: 'Mình đang xem lại hóa đơn tiền ăn.' } })
    expect(events(response.body).filter((event) => event.type === 'stage' && event.stage.step === 'REASONING'))
      .toMatchObject([{ stage: { status: 'running' } }, { stage: { status: 'done' } }])
  })

  it.each([true, false])('retries rejected narrative once and applies the same grounding guard (safe retry: %s)', async (validRetry) => {
    const { inject, generate } = await setup()
    const safe = 'Bạn nên đối chiếu hóa đơn qua kênh chính thức.'
    const ungrounded = 'Bạn đã trả 99 000 000 đ.'
    generate.mockImplementation(async (_task, schema, input) => ({
      provider: 'fixture', output: schema.parse({
        narrative: validRetry && JSON.parse(input.text).qualitativeOnly ? safe : ungrounded, immediateActions: [],
      }),
    }))
    const response = await inject({ payload: { rawText: 'Mình xem lại hóa đơn tiền ăn.' } })
    const result = events(response.body).find((event) => event.type === 'result')
    expect(generate.mock.calls.map(([task, , input]) => [task, JSON.parse(input.text).qualitativeOnly])).toEqual([
      ['FORENSIC_VERDICT_NARRATIVE', undefined], ['FORENSIC_VERDICT_NARRATIVE', true],
    ])
    expect(result).toMatchObject({ audit: { meta: { llmProvider: validRetry ? 'fixture' : null, degradedMode: !validRetry } } })
    if (validRetry) expect(result?.audit.aiNarrative).toBe(safe)
    else expect(result?.audit.aiNarrative).not.toContain(ungrounded)
  })

  it('returns standard 400 and 413 JSON before opening an SSE stream', async () => {
    const { inject, audit } = await setup()
    for (const [input, statusCode, errorCode] of [
      [{ payload: {} }, 400, 'ERR_VALIDATION_FAILED'],
      [upload(Buffer.from('test'), 'wrong-field'), 400, 'ERR_VALIDATION_FAILED'],
      [upload(Buffer.alloc(1025)), 413, 'ERR_FILE_TOO_LARGE'],
    ] as const) {
      const response = await inject(input)
      expect(response.statusCode).toBe(statusCode)
      expect(response.headers['content-type']).toContain('application/json')
      expect(response.json()).toMatchObject({ statusCode, errorCode })
    }
    expect(audit).not.toHaveBeenCalled()
  })

  it.each(['audit', 'audit/stream'])('returns standard 413 for too many files on %s', async (path) => {
    const { inject, audit, create } = await setup()
    const response = await inject(upload(Buffer.from('image contents'), 'files', 7), path)
    expect(response.statusCode).toBe(413)
    expect(response.json()).toMatchObject({ statusCode: 413, errorCode: 'ERR_FILE_TOO_LARGE' })
    expect(audit).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('emits the extraction error in-band and preserves the legacy JSON error', async () => {
    const { inject, audit, create } = await setup()
    const invalid = Buffer.from('invalid PNG contents')
    const response = await inject(upload(invalid))
    expect(response.statusCode).toBe(200)
    expect(events(response.body)).toMatchObject([
      { type: 'stage', stage: { step: 'EXTRACT', status: 'running' } },
      { type: 'error', errorCode: 'ERR_INVALID_FILE_MAGIC' },
    ])
    expect(audit.mock.lastCall?.[2][0].buffer).toEqual(Buffer.alloc(invalid.length))
    expect(create).not.toHaveBeenCalled()
    const legacy = await inject(upload(invalid), 'audit')
    expect(legacy.statusCode).toBe(400)
    expect(legacy.json()).toMatchObject({ errorCode: 'ERR_INVALID_FILE_MAGIC' })
  })
})
