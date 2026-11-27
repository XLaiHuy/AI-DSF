import {
  handoffRoutes, ThreatTrendAudienceSchema, ThreatTrendWindowSchema,
  type ThreatTrendsQuery, type ThreatTrendsResponse,
} from '@fincopilot/shared-types'
import type { Prisma } from '@prisma/client'
import type { RedisService } from '../../common/redis.service'
import { hasInternalIdentifierLeak } from '../../common/untrusted-text'
import { maskForensicText } from '../forensic/qr-evidence'
import { vnScamTaxonomy } from '../forensic/vn-scam-taxonomy'

const days = { '7d': 7, '30d': 30, '90d': 90 } as const
const dayMs = 86_400_000
export const threatTrendCacheKey = ({ window, audience }: ThreatTrendsQuery) =>
  'fincopilot:cache:radar:alert-trends:v1:' + window + ':' + audience

export async function invalidateThreatTrends(redis?: RedisService) {
  if (!redis) return
  await Promise.all(ThreatTrendWindowSchema.options.flatMap(window =>
    ThreatTrendAudienceSchema.options.map(audience => redis.del(threatTrendCacheKey({ window, audience })))))
}

type TrendGroup = {
  code: string | null
  currentCount: number
  previousCount: number
  sampleAlertId: string | null
  sampleTacticSummary: string | null
}

export async function readThreatTrends(prisma: Pick<Prisma.TransactionClient, '$queryRaw'>, input: ThreatTrendsQuery, now = new Date()): Promise<ThreatTrendsResponse> {
  const period = dayMs * days[input.window]
  const currentStart = new Date(now.getTime() - period)
  const previousStart = new Date(currentStart.getTime() - period)
  const groups = await prisma.$queryRaw<TrendGroup[]>`
    WITH verified AS (
      SELECT id, vn_ais_code, published_at, tactic_summary
      FROM threat_alert
      WHERE verification_status = 'VERIFIED' AND published_at >= ${previousStart} AND published_at <= ${now}
        AND (${input.audience} = 'ALL' OR target_audience = ${input.audience})
    ),
    counts AS (
      SELECT vn_ais_code AS code,
        COUNT(*) FILTER (WHERE published_at >= ${currentStart})::int AS "currentCount",
        COUNT(*) FILTER (WHERE published_at < ${currentStart})::int AS "previousCount"
      FROM verified
      GROUP BY vn_ais_code
    ),
    samples AS (
      SELECT DISTINCT ON (vn_ais_code) vn_ais_code AS code, id AS "sampleAlertId", tactic_summary AS "sampleTacticSummary"
      FROM verified
      WHERE published_at >= ${currentStart} AND vn_ais_code IS NOT NULL
      ORDER BY vn_ais_code, published_at DESC, id
    )
    SELECT counts.*, samples."sampleAlertId", samples."sampleTacticSummary"
    FROM counts LEFT JOIN samples USING (code)
  `
  const totalVerifiedInWindow = groups.reduce((total, row) => total + row.currentCount, 0)
  const mode = totalVerifiedInWindow < 5 ? 'MONITORING_CATALOG' : 'VERIFIED_TRENDS'
  const byCode = new Map(groups.map((row) => [row.code, row]))
  const items: ThreatTrendsResponse['items'] = vnScamTaxonomy
    .filter((item) => input.audience === 'ALL' || item.targetAudience === input.audience)
    .flatMap((item) => {
      const row = byCode.get(item.vnAisCode)
      const currentCount = row?.currentCount ?? 0
      const previousCount = row?.previousCount ?? 0
      if (mode === 'VERIFIED_TRENDS' && !currentCount && !previousCount) return []
      const rising = mode === 'VERIFIED_TRENDS' && currentCount >= 3 && currentCount * 2 >= previousCount * 3
      const sampleAlertId = row?.sampleAlertId ?? null
      const excerpt = row?.sampleTacticSummary && maskForensicText(row.sampleTacticSummary).trim().slice(0, 500)
      const sampleTacticSummary = excerpt && !hasInternalIdentifierLeak([excerpt]) ? excerpt : sampleAlertId ? item.vnAisLabel : null
      const handoffHref = sampleAlertId ? handoffRoutes.radarAlertToForensic({
        alertId: sampleAlertId, summary: sampleTacticSummary ?? undefined,
      }) : '/forensic'
      return [{ ...item, currentCount, previousCount, sampleAlertId, sampleTacticSummary, handoffHref,
        trendStatus: rising ? 'RISING' as const : 'MONITORING' as const }]
    })
    .sort((a, b) => b.currentCount - a.currentCount || b.previousCount - a.previousCount || a.vnAisCode.localeCompare(b.vnAisCode))
  return { ...input, generatedAt: now.toISOString(), mode, totalVerifiedInWindow, items }
}
