import type { PrismaService } from '../../common/prisma.service'
import type { RadarService } from '../radar/radar.service'
import type { SurveyCalcService } from '../survey-calc/survey-calc.service'
import { describe, expect, it, vi } from 'vitest'
import { AdminService } from './admin.service'

function setup() {
  const existing = {
    nominalRateMin: '5', nominalRateMax: '6', minAmountVnd: '100', maxAmountVnd: '200',
    minTermMonths: 12, maxTermMonths: 24, isActive: false, dataProvenance: 'WEB_REFERENCE',
  }
  const update = vi.fn(({ data }) => ({ ...existing, ...data }))
  const findMany = vi.fn()
  const prisma = { financialProduct: { findUnique: async () => existing, update, findMany } }
  return { service: new AdminService(prisma as unknown as PrismaService, {} as RadarService, {} as SurveyCalcService), update, findMany }
}

describe('Admin product updates', () => {
  it('reports the age of each product and counts freshness for active rows', async () => {
    const { service, findMany } = setup()
    const startOfToday = Math.floor(Date.now() / 86_400_000) * 86_400_000
    findMany.mockResolvedValue([30, 31, 60, 61, 90].map(ageDays => ({
      effectiveDate: new Date(startOfToday - ageDays * 86_400_000), isActive: ageDays < 90,
    })))
    const result = await service.products()
    expect(result.products.map(({ ageDays, freshnessTier }) => [ageDays, freshnessTier]))
      .toEqual([[30, 'FRESH'], [31, 'AGING'], [60, 'AGING'], [61, 'STALE'], [90, 'STALE']])
    expect(result.freshness).toEqual({ freshCount: 1, agingCount: 2, staleCount: 1 })
  })

  it.each([{}, { nominalRateMax: '4' }, { minAmountVnd: '201' }, { maxTermMonths: 11 }])(
    'rejects an empty or invalid merged patch %j', async (patch) => {
      const { service, update } = setup()
      await expect(service.updateProduct('product', patch)).rejects.toMatchObject({ status: 400 })
      expect(update).not.toHaveBeenCalled()
    },
  )

  it('preserves provenance and activation on a name-only edit', async () => {
    const { service } = setup()
    await expect(service.updateProduct('product', { productName: 'Tên mới' })).resolves.toMatchObject({
      productName: 'Tên mới', isActive: false, dataProvenance: 'WEB_REFERENCE',
    })
  })

  it('preserves provenance when toggling activation', async () => {
    const { service } = setup()
    await expect(service.updateProduct('product', { isActive: true })).resolves.toMatchObject({
      isActive: true, dataProvenance: 'WEB_REFERENCE',
    })
  })

  it.each([
    { upfrontFeeRate: '100' },
    { earlySettlementFeeRate: '101' },
    { nominalRateMax: '201' },
  ])('rejects out-of-range fee or rate bounds %j', async (patch) => {
    const { service, update } = setup()
    await expect(service.updateProduct('product', patch)).rejects.toMatchObject({ status: 400 })
    expect(update).not.toHaveBeenCalled()
  })
})
