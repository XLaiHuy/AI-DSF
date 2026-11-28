import 'reflect-metadata'
import cookie from '@fastify/cookie'
import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { guestCookie } from '../../common/guest-session.guard'
import { PrismaService } from '../../common/prisma.service'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ForensicController } from './forensic.controller'
import { ForensicService } from './forensic.service'
import { SurveyCalcService } from '../survey-calc/survey-calc.service'
import { CopilotToolsService } from './copilot-tools.service'
import { ForensicFollowUpResponseSchema } from '@fincopilot/shared-types'
import type { FastifyInstance } from 'fastify'
import type { ForensicAuditResponse, ForensicChatTurn, ForensicGuidance, SessionContext } from '@fincopilot/shared-types'

const session = { kind: 'guest', guestSessionId: '6efaf59b-554d-4bd8-80e9-c864ad513ceb' } satisfies SessionContext
const auditId = 'ce4bfd2d-9104-4ff1-81a9-38297261f01a'
const audit: ForensicAuditResponse = {
  auditId, verdictLevel: 'HIGH_RISK', riskScore: 95, deterministicOverride: true,
  claimedEntityName: null, mathBreakdown: null, qrPayloads: [], findings: [],
  privacyProof: { sourceFilesPurgedAt: new Date().toISOString(), rawTextMasked: null },
  aiNarrative: '', immediateActions: [], handoffPayload: null, meta: { llmProvider: null, degradedMode: false },
}

describe('Forensic SSE route', () => {
  let app: NestFastifyApplication | undefined
  afterEach(async () => { await app?.close() })

  async function setup(owned: boolean, chunks: string[], report = audit, planning?: Omit<ForensicGuidance, 'type'>, provider?: string) {
    const config = new ConfigService()
    const prisma = new PrismaService()
    const databaseRead = vi.spyOn(prisma.forensicAudit, 'findFirst').mockResolvedValue(null)
    const ai = new AiGatewayService(config)
    const stream = vi.spyOn(ai, 'streamWithProvider').mockImplementation(async function* () {
      for (const delta of chunks) yield { delta, provider: 'openai' as const }
    })
    const planAndExecute = vi.fn<CopilotToolsService['planAndExecute']>(async (_input, options) => {
      if (provider) options?.onProvider?.(provider)
      return planning
    })
    const tools = planning ? new CopilotToolsService(new SurveyCalcService(prisma, ai), prisma) : undefined
    if (tools) vi.spyOn(tools, 'planAndExecute').mockImplementation(planAndExecute)
    const service = new ForensicService(prisma, ai, config, undefined, undefined, undefined, tools)
    vi.spyOn(prisma.financialProfile, 'findFirst').mockResolvedValue(null)
    if (owned) vi.spyOn(service, 'read').mockResolvedValue(report)
    // Vitest's TS transform does not emit metadata for implicit constructor injection.
    Reflect.defineMetadata('design:paramtypes', [ForensicService], ForensicController)
    @Module({ controllers: [ForensicController], providers: [
      { provide: ForensicService, useValue: service },
      { provide: JwtService, useValue: new JwtService({ secret: 'test-signing-secret' }) },
    ] })
    class TestModule {}
    app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter(), { logger: false, abortOnError: false })
    await app.register(cookie, { secret: 'test-signing-secret' })
    app.setGlobalPrefix('api/v1')
    await app.init()
    const server: FastifyInstance = app.getHttpAdapter().getInstance()
    await server.ready()
    const inject = (question: string, json = false, history?: ForensicChatTurn[]) => server.inject({
      method: 'POST', url: `/api/v1/forensic/audits/${auditId}/chat${json ? '' : '/stream'}`, payload: { question, history },
      cookies: { [guestCookie]: server.signCookie(session.guestSessionId) },
    })
    return { inject, databaseRead, stream, prisma, ai, planAndExecute }
  }

  function frames(body: string): unknown[] {
    const lines = body.trimEnd().split('\n\n')
    expect(lines.every((line) => line.startsWith('data: '))).toBe(true)
    return lines.map((line) => JSON.parse(line.slice(6)) as unknown)
  }

  const loanPlanning = {
    intent: 'FINANCIAL_EDUCATION', message: 'Mình đã đối chiếu các gói có kỳ hạn phù hợp.',
    toolTrace: [{ tool: 'LOAN_SURVEY', label: 'Kho ngân hàng NHNN', status: 'done', durationMs: 3, summary: 'Đã đối chiếu khoản vay.' }],
    richCard: { kind: 'LOAN_PLAN', principalVnd: '100000000', termMonths: 36, categoryLabel: 'Vay tín chấp', profileUsed: true,
      dtiPct: '20.08', dtiRiskBand: 'SAFE', disposableCashflowVnd: '6384760',
      topOffers: [{ institutionName: 'VPBank', productName: 'Vay tiêu dùng', monthlyPaymentFirstVnd: '3615240',
        effectiveAprPct: '18', totalInterestAndFeesVnd: '30148120', trustScore: 78 }],
      openSurveyHref: '/survey?mode=loan&amount=100000000&term=36' },
    cta: { label: 'Xem bảng trả nợ', href: '/survey?mode=loan&amount=100000000&term=36' },
  } satisfies Omit<ForensicGuidance, 'type'>
  const priorWarning: ForensicChatTurn[] = [
    { role: 'user', content: 'Vì sao nguy hiểm?' },
    { role: 'assistant', content: 'Mức nguy hiểm cao (95/100). Dừng giao dịch và xác minh lại.' },
  ]

  it.each([
    ['Lương 18 triệu, chi 8 triệu, muốn vay 100 triệu trong 36 tháng có ổn không?', 'LOAN', undefined],
    ['Vay 100 triệu ở VPBank trong 36 tháng mỗi tháng trả bao nhiêu?', 'LOAN', 'openai'],
    ['Muốn có 300 triệu sau 3 năm cần góp bao nhiêu?', undefined, undefined],
    ['Đầu tư 20 triệu, góp thêm 3 triệu/tháng trong 24 tháng được bao nhiêu?', 'INVEST', undefined],
    ['Mình muốn gửi tiết kiệm 50 triệu trong 24 tháng ở ngân hàng BIDV', 'SAVINGS', undefined],
    ['Có nên chuyển khoản vay? Dư nợ 100 triệu, còn 24 tháng, lãi hiện tại 18%.', undefined, undefined],
    ['Gần đây có thủ đoạn lừa đảo và lãi suất ngân hàng nào đáng chú ý?', undefined, undefined],
  ])('returns planning data on JSON and SSE without regrading an audit for %s', async (question, domain, provider) => {
    const { inject, stream, planAndExecute, ai, prisma } = await setup(true, [], audit, loanPlanning, provider)
    const normalModel = vi.spyOn(ai, 'generateWithProvider')
    const response = await inject(question, true, priorWarning)
    expect(response.statusCode).toBe(200)
    const json = ForensicFollowUpResponseSchema.parse(response.json())
    expect(json).toEqual({ answer: loanPlanning.message, meta: { llmProvider: provider ?? null, degradedMode: false, intent: 'FINANCIAL_EDUCATION' },
      richCard: loanPlanning.richCard, toolTrace: loanPlanning.toolTrace, cta: loanPlanning.cta })
    const sse = await inject(question, false, priorWarning)
    expect(sse.statusCode).toBe(200)
    const { answer, ...details } = json
    expect(frames(sse.body)).toEqual([{ delta: answer }, { done: true, ...details }])
    expect(planAndExecute).toHaveBeenCalledTimes(2)
    for (const [input] of planAndExecute.mock.calls) {
      expect(input).toMatchObject({ rawText: question, slots: {}, session })
      expect(input.domain).toBe(domain)
    }
    expect(prisma.financialProfile.findFirst).not.toHaveBeenCalled()
    expect(stream).not.toHaveBeenCalled()
    expect(normalModel).not.toHaveBeenCalled()
  })

  it.each([
    'Bên kia vừa đòi chuyển thêm 5 triệu phí giải ngân',
    'Họ đòi chuyển 100 triệu vào tài khoản cá nhân để mở khóa',
    'Mình muốn vay 100 triệu trong 36 tháng, nhưng họ vừa đòi chuyển thêm 5 triệu phí giải ngân.',
    'Vay 100 triệu ở VPBank trong 36 tháng, nhân viên đòi đóng phí giải ngân 2 triệu.',
    'Muốn có 300 triệu sau 3 năm cần góp bao nhiêu? Bên kia yêu cầu gửi OTP.',
    'Muốn vay 100 triệu trong 36 tháng, vừa yêu cầu cài app để xác minh.',
    'Đầu tư 20 triệu trong 24 tháng. Bên cho vay bắt nộp tiền mở khóa.',
    'Muốn vay 100 triệu trong 36 tháng, gửi vào tài khoản cá nhân như họ dặn.',
  ])('keeps mixed planning and new risk in re-audit on both endpoints for %s', async question => {
    const { inject, planAndExecute, ai } = await setup(true, ['Hãy giữ lại biên lai.'], audit, loanPlanning)
    vi.spyOn(ai, 'generateWithProvider').mockResolvedValue({ provider: 'openai', output: { narrative: 'Hãy giữ lại biên lai.', immediateActions: [] } })
    const json = ForensicFollowUpResponseSchema.parse((await inject(question, true, priorWarning)).json())
    const sse = frames((await inject(question, false, priorWarning)).body)
    expect(json.meta).toMatchObject({ intent: 'NEW_CONTEXT', suggestReaudit: true })
    expect(sse.at(-1)).toMatchObject({ done: true, meta: { intent: 'NEW_CONTEXT', suggestReaudit: true } })
    expect(json.richCard).toBeUndefined()
    expect(json.answer).toContain('95/100')
    expect(planAndExecute).not.toHaveBeenCalled()
  })

  it('omits the repeated anchor but still blocks reassurance with prior assistant history', async () => {
    const risky = 'Giao dịch này an toàn, bạn có thể chuyển tiền ngay.'
    const { inject, ai, planAndExecute } = await setup(true, [risky], audit, loanPlanning)
    vi.spyOn(ai, 'generateWithProvider').mockResolvedValue({ provider: 'openai', output: { narrative: risky, immediateActions: [] } })
    for (const json of [false, true]) {
      const repeated = await inject('Vì sao báo cáo nói vậy?', json, priorWarning)
      const text = json ? ForensicFollowUpResponseSchema.parse(repeated.json()).answer
        : (frames(repeated.body) as Array<{ delta?: string }>).map(frame => frame.delta ?? '').join('')
      expect(text).not.toMatch(/95\/100|giao dịch này an toàn|chuyển tiền ngay/i)
      expect(text).toContain('gọi tổng đài')
      const userQuote = await inject('Vì sao báo cáo nói vậy?', json, [{ ...priorWarning[1], role: 'user' }])
      expect(userQuote.body).toContain('95/100')
    }
    expect(planAndExecute).not.toHaveBeenCalled()
  })

  it('does not run planning for an audit outside the session owner', async () => {
    const { inject, planAndExecute } = await setup(false, [], audit, loanPlanning)
    for (const json of [false, true]) {
      expect((await inject('Vay 100 triệu ở VPBank trong 36 tháng trả bao nhiêu?', json)).statusCode).toBe(404)
    }
    expect(planAndExecute).not.toHaveBeenCalled()
  })

  it.each([['giải tôi pt bậc 2', 'OFF_TOPIC'], ['ok', 'ACK']])('routes %s without calling AI on either endpoint', async (question, intent) => {
    const { inject, stream, ai } = await setup(true, [], { ...audit, verdictLevel: 'SAFE', riskScore: 0 })
    const generate = vi.spyOn(ai, 'generateWithProvider')
    const sse = await inject(question)
    const json = (await inject(question, true)).json()
    expect(frames(sse.body).at(-1)).toEqual({ done: true, meta: { llmProvider: null, degradedMode: false, intent } })
    expect(json.meta).toEqual({ llmProvider: null, degradedMode: false, intent })
    expect(sse.body + json.answer).not.toContain('0/100')
    expect(stream).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
  }, 15_000)

  it('rechecks a large transfer against the owner profile and screens both model responses', async () => {
    const { inject, stream, prisma, ai } = await setup(true, ['Giao dịch hiện được đánh giá an toàn, không phát hiện rủi ro.'],
      { ...audit, verdictLevel: 'SAFE', riskScore: 0 })
    const decimal = (value: string) => ({ toFixed: () => value })
    const profile = vi.spyOn(prisma.financialProfile, 'findFirst').mockImplementation(() => Promise.resolve({
      monthlyIncomeVnd: decimal('10000000'), monthlyExpenseVnd: decimal('4000000'),
      existingDebtPaymentVnd: decimal('0'), liquidSavingsVnd: decimal('50000000'),
    }) as unknown as ReturnType<typeof prisma.financialProfile.findFirst>)
    vi.spyOn(ai, 'generateWithProvider').mockResolvedValue({
      provider: 'openai', output: { narrative: 'Giao dịch an toàn và không có rủi ro.', immediateActions: [] },
    })
    const question = 'chuyển khoản 500tr, nội dung CBM 2026'
    const events = frames((await inject(question)).body) as Array<{ delta?: string }>
    const json = (await inject(question, true)).json()
    const meta = { intent: 'NEW_CONTEXT', suggestReaudit: true, reAuditAppendText: question }
    expect(events.at(-1)).toMatchObject({ done: true, meta })
    expect(json.meta).toMatchObject(meta)
    for (const text of [events.map(({ delta }) => delta ?? '').join(''), json.answer]) {
      expect(text).toContain('500 000 000 đ')
      expect(text).toContain('CBM 2026')
      expect(text).not.toMatch(/0\/100|an toàn|không (?:có|phát hiện) rủi ro/u)
    }
    expect(stream.mock.calls[0]?.[1].text).toContain('OVER_CAPACITY')
    expect(profile).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: null, guestSessionId: session.guestSessionId } }))
  }, 15_000)

  it('keeps cautious non-directive guidance on NEW_CONTEXT without tripping degradedMode', async () => {
    const { inject, prisma } = await setup(true, [
      'Trước khi chuyển khoản 500 triệu, hãy xác minh người nhận qua kênh chính thức. ',
      'Nếu đã chuyển tiền, hãy gọi tổng đài ngân hàng. ',
      'Khoản chuyển khoản này vượt mức an toàn tài chính của bạn.',
    ], { ...audit, verdictLevel: 'SAFE', riskScore: 0 })
    vi.spyOn(prisma.financialProfile, 'findFirst').mockResolvedValue(null)
    const events = frames((await inject('chuyển khoản 500tr, nội dung CBM 2026')).body) as Array<{ delta?: string }>
    const message = events.map(({ delta }) => delta ?? '').join('')
    expect(message).toContain('Trước khi chuyển khoản 500 triệu')
    expect(message).toContain('vượt mức an toàn tài chính')
    expect(events.at(-1)).toEqual({ done: true, meta: expect.objectContaining({
      llmProvider: 'openai', degradedMode: false, intent: 'NEW_CONTEXT', suggestReaudit: true,
    }) })
  }, 15_000)

  it('blocks invented rates and money on both follow-up endpoints', async () => {
    const grounded = 'Khoản vay ghi 100 triệu đồng với lãi 12%/năm.'
    const ungrounded = 'Lãi vay chắc chắn là 37% và còn phải trả 91 triệu đồng.'
    const { inject, ai } = await setup(true, [grounded + ' ', ungrounded], {
      ...audit, privacyProof: { ...audit.privacyProof, rawTextMasked: grounded },
    })
    vi.spyOn(ai, 'generateWithProvider').mockResolvedValue({
      provider: 'openai', output: { narrative: ungrounded, immediateActions: [] },
    })
    const response = await inject('Giải thích lãi suất giúp tôi.')
    expect(response.body).toContain('12%/năm')
    expect(response.body).not.toMatch(/37%|91 triệu/)
    expect((await inject('Giải thích lãi suất giúp tôi.', true)).json().answer).not.toMatch(/37%|91 triệu/)
  })

  it('returns 404 before SSE headers or model calls for another owner', async () => {
    const { inject, databaseRead, stream } = await setup(false, [])
    const response = await inject('Tôi nên làm gì?')
    expect(response.statusCode).toBe(404)
    expect(response.headers['content-type']).not.toContain('text/event-stream')
    expect(databaseRead).toHaveBeenCalledWith(expect.objectContaining({ where: { id: auditId, userId: null, guestSessionId: session.guestSessionId } }))
    expect(stream).not.toHaveBeenCalled()
  }, 15_000)

  it('validates the body and sends exact SSE frames while suppressing raw PII and contradictory text', async () => {
    const { inject, stream } = await setup(true, [
      'Hãy lưu biên lai và ghi lại số 09012', '34567. Giao dịch này an ',
      'toàn, cứ chuyển tiền đi. Mã này đáng tin, bạn có thể quét ',
      'ngay để hoàn tất. Hãy gọi tổng đài chính thức.',
    ])
    const invalid = await inject(' ')
    expect(invalid.statusCode).toBe(400)
    expect(stream).not.toHaveBeenCalled()

    const response = await inject('Tôi gửi rồi. Số điện thoại 0901234567.')
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    expect(response.headers['cache-control']).toBe('no-cache, no-transform')
    const events = frames(response.body) as Array<{ delta?: string }>
    expect(events.at(0)).toEqual({ delta: expect.stringContaining('95/100') })
    expect(events.at(-1)).toEqual({ done: true, meta: { llmProvider: 'openai', degradedMode: true, intent: 'FINANCIAL_QA' } })
    expect(events.slice(1, -1).every(({ delta }) => delta && delta.trim().split(/\s+/).length <= 4)).toBe(true)
    const message = events.map(({ delta }) => delta ?? '').join('')
    expect(message).toContain('Hãy lưu biên lai')
    expect(message).toContain('Hãy gọi tổng đài chính thức.')
    expect(message).not.toContain('an toàn, cứ chuyển tiền')
    expect(message).not.toContain('đáng tin, bạn có thể quét')
    expect(stream.mock.calls[0]?.[1].text).not.toContain('0901234567')
    expect(message).not.toContain('0901234567')
  })

  it('keeps a natural provider reply intact across frames', async () => {
    const { inject } = await setup(true, ['Hãy lưu biên ', 'lai. Liên hệ tổng đài chính thức.'])
    const events = frames((await inject('Tôi nên làm gì?')).body) as Array<{ delta?: string }>
    expect(events.slice(1, -1).map(({ delta }) => delta).join('')).toBe('Hãy lưu biên lai. Liên hệ tổng đài chính thức.')
    expect(events.at(-1)).toEqual({ done: true, meta: { llmProvider: 'openai', degradedMode: false, intent: 'FINANCIAL_QA' } })
  })

  it('keeps explicit warnings and coordinated actions in a high-risk reply', async () => {
    const { inject } = await setup(true, [
      'Bạn không nên đóng phí giải ', 'ngân hay chuyển tiền. Giao dịch này không ',
      'an toàn, đừng chia sẻ mã OTP. Tránh bấm vào link. Ngừng cài app. Tuyệt đối không mở liên kết.',
    ])
    const events = frames((await inject('Mình có nên đóng phí giải ngân không?')).body) as Array<{ delta?: string }>
    expect(events.slice(1, -1).map(({ delta }) => delta).join('')).toBe(
      'Bạn không nên đóng phí giải ngân hay chuyển tiền. Giao dịch này không an toàn, đừng chia sẻ mã OTP. Tránh bấm vào link. Ngừng cài app. Tuyệt đối không mở liên kết.',
    )
    expect(events.at(-1)).toEqual({ done: true, meta: { llmProvider: 'openai', degradedMode: false, intent: 'FINANCIAL_QA' } })
  })

  it('does not carry a negation across a new instruction or allow a double negation', async () => {
    const { inject } = await setup(true, [
      'Không đóng phí, cứ chuyển tiền đi. Đừng đóng phí hãy chuyển tiền đi. ',
      'Không được ngừng chuyển tiền. Không phải là không an toàn. Mã này không có rủi ro. ',
      'Đừng, chia sẻ mã OTP. Dùng thanh toán ngay. Cứ chuyển—tiền nhé. Hãy lưu biên lai.',
    ])
    const events = frames((await inject('Mình có nên tiếp tục không?')).body) as Array<{ delta?: string }>
    const message = events.slice(1, -1).map(({ delta }) => delta).join('')
    expect(message).toContain('Hãy lưu biên lai.')
    expect(message).not.toMatch(/đóng phí|ngừng chuyển tiền|không an toàn|không có rủi ro|chia sẻ mã OTP|thanh toán ngay|chuyển—tiền/)
    expect(events.at(-1)).toEqual({ done: true, meta: { llmProvider: 'openai', degradedMode: true, intent: 'FINANCIAL_QA' } })
  })

  it('streams the deterministic fallback when the provider emits no approved guidance', async () => {
    const { inject } = await setup(true, ['Cứ chuyển tiền đi.'])
    const response = await inject('Có nên chuyển không?')
    const events = frames(response.body) as Array<{ delta?: string }>
    expect(events.at(0)).toEqual({ delta: expect.stringContaining('Dừng chuyển tiền') })
    expect(events.slice(1, -1).map(({ delta }) => delta).join('')).toContain('hãy dừng lại')
    expect(events.at(-1)).toEqual({ done: true, meta: { llmProvider: null, degradedMode: true, intent: 'FINANCIAL_QA' } })
  })
})
