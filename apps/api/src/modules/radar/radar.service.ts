import { createHash, randomUUID } from 'node:crypto'
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Job, Queue } from 'bullmq'
import { z } from 'zod'
import { PrismaService } from '../../common/prisma.service'
import { ProfileAuthService } from '../profile-auth/profile-auth.service'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { AI_TASK_SCHEMAS } from '@fincopilot/shared-types'

const categoryKeywords: Record<string, string[]> = {
  INTEREST_RATE: ['lãi suất', 'lãi vay', 'lãi suất huy động', 'rate'],
  BANKING: ['ngân hàng', 'tín dụng', 'sbv', 'nhnn'],
  MARKET: ['chứng khoán', 'thị trường', 'kinh tế', 'cổ phiếu'],
  POLICY: ['chính sách', 'nghị định', 'thông tư', 'điều hành'],
  FINANCIAL_FRAUD: ['lừa đảo', 'giả mạo', 'phishing', 'ncsc', 'cảnh báo'],
}

type FeedEntry = { title: string; url: string; publishedAt: Date | null; description: string }

function decodeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ').trim()
}

function tag(block: string, name: string): string {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(block)
  return match?.[1] ? decodeXml(match[1]) : ''
}

function parseFeed(text: string, sourceType: string, endpoint: string): FeedEntry[] {
  const entries = [...text.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)].map(([, block]) => {
    const rawLink = tag(block, 'link') || /<link\b[^>]*href=["']([^"']+)["']/i.exec(block)?.[1] || ''
    const date = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated')
    const parsedDate = date ? new Date(date) : null
    return {
      title: tag(block, 'title'), url: rawLink ? new URL(rawLink, endpoint).toString() : '',
      publishedAt: parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate : null,
      description: tag(block, 'description') || tag(block, 'summary') || tag(block, 'content'),
    }
  }).filter((entry) => entry.title && entry.url)
  if (entries.length || sourceType.toUpperCase() !== 'WEB') return entries.slice(0, 100)

  // Basic public-page fallback for the two official web sources; only article links are retained.
  const origin = new URL(endpoint).origin
  return [...text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(([, href, label]) => ({ title: decodeXml(label), url: new URL(href, origin).toString(), publishedAt: null, description: '' }))
    .filter((entry) => entry.title.length >= 18 && /^https?:/i.test(entry.url) && !/javascript:|#/.test(entry.url))
    .slice(0, 40)
}

function normalizeUrl(raw: string): string {
  const url = new URL(raw)
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref)/i.test(key)) url.searchParams.delete(key)
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString()
}

function categoriesFor(text: string): string[] {
  const value = text.toLocaleLowerCase('vi')
  return Object.entries(categoryKeywords).filter(([, words]) => words.some((word) => value.includes(word))).map(([code]) => code)
}

@Processor('radar-ingestion')
@Injectable()
export class RadarService extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(RadarService.name)

  constructor(
    @InjectQueue('radar-ingestion') private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ai: AiGatewayService,
    private readonly profiles: ProfileAuthService,
  ) { super() }

  async onModuleInit() {
    await this.queue.upsertJobScheduler('radar-periodic-scan', { every: 15 * 60_000 }, { name: 'fetch-all' })
  }

  async process(job: Job<{ sourceKey?: string }>) {
    if (job.name !== 'fetch-all') return { skipped: true }
    const sources = await this.prisma.marketSource.findMany({
      where: { isActive: true, ...(job.data.sourceKey ? { sourceKey: job.data.sourceKey } : {}) },
      orderBy: { sourceKey: 'asc' },
    })
    const results = await Promise.all(sources.map((source) => this.fetchSource(source)))
    return { results }
  }

  async enqueueFetch(sourceKey?: string) {
    const job = await this.queue.add('fetch-all', { sourceKey }, {
      jobId: sourceKey ? `manual-${sourceKey}-${Date.now()}` : `manual-all-${Date.now()}`,
      attempts: 1, removeOnComplete: 100, removeOnFail: 100,
    })
    return { jobId: job.id, queued: true }
  }

  async getJob(jobId: string) {
    const job = await this.queue.getJob(jobId)
    if (!job) throw new NotFoundException('Không tìm thấy tác vụ quét.')
    return { jobId, state: await job.getState(), result: job.returnvalue ?? null, error: job.failedReason ?? null }
  }

  async listArticles(query: { category?: string; search?: string; cursor?: string; limit?: number }) {
    const take = Math.min(Math.max(query.limit ?? 20, 1), 50)
    const where = {
      feedStatus: 'ACTIVE',
      ...(query.category ? { categories: { some: { categoryCode: query.category.toUpperCase() } } } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' as const } } : {}),
    }
    const rows = await this.prisma.marketArticle.findMany({
      where, take: take + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      include: { categories: true, sources: { include: { source: true } } },
    })
    const hasMore = rows.length > take
    const items = rows.slice(0, take)
    const sources = await this.prisma.marketSource.findMany({ where: { isActive: true }, orderBy: { sourceKey: 'asc' } })
    return {
      items: items.map((row) => this.articleDto(row)),
      page: { limit: take, hasMore, nextCursor: hasMore ? items.at(-1)?.id ?? null : null },
      sources: sources.map((source) => ({ sourceKey: source.sourceKey, name: source.name, lastFetchStatus: source.lastFetchStatus, lastAttemptAt: source.lastAttemptAt, lastSuccessAt: source.lastSuccessAt })),
    }
  }

  async articleDetail(id: string) {
    const article = await this.prisma.marketArticle.findUnique({ where: { id }, include: { categories: true, sources: { include: { source: true } } } })
    if (!article) throw new NotFoundException('Không tìm thấy bài viết.')
    const analyses = await this.prisma.articleImpactAnalysis.findMany({ where: { articleId: id, analysisMode: 'GENERAL', profileId: null }, orderBy: { createdAt: 'desc' }, take: 1 })
    const analysis = analyses[0]
    return {
      ...this.articleDto(article),
      analysis: analysis ? { mode: analysis.analysisMode, facts: analysis.extractedFactsJson, assessment: analysis.aiAssessmentJson, suggestedRateDelta: analysis.suggestedRateDelta?.toString() ?? null } : null,
    }
  }

  async analyzeArticle(id: string, session: { kind: 'guest'; guestSessionId: string } | { kind: 'user'; userId: string }) {
    const article = await this.prisma.marketArticle.findUnique({ where: { id }, include: { sources: { include: { source: true } } } })
    if (!article) throw new NotFoundException('Không tìm thấy bài viết.')
    const profile = await this.profiles.getActiveProfile(session)
    const mode = profile ? 'PERSONALIZED' : 'GENERAL'
    try {
      const output = await this.ai.generateStructured('RADAR_CLASSIFY_IMPACT', AI_TASK_SCHEMAS.RADAR_CLASSIFY_IMPACT, {
        article: { title: article.title, publishedAt: article.publishedAt, sources: article.sources.map((source) => ({ name: source.source.name, url: source.sourceUrl })) },
        profile: profile ?? null,
        instruction: 'Separate source-backed facts from AI interpretation. Use only supplied source URLs. If no profile, give general analysis and disclose assumptions.',
      })
      const saved = await this.prisma.articleImpactAnalysis.create({ data: {
        id: randomUUID(), articleId: article.id, profileId: profile?.id ?? null, analysisMode: mode,
        extractedFactsJson: output.extractedFacts, aiAssessmentJson: { text: output.aiAssessment, topics: output.topics },
        suggestedRateDelta: output.suggestedRateDelta,
        llmProvider: 'gateway', llmModel: 'configured',
      } })
      if (output.isFraudAlert && article.sources.some((source) => source.source.isTrustedForAlerts)) {
        await this.createThreatAlert(article, output)
      }
      return { mode, facts: output.extractedFacts, assessment: output.aiAssessment, suggestedRateDelta: output.suggestedRateDelta, assumptions: profile ? [] : ['Không có hồ sơ R07; đây là phân tích tổng quát.'], citations: article.sources.map((source) => ({ sourceId: source.sourceId, url: source.sourceUrl, sourceName: source.source.name })), createdAt: saved.createdAt }
    } catch (error) {
      this.logger.warn(`AI impact analysis unavailable for article ${id}: ${error instanceof Error ? error.message : 'unknown error'}`)
      return { mode, facts: [], assessment: null, suggestedRateDelta: null, assumptions: ['Dịch vụ AI hiện không khả dụng.'], citations: article.sources.map((source) => ({ sourceId: source.sourceId, url: source.sourceUrl, sourceName: source.source.name })), unavailable: true }
    }
  }

  async listAlerts() {
    const alerts = await this.prisma.threatAlert.findMany({
      where: { publishedAt: { not: null } }, orderBy: { publishedAt: 'desc' }, take: 50,
      include: { indicators: true, evidence: { include: { articleSource: { include: { source: true, article: true } } } } },
    })
    return { items: alerts.map((alert) => this.alertDto(alert)) }
  }

  async alertDetail(id: string) {
    const alert = await this.prisma.threatAlert.findUnique({
      where: { id }, include: { indicators: true, evidence: { include: { articleSource: { include: { source: true, article: true } } } } },
    })
    if (!alert || !alert.publishedAt) throw new NotFoundException('Không tìm thấy cảnh báo.')
    return this.alertDto(alert)
  }

  private async fetchSource(source: { id: string; sourceKey: string; endpointUrl: string; sourceType: string }) {
    const attemptedAt = new Date()
    try {
      const response = await fetch(source.endpointUrl, { signal: AbortSignal.timeout(12_000), headers: { 'user-agent': 'FinCopilotRadar/1.0 (+contact project team)', accept: 'application/rss+xml, application/atom+xml, text/html;q=0.8' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = (await response.text()).slice(0, 2_000_000)
      const entries = parseFeed(body, source.sourceType, source.endpointUrl)
      for (const entry of entries) await this.upsertEntry(source, entry)
      await this.prisma.marketSource.update({ where: { id: source.id }, data: { lastFetchStatus: 'SUCCESS', lastAttemptAt: attemptedAt, lastSuccessAt: new Date(), updatedAt: new Date() } })
      return { sourceKey: source.sourceKey, status: 'SUCCESS', items: entries.length }
    } catch (error) {
      await this.prisma.marketSource.update({ where: { id: source.id }, data: { lastFetchStatus: 'ERROR', lastAttemptAt: attemptedAt, updatedAt: new Date() } })
      this.logger.warn(`Radar source ${source.sourceKey} fetch failed: ${error instanceof Error ? error.message : 'unknown error'}`)
      return { sourceKey: source.sourceKey, status: 'ERROR', items: 0 }
    }
  }

  private async upsertEntry(source: { id: string }, entry: FeedEntry) {
    let sourceUrl: string
    let normalizedUrl: string
    try { sourceUrl = new URL(entry.url, 'https://invalid.local').toString(); normalizedUrl = normalizeUrl(sourceUrl) } catch { return }
    if (!/^https?:$/.test(new URL(sourceUrl).protocol) || !entry.title) return
    const hash = createHash('sha256').update(`${entry.title.trim().toLocaleLowerCase('vi')}|${entry.description.trim().toLocaleLowerCase('vi')}|${entry.publishedAt?.toISOString() ?? ''}`).digest('hex')
    const exact = await this.prisma.articleSource.findFirst({ where: { sourceId: source.id, normalizedSourceUrl: normalizedUrl } })
    const canonical = exact
      ? await this.prisma.marketArticle.findUnique({ where: { id: exact.articleId } })
      : await this.prisma.marketArticle.findFirst({ where: { contentHash: hash, feedStatus: 'ACTIVE' }, orderBy: { createdAt: 'asc' } })
    const article = canonical ?? await this.prisma.marketArticle.upsert({
      where: { canonicalUrl: normalizedUrl },
      create: { id: randomUUID(), canonicalUrl: normalizedUrl, title: entry.title, publishedAt: entry.publishedAt, contentHash: hash, feedStatus: 'ACTIVE' },
      update: { title: entry.title, publishedAt: entry.publishedAt ?? undefined, contentHash: hash, updatedAt: new Date() },
    })
    const seenAt = new Date()
    await this.prisma.articleSource.upsert({
      where: { articleId_sourceId: { articleId: article.id, sourceId: source.id } },
      create: { articleId: article.id, sourceId: source.id, sourceUrl, normalizedSourceUrl: normalizedUrl, firstSeenAt: seenAt, lastSeenAt: seenAt },
      update: { lastSeenAt: seenAt },
    })
    const categories = categoriesFor(`${entry.title} ${entry.description}`)
    for (const categoryCode of categories) await this.prisma.articleCategory.upsert({ where: { articleId_categoryCode: { articleId: article.id, categoryCode } }, create: { articleId: article.id, categoryCode }, update: {} })
    await this.classifyIngestion(article.id)
  }

  private async classifyIngestion(articleId: string) {
    const alreadyAnalyzed = await this.prisma.articleImpactAnalysis.findFirst({ where: { articleId, analysisMode: 'GENERAL' }, select: { id: true } })
    if (alreadyAnalyzed) return
    const article = await this.prisma.marketArticle.findUnique({ where: { id: articleId }, include: { sources: { include: { source: true } } } })
    if (!article) return
    try {
      const output = await this.ai.generateStructured('RADAR_CLASSIFY_IMPACT', AI_TASK_SCHEMAS.RADAR_CLASSIFY_IMPACT, {
        article: { title: article.title, publishedAt: article.publishedAt, sources: article.sources.map((source) => ({ name: source.source.name, url: source.sourceUrl })) },
        profile: null,
        instruction: 'Classify topics and extract only source-supported facts. Separate interpretation. Use only supplied source URLs. Return no unsupported facts or indicators.',
      })
      await this.prisma.articleImpactAnalysis.create({ data: {
        id: randomUUID(), articleId, profileId: null, analysisMode: 'GENERAL',
        extractedFactsJson: output.extractedFacts, aiAssessmentJson: { text: output.aiAssessment, topics: output.topics },
        suggestedRateDelta: output.suggestedRateDelta, llmProvider: 'gateway', llmModel: 'configured',
      } })
      if (output.isFraudAlert) await this.createThreatAlert(article, output)
    } catch (error) {
      this.logger.warn(`Ingestion classification unavailable for article ${articleId}: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  private async createThreatAlert(article: { id: string; title: string; publishedAt: Date | null; sources: Array<{ sourceId: string; sourceUrl: string; source: { isTrustedForAlerts: boolean } }> }, output: z.infer<typeof AI_TASK_SCHEMAS.RADAR_CLASSIFY_IMPACT>) {
    const trustedLink = article.sources.find((item) => item.source.isTrustedForAlerts)
    if (!trustedLink || output.indicators.length === 0) return
    const tacticSummary = output.aiAssessment.trim() || article.title
    const existing = await this.prisma.threatEvidence.findFirst({ where: { articleId: article.id, sourceId: trustedLink.sourceId } })
    if (existing) return
    await this.prisma.$transaction(async (tx) => {
      const alertId = randomUUID()
      await tx.threatAlert.create({ data: { id: alertId, threatCategory: 'PHISHING', tacticSummary, preventionGuidance: 'Không chia sẻ mã OTP, không chuyển phí để mở khóa khoản vay; xác minh trực tiếp với tổ chức qua kênh chính thức.', verificationStatus: 'UNVERIFIED', issuedAt: article.publishedAt, publishedAt: new Date(), evidence: { create: { articleId: article.id, sourceId: trustedLink.sourceId } }, indicators: { create: output.indicators.map((item) => ({ id: randomUUID(), indicatorType: item.indicatorType, indicatorText: item.indicatorText })) } } })
    })
  }

  private articleDto(row: { id: string; title: string; canonicalUrl: string; publishedAt: Date | null; categories: Array<{ categoryCode: string }>; sources: Array<{ sourceUrl: string; firstSeenAt: Date; lastSeenAt: Date; source: { id: string; name: string; sourceKey: string } }> }) {
    return { id: row.id, title: row.title, canonicalUrl: row.canonicalUrl, publishedAt: row.publishedAt, categories: row.categories.map((item) => item.categoryCode), sources: row.sources.map((item) => ({ sourceId: item.source.id, sourceKey: item.source.sourceKey, sourceName: item.source.name, url: item.sourceUrl, firstSeenAt: item.firstSeenAt, lastSeenAt: item.lastSeenAt })) }
  }

  private alertDto(alert: { id: string; threatCategory: string; tacticSummary: string; preventionGuidance: string; verificationStatus: string; issuedAt: Date | null; publishedAt: Date | null; verifiedAt: Date | null; indicators: Array<{ id: string; indicatorType: string; indicatorText: string }>; evidence: Array<{ articleSource: { article: { id: string; title: string; publishedAt: Date | null }; source: { id: string; name: string }; sourceUrl: string } }> }) {
    return { id: alert.id, threatCategory: alert.threatCategory, tacticSummary: alert.tacticSummary, preventionGuidance: alert.preventionGuidance, verificationStatus: alert.verificationStatus, issuedAt: alert.issuedAt, publishedAt: alert.publishedAt, verifiedAt: alert.verifiedAt, indicators: alert.indicators, evidence: alert.evidence.map(({ articleSource }) => ({ articleId: articleSource.article.id, title: articleSource.article.title, sourceId: articleSource.source.id, sourceName: articleSource.source.name, url: articleSource.sourceUrl, publishedAt: articleSource.article.publishedAt })) }
  }
}
