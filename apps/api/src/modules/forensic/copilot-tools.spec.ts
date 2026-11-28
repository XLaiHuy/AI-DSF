import { ForensicGuidanceSchema } from '@fincopilot/shared-types'
import { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../../common/prisma.service'
import { hasInternalIdentifierLeak } from '../../common/untrusted-text'
import type { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { SurveyCalcService } from '../survey-calc/survey-calc.service'
import { CopilotToolsService } from './copilot-tools.service'
import { routeForensicConversation } from './forensic-conversation'
import { vnScamTaxonomy } from './vn-scam-taxonomy'

const session = { kind: 'guest', guestSessionId: '11111111-1111-4111-8111-111111111111' } as const
const alertId = '22222222-2222-4222-8222-222222222222'
const decimal = (value: string) => new Prisma.Decimal(value)
const bank = {
  id: 'sample', institutionId: 'bank', institution: { name: 'Ngân hàng mẫu' }, productName: 'Gói ngân hàng',
  dataProvenance: 'CATALOG_VERIFIED', sourceUrl: 'https://example.test/survey', effectiveDate: new Date('2025-01-01'),
  rateType: 'FIXED', calcMethod: 'REDUCING_BALANCE', nominalRateMin: decimal('12'), nominalRateMax: decimal('12'),
  upfrontFeeRate: decimal('0'), monthlyFeeVnd: decimal('0'), productCategory: 'UNSECURED_LOAN',
}

function setup() {
  const publishedAt = new Date()
  const taxonomy = vnScamTaxonomy[0]
  const profile = {
    monthlyIncomeVnd: decimal('20000000'), monthlyExpenseVnd: decimal('9000000'),
    existingDebtPaymentVnd: decimal('1000000'), liquidSavingsVnd: decimal('50000000'),
  }
  const prisma = {
    financialProduct: { findMany: vi.fn().mockResolvedValue([bank]), count: vi.fn().mockResolvedValue(0) },
    financialProfile: { findUnique: vi.fn().mockResolvedValue(profile), upsert: vi.fn() },
    calculationSession: { create: vi.fn().mockResolvedValue({}) },
    forensicAudit: { create: vi.fn(), findFirst: vi.fn() },
    threatAlert: { findMany: vi.fn().mockResolvedValue([
      { id: alertId, tacticSummary: 'Tóm tắt nội bộ ratePct', vnAisCode: taxonomy.vnAisCode, publishedAt },
    ]) },
    $queryRaw: vi.fn().mockResolvedValue([{ code: taxonomy.vnAisCode, currentCount: 2, previousCount: 1,
      sampleAlertId: alertId, sampleTacticSummary: 'Cảnh báo đã xác minh' }]),
  }
  const ai = {
    generateStructured: vi.fn().mockRejectedValue(new Error('offline')),
    classifyConversationRoute: vi.fn().mockRejectedValue(new Error('offline')),
  }
  const survey = new SurveyCalcService(prisma as unknown as PrismaService, ai as unknown as AiGatewayService)
  const tools = new CopilotToolsService(survey, prisma as unknown as PrismaService)
  const voiced = new CopilotToolsService(survey, prisma as unknown as PrismaService, ai as unknown as AiGatewayService)
  const route = (rawText: string) => routeForensicConversation({ rawText }, false, ai, undefined, undefined,
    args => tools.planAndExecute({ ...args, session }))
  const run = async (text: string) => {
    const result = ForensicGuidanceSchema.parse(await route(text))
    expect(hasInternalIdentifierLeak([result.message, ...(result.toolTrace ?? []).flatMap(item => [item.label, item.summary])])).toBe(false)
    expect(ai.generateStructured).not.toHaveBeenCalled()
    expect(ai.classifyConversationRoute).not.toHaveBeenCalled()
    expect(prisma.forensicAudit.create).not.toHaveBeenCalled()
    expect(prisma.forensicAudit.findFirst).not.toHaveBeenCalled()
    for (const item of result.toolTrace ?? []) expect(item.durationMs).toBeGreaterThanOrEqual(0)
    return result
  }
  return { prisma, survey, tools, voiced, route, run, ai, taxonomy, publishedAt }
}

const voicedQuestion = 'Vay 100 triệu ở VPBank trong 36 tháng trả bao nhiêu?'
const voiceInput = { rawText: voicedQuestion, session, slots: {} }
const goodVoice = { summary: 'Với khoản vay 100 triệu đồng trong 36 tháng, chi phí vay mỗi năm là 12%.',
  tradeoffs: ['Bạn nên so tổng lãi và phí trước khi chọn kỳ hạn.'] }

describe('Verified Copilot tools', () => {
  it.each([
    ['Vay 100 triệu ở VPBank trong 36 tháng trả bao nhiêu?', ['VPB']],
    ['VAY 100 TRIEU TAI VP BANK TRONG 36 THANG TRA BAO NHIEU', ['VPB']],
    ['Mình muốn vay 100.000.000 đ trong 36 tháng tại ngân hàng VPBank', ['VPB']],
    ['So sánh vay 100 triệu ở ACB và VPBank trong 36 tháng giúp mình', ['VPB', 'ACB']],
    ['Vay 100 triệu tại VIB kỳ hạn 36 tháng, tính thử giúp tôi', ['VIB']],
    ['Vay 100 triệu ở TPBank trong 3 năm mỗi tháng trả bao nhiêu?', ['TPB']],
    ['Vay 100 triệu tại ngân hàng trong 36 tháng có ổn không?', []],
  ])('looks up the correct licensed banks for %s', async (question, codes) => {
    const { run, prisma } = setup()
    prisma.financialProduct.findMany.mockResolvedValue([{ ...bank, institution: { name: 'VPBank' } }])
    const result = await run(question)
    expect(result.toolTrace?.at(-1)?.tool).toBe('LOAN_SURVEY')
    expect(result.richCard).toMatchObject({ kind: 'LOAN_PLAN', principalVnd: '100000000', termMonths: 36 })
    const selection = prisma.financialProduct.findMany.mock.calls[0][0].where.institution
    expect(selection).toMatchObject({ institutionType: 'BANK', trustStatus: 'LICENSED', licenseIssuer: 'NHNN' })
    expect(selection.code).toEqual(codes.length ? { in: codes } : undefined)
  })

  it.each([
    'Nhân viên VPBank gọi đòi đóng phí giải ngân 2 triệu để nhận vay 100 triệu',
    'Vay 100 triệu ở VPBank trong 36 tháng, trả trước phí 2 triệu có ổn không?',
    'Vay 100 triệu ở VPBank trong 36 tháng, họ yêu cầu trả phí xử lý hồ sơ trước?',
    'Vay 100 triệu ở VPBank trong 36 tháng, có cần đóng 2 triệu để được giải ngân không?',
    'Vay 100 triệu tại VPBank, phí trả trước 2 triệu trong kỳ hạn 36 tháng?',
    'Vay 100 triệu ở VPBank trong 36 tháng, đọc mã xác thực cho họ có sao không?',
    'Vay 100 triệu ở VPBank trong 36 tháng và phải đặt cọc 2 triệu?',
    'Vay 100 triệu ở VPBank trong 36 tháng với lãi phẳng 2%/tháng?',
    'Vay 100 triệu ở VPBank trong 36 tháng, lãi phẳng họ ghi là gì?',
    'Vay 100 triệu ở ngân hàng trong 36 tháng, mã QR họ gửi nghĩa là gì?',
    'Vay 100 triệu ở VPBank trong 36 tháng, khoản bị ép bảo hiểm là gì?',
    'Vay 100 triệu ở VPBank trong 36 tháng nhưng bị ép mua bảo hiểm?',
    'Vay 100 triệu ở VPBank trong 36 tháng, họ yêu cầu nộp thêm tiền.',
    'Vay 100 triệu ở VPBank trong 36 tháng. Mở khóa lỗi 102 thế nào?',
    'Vay 100 triệu ở VPBank trong 36 tháng, có người tự xưng nhân viên',
    'Vay 100 triệu ở VPBank trong 36 tháng, yêu cầu gửi OTP?',
    'Vay 100 triệu ở VPBank trong 36 tháng qua https://example.test',
    'Vay 100 triệu ở VPBank trong 36 tháng, mã QR ở đây',
    'Vay 100 triệu ở VPBank trong 36 tháng, chuyển vào tài khoản cá nhân',
    'Vay 100 triệu ở VPBank trong 36 tháng. Kiểm tra hợp đồng giúp tôi.',
    'Vay 100 triệu ở VPBank trong 36 tháng có phải gói giả mạo không?',
    'VPBank cho vay 100 triệu trong 36 tháng.',
    'Vay 100 triệu ở FE Credit trong 36 tháng, so với VPBank?',
  ])('keeps suspicious or unverified bank evidence out of Copilot for %s', async (question) => {
    const { prisma, route, ai } = setup()
    expect(await route(question)).toBeNull()
    expect(prisma.financialProduct.findMany).not.toHaveBeenCalled()
    expect(ai.generateStructured).not.toHaveBeenCalled()
  })

  it('accepts natural synthesis grounded in the card and keeps original tool data', async () => {
    const { ai, voiced, tools } = setup()
    ai.generateStructured.mockImplementation(async (_task, _schema, _payload, options) => {
      options.onProvider('openai')
      return goodVoice
    })
    const onProvider = vi.fn()
    const base = await tools.planAndExecute(voiceInput)
    const result = await voiced.planAndExecute(voiceInput, { onProvider })
    expect(result?.message).toBe(goodVoice.summary + ' ' + goodVoice.tradeoffs[0])
    expect(result?.richCard).toMatchObject({ kind: 'LOAN_PLAN', principalVnd: '100000000', termMonths: 36 })
    expect(result?.toolTrace?.map(item => item.tool)).toEqual(base?.toolTrace?.map(item => item.tool))
    expect(onProvider).toHaveBeenCalledExactlyOnceWith('openai')
    expect(ai.generateStructured).toHaveBeenCalledWith('SURVEY_EXPLAIN', expect.anything(), expect.objectContaining({
      question: voicedQuestion, verified: expect.not.objectContaining({ openSurveyHref: expect.anything() }),
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it.each([
    'Lãi suất chính xác là 63,5%/năm.',
    'Số tiền phải trả là 91 triệu đồng.',
    'Số tiền phải trả là 91.000.000 ₫.',
    'Chi phí là chín mươi triệu đồng.',
    'Lãi suất mỗi năm là 63,5.',
    'Kỳ hạn là 72 tháng.',
    'Mỗi kỳ phải trả 91.000.000.',
    'Khoản phí là 91 USD.',
    'Tỷ lệ là ba mươi phần trăm.',
    'Chi phí vay là một phẩy hai phần trăm.',
    'Kỳ hạn là bảy mươi hai tháng.',
    'Khoản tiền phải trả là 987,654,321.09 đồng.',
    'Kết quả có trường monthlyPaymentFirstVnd.',
    'Kết quả có mã monthly_payment_vnd.',
    'Bạn có thể chuyển tiền ngay.',
    'Bạn nên chuyển 100 triệu đồng ngay.',
    'Bạn có thể nộp ngay 100 triệu đồng.',
    'Bạn cứ cung cấp mã OTP.',
    'Ngân hàng chắc chắn sẽ duyệt khoản vay.',
    'Bạn hãy mở https://example.test để tiếp tục.',
    'Kết quả có <strong>con số mới</strong>.',
    'Bạn có thể chọn kỳ hạn. Bạn có thể chọn gói. Bạn có thể cân nhắc. Hãy kiểm tra một lần nữa.',
  ])('retains the deterministic explanation if synthesis includes %s', async (sentence) => {
    const { ai, voiced, tools } = setup()
    ai.generateStructured.mockResolvedValue({ summary: goodVoice.summary, tradeoffs: [sentence] })
    const onProvider = vi.fn()
    const expected = await tools.planAndExecute(voiceInput)
    const result = await voiced.planAndExecute(voiceInput, { onProvider })
    expect(result?.message).toBe(expected?.message)
    expect(result?.richCard).toMatchObject({ kind: 'LOAN_PLAN', topOffers: [expect.objectContaining({ effectiveAprPct: '12.0000' })] })
    expect(onProvider).not.toHaveBeenCalled()
  })

  it('keeps contact details and navigation identifiers out of the model request', async () => {
    const { ai, voiced } = setup()
    ai.generateStructured.mockResolvedValue(goodVoice)
    const result = await voiced.planAndExecute({ ...voiceInput, rawText: voicedQuestion + ' SĐT 0901234567.' })
    const request = ai.generateStructured.mock.calls[0]?.[2]
    expect(result?.richCard?.kind).toBe('LOAN_PLAN')
    expect(request).toMatchObject({ question: expect.stringContaining('090****567') })
    expect(JSON.stringify(request)).not.toMatch(/0901234567|sessionId|openSurveyHref/)
  })

  it('returns the same result when the model is offline', async () => {
    const { voiced, tools } = setup()
    expect((await voiced.planAndExecute(voiceInput))?.message).toBe((await tools.planAndExecute(voiceInput))?.message)
  })

  it('falls back at six seconds even when the model ignores abort', async () => {
    const { ai, voiced } = setup()
    vi.useFakeTimers()
    try {
      ai.generateStructured.mockImplementation(() => new Promise(() => undefined))
      const result = voiced.planAndExecute(voiceInput)
      await vi.advanceTimersByTimeAsync(0)
      const options = ai.generateStructured.mock.calls[0]?.[3]
      expect(options?.signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(6_000)
      expect(options?.signal?.aborted).toBe(true)
      expect((await result)?.richCard?.kind).toBe('LOAN_PLAN')
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the model after caller abort without discarding the verified result', async () => {
    const { ai, voiced } = setup()
    ai.generateStructured.mockImplementation(() => new Promise(() => undefined))
    const controller = new AbortController()
    const result = voiced.planAndExecute(voiceInput, { signal: controller.signal })
    await vi.waitFor(() => expect(ai.generateStructured).toHaveBeenCalled())
    controller.abort()
    expect((await result)?.richCard?.kind).toBe('LOAN_PLAN')
  })

  it('loads the profile before ranking loans and uses stated cash flow without saving raw overrides', async () => {
    const { prisma, survey, run } = setup()
    const loan = vi.spyOn(survey, 'loan')
    const result = await run('Lương 18 triệu, chi 8 triệu, muốn vay 100 triệu trong 36 tháng có ổn không?')
    expect(result.toolTrace?.map(item => [item.tool, item.status])).toEqual([['PROFILE_HEALTH', 'done'], ['LOAN_SURVEY', 'done']])
    expect(loan).toHaveBeenCalledWith(expect.objectContaining({ enableWebFallback: true, dtiOverride: {
      monthlyIncomeVnd: '18000000', monthlyExpenseVnd: '8000000', existingDebtPaymentVnd: '1000000',
    } }), session, { verifiedBanksOnly: true, deterministic: true, persistDtiOverride: false })
    expect(prisma.financialProfile.findUnique.mock.invocationCallOrder[0]).toBeLessThan(loan.mock.invocationCallOrder[0])
    expect(prisma.financialProfile.upsert).not.toHaveBeenCalled()
    expect(prisma.calculationSession.create.mock.calls[0][0].data.inputParamsJson.dtiOverride).toBeUndefined()
    expect(prisma.financialProduct.findMany.mock.calls[0][0].where).toMatchObject({
      institution: { trustStatus: 'LICENSED', licenseIssuer: 'NHNN', institutionType: 'BANK' },
      dataProvenance: { in: ['CATALOG_VERIFIED', 'WEB_REFERENCE'] },
    })
    expect(result.richCard).toMatchObject({
      kind: 'LOAN_PLAN', principalVnd: '100000000', termMonths: 36, profileUsed: true, dtiPct: expect.any(String),
      topOffers: [{ institutionName: bank.institution.name, effectiveAprPct: '12.0000', dataProvenance: 'CATALOG_VERIFIED',
        sourceLabel: 'Danh mục đã xác minh', effectiveDate: '2025-01-01', freshnessTier: 'STALE', verificationReceipt: { verified: true } }],
      openSurveyHref: expect.stringMatching(/^\/survey\?mode=loan&sessionId=/),
    })
  })

  it('reports current DTI when no verified offer matches the proposed loan', async () => {
    const { prisma, run } = setup()
    prisma.financialProduct.findMany.mockResolvedValue([])
    const result = await run('Lương 18 triệu, chi 8 triệu, muốn vay 100 triệu trong 36 tháng có ổn không?')
    expect(result.toolTrace?.map(step => step.status)).toEqual(['done', 'empty'])
    expect(result.richCard).toMatchObject({
      kind: 'LOAN_PLAN', dtiPct: '5.56', disposableCashflowVnd: '9000000', topOffers: [],
    })
  })

  it('uses the best after-fee investment in each category and keeps the monthly contribution distinct', async () => {
    const { prisma, run } = setup()
    prisma.financialProduct.findMany.mockResolvedValue([
      { ...bank, productCategory: 'SAVING', calcMethod: 'COMPOUND_DCA', productName: 'Tiết kiệm thấp', nominalRateMin: decimal('2') },
      { ...bank, productCategory: 'SAVING', calcMethod: 'COMPOUND_DCA', productName: 'Tiết kiệm cao', nominalRateMin: decimal('5') },
      { ...bank, productCategory: 'SAVING', calcMethod: 'COMPOUND_DCA', productName: 'Mức tham khảo',
        nominalRateMin: decimal('9'), dataProvenance: 'WEB_REFERENCE', effectiveDate: new Date() },
      { ...bank, productCategory: 'ACCUMULATION', calcMethod: 'COMPOUND_DCA', nominalRateMin: decimal('4') },
      { ...bank, productCategory: 'OPEN_FUND', calcMethod: 'COMPOUND_DCA', rateType: 'VARIABLE_NAV' },
    ])
    const result = await run('Đầu tư 20 triệu, góp thêm 3 triệu/tháng trong 24 tháng được bao nhiêu?')
    expect(result.toolTrace).toEqual([expect.objectContaining({ tool: 'INVESTMENT_SURVEY', status: 'done' })])
    expect(result.richCard).toMatchObject({
      kind: 'INVESTMENT_PLAN', initialVnd: '20000000', monthlyContributionVnd: '3000000', termMonths: 24,
      topOffers: [{ productName: 'Tiết kiệm cao', totalContributedVnd: '92000000' }, { categoryLabel: 'Tích lũy' }, { categoryLabel: 'Quỹ mở' }],
    })
  })

  it('distinguishes one initial savings amount from a recurring contribution', async () => {
    const { prisma, run } = setup()
    prisma.financialProduct.findMany.mockResolvedValue([
      { ...bank, productCategory: 'SAVING', calcMethod: 'COMPOUND_DCA', nominalRateMin: decimal('5') },
    ])
    const initial = await run('Tích lũy 20 triệu trong 24 tháng')
    expect(initial.richCard).toMatchObject({ kind: 'INVESTMENT_PLAN', initialVnd: '20000000', monthlyContributionVnd: '0' })
    const recurring = await run('Tích lũy 3 triệu/tháng trong 24 tháng')
    expect(recurring.richCard).toMatchObject({ kind: 'INVESTMENT_PLAN', initialVnd: '0', monthlyContributionVnd: '3000000' })
  })

  it('uses income, expenses and existing debt to calculate a safe loan at a verified rate', async () => {
    const { prisma, run } = setup()
    prisma.financialProduct.findMany.mockResolvedValue([
      { ...bank, nominalRateMin: decimal('10'), nominalRateMax: decimal('10'), effectiveDate: new Date() },
      { ...bank, nominalRateMin: decimal('14'), nominalRateMax: decimal('14'), effectiveDate: new Date() },
      { ...bank, nominalRateMin: decimal('2'), nominalRateMax: decimal('2'), dataProvenance: 'WEB_REFERENCE', effectiveDate: new Date() },
    ])
    const result = await run('Lương 18 triệu, chi 8 triệu, tôi được vay tối đa bao nhiêu trong 36 tháng để an toàn?')
    expect(result.toolTrace?.map(step => step.tool)).toEqual(['PROFILE_HEALTH', 'SAFE_LOAN_LIMIT'])
    expect(result.richCard).toMatchObject({ kind: 'SAFE_LOAN_LIMIT', termMonths: 36, safeDtiCapPct: '35',
      existingDebtPaymentVnd: '1000000', maxSafeEmiVnd: '5300000', referenceRatePct: '12',
      openSurveyHref: expect.stringMatching(/^\/survey\?mode=loan&amount=\d+&term=36$/),
    })
  })

  it('calculates a goal contribution and prefills it even when there is no rate for the term', async () => {
    const { prisma, run } = setup()
    prisma.financialProduct.findMany.mockResolvedValue([])
    const result = await run('Muốn có 300 triệu sau 3 năm, đang có 50 triệu, mỗi tháng cần góp bao nhiêu?')
    expect(result.toolTrace).toEqual([expect.objectContaining({ tool: 'GOAL_PLANNER', status: 'done', summary: expect.stringContaining('0%') })])
    expect(result.richCard).toMatchObject({ kind: 'GOAL_PLANNER', targetVnd: '300000000', initialVnd: '50000000',
      termMonths: 36, requiredMonthlyContributionVnd: '6944445', projectedNetValueVnd: '300000020',
      openSurveyHref: '/survey?mode=invest&amount=50000000&contribution=6944445&term=36',
    })
  })

  it('uses the compiled catalog snapshot when the bank lookup is offline', async () => {
    const { prisma, run } = setup()
    prisma.financialProduct.findMany.mockRejectedValue(new Error('offline'))
    const result = await run('Lương 18 triệu, chi 8 triệu, vay tối đa bao nhiêu trong 36 tháng?')
    expect(result.richCard?.kind).toBe('SAFE_LOAN_LIMIT')
    expect(result.toolTrace?.at(-1)?.summary).toContain('bản lưu ngoại tuyến')
  })

  it('simulates a refinance using the current annual rate and the stated settlement fee', async () => {
    const { run } = setup()
    const result = await run('Nên đảo nợ không? Dư nợ 100 triệu, còn 24 tháng, lãi suất hiện tại 18%/năm, phí tất toán 1%.')
    expect(result.toolTrace).toEqual([expect.objectContaining({ tool: 'REFINANCE_SIM', status: 'done' })])
    expect(result.richCard).toMatchObject({ kind: 'REFINANCE_PLAN', remainingPrincipalVnd: '100000000',
      remainingTermMonths: 24, currentAnnualRatePct: '18', totalSwitchCostVnd: '1000000', recommendation: 'WORTH_REFINANCING',
      breakEvenMonth: expect.any(Number), netSavingsVnd: expect.any(String) })
  })

  it('reads verified Radar records and computes the Decimal median of advertised intervals', async () => {
    const { prisma, run, taxonomy, publishedAt } = setup()
    prisma.financialProduct.findMany.mockResolvedValue([
      { ...bank, nominalRateMin: decimal('10.1'), nominalRateMax: decimal('12.3') },
      { ...bank, nominalRateMin: decimal('11'), nominalRateMax: decimal('16') },
    ])
    const result = await run('Gần đây có thủ đoạn lừa đảo và lãi suất ngân hàng nào đáng chú ý?')
    expect(result.toolTrace).toEqual([expect.objectContaining({ tool: 'RADAR_ALERTS', status: 'done' })])
    expect(result.richCard).toMatchObject({ kind: 'RADAR_BRIEF', totalVerified: 2,
      alerts: [{ id: alertId, title: taxonomy.vnAisLabel, vnAisCode: taxonomy.vnAisCode, publishedAt: publishedAt.toISOString(),
        handoffHref: expect.stringContaining('alertId=' + alertId) }],
      marketRates: [{ minRatePct: '10.1', maxRatePct: '16', medianRatePct: '12.3500', sampleCount: 2 }],
    })
    expect(prisma.threatAlert.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ verificationStatus: 'VERIFIED' }), take: 3,
    }))
    expect(JSON.stringify(result)).not.toContain('ratePct')
  })

  it('computes a health card without changing the stored profile', async () => {
    const { prisma, run } = setup()
    const result = await run('Lương 18 triệu, chi 8 triệu, trả nợ 2 triệu, tiết kiệm 50 triệu. Sức khỏe tài chính của tôi thế nào?')
    expect(result.toolTrace).toEqual([expect.objectContaining({ tool: 'PROFILE_HEALTH', status: 'done' })])
    expect(result.richCard).toMatchObject({
      kind: 'PROFILE_SNAPSHOT', dtiPct: '11.11', monthlySurplusVnd: '8000000.00', emergencyMonths: '5.0',
    })
    expect(prisma.financialProfile.upsert).not.toHaveBeenCalled()
  })

  it('marks empty and unavailable sources and excludes evidence and uploads from tool routing', async () => {
    const { prisma, run, ai, tools } = setup()
    prisma.financialProfile.findUnique.mockResolvedValue(null)
    const empty = await run('Sức khỏe tài chính của tôi thế nào?')
    expect(empty.richCard).toBeUndefined()
    expect(empty.toolTrace).toEqual([expect.objectContaining({ status: 'empty' })])
    prisma.financialProduct.findMany.mockRejectedValueOnce(new Error('offline'))
    const unavailable = await run('Lãi suất tiết kiệm hiện nay bao nhiêu?')
    expect(unavailable.richCard).toBeUndefined()
    expect(unavailable.toolTrace).toEqual([expect.objectContaining({ status: 'skipped' })])

    const copilot = vi.fn(args => tools.planAndExecute({ ...args, session }))
    const rawText = 'Cần vay 100 triệu trong 36 tháng. Bên cho vay yêu cầu phí giải ngân 2 triệu.'
    await expect(routeForensicConversation({ rawText }, false, ai, undefined, undefined, copilot)).resolves.toBeNull()
    await expect(routeForensicConversation({ rawText: 'Cần vay 100 triệu trong 36 tháng?' }, true, ai, undefined, undefined, copilot)).resolves.toBeNull()
    expect(copilot).not.toHaveBeenCalled()
  })
})
