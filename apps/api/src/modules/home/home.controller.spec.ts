import { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../../common/prisma.service'
import { HomeController } from './home.controller'

describe('HomeController market benchmark', () => {
  it('computes rate bounds from nominalRateMin/nominalRateMax and filters active effective products', async () => {
    const findManyProducts = vi.fn().mockResolvedValue([
      {
        productCategory: 'SECURED_LOAN',
        effectiveDate: new Date('2026-01-01'), institution: { name: 'A' },
        nominalRateMin: new Prisma.Decimal('5'),
        nominalRateMax: new Prisma.Decimal('9'),
      },
      {
        productCategory: 'SECURED_LOAN',
        effectiveDate: new Date('2026-01-01'), institution: { name: 'B' },
        nominalRateMin: new Prisma.Decimal('7'),
        nominalRateMax: new Prisma.Decimal('10'),
      },
    ])
    const prisma = {
      threatAlert: { findMany: vi.fn().mockResolvedValue([]) },
      marketArticle: { findMany: vi.fn().mockResolvedValue([]) },
      financialProduct: { findMany: findManyProducts },
    }
    const controller = new HomeController(prisma as unknown as PrismaService)
    const response = await controller.market()

    expect(findManyProducts).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true, effectiveDate: { lte: expect.any(Date) } },
    }))
    expect(response.marketRates).toEqual([
      expect.objectContaining({
        category: 'SECURED_LOAN',
        minRatePct: 5,
        medianRatePct: 6,
        maxRatePct: 10,
        group: 'LOAN', latestEffectiveDate: '2026-01-01', institutions: ['A', 'B'], sampleCount: 2,
      }),
    ])
  })
})
