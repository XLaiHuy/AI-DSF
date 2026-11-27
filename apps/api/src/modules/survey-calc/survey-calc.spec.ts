import { Prisma } from '@prisma/client'
import { AdminProductSyncResultSchema, LoanUseCase, ManualCompareRequestSchema, ManualCompareResponseSchema, SurveyInvestResponseSchema, SurveyLoanResponseSchema, SurveyRefinanceRequestSchema, SurveyRefinanceResponseSchema } from '@fincopilot/shared-types'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../../common/prisma.service'
import type { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { SurveyCalcService } from './survey-calc.service'
import { SurveyCalcController } from './survey-calc.controller'
import type { FastifyRequest } from 'fastify'

vi.mock('../admin/threat-safety', () => ({ fetchPublicDocument: vi.fn().mockRejectedValue(new Error('offline')) }))

const guestSessionId = '11111111-1111-4111-8111-111111111111'
const sourceArticleId = '22222222-2222-4222-8222-222222222222'
const sourceAuditId = '33333333-3333-4333-8333-333333333333'
const profileId = '44444444-4444-4444-8444-444444444444'
const session = { kind: 'guest', guestSessionId } as const
const loan = { principalVnd: '10000000', termMonths: 12, productCategory: 'UNSECURED_LOAN', priority: 'LOWEST_APR' } as const
const investment = { initialVnd: '10000000', monthlyContributionVnd: '1000000', termMonths: 12 } as const
const decimal = (value: string) => new Prisma.Decimal(value)
const offer = {
  id: 'sample', institution: { name: 'ACB' }, productName: 'Sản phẩm kiểm thử', dataProvenance: 'CATALOG_VERIFIED',
  sourceUrl: 'https://example.test/product', effectiveDate: new Date('2026-01-01'), rateType: 'FIXED',
  calcMethod: 'REDUCING_BALANCE', nominalRateMin: decimal('12'), nominalRateMax: decimal('12'),
  upfrontFeeRate: decimal('0'), monthlyFeeVnd: decimal('0'), productCategory: loan.productCategory,
}

function setup(products: Array<Record<string, unknown>> = [offer]) {
  const prisma = {
    financialProduct: { findMany: vi.fn().mockResolvedValue(products), count: vi.fn().mockResolvedValue(0) },
    financialInstitution: { findMany: vi.fn().mockResolvedValue([{ name: 'ACB', code: 'ACB' }]) },
    financialProfile: { findUnique: vi.fn().mockResolvedValue({ id: profileId }) },
    calculationSession: { create: vi.fn().mockResolvedValue({}), findFirst: vi.fn() },
    marketArticle: { findFirst: vi.fn().mockResolvedValue({ id: sourceArticleId }) },
    forensicAudit: { findFirst: vi.fn().mockResolvedValue({ id: sourceAuditId }) },
  }
  const generateStructured = vi.fn().mockResolvedValue({ summary: 'Giải thích thử', tradeoffs: [], warnings: [] })
  const service = new SurveyCalcService(prisma as unknown as PrismaService, { generateStructured } as unknown as AiGatewayService)
  return { service, prisma, generateStructured }
}

describe('Contract comparison', () => {
  const borrower = { kind: 'user', userId: '55555555-5555-4555-8555-555555555555' } as const
  const terms = {
    remainingPrincipalVnd: '10000000', remainingTermMonths: 12, currentAnnualRatePct: '36',
    currentCalcMethod: 'FLAT_RATE', currentMonthlyFeeVnd: '0', earlySettlementFeePct: '0',
    productCategory: 'UNSECURED_LOAN',
  } as const

  it('ranks up to three distinct licensed banks and restores a compact history record', async () => {
    const { service, prisma } = setup(['A', 'A', 'B', 'C', 'D'].map((key, index) => ({
      ...offer, id: 'offer-' + index, institutionId: key, institution: { name: key }, nominalRateMin: decimal(String(10 + index)),
    })))
    const request = { session } as unknown as FastifyRequest
    const controller = new SurveyCalcController(service)
    const result = SurveyRefinanceResponseSchema.parse(await controller.refinance(SurveyRefinanceRequestSchema.parse(terms), request))
    expect(result.offers.map((item) => item.institutionName)).toEqual(['A', 'B', 'C'])
    expect(result.offers[0].result).toMatchObject({ breakEvenMonth: 1, recommendation: 'WORTH_REFINANCING' })
    expect(prisma.financialProduct.findMany.mock.calls[0][0].where).toMatchObject({
      institution: { trustStatus: 'LICENSED', licenseIssuer: 'NHNN', institutionType: 'BANK' },
      dataProvenance: { in: ['CATALOG_VERIFIED', 'WEB_REFERENCE'] },
    })
    const { data } = prisma.calculationSession.create.mock.calls[0][0]
    expect(data.sessionMode).toBe('REFINANCE_COMPARE')
    expect(JSON.stringify(data.mathResultsJson)).not.toContain('schedule')
    prisma.calculationSession.findFirst.mockResolvedValue({ ...data, createdAt: new Date() })
    await expect(service.sessionDetail(session, result.sessionId)).resolves.toMatchObject({ result, sessionMode: 'REFINANCE_COMPARE' })
  })

  it('uses the monthly flat rate from an owned audit without charging the original upfront fee twice', async () => {
    const { service, prisma } = setup([])
    prisma.forensicAudit.findFirst.mockResolvedValue({
      id: sourceAuditId, claimedEntityName: 'Bên cho vay', principalNominalVnd: decimal('10000000'), quotedRatePct: decimal('3'),
      effectiveAprPct: decimal('60'), extractedClaimsJson: {
        mathBreakdown: { principalNominalVnd: '10000000', principalNetVnd: '9700000', upfrontFeeVnd: '300000',
          quotedRateLabel: '3% mỗi tháng', effectiveAprPct: '60', effectiveEarPct: '70', termMonths: 12, scheduleType: 'FIXED_FLAT' },
      },
    })
    const result = await service.refinance({ sourceAuditId }, borrower)
    expect(result.currentContract).toMatchObject({ ...terms, sourceAuditId, referenceAprPct: '60', rateIsEstimate: false })
    expect(prisma.forensicAudit.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: sourceAuditId, userId: borrower.userId } }))
  })

  it('returns 404 for another owner even when all manual terms were also supplied', async () => {
    const { service, prisma } = setup()
    prisma.forensicAudit.findFirst.mockImplementation(async (input) =>
      input.where.userId === borrower.userId ? { id: sourceAuditId } : null)
    const request = { session: { kind: 'user', userId: '77777777-7777-4777-8777-777777777777' } } as unknown as FastifyRequest
    const controller = new SurveyCalcController(service)
    await expect(controller.refinance({ ...terms, sourceAuditId }, request)).rejects.toMatchObject({ status: 404 })
    await expect(controller.refinanceFromAudit(request, sourceAuditId)).rejects.toMatchObject({ status: 404 })
    expect(prisma.financialProduct.findMany).not.toHaveBeenCalled()
    expect(prisma.calculationSession.create).not.toHaveBeenCalled()
  })
})

describe('Survey API contracts', () => {
  it.each(LoanUseCase.options)('selects by %s and supplies the payment after the promotional period', async (loanUseCase) => {
    const { service, prisma } = setup([{
      ...offer, loanUseCase, rateType: 'PROMO_THEN_FLOATING', promoMonths: 6, nominalRateMax: decimal('18'),
    }])
    const { offers: [result] } = SurveyLoanResponseSchema.parse(await service.loan({ ...loan, loanUseCase }, session))
    expect(prisma.financialProduct.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ productCategory: loan.productCategory }),
    }))
    expect(prisma.financialProduct.findMany.mock.calls[0][0].where.loanUseCase).toBe(loanUseCase)
    expect(result).toMatchObject({ loanUseCase, nominalRatePct: '12', stressPaymentFirstVnd: result.schedule[6].paymentVnd })
  })

  it('replays a 360-month multi-offer stress simulation from compact immutable inputs', async () => {
    const { service, prisma } = setup([offer, { ...offer, id: 'promo', rateType: 'PROMO_THEN_FLOATING',
      promoMonths: 12, nominalRateMax: decimal('16'), monthlyFeeVnd: decimal('7000') }])
    const result = await service.loan({ ...loan, termMonths: 360, rateShockDeltaPct: '1' }, session)
    const { data } = prisma.calculationSession.create.mock.calls[0][0]
    expect(result.offers).toHaveLength(2)
    expect(data.mathResultsJson.baseRecipes).toHaveLength(2)
    expect(data.mathResultsJson.result.offers.every((item: { schedule: unknown[] }) => item.schedule.length === 0)).toBe(true)
    expect(JSON.stringify(data.mathResultsJson)).not.toContain('stressSchedule')
    expect(JSON.stringify(data.mathResultsJson).length).toBeLessThan(JSON.stringify(result).length * 0.6)
    prisma.calculationSession.findFirst.mockResolvedValue({ ...data, createdAt: new Date() })
    expect((await service.sessionDetail(session, result.sessionId)).result).toEqual(result)
    expect(prisma.financialProduct.findMany).toHaveBeenCalledTimes(1)
  })

  it('replays legacy loan sessions that already contain a stress schedule', async () => {
    const { service, prisma } = setup()
    const result = await service.loan({ ...loan, termMonths: 360 }, session)
    expect(result.offers[0].stressSchedule).toHaveLength(360)
    const { data } = prisma.calculationSession.create.mock.calls[0][0]
    prisma.calculationSession.findFirst.mockResolvedValue({ ...data, mathResultsJson: result, createdAt: new Date() })
    await expect(service.sessionDetail(session, result.sessionId)).resolves.toMatchObject({ result })
  })

  it('uses a two-point rate shock when there is no post-promotion phase', async () => {
    const { service } = setup()
    const { offers: [result] } = await service.loan(loan, session)
    expect(result.stressPaymentFirstVnd).toBe(result.stressSchedule?.[0].paymentVnd)
    expect(decimal(result.stressPaymentFirstVnd ?? '0').gt(result.monthlyPaymentFirstVnd)).toBe(true)
  })

  it.each(['UNSECURED_LOAN', 'SECURED_LOAN'] as const)('selects eligible verified loans for %s and records validated source links', async (productCategory) => {
    const { service, prisma, generateStructured } = setup([{ ...offer, productCategory }])
    const data = SurveyLoanResponseSchema.parse(await service.loan({
      ...loan, productCategory, sourceArticleId, sourceAuditId, enableWebFallback: false, checkEntityName: 'ACB',
    }, session))
    expect(prisma.financialProduct.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ productCategory, isActive: true, dataProvenance: { in: ['CATALOG_VERIFIED'] } }),
    }))
    expect(prisma.forensicAudit.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: sourceAuditId, guestSessionId } }))
    expect(prisma.calculationSession.create).toHaveBeenCalledWith({ data: expect.objectContaining({ profileId, sourceArticleId, sourceAuditId, guestSessionId }) })
    expect(generateStructured).toHaveBeenCalledWith('SURVEY_EXPLAIN', expect.anything(), expect.anything())
    expect(data.meta).toMatchObject({ degradedMode: false, savedToHistory: true })
  })

  it('rejects a handoff to an audit owned by another session', async () => {
    const { service, prisma } = setup()
    prisma.forensicAudit.findFirst.mockResolvedValue(null)
    await expect(service.loan({ ...loan, sourceAuditId }, session)).rejects.toMatchObject({ status: 400 })
    expect(prisma.calculationSession.create).not.toHaveBeenCalled()
  })

  it('uses the flat calculation, applies fees and reports AI and history failures independently', async () => {
    const { service, generateStructured, prisma } = setup([{
      ...offer, calcMethod: 'FLAT_RATE', upfrontFeeRate: decimal('10'), monthlyFeeVnd: decimal('10000'),
    }])
    generateStructured.mockRejectedValue(new Error('offline'))
    prisma.calculationSession.create.mockRejectedValue(new Error('database unavailable'))
    const result = SurveyLoanResponseSchema.parse(await service.loan(loan, session))
    expect(result.offers[0]).toMatchObject({ calcMethod: 'FLAT_RATE', principalNetVnd: '9000000',
      totalInterestAndFeesVnd: '2320000', upfrontFeeVnd: '1000000', monthlyFeeVnd: '10000' })
    expect(result.offers[0].schedule[0]).toMatchObject({ principalVnd: '833333', interestVnd: '100000', feeVnd: '10000' })
    expect(result.meta).toMatchObject({ degradedMode: true, errorCode: 'ERR_AI_DEGRADED_FALLBACK', savedToHistory: false })
  })

  it('distinguishes no match, empty catalog, and database outage', async () => {
    const { service, prisma } = setup([])
    expect((await service.loan(loan, session)).meta?.catalogStatus).toBe('EMPTY_CATALOG')
    prisma.financialProduct.count.mockResolvedValue(1)
    expect((await service.loan(loan, session)).meta?.catalogStatus).toBe('NO_MATCH')
    prisma.financialProduct.findMany.mockRejectedValue(new Error('offline'))
    expect((await service.loan(loan, session)).meta?.catalogStatus).toBe('CATALOG_UNAVAILABLE')
  })

  it('blocks an unknown name rather than catching and accepting it, and reports database failure', async () => {
    const { service, prisma } = setup()
    const request = { ...investment, checkEntityName: 'ACB Agency' }
    await expect(service.investment(request, session)).rejects.toMatchObject({ status: 422 })
    prisma.financialInstitution.findMany.mockRejectedValue(new Error('offline'))
    await expect(service.investment(request, session)).rejects.toMatchObject({ status: 503 })
  })

  it('rejects a post-shock interest rate outside the supported range', async () => {
    const { service } = setup()
    for (const rateShockDeltaPct of ['-13', '190']) {
      await expect(service.loan({ ...loan, rateShockDeltaPct }, session)).rejects.toMatchObject({ status: 400 })
    }
  })

  it('skips broken catalog offers and keeps valid ones during fee or negative shock evaluation', async () => {
    const healthy = { ...offer, id: 'healthy', productName: 'Gói hợp lệ', nominalRateMin: decimal('7'), nominalRateMax: decimal('11') }
    const invalidFee = { ...offer, id: 'bad-fee', productName: 'Gói phí sai', upfrontFeeRate: decimal('100') }
    const { service: feeService } = setup([invalidFee, healthy])
    const feeResult = await feeService.loan(loan, session)
    expect(feeResult.offers.map((item) => item.productId)).toEqual(['healthy'])

    const lowRate = { ...offer, id: 'low', nominalRateMin: decimal('5'), nominalRateMax: decimal('9') }
    const { service: shockService } = setup([lowRate, healthy])
    const shockResult = await shockService.loan({ ...loan, rateShockDeltaPct: '-6' }, session)
    expect(shockResult.offers.map((item) => item.productId)).toEqual(['healthy'])
  })

  it('returns all three investment categories with product rates and fees', async () => {
    const products = ['SAVING', 'ACCUMULATION', 'OPEN_FUND'].map((productCategory, index) => ({
      ...offer, id: 'product-' + index, productCategory, nominalRateMin: decimal(String(index + 3)),
      rateType: index === 2 ? 'VARIABLE_NAV' : 'FIXED',
      redemptionFeeTiers: index === 2 ? [{ throughMonths: 3, ratePct: '2' }] : null,
      investmentTaxPct: index === 2 ? decimal('0.1') : null,
    }))
    const { service, prisma } = setup(products)
    const data = SurveyInvestResponseSchema.parse(await service.investment(investment, session))
    expect(data.offers.map(({ productCategory, scenario }) => [productCategory, scenario.annualReturnPct]))
      .toEqual([['SAVING', '3'], ['ACCUMULATION', '4'], ['OPEN_FUND', '5']])
    expect(new Prisma.Decimal(data.offers[2].scenario.sellFeeVnd).gt(0)).toBe(true)
    expect(data.offers[2].scenarios).toMatchObject({
      conservative: { annualReturnPct: '1.5' }, base: data.offers[2].scenario, optimistic: { annualReturnPct: '8.5' },
    })
    expect(data.offers[2].projection?.at(-1)).toMatchObject({
      month: 12, contributedVnd: '22000000', baseVnd: data.offers[2].scenario.netValueVnd,
    })
    await service.investment({ ...investment, productCategory: 'SAVING' }, session)
    expect(prisma.financialProduct.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ productCategory: 'SAVING' }),
    }))
  })

  it('uses upfront fees for APR and rejects fees at or above principal', async () => {
    const { service } = setup()
    const a = { label: 'A', principalVnd: '10000000', annualRatePct: '12', termMonths: 12 }
    const b = { ...a, label: 'B', upfrontFeeVnd: '1000000' }
    const { offers } = ManualCompareResponseSchema.parse(await service.manualCompare({ offers: [a, b] }, session))
    expect(offers[1]).toMatchObject({ upfrontFeeVnd: '1000000', principalNetVnd: '9000000' })
    expect(decimal(offers[1].effectiveAprPct).gt(offers[0].effectiveAprPct)).toBe(true)
    await expect(service.manualCompare({ offers: [a, { ...b, upfrontFeeVnd: '10000000' }] }, session)).rejects.toMatchObject({ status: 400 })
  })

  it('compares all three methods, models the rate change and charges the early exit fee', async () => {
    const { service, prisma } = setup()
    const base = { label: 'A', principalVnd: '12000000', annualRatePct: '12', termMonths: 12 }
    const input = ManualCompareRequestSchema.parse({ offers: [
      base, { ...base, label: 'B', calcMethod: 'DECLINING_PRINCIPAL' },
      { ...base, label: 'C', calcMethod: 'FLAT_RATE', monthlyFeeVnd: '20000',
        promoMonths: 6, floatingRatePct: '24', earlySettlementMonth: 8, earlySettlementFeePct: '2' },
      { ...base, label: 'D' },
    ] })
    const result = await service.manualCompare(input, session)
    const { offers } = result
    const { data } = prisma.calculationSession.create.mock.calls[0][0]
    expect(data.mathResultsJson.offers.every((item: { schedule: unknown[] }) => item.schedule.length === 0)).toBe(true)
    prisma.calculationSession.findFirst.mockResolvedValue({ ...data, createdAt: new Date() })
    expect((await service.sessionDetail(session, result.sessionId)).result).toEqual(result)
    expect(offers.map(({ calcMethod }) => calcMethod)).toEqual(['REDUCING_BALANCE', 'DECLINING_PRINCIPAL', 'FLAT_RATE', 'REDUCING_BALANCE'])
    expect(offers[2].schedule[5]).toMatchObject({ paymentVnd: '1140000', interestVnd: '120000', feeVnd: '20000' })
    expect(offers[2].schedule[6]).toMatchObject({ paymentVnd: '1260000', interestVnd: '240000', feeVnd: '20000' })
    expect(offers[2].earlySettlement).toMatchObject({
      month: 8, remainingPrincipalVnd: '4000000', penaltyFeeVnd: '80000', totalPaidUntilExitVnd: '13440000',
    })
    expect(ManualCompareRequestSchema.safeParse({ offers: [...input.offers, base] }).success).toBe(false)
    await expect(service.manualCompare({ offers: [base, { ...base, promoMonths: 6 }] }, session)).rejects.toMatchObject({ status: 400 })
    await expect(service.manualCompare({ offers: [base, { ...base, earlySettlementMonth: 13 }] }, session)).rejects.toMatchObject({ status: 400 })
  })

  it('replays the saved result only for its owner, including legacy manual offers', async () => {
    const { service, prisma } = setup()
    const id = sourceArticleId
    const base = { label: 'A', principalVnd: '12000000', annualRatePct: '12', termMonths: 12 }
    const legacyOffer = { label: 'A', monthlyPaymentVnd: '1066185', totalInterestVnd: '794224',
      totalPayableVnd: '12794224', effectiveAprPct: '12', upfrontFeeVnd: '0', principalNetVnd: '12000000' }
    prisma.calculationSession.findFirst.mockImplementation(({ where }: { where: { id: string; guestSessionId?: string } }) =>
      where.id === id && where.guestSessionId === guestSessionId
        ? { id, sessionMode: 'MANUAL_COMPARE', createdAt: new Date('2026-08-01'),
          inputParamsJson: { offers: [base, base] }, mathResultsJson: { sessionId: id, offers: [legacyOffer, legacyOffer] } }
        : null)
    await expect(service.sessionDetail(session, id)).resolves.toMatchObject({
      id, sessionMode: 'MANUAL_COMPARE', createdAt: '2026-08-01T00:00:00.000Z',
      result: { offers: [expect.objectContaining({ calcMethod: 'REDUCING_BALANCE', schedule: expect.any(Array) }), expect.anything()] },
    })
    await expect(service.sessionDetail({ kind: 'guest', guestSessionId: profileId }, id)).rejects.toMatchObject({ status: 404 })
    await expect(service.sessionDetail(session, sourceAuditId)).rejects.toMatchObject({ status: 404 })
    await expect(service.sessionDetail(session, 'invalid')).rejects.toMatchObject({ status: 404 })
  })

  it('syncs the curated snapshot idempotently with sources offline and preserves Admin overrides', async () => {
    const catalog = new Map<string, { id: string; isActive: boolean; catalogSyncFingerprint: string | null }>()
    const transaction = {
      $queryRaw: vi.fn(),
      financialInstitution: { upsert: vi.fn().mockResolvedValue({ id: 'bank', trustStatus: 'LICENSED' }) },
      financialProduct: {
        findFirst: vi.fn(({ where }) => catalog.get(where.OR[0].id) ?? null),
        createMany: vi.fn(({ data: [data] }) => { catalog.set(data.id, data); return { count: 1 } }),
        updateMany: vi.fn(),
      },
    }
    const prisma = { $transaction: (run: (value: typeof transaction) => unknown) => run(transaction) }
    const service = new SurveyCalcService(prisma as unknown as PrismaService, {} as AiGatewayService)
    const initial = AdminProductSyncResultSchema.parse(await service.syncTrustedProducts())
    expect(initial.productsActivated).toBe(21)
    expect(initial.sourcesReachable).toBe(0)
    const first = [...catalog.values()][0]
    first.catalogSyncFingerprint = null
    first.isActive = false
    expect(await service.syncTrustedProducts()).toMatchObject({ productsActivated: 0, productsUpserted: 0 })
    expect(transaction.financialProduct.updateMany).not.toHaveBeenCalled()
    expect(first.isActive).toBe(false)
  })
})
