import type { PrismaClient } from '@prisma/client'
import { stableUuid } from './seed-id'

export async function seedRadarAlerts(prisma: PrismaClient) {
  const demoUrl = { startsWith: 'https://example.invalid/' }
  await prisma.$transaction(async (tx) => {
    const alerts = await tx.threatAlert.findMany({
      where: { OR: [
        ...['DEMO —', 'Mẫu cảnh báo:', 'Mẫu chờ duyệt:'].map((startsWith) => ({ tacticSummary: { startsWith } })),
        { id: { in: ['vietqr-fee', 'trc20-unlock', 'apk-limit'].map((key) => stableUuid(`demo:threat:${key}`)) } },
      ] },
      select: { id: true },
    })
    const alertIds = alerts.map(({ id }) => id)
    const indicators = { threatAlertId: { in: alertIds } }
    const articles = { canonicalUrl: demoUrl }
    await tx.threatFeedbackExample.deleteMany({
      where: { id: { in: ['FALSE_POSITIVE', 'CONFIRMED_SCAM'].map((kind) => stableUuid(`demo:feedback:${kind}`)) } },
    })
    await tx.forensicFinding.updateMany({ where: { matchedIndicator: indicators }, data: { matchedIndicatorId: null } })
    await tx.forensicAudit.updateMany({ where: { sourceAlertId: { in: alertIds } }, data: { sourceAlertId: null } })
    await tx.threatEvidence.deleteMany({
      where: { OR: [{ threatAlertId: { in: alertIds } }, { articleSource: { article: articles } }] },
    })
    await tx.threatIndicator.deleteMany({ where: indicators })
    await tx.threatAlert.deleteMany({ where: { id: { in: alertIds } } })
    await tx.articleImpactAnalysis.deleteMany({ where: { article: articles } })
    await tx.articleCategory.deleteMany({ where: { article: articles } })
    await tx.articleSource.deleteMany({ where: { article: articles } })
    await tx.marketArticle.updateMany({ where: { duplicateOf: articles }, data: { duplicateOfId: null } })
    await tx.marketArticle.deleteMany({ where: articles })
  })
}
