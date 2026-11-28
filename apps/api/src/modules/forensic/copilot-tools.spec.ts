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
  return { prisma, survey, tools, run, ai, taxonomy, publishedAt }
}

describe('Verified Copilot tools', () => {
  it('loads the profile before ranking loans and uses stated cash flow without saving raw overrides', async () => {
    const { prisma, survey, run } = setup()
    const loan = vi.spyOn(survey, 'loan')
    const result = await run('Lương 18 triệu, chi 8 triệu, muốn vay 100 triệu trong 36 tháng có ổn không?')
    expect(result.toolTrace?.map(item => [item.tool, item.status])).toEqual([['PROFILE_HEALTH', 'done'], ['LOAN_SURVEY', 'done']])
    expect(loan).toHaveBeenCalledWith(expect.objectContaining({ enableWebFallback: false, dtiOverride: {
      monthlyIncomeVnd: '18000000', monthlyExpenseVnd: '8000000', existingDebtPaymentVnd: '1000000',
    } }), session, { verifiedBanksOnly: true, deterministic: true, persistDtiOverride: false })
    expect(prisma.financialProfile.findUnique.mock.invocationCallOrder[0]).toBeLessThan(loan.mock.invocationCallOrder[0])
    expect(prisma.financialProfile.upsert).not.toHaveBeenCalled()
    expect(prisma.calculationSession.create.mock.calls[0][0].data.inputParamsJson.dtiOverride).toBeUndefined()
    expect(prisma.financialProduct.findMany.mock.calls[0][0].where).toMatchObject({
      institution: { trustStatus: 'LICENSED', licenseIssuer: 'NHNN', institutionType: 'BANK' },
      dataProvenance: { in: ['CATALOG_VERIFIED'] },
    })
    expect(result.richCard).toMatchObject({
      kind: 'LOAN_PLAN', principalVnd: '100000000', termMonths: 36, profileUsed: true, dtiPct: expect.any(String),
      topOffers: [{ institutionName: bank.institution.name, effectiveAprPct: '12.0000' }],
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
