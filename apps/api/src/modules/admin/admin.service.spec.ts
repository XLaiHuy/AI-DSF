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
  const prisma = { financialProduct: { findUnique: async () => existing, update } }
  return { service: new AdminService(prisma as unknown as PrismaService, {} as RadarService, {} as SurveyCalcService), update }
}

describe('Admin product updates', () => {
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
})
