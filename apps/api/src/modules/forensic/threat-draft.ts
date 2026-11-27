import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import type { ThreatDraft } from '@fincopilot/shared-types'
import { normalizeThreatIndicator } from '../admin/threat-safety'
import { normalizeVietnamese } from './data/trusted-institutions'
import { maskForensicText } from './qr-evidence'
import { matchesTrustedIdentity } from './threat-iocs'
import { embeddingCosine, readThreatEmbedding, type ThreatMemoryService } from './threat-memory.service'

export const publicThreatAlertWhere = {
  verificationStatus: 'VERIFIED', publishedAt: { not: null },
} satisfies Prisma.ThreatAlertWhereInput

type DraftSource = { articleId: string; sourceId: string; url: string; title: string; publishedAt: Date | null }
type TrustedCatalog = Awaited<ReturnType<ThreatMemoryService['get']>>['trusted']

export async function attachThreatDraft(tx: Prisma.TransactionClient, memory: ThreatMemoryService, {
  source, draft, trusted, origin, embedding,
}: {
  source: DraftSource; draft: ThreatDraft; trusted: TrustedCatalog
  origin: 'RADAR_AUTO' | 'ADMIN_INGEST'; embedding?: { vector: number[]; model: string } | null
}) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('threat-intake-alert-dedup', 0))`
  const { indicators, ...draftFields } = draft
  const host = new URL(source.url).hostname
  const unique = new Map<string, ThreatDraft['indicators'][number]>()
  for (const input of indicators) {
    const item = normalizeThreatIndicator(input)
    if (!item || matchesTrustedIdentity(item.indicatorText, trusted)) continue
    if (item.indicatorType === 'DOMAIN' && (host === item.indicatorText || host.endsWith('.' + item.indicatorText))) continue
    unique.set(item.indicatorType + ':' + normalizeVietnamese(item.indicatorText), item)
  }
  const usable = [...unique.values()]
  const hardIocs = usable.filter(({ indicatorType }) => indicatorType !== 'KEYWORD')
  const evidence = { articleId: source.articleId, sourceId: source.sourceId }
  const stored = (type: string, value: string) =>
    type === 'PHONE' || type === 'BANK_ACCOUNT' ? memory.fingerprint(type, value) : value
  const existing = await tx.threatAlert.findFirst({
    where: { OR: [
      { evidence: { some: evidence } },
      ...hardIocs.map(({ indicatorType, indicatorText }) => ({ indicators: { some: {
        indicatorType, indicatorText: { in: [indicatorText, stored(indicatorType, indicatorText)], mode: 'insensitive' as const },
      } } })),
    ] },
    orderBy: [{ verificationStatus: 'desc' }, { createdAt: 'asc' }], select: { id: true },
  }) ?? (await tx.threatAlert.findMany({
    take: 300, orderBy: [{ verificationStatus: 'desc' }, { updatedAt: 'desc' }],
    select: { id: true, embeddingJson: true, embeddingModel: true,
      evidence: { select: { articleSource: { select: { article: { select: { title: true } } } } } } },
  })).find((row) => {
    const title = normalizeVietnamese(maskForensicText(source.title))
    const prior = readThreatEmbedding(row.embeddingJson)
    return row.evidence.some(({ articleSource }) => normalizeVietnamese(maskForensicText(articleSource.article.title)) === title) ||
      Boolean(embedding && prior && embedding.model === row.embeddingModel && embeddingCosine(embedding.vector, prior) >= 0.90)
  })
  if (existing) {
    const attached = await tx.threatEvidence.createMany({
      data: { ...evidence, threatAlertId: existing.id }, skipDuplicates: true,
    })
    if (attached.count) await tx.threatAlert.update({ where: { id: existing.id }, data: { hitCount: { increment: 1 } } })
    return { proposal: 0, attached: 0 }
  }
  if (origin === 'RADAR_AUTO' && usable.length === 0) return { proposal: 0, attached: 0 }
  await tx.threatAlert.create({ data: {
    ...draftFields, id: randomUUID(), originSource: origin, issuedAt: source.publishedAt,
    tacticSummary: maskForensicText(draftFields.tacticSummary),
    preventionGuidance: maskForensicText(draftFields.preventionGuidance),
    verificationStatus: 'UNVERIFIED', publishedAt: null,
    embeddingJson: embedding?.vector, embeddingModel: embedding?.model,
    evidence: { create: evidence },
    indicators: { create: usable.map(({ indicatorType, indicatorText }) => ({
      id: randomUUID(), indicatorType, indicatorText: stored(indicatorType, indicatorText),
    })) },
  } })
  return { proposal: 1, attached: usable.length }
}
