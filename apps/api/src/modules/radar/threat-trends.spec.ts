import { ThreatTrendsQuerySchema, ThreatTrendsResponseSchema } from '@fincopilot/shared-types'
import type { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { backfillThreatTaxonomy, threatTaxonomyFields } from '../forensic/threat-taxonomy'
import { readThreatTrends } from './threat-trends'

const now = new Date('2026-11-27T12:00:00Z')
const alertId = '82af57e9-ac5a-4916-8f3b-22cb9e4f3ced'
const group = (code: string | null, currentCount: number, previousCount: number) => ({
  code, currentCount, previousCount, sampleAlertId: null, sampleTacticSummary: null,
})

function data(rows: unknown[]) {
  const query = vi.fn().mockResolvedValue(rows)
  return { prisma: { $queryRaw: query } as Pick<Prisma.TransactionClient, '$queryRaw'>, query }
}

describe('Verified threat trends', () => {
  it.each([['7d', 7], ['30d', 30], ['90d', 90]] as const)('queries two adjacent %s windows from published verified rows', async (window, length) => {
    const { prisma, query } = data([])
    const result = await readThreatTrends(prisma, { window, audience: 'STUDENT' }, now)
    const [sql, previous, end, audience, filterAudience, current] = query.mock.calls[0]
    expect(sql.join(' ')).toContain("verification_status = 'VERIFIED' AND published_at >=")
    expect(sql.join(' ')).toContain('OR target_audience =')
    expect(end).toEqual(now)
    expect((now.getTime() - current.getTime()) / 86_400_000).toBe(length)
    expect((current.getTime() - previous.getTime()) / 86_400_000).toBe(length)
    expect(audience).toBe('STUDENT')
    expect(filterAudience).toBe('STUDENT')
    expect(result.items.every((item) => item.targetAudience === 'STUDENT')).toBe(true)
    expect(result.totalVerifiedInWindow).toBe(0)
    expect(ThreatTrendsResponseSchema.parse(result)).toEqual(result)
  })

  it('uses the exact sample and growth thresholds and keeps uncategorized rows in the total', async () => {
    const { prisma } = data([
      { ...group('VN-AIS-07', 3, 2), sampleAlertId: alertId, sampleTacticSummary: 'Mạo danh ngân hàng để yêu cầu nộp phí.' },
      group('VN-AIS-11', 4, 3), group('VN-AIS-22', 2, 0), group('VN-AIS-23', 3, 0), group('VN-AIS-20', 0, 4), group(null, 2, 0),
    ])
    const result = await readThreatTrends(prisma, { window: '7d', audience: 'ALL' }, now)
    expect(result.mode).toBe('VERIFIED_TRENDS')
    expect(result.totalVerifiedInWindow).toBe(14)
    expect(result.items.find((row) => row.vnAisCode === 'VN-AIS-20')).toMatchObject({ currentCount: 0, previousCount: 4, trendStatus: 'MONITORING' })
    expect(result.items.filter((row) => row.trendStatus === 'RISING').map((row) => row.vnAisCode)).toEqual(['VN-AIS-07', 'VN-AIS-23'])
    expect(result.items.find((row) => row.sampleAlertId === alertId)).toMatchObject({
      sampleTacticSummary: 'Mạo danh ngân hàng để yêu cầu nộp phí.',
      handoffHref: expect.stringContaining('alertId=' + alertId),
    })
  })

  it('shows the full monitoring catalog with measured counts and no rising marker under five alerts', async () => {
    const { prisma } = data([group('VN-AIS-11', 3, 0), group('VN-AIS-23', 1, 7)])
    const result = await readThreatTrends(prisma, { window: '30d', audience: 'ALL' }, now)
    expect(result.mode).toBe('MONITORING_CATALOG')
    expect(result.totalVerifiedInWindow).toBe(4)
    expect(result.items).toHaveLength(24)
    expect(result.items[0]).toMatchObject({ vnAisCode: 'VN-AIS-11', currentCount: 3, previousCount: 0 })
    expect(result.items.every((row) => row.trendStatus === 'MONITORING')).toBe(true)
    expect(result.items.filter((row) => row.currentCount > 0)).toHaveLength(2)
  })

  it('rejects unrecognized windows, audiences and extra filters', () => {
    for (const input of [{ window: '8d' }, { audience: 'UNKNOWN' }, { verifiedOnly: false }, { window: ['7d', '30d'] }]) {
      expect(ThreatTrendsQuerySchema.safeParse(input).success).toBe(false)
    }
  })
})

describe('Threat alert taxonomy backfill', () => {
  it('leaves vague alerts unclassified and safely retries only missing classifications', async () => {
    const row = { id: alertId, threatCategory: 'IMPERSONATION', tacticSummary: 'Giả danh ngân hàng', sourceExcerpt: null, updatedAt: now }
    const vague = { ...row, id: 'ccc35d01-1b69-4695-9606-c27762201ff1', tacticSummary: 'Cảnh báo chung' }
    expect(threatTaxonomyFields(vague)).toEqual({ vnAisCode: null, targetAudience: null, gasaCategory: null })
    const findMany = vi.fn().mockResolvedValueOnce([row, vague]).mockResolvedValueOnce([]).mockResolvedValueOnce([vague]).mockResolvedValue([])
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const prisma = { threatAlert: { findMany, updateMany } } as unknown as Pick<Prisma.TransactionClient, 'threatAlert'>
    await expect(backfillThreatTaxonomy(prisma)).resolves.toBe(1)
    await expect(backfillThreatTaxonomy(prisma)).resolves.toBe(0)
    expect(updateMany).toHaveBeenCalledTimes(1)
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: alertId, updatedAt: now, OR: [{ vnAisCode: null }, { gasaCategory: null }, { targetAudience: null }] },
      data: { vnAisCode: 'VN-AIS-07', gasaCategory: 'Lừa đảo mạo danh', targetAudience: 'GENERAL' },
    })
  })
})
