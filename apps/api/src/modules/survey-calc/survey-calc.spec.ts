import { Prisma } from '@prisma/client'
import { AdminProductSyncResultSchema, ManualCompareResponseSchema, SurveyInvestResponseSchema, SurveyLoanResponseSchema } from '@fincopilot/shared-types'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../../common/prisma.service'
import type { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { SurveyCalcService } from './survey-calc.service'

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
    calculationSession: { create: vi.fn().mockResolvedValue({}) },
    marketArticle: { findFirst: vi.fn().mockResolvedValue({ id: sourceArticleId }) },
    forensicAudit: { findFirst: vi.fn().mockResolvedValue({ id: sourceAuditId }) },
  }
  const generateStructured = vi.fn().mockResolvedValue({ summary: 'Giải thích thử', tradeoffs: [], warnings: [] })
  const service = new SurveyCalcService(prisma as unknown as PrismaService, { generateStructured } as unknown as AiGatewayService)
  return { service, prisma, generateStructured }
}

describe('Survey API contracts', () => {
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
    expect(initial.productsActivated).toBeGreaterThanOrEqual(5)
    expect(initial.sourcesReachable).toBe(0)
    const first = [...catalog.values()][0]
    first.catalogSyncFingerprint = null
    first.isActive = false
    expect(await service.syncTrustedProducts()).toMatchObject({ productsActivated: 0, productsUpserted: 0 })
    expect(transaction.financialProduct.updateMany).not.toHaveBeenCalled()
    expect(first.isActive).toBe(false)
  })
})
