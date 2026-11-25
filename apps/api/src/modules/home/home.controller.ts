import { Controller, Get } from '@nestjs/common'
import { handoffRoutes, ROUTES } from '@fincopilot/shared-types'
import { PrismaService } from '../../common/prisma.service'

const categoryBenchmarkLabels: Record<string, string> = {
  UNSECURED_LOAN: 'Vay tín chấp',
  SECURED_LOAN: 'Vay thế chấp',
  SAVING: 'Tiết kiệm',
  ACCUMULATION: 'Tích lũy',
  OPEN_FUND: 'Quỹ mở',
}

function proxyImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null
  try {
    const parsed = new URL(imageUrl)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    return `/api/v1/radar/image-proxy?url=${encodeURIComponent(parsed.toString())}`
  } catch {
    return null
  }
}

function estimateReadMinutes(title: string): number {
  const words = title.trim().split(/\s+/).length
  return Math.max(2, Math.min(6, Math.round(words / 4)))
}

function medianOf(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2))
}

@Controller('home')
export class HomeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('market')
  async market() {
    const select = {
      id: true,
      title: true,
      imageUrl: true,
      publishedAt: true,
      categories: { select: { categoryCode: true } },
      sources: {
        take: 1,
        select: { source: { select: { name: true } } },
      },
      impactAnalyses: {
        where: { analysisMode: 'GENERAL', profileId: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { suggestedRateDelta: true, aiAssessmentJson: true },
      },
    } as const
    const orderBy = [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }] as const
    const [alerts, withImages, activeProducts] = await Promise.all([
      this.prisma.threatAlert.findMany({
        where: { verificationStatus: 'VERIFIED', publishedAt: { not: null } },
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        take: 3,
        select: {
          id: true,
          tacticSummary: true,
          preventionGuidance: true,
          publishedAt: true,
          evidence: {
            take: 1,
            select: { articleSource: { select: { source: { select: { name: true } }, article: { select: { imageUrl: true } } } } },
          },
        },
      }),
      this.prisma.marketArticle.findMany({
        where: { feedStatus: 'ACTIVE', duplicateOfId: null, imageUrl: { not: null } },
        orderBy: [...orderBy],
        select,
        take: 10,
      }),
      this.prisma.financialProduct.findMany({
        where: { isActive: true },
        select: { productCategory: true, nominalRateMin: true, nominalRateMax: true },
      }),
    ])

    const remaining = Math.max(0, 6 - withImages.length)
    const fallback = remaining > 0 ? await this.prisma.marketArticle.findMany({
      where: { feedStatus: 'ACTIVE', duplicateOfId: null, imageUrl: null },
      orderBy: [...orderBy],
      select,
      take: remaining,
    }) : []

    const combined = [...withImages, ...fallback]
    const articles = combined.slice(0, 6).map(({ categories, sources, imageUrl, ...article }) => ({
      ...article,
      imageUrl,
      proxyUrl: proxyImageUrl(imageUrl),
      sourceName: sources[0]?.source.name ?? null,
      categories: categories.map(({ categoryCode }) => categoryCode),
    }))

    const trendingCandidates = [...withImages, ...fallback].slice(0, 2)
    const trending = trendingCandidates.map((item, index) => {
      const cats = item.categories.map(({ categoryCode }) => categoryCode)
      const analysis = item.impactAnalyses[0]
      const assessmentText = analysis?.aiAssessmentJson && typeof analysis.aiAssessmentJson === 'object' && 'text' in analysis.aiAssessmentJson
        ? String((analysis.aiAssessmentJson as { text?: unknown }).text ?? '')
        : null
      const suggestedRateDelta = analysis?.suggestedRateDelta?.toString() ?? null
      return {
        rank: (index === 0 ? 1 : 2) as 1 | 2,
        id: item.id,
        title: item.title,
        summary: assessmentText ? assessmentText.slice(0, 180) : null,
        imageUrl: item.imageUrl,
        proxyUrl: proxyImageUrl(item.imageUrl),
        sourceName: item.sources[0]?.source.name ?? null,
        publishedAt: item.publishedAt,
        readMinutes: estimateReadMinutes(item.title),
        categories: cats,
        suggestedRateDelta,
        trendReason: cats.includes('FINANCIAL_FRAUD')
          ? 'Cảnh báo an toàn tài chính đáng chú ý'
          : suggestedRateDelta
            ? `Biến động lãi suất ${suggestedRateDelta} điểm %`
            : 'Tin tài chính nổi bật mới ghi nhận',
      }
    })

    const alertItems = alerts.map((item) => {
      const alertImg = item.evidence[0]?.articleSource.article.imageUrl ?? null
      return {
        id: item.id,
        kind: 'ALERT' as const,
        title: item.tacticSummary,
        badge: 'Cảnh báo Scam · Đã xác minh',
        imageUrl: alertImg,
        proxyUrl: proxyImageUrl(alertImg),
        sourceName: item.evidence[0]?.articleSource.source.name ?? 'Radar FinCopilot',
        publishedAt: item.publishedAt,
        handoffHref: handoffRoutes.radarAlertToForensic({
          alertId: item.id,
          summary: item.tacticSummary.trim().slice(0, 500) || undefined,
        }),
      }
    })

    const financeFocusArticles = combined
      .filter((item) => item.categories.some(({ categoryCode }) => ['FINANCIAL_FRAUD', 'INTEREST_RATE', 'INFLATION'].includes(categoryCode)))
      .slice(0, Math.max(0, 6 - alertItems.length))
      .map((item) => {
        const cats = item.categories.map(({ categoryCode }) => categoryCode)
        const isFraud = cats.includes('FINANCIAL_FRAUD')
        const delta = item.impactAnalyses[0]?.suggestedRateDelta?.toString()
        return {
          id: item.id,
          kind: (isFraud ? 'SCAM_NEWS' : 'FINANCE_NEWS') as 'SCAM_NEWS' | 'FINANCE_NEWS',
          title: item.title,
          badge: isFraud ? 'Tin lừa đảo' : 'Tài chính · Lãi suất',
          imageUrl: item.imageUrl,
          proxyUrl: proxyImageUrl(item.imageUrl),
          sourceName: item.sources[0]?.source.name ?? null,
          publishedAt: item.publishedAt,
          handoffHref: isFraud
            ? ROUTES.radarArticle(item.id)
            : delta
              ? handoffRoutes.radarToSurvey({ shockDelta: delta, articleId: item.id })
              : ROUTES.radarArticle(item.id),
        }
      })

    const grouped = new Map<string, number[]>()
    for (const row of activeProducts) {
      const list = grouped.get(row.productCategory) ?? []
      list.push(Number(row.nominalRateMin.toString()))
      grouped.set(row.productCategory, list)
    }
    const marketRates = [...grouped.entries()].map(([category, rates]) => ({
      category,
      label: categoryBenchmarkLabels[category] ?? category,
      minRatePct: Math.min(...rates),
      medianRatePct: medianOf(rates),
      maxRatePct: Math.max(...rates),
      sampleCount: rates.length,
    }))

    const latestAlert = alerts[0]
      ? {
          id: alerts[0].id,
          tacticSummary: alerts[0].tacticSummary,
          preventionGuidance: alerts[0].preventionGuidance,
          publishedAt: alerts[0].publishedAt,
        }
      : null

    return {
      alert: latestAlert,
      articles,
      trending,
      scamFinanceRail: [...alertItems, ...financeFocusArticles].slice(0, 6),
      marketRates,
    }
  }
}
