import { createHash, randomUUID } from 'node:crypto'
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Job, Queue } from 'bullmq'
import { z } from 'zod'
import { PrismaService } from '../../common/prisma.service'
import { ProfileAuthService } from '../profile-auth/profile-auth.service'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { AI_TASK_SCHEMAS, RadarDailyBriefRequestSchema } from '@fincopilot/shared-types'
import type { SessionContext } from '@fincopilot/shared-types'
import { fetchPublicDocument, fetchPublicImage } from '../admin/threat-safety'
import { attachThreatDraft, publicThreatAlertWhere } from '../forensic/threat-draft'
import { ThreatMemoryService } from '../forensic/threat-memory.service'

const categoryKeywords: Record<string, string[]> = {
  INTEREST_RATE: ['lãi suất', 'lãi vay', 'lãi suất huy động', 'rate'],
  BANKING: ['ngân hàng', 'tín dụng', 'sbv', 'nhnn'],
  MARKET: ['chứng khoán', 'thị trường', 'kinh tế', 'cổ phiếu'],
  INFLATION: ['lạm phát', 'cpi', 'giá tiêu dùng', 'sức mua', 'chi phí sinh hoạt'],
  POLICY: ['chính sách', 'nghị định', 'thông tư', 'điều hành'],
  FINANCIAL_FRAUD: ['lừa đảo', 'giả mạo', 'phishing', 'ncsc', 'cảnh báo'],
}

type FeedEntry = { title: string; url: string; publishedAt: Date | null; description: string; imageUrl: string | null }

const VIETNAM_OFFSET = '+07:00'
const recommendationConsentSchema = z.strictObject({
  includeProfileGoal: z.boolean().default(false),
  includeSurveyTopics: z.boolean().default(false),
  includeForensicHistory: z.boolean().default(false),
})

type BriefCandidate = {
  id: string
  kind: 'ARTICLE' | 'ALERT'
  title: string
  publishedAt: Date | null
  updatedAt: Date
  categories: string[]
  verificationStatus: string | null
  sources: Array<{ sourceName: string; sourceTitle: string; url: string; sourcePublishedAt: Date | null }>
  sourceFacts: string[]
}
type BriefBaseLine = { referenceId: string; summary: string; interpretation: string | null; generatedByAi: boolean }
type BriefBase = { status: 'AI_SUMMARY' | 'SOURCE_FALLBACK' | 'EMPTY'; items: BriefBaseLine[]; updatedAt: string }

function validHttpsUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password } catch { return false }
}

function briefInclusionReason(candidate: BriefCandidate): string {
  if (candidate.kind === 'ALERT' && candidate.verificationStatus === 'VERIFIED') return 'Cảnh báo đã xác minh, được ưu tiên theo ngày công bố.'
  if (candidate.kind === 'ALERT') return 'Cảnh báo có dẫn chứng; trạng thái xác minh được hiển thị riêng.'
  if (candidate.categories.includes('FINANCIAL_FRAUD')) return 'Bài viết về dấu hiệu lừa đảo; không đồng nghĩa cảnh báo đã xác minh.'
  return 'Tin tài chính được chọn theo chủ đề và thời điểm công bố.'
}

function vnDay(value = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value)
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${fields.year}-${fields.month}-${fields.day}`
}

function vnDayLabel(day: string): string {
  const [year, month, date] = day.split('-')
  return `${date}/${month}/${year}`
}

export function dateOnly(value: string, endOfDay = false): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Ngày phải theo định dạng YYYY-MM-DD.')
  if (!Number.isFinite(new Date(`${value}T00:00:00Z`).getTime()) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new BadRequestException('Ngày lọc không hợp lệ.')
  const date = new Date(`${value}T00:00:00${VIETNAM_OFFSET}`)
  if (endOfDay) date.setTime(date.getTime() + 86_400_000)
  return date
}

function todayInVietnam(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

const trackingImageUrl = /(?:1x1|pixel|spacer|blank\.gif|clear\.gif|doubleclick|scorecardresearch|beacon)/i

function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .trim()
}

function normalizeHttpsImageUrl(candidate: string | undefined | null, base: string): string | null {
  if (!candidate) return null
  const decoded = decodeEntities(candidate)
  if (!decoded || /^data:/i.test(decoded) || trackingImageUrl.test(decoded)) return null
  try {
    const image = new URL(decoded, base)
    if (image.protocol !== 'https:' || image.username || image.password) return null
    return image.toString()
  } catch {
    return null
  }
}

function extractHtmlImageCandidate(block: string): string | undefined {
  const sections = [
    /<content:encoded\b[^>]*>([\s\S]*?)<\/content:encoded>/i.exec(block)?.[1],
    /<description\b[^>]*>([\s\S]*?)<\/description>/i.exec(block)?.[1],
    /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(block)?.[1],
    block,
  ].filter((part): part is string => Boolean(part))
  for (const section of sections) {
    const html = section.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    for (const [, attrs] of html.matchAll(/<img\b([^>]*)>/gi)) {
      if (/\b(?:width|height)\s*=\s*["']?(?:0|1)["']?(?:\s|$)/i.test(attrs)) continue
      const src = /\b(?:data-src|data-original|src)\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]
      if (src && !/^data:/i.test(src) && !trackingImageUrl.test(src)) return src
    }
  }
  return undefined
}

export function extractOgImageUrl(html: string, pageUrl: string): string | null {
  for (const [, attrs] of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const key = /\b(?:property|name)\s*=\s*["'](og:image(?::secure_url)?|twitter:image(?::src)?)["']/i.exec(attrs)?.[1]
    if (!key) continue
    const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]
    const resolved = normalizeHttpsImageUrl(content, pageUrl)
    if (resolved) return resolved
  }
  return null
}

export function articleImageUrl(block: string, endpoint: string): string | null {
  const mediaElement = /<(media:content|media:thumbnail|enclosure)\b([^>]*)>/i.exec(block)
  if (mediaElement?.[1].toLowerCase() === 'enclosure' && !/\btype=["']image\//i.test(mediaElement[2])) return null
  const mediaCandidate = (mediaElement?.[2] ? /\burl=["']([^"']+)["']/i.exec(mediaElement[2])?.[1] : undefined)
    ?? /<image\b[^>]*>[\s\S]*?<url[^>]*>([\s\S]*?)<\/url>[\s\S]*?<\/image>/i.exec(block)?.[1]
  const candidate = mediaCandidate ?? extractHtmlImageCandidate(block)
  return normalizeHttpsImageUrl(candidate, endpoint)
}

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

export function parseFeed(text: string, sourceType: string, endpoint: string): FeedEntry[] {
  const entries = [...text.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)].map(([, block]) => {
    const rawLink = tag(block, 'link') || /<link\b[^>]*href=["']([^"']+)["']/i.exec(block)?.[1] || ''
    const date = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated')
    const parsedDate = date ? new Date(date) : null
    return {
      title: tag(block, 'title'), url: rawLink ? new URL(rawLink, endpoint).toString() : '',
      publishedAt: parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate : null,
      description: tag(block, 'description') || tag(block, 'summary') || tag(block, 'content'),
      imageUrl: articleImageUrl(block, endpoint),
    }
  }).filter((entry) => entry.title && entry.url)
  if (entries.length || sourceType.toUpperCase() !== 'WEB') return entries.slice(0, 100)

  // Basic public-page fallback for the two official web sources; only article links are retained.
  const origin = new URL(endpoint).origin
  return [...text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(([, href, label]) => ({ title: decodeXml(label), url: new URL(href, origin).toString(), publishedAt: null, description: '', imageUrl: null }))
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

export function categoriesFor(text: string): string[] {
  const value = text.toLocaleLowerCase('vi')
  return Object.entries(categoryKeywords).filter(([, words]) => words.some((word) => value.includes(word))).map(([code]) => code)
}

@Processor('radar-ingestion')
@Injectable()
export class RadarService extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(RadarService.name)
  private readonly dailyBriefCache = new Map<string, { expiresAt: number; value: BriefBase }>()
  private readonly dailyBriefInFlight = new Map<string, Promise<BriefBase>>()

  constructor(
    @InjectQueue('radar-ingestion') private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ai: AiGatewayService,
    private readonly profiles: ProfileAuthService,
    private readonly threatMemory: ThreatMemoryService,
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

  async listArticles(query: { category?: string; search?: string; cursor?: string; limit?: number; period?: string; year?: string; from?: string; to?: string }) {
    const requestedLimit = query.limit ?? 20
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) throw new BadRequestException('Số tin mỗi trang phải từ 1 đến 50.')
    const take = requestedLimit
    let publishedAt: { gte?: Date; lt?: Date } | undefined
    if (query.period && (query.from || query.to || query.year)) throw new BadRequestException('Chỉ chọn một trong khoảng ngày, năm hoặc khoảng thời gian nhanh.')
    if (query.year && (query.from || query.to)) throw new BadRequestException('Không thể kết hợp chọn năm với khoảng ngày.')
    if (query.period) {
      const today = todayInVietnam()
      if (query.period === 'today') publishedAt = { gte: dateOnly(today), lt: dateOnly(today, true) }
      else if (query.period === '7d') publishedAt = { gte: new Date(dateOnly(today).getTime() - 6 * 86_400_000), lt: dateOnly(today, true) }
      else if (query.period === 'month') {
        const [year, month] = today.slice(0, 7).split('-').map(Number)
        const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`
        publishedAt = { gte: dateOnly(`${today.slice(0, 7)}-01`), lt: dateOnly(nextMonth) }
      }
      else throw new BadRequestException('Khoảng thời gian không được hỗ trợ.')
    } else if (query.year) {
      if (!/^\d{4}$/.test(query.year)) throw new BadRequestException('Năm phải gồm 4 chữ số.')
      publishedAt = { gte: dateOnly(`${query.year}-01-01`), lt: dateOnly(`${Number(query.year) + 1}-01-01`) }
    } else if (query.from || query.to) {
      const gte = query.from ? dateOnly(query.from) : undefined
      const lt = query.to ? dateOnly(query.to, true) : undefined
      if (gte && lt && gte >= lt) throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.')
      publishedAt = { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) }
    }
    const where = {
      feedStatus: 'ACTIVE',
      ...(query.category ? { categories: { some: { categoryCode: query.category.toUpperCase() } } } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' as const } } : {}),
      ...(publishedAt ? { publishedAt } : {}),
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

  async articleHighlights() {
    const rows = await this.prisma.marketArticle.findMany({
      where: { feedStatus: 'ACTIVE', publishedAt: { not: null } }, take: 80,
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      include: { categories: true, sources: { include: { source: true } } },
    })
    const ids = rows.map((row) => row.id)
    const evidence = ids.length ? await this.prisma.threatEvidence.findMany({
      where: { articleId: { in: ids }, threatAlert: { publishedAt: { not: null } } },
      select: { articleId: true, threatAlert: { select: { verificationStatus: true } } },
    }) : []
    const alertStates = new Map<string, string[]>()
    for (const item of evidence) alertStates.set(item.articleId, [...(alertStates.get(item.articleId) ?? []), item.threatAlert.verificationStatus])
    const now = Date.now()
    const ranked = rows.map((row) => {
      const dto = this.articleDto(row)
      const ageHours = row.publishedAt ? Math.max(0, (now - row.publishedAt.getTime()) / 3_600_000) : Number.POSITIVE_INFINITY
      const states = alertStates.get(row.id) ?? []
      const categories = row.categories.map((item) => item.categoryCode)
      const priorityReasons: string[] = []
      let score = ageHours <= 24 ? 30 : ageHours <= 24 * 7 ? 18 : ageHours <= 24 * 30 ? 8 : 0
      if (ageHours <= 24) priorityReasons.push('Công bố trong 24 giờ qua')
      else if (ageHours <= 24 * 7) priorityReasons.push('Công bố trong 7 ngày qua')
      if (states.includes('VERIFIED')) { score += 50; priorityReasons.push('Có cảnh báo liên quan đã xác minh') }
      else if (states.length) { score += 20; priorityReasons.push('Có cảnh báo liên quan, đang/chưa được xác minh') }
      if (categories.includes('FINANCIAL_FRAUD')) { score += 18; priorityReasons.push('Chủ đề phòng tránh lừa đảo') }
      if (categories.includes('INFLATION')) { score += 12; priorityReasons.push('Chủ đề lạm phát') }
      if (categories.includes('INTEREST_RATE')) { score += 10; priorityReasons.push('Chủ đề lãi suất') }
      const sourceCount = new Set(row.sources.map((item) => item.sourceId)).size
      if (sourceCount >= 2) { score += Math.min(sourceCount, 4) * 3; priorityReasons.push(`Được ${sourceCount} nguồn ghi nhận; chưa đánh giá tính độc lập`) }
      return { item: { ...dto, editorialPriority: score >= 35 ? 'HIGH' as const : 'STANDARD' as const, priorityReasons }, score }
    }).sort((a, b) => b.score - a.score
      || (new Date(b.item.publishedAt ?? 0).getTime() - new Date(a.item.publishedAt ?? 0).getTime()))
    return { items: ranked.slice(0, 8).map(({ item }) => item), ranking: 'recency + topic + published alert state + distinct source count; no popularity score' }
  }

  async dailyBrief(session: SessionContext, input: unknown) {
    const parsed = RadarDailyBriefRequestSchema.safeParse(input ?? {})
    if (!parsed.success) throw new BadRequestException('Tùy chọn bản tin cá nhân chưa hợp lệ.')
    const request = parsed.data
    const candidates = await this.dailyBriefCandidates()
    const day = vnDay()
    const fingerprint = createHash('sha256').update(JSON.stringify(candidates.map((item) => [item.id, item.updatedAt.toISOString(), item.verificationStatus, item.sourceFacts, item.sources.map((source) => source.url)]))).digest('hex').slice(0, 20)
    const cacheKey = `${day}:${fingerprint}`
    const base = await this.cachedDailyBrief(cacheKey, day, candidates)

    let signals: Array<{ categoryCode: string; source: 'PROFILE_GOAL' | 'SURVEY_TOPIC' | 'FORENSIC_HISTORY'; reason: string }> = []
    if (request.personalizationEnabled && (request.includeProfileGoal || request.includeSurveyTopics || request.includeForensicHistory)) {
      signals = (await this.recommendationSignals(session, {
        includeProfileGoal: request.includeProfileGoal,
        includeSurveyTopics: request.includeSurveyTopics,
        includeForensicHistory: request.includeForensicHistory,
      })).signals
    }
    const allowedTopics = new Set(request.personalizationEnabled ? [...request.topics, ...signals.map((signal) => signal.categoryCode)] : [])
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
    const items = base.items.map((line) => {
      const candidate = byId.get(line.referenceId)
      if (!candidate) return null
      const sources = candidate.sources.filter((source) => validHttpsUrl(source.url))
      if (!sources.length) return null
      const matchedTopic = candidate.categories.find((topic) => allowedTopics.has(topic))
      const matchedSignal = matchedTopic ? signals.find((signal) => signal.categoryCode === matchedTopic) : undefined
      const relevance = matchedTopic
        ? matchedSignal?.reason ?? `Liên quan đến chủ đề ${matchedTopic === 'INTEREST_RATE' ? 'lãi suất' : matchedTopic === 'INFLATION' ? 'lạm phát' : matchedTopic === 'BANKING' ? 'ngân hàng' : matchedTopic === 'FINANCIAL_FRAUD' ? 'lừa đảo tài chính' : matchedTopic === 'POLICY' ? 'chính sách' : 'thị trường'} bạn đã chọn.`
        : null
      return {
        id: candidate.id, kind: candidate.kind, summary: line.summary, interpretation: line.interpretation,
        generatedByAi: line.generatedByAi, category: candidate.categories[0] ?? (candidate.kind === 'ALERT' ? 'FINANCIAL_FRAUD' : 'MARKET'),
        publishedAt: candidate.publishedAt, verificationStatus: candidate.verificationStatus,
        inclusionReason: briefInclusionReason(candidate), relevance,
        citations: sources.map((source) => ({ sourceName: source.sourceName, sourceTitle: source.sourceTitle, url: source.url, publishedAt: source.sourcePublishedAt })),
      }
    }).filter((item): item is NonNullable<typeof item> => item !== null)

    return {
      date: day, dateLabel: vnDayLabel(day), status: base.status, updatedAt: base.updatedAt,
      isStale: candidates.length > 0 && !candidates.some((item) => item.publishedAt && Date.now() - item.publishedAt.getTime() <= 24 * 60 * 60_000),
      personalization: { enabled: request.personalizationEnabled, usedSignals: signals.map(({ categoryCode, source }) => ({ categoryCode, source })) },
      items,
    }
  }

  private async dailyBriefCandidates(): Promise<BriefCandidate[]> {
    const since = new Date(Date.now() - 14 * 86_400_000)
    const [alerts, articles] = await Promise.all([
      this.prisma.threatAlert.findMany({
        where: publicThreatAlertWhere, orderBy: [{ publishedAt: 'desc' }], take: 30,
        include: {
          indicators: true,
          evidence: { include: { articleSource: { include: { source: true, article: true } } } },
        },
      }),
      this.prisma.marketArticle.findMany({
        where: { feedStatus: 'ACTIVE', publishedAt: { gte: since } }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: 40,
        include: {
          categories: true,
          sources: { include: { source: true } },
          impactAnalyses: { where: { analysisMode: 'GENERAL', profileId: null }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
    ])
    const alertItems: BriefCandidate[] = alerts.map((alert) => ({
      id: alert.id, kind: 'ALERT', title: alert.tacticSummary, publishedAt: alert.publishedAt,
      updatedAt: alert.updatedAt, categories: ['FINANCIAL_FRAUD'], verificationStatus: alert.verificationStatus,
      sources: alert.evidence.map(({ articleSource }) => ({ sourceName: articleSource.source.name, sourceTitle: articleSource.article.title, url: articleSource.sourceUrl, sourcePublishedAt: articleSource.article.publishedAt })),
      sourceFacts: [alert.tacticSummary, ...alert.indicators.map((indicator) => indicator.indicatorText), alert.preventionGuidance].filter(Boolean),
    }))
    const articleItems: BriefCandidate[] = articles.map((article) => {
      const analysis = article.impactAnalyses[0]
      const facts = Array.isArray(analysis?.extractedFactsJson) ? analysis.extractedFactsJson.filter((item): item is string => typeof item === 'string').slice(0, 5) : []
      return {
        id: article.id, kind: 'ARTICLE', title: article.title, publishedAt: article.publishedAt,
        updatedAt: article.updatedAt, categories: article.categories.map((category) => category.categoryCode), verificationStatus: null,
        sources: article.sources.map((source) => ({ sourceName: source.source.name, sourceTitle: article.title, url: source.sourceUrl, sourcePublishedAt: article.publishedAt })),
        sourceFacts: facts,
      }
    })
    const priority = (item: BriefCandidate) => item.kind === 'ALERT'
      ? item.verificationStatus === 'VERIFIED' && item.publishedAt && Date.now() - item.publishedAt.getTime() <= 48 * 60 * 60_000 ? 4
        : 2
      : item.categories.includes('FINANCIAL_FRAUD') ? 2 : 1
    return [...alertItems, ...articleItems]
      .filter((item) => item.sources.some((source) => validHttpsUrl(source.url)))
      .sort((a, b) => priority(b) - priority(a) || (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
      .slice(0, 40)
  }

  private async cachedDailyBrief(key: string, day: string, candidates: BriefCandidate[]): Promise<BriefBase> {
    for (const cacheKey of this.dailyBriefCache.keys()) if (!cacheKey.startsWith(`${day}:`)) this.dailyBriefCache.delete(cacheKey)
    const cached = this.dailyBriefCache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.value
    const pending = this.dailyBriefInFlight.get(key)
    if (pending) return pending
    const build = this.buildDailyBrief(candidates).then((value) => {
      const ttl = value.status === 'AI_SUMMARY' ? 30 * 60_000 : 5 * 60_000
      this.dailyBriefCache.set(key, { expiresAt: Date.now() + ttl, value })
      return value
    }).finally(() => this.dailyBriefInFlight.delete(key))
    this.dailyBriefInFlight.set(key, build)
    return build
  }

  private async buildDailyBrief(candidates: BriefCandidate[]): Promise<BriefBase> {
    const now = new Date().toISOString()
    if (!candidates.length) return { status: 'EMPTY', items: [], updatedAt: now }
    const byId = new Map(candidates.map((item) => [item.id, item]))
    try {
      const result = await this.ai.generateStructured('RADAR_DAILY_BRIEF', AI_TASK_SCHEMAS.RADAR_DAILY_BRIEF, {
        calendarDate: vnDay(),
        candidates: candidates.map(({ id, kind, title, publishedAt, categories, verificationStatus, sources, sourceFacts }) => ({
          referenceId: id, kind, title, publishedAt, categories, verificationStatus,
          sources: sources.filter((source) => validHttpsUrl(source.url)), sourceFacts,
        })),
        instruction: 'Return at most ten distinct referenceId values from this list. Prefer materially relevant information and include newly published verified warnings before general market news. Do not cite or create URLs; the application attaches links from stored evidence records.',
      })
      const seen = new Set<string>()
      const generated: BriefBaseLine[] = []
      for (const item of result.items) {
        const candidate = byId.get(item.referenceId)
        if (!candidate || seen.has(candidate.id) || !candidate.sources.some((source) => validHttpsUrl(source.url))) continue
        seen.add(candidate.id)
        generated.push({ ...item, generatedByAi: true })
      }
      // Newly published verified warnings are retained and placed first even if the model omits one.
      const recentVerified = candidates.filter((item) => item.kind === 'ALERT' && item.verificationStatus === 'VERIFIED' && item.publishedAt && Date.now() - item.publishedAt.getTime() <= 48 * 60 * 60_000)
      const verifiedLines = recentVerified.map((warning) => {
        const generatedLine = generated.find((line) => line.referenceId === warning.id)
        return generatedLine ?? { referenceId: warning.id, summary: warning.title, interpretation: null, generatedByAi: false }
      })
      const verifiedIds = new Set(verifiedLines.map((line) => line.referenceId))
      const ordered = [...verifiedLines, ...generated.filter((line) => !verifiedIds.has(line.referenceId))].slice(0, 10)
      ordered.sort((a, b) => {
        const left = byId.get(a.referenceId)!
        const right = byId.get(b.referenceId)!
        const score = (candidate: BriefCandidate) => candidate.kind === 'ALERT' && candidate.verificationStatus === 'VERIFIED' && candidate.publishedAt && Date.now() - candidate.publishedAt.getTime() <= 48 * 60 * 60_000 ? 3 : candidate.kind === 'ALERT' ? 2 : 1
        return score(right) - score(left) || (right.publishedAt?.getTime() ?? 0) - (left.publishedAt?.getTime() ?? 0)
      })
      if (!ordered.length) throw new Error('AI trả về nội dung không liên kết được với bản ghi nguồn.')
      return { status: ordered.some((item) => item.generatedByAi) ? 'AI_SUMMARY' : 'SOURCE_FALLBACK', items: ordered, updatedAt: now }
    } catch (error) {
      this.logger.warn(`Radar daily brief AI unavailable: ${error instanceof Error ? error.message : 'unknown error'}`)
      const fallback = candidates.slice(0, 10).map((candidate) => ({ referenceId: candidate.id, summary: candidate.title, interpretation: null, generatedByAi: false }))
      return { status: fallback.length ? 'SOURCE_FALLBACK' : 'EMPTY', items: fallback, updatedAt: now }
    }
  }

  async recommendationSignals(session: SessionContext, input: unknown) {
    const parsed = recommendationConsentSchema.safeParse(input)
    if (!parsed.success) throw new BadRequestException('Tùy chọn cá nhân hóa không hợp lệ.')
    const consent = parsed.data
    const signals: Array<{ categoryCode: string; source: 'PROFILE_GOAL' | 'SURVEY_TOPIC' | 'FORENSIC_HISTORY'; reason: string }> = []
    const owner = session.kind === 'guest' ? { guestSessionId: session.guestSessionId } : { userId: session.userId }
    if (consent.includeProfileGoal === true) {
      const profile = await this.prisma.financialProfile.findUnique({ where: owner, select: { primaryGoal: true } })
      if (profile?.primaryGoal === 'BORROW_SAFE' || profile?.primaryGoal === 'OPTIMIZE_DEBT') {
        signals.push({ categoryCode: 'INTEREST_RATE', source: 'PROFILE_GOAL', reason: profile.primaryGoal === 'BORROW_SAFE' ? 'Theo mục tiêu ưu tiên khoản vay an toàn bạn đã chọn' : 'Theo mục tiêu tối ưu khoản nợ bạn đã chọn' })
      } else if (profile?.primaryGoal === 'SAVE_INVEST') {
        signals.push({ categoryCode: 'MARKET', source: 'PROFILE_GOAL', reason: 'Theo mục tiêu tiết kiệm và đầu tư bạn đã chọn' })
        signals.push({ categoryCode: 'INFLATION', source: 'PROFILE_GOAL', reason: 'Theo mục tiêu tiết kiệm và đầu tư bạn đã chọn' })
      }
    }
    if (consent.includeSurveyTopics === true) {
      const since = new Date(Date.now() - 90 * 86_400_000)
      const sessions = await this.prisma.calculationSession.findMany({
        where: { ...owner, createdAt: { gte: since }, sessionMode: { in: ['LOAN_SURVEY', 'INVESTMENT_SURVEY', 'MANUAL_COMPARE'] } },
        orderBy: { createdAt: 'desc' }, take: 8, select: { sessionMode: true },
      })
      const modes = new Set(sessions.map(({ sessionMode }) => sessionMode))
      if (modes.has('LOAN_SURVEY') || modes.has('MANUAL_COMPARE')) signals.push({ categoryCode: 'INTEREST_RATE', source: 'SURVEY_TOPIC', reason: 'Dựa trên loại Khảo sát đã dùng gần đây (không đọc số tiền hay kết quả)' })
      if (modes.has('INVESTMENT_SURVEY')) {
        signals.push({ categoryCode: 'MARKET', source: 'SURVEY_TOPIC', reason: 'Dựa trên loại Khảo sát đã dùng gần đây (không đọc số tiền hay kết quả)' })
        signals.push({ categoryCode: 'INFLATION', source: 'SURVEY_TOPIC', reason: 'Dựa trên loại Khảo sát đã dùng gần đây (không đọc số tiền hay kết quả)' })
      }
    }
    if (consent.includeForensicHistory === true) {
      const since = new Date(Date.now() - 30 * 86_400_000)
      const recentHighRiskAudit = await this.prisma.forensicAudit.findFirst({
        where: { ...owner, createdAt: { gte: since }, verdictLevel: 'HIGH_RISK' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
      if (recentHighRiskAudit) signals.push({
        categoryCode: 'FINANCIAL_FRAUD',
        source: 'FORENSIC_HISTORY',
        reason: 'Ưu tiên tin cảnh báo lừa đảo vì bạn đã bật dùng tín hiệu có kết quả Giám định rủi ro cao trong 30 ngày gần đây; nội dung tài liệu không được đọc.',
      })
    }
    return { signals }
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

  async analyzeArticle(id: string, session: { kind: 'guest'; guestSessionId: string } | { kind: 'user'; userId: string }, requestedMode: 'GENERAL' | 'PERSONALIZED' = 'GENERAL') {
    const article = await this.prisma.marketArticle.findUnique({ where: { id }, include: { sources: { include: { source: true } } } })
    if (!article) throw new NotFoundException('Không tìm thấy bài viết.')
    const profile = requestedMode === 'PERSONALIZED' ? await this.profiles.getActiveProfile(session) : null
    if (requestedMode === 'PERSONALIZED' && !profile) throw new BadRequestException('Chưa có hồ sơ tài chính để cá nhân hóa. Hãy dùng phân tích tổng quát.')
    const mode = profile ? 'PERSONALIZED' : 'GENERAL'
    try {
      const output = await this.ai.generateStructured('RADAR_CLASSIFY_IMPACT', AI_TASK_SCHEMAS.RADAR_CLASSIFY_IMPACT, {
        article: { title: article.title, publishedAt: article.publishedAt, sources: article.sources.map((source) => ({ name: source.source.name, url: source.sourceUrl })) },
        // Only the explicit goal is passed to AI. Income, expenses, debt and savings stay out of the prompt.
        profile: profile ? { primaryGoal: profile.primaryGoal } : null,
        instruction: 'Separate source-backed facts from AI interpretation. Cite only supplied URLs. Return suggestedRateDelta only when the supplied title/metadata explicitly states before and after rates; use the exact difference in percentage points. Otherwise return null. Never infer or invent rates. Use only the explicit primary goal when personalized; disclose assumptions.',
      })
      const saved = await this.prisma.articleImpactAnalysis.create({ data: {
        id: randomUUID(), articleId: article.id, profileId: profile?.id ?? null, analysisMode: mode,
        extractedFactsJson: output.extractedFacts, aiAssessmentJson: { text: output.aiAssessment, topics: output.topics },
        suggestedRateDelta: output.suggestedRateDelta, llmProvider: 'gateway', llmModel: 'configured',
      } })
      if (output.isFraudAlert && article.sources.some((source) => source.source.isTrustedForAlerts)) {
        await this.createThreatAlert(article, output)
      }
      return { mode, facts: output.extractedFacts, assessment: output.aiAssessment, suggestedRateDelta: output.suggestedRateDelta, assumptions: profile ? ['Chỉ dùng mục tiêu đã lưu; kết quả không phải phép tính tài chính.'] : ['Phân tích tổng quát, không dùng hồ sơ cá nhân hay phép tính khoản vay.'], citations: article.sources.map((source) => ({ sourceId: source.sourceId, url: source.sourceUrl, sourceName: source.source.name })), createdAt: saved.createdAt }
    } catch (error) {
      this.logger.warn(`AI impact analysis unavailable for article ${id}: ${error instanceof Error ? error.message : 'unknown error'}`)
      return { mode, facts: [], assessment: null, suggestedRateDelta: null, assumptions: ['Dịch vụ AI hiện không khả dụng.'], citations: article.sources.map((source) => ({ sourceId: source.sourceId, url: source.sourceUrl, sourceName: source.source.name })), unavailable: true }
    }
  }

  async listAlerts() {
    const alerts = await this.prisma.threatAlert.findMany({
      where: publicThreatAlertWhere, orderBy: { publishedAt: 'desc' }, take: 50,
      include: { indicators: true, evidence: { include: { articleSource: { include: { source: true, article: true } } } } },
    })
    return { items: alerts.map((alert) => this.alertDto(alert)) }
  }

  async alertDetail(id: string) {
    const alert = await this.prisma.threatAlert.findFirst({
      where: { id, ...publicThreatAlertWhere }, include: { indicators: true, evidence: { include: { articleSource: { include: { source: true, article: true } } } } },
    })
    if (!alert) throw new NotFoundException('Không tìm thấy cảnh báo.')
    return this.alertDto(alert)
  }

  private async fetchSource(source: { id: string; sourceKey: string; endpointUrl: string; sourceType: string }) {
    const attemptedAt = new Date()
    try {
      const response = await fetch(source.endpointUrl, { signal: AbortSignal.timeout(12_000), headers: { 'user-agent': 'FinCopilotRadar/1.0 (+contact project team)', accept: 'application/rss+xml, application/atom+xml, text/html;q=0.8' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = (await response.text()).slice(0, 2_000_000)
      const entries = parseFeed(body, source.sourceType, source.endpointUrl)
      const ogBudget = { remaining: 5 }
      for (const entry of entries) await this.upsertEntry(source, entry, ogBudget)
      await this.prisma.marketSource.update({ where: { id: source.id }, data: { lastFetchStatus: 'SUCCESS', lastAttemptAt: attemptedAt, lastSuccessAt: new Date(), updatedAt: new Date() } })
      return { sourceKey: source.sourceKey, status: 'SUCCESS', items: entries.length }
    } catch (error) {
      await this.prisma.marketSource.update({ where: { id: source.id }, data: { lastFetchStatus: 'ERROR', lastAttemptAt: attemptedAt, updatedAt: new Date() } })
      this.logger.warn(`Radar source ${source.sourceKey} fetch failed: ${error instanceof Error ? error.message : 'unknown error'}`)
      return { sourceKey: source.sourceKey, status: 'ERROR', items: 0 }
    }
  }

  private async resolveOgFallback(sourceUrl: string): Promise<string | null> {
    if (!validHttpsUrl(sourceUrl)) return null
    try {
      const { text, url } = await fetchPublicDocument(sourceUrl, { timeoutMs: 3_500 })
      return extractOgImageUrl(text, url)
    } catch {
      return null
    }
  }

  private async upsertEntry(source: { id: string }, entry: FeedEntry, ogBudget?: { remaining: number }) {
    let sourceUrl: string
    let normalizedUrl: string
    try { sourceUrl = new URL(entry.url, 'https://invalid.local').toString(); normalizedUrl = normalizeUrl(sourceUrl) } catch { return }
    if (!/^https?:$/.test(new URL(sourceUrl).protocol) || !entry.title) return
    const hash = createHash('sha256').update(`${entry.title.trim().toLocaleLowerCase('vi')}|${entry.description.trim().toLocaleLowerCase('vi')}|${entry.publishedAt?.toISOString() ?? ''}`).digest('hex')
    const exact = await this.prisma.articleSource.findFirst({ where: { sourceId: source.id, normalizedSourceUrl: normalizedUrl } })
    const canonical = exact
      ? await this.prisma.marketArticle.findUnique({ where: { id: exact.articleId } })
      : await this.prisma.marketArticle.findFirst({ where: { contentHash: hash, feedStatus: 'ACTIVE' }, orderBy: { createdAt: 'asc' } })
    let resolvedImageUrl = entry.imageUrl
    if (!resolvedImageUrl && !canonical?.imageUrl && ogBudget && ogBudget.remaining > 0) {
      ogBudget.remaining -= 1
      resolvedImageUrl = await this.resolveOgFallback(sourceUrl)
    }
    const article = canonical ?? await this.prisma.marketArticle.upsert({
      where: { canonicalUrl: normalizedUrl },
      create: { id: randomUUID(), canonicalUrl: normalizedUrl, title: entry.title, publishedAt: entry.publishedAt, contentHash: hash, feedStatus: 'ACTIVE', imageUrl: resolvedImageUrl },
      update: { title: entry.title, publishedAt: entry.publishedAt ?? undefined, contentHash: hash, updatedAt: new Date() },
    })
    if (resolvedImageUrl && !article.imageUrl) await this.prisma.marketArticle.update({
      where: { id: article.id },
      data: { imageUrl: resolvedImageUrl },
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
        instruction: 'Classify topics and extract only source-supported facts. Separate interpretation. Use only supplied source URLs. Return no unsupported facts or indicators. Set suggestedRateDelta only if the supplied title/metadata explicitly states before and after rates, using the exact difference in percentage points; otherwise return null.',
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
    const { trusted } = await this.threatMemory.get()
    await this.prisma.$transaction((tx) => attachThreatDraft(tx, this.threatMemory, {
      source: { articleId: article.id, sourceId: trustedLink.sourceId, url: trustedLink.sourceUrl, title: article.title, publishedAt: article.publishedAt },
      draft: {
        threatCategory: 'PHISHING', tacticSummary: (output.aiAssessment.trim() || article.title).slice(0, 800),
        preventionGuidance: 'Không chia sẻ mã OTP, không chuyển phí để mở khóa khoản vay. Hãy xác minh trực tiếp qua kênh chính thức.',
        indicators: output.indicators.slice(0, 40),
      },
      trusted, origin: 'RADAR_AUTO',
    }))
  }

  proxyArticleImage(rawUrl: string) {
    return fetchPublicImage(rawUrl, { timeoutMs: 6_000 })
  }

  private articleDto(row: { id: string; title: string; canonicalUrl: string; publishedAt: Date | null; imageUrl: string | null; categories: Array<{ categoryCode: string }>; sources: Array<{ sourceId: string; sourceUrl: string; firstSeenAt: Date; lastSeenAt: Date; source: { id: string; name: string; sourceKey: string } }> }) {
    const imageUrl = row.imageUrl && validHttpsUrl(row.imageUrl) ? row.imageUrl : null
    const imageSource = row.sources[0]
    return { id: row.id, title: row.title, canonicalUrl: row.canonicalUrl, publishedAt: row.publishedAt,
      image: imageUrl ? { url: imageUrl, proxyUrl: `/api/v1/radar/image-proxy?url=${encodeURIComponent(imageUrl)}`, alt: row.title, credit: imageSource?.source.name ?? null, sourceUrl: imageSource?.sourceUrl ?? null } : null,
      categories: row.categories.map((item) => item.categoryCode), sources: row.sources.map((item) => ({ sourceId: item.source.id, sourceKey: item.source.sourceKey, sourceName: item.source.name, url: item.sourceUrl, firstSeenAt: item.firstSeenAt, lastSeenAt: item.lastSeenAt })) }
  }

  private alertDto(alert: { id: string; threatCategory: string; tacticSummary: string; preventionGuidance: string; verificationStatus: string; issuedAt: Date | null; publishedAt: Date | null; verifiedAt: Date | null; indicators: Array<{ id: string; indicatorType: string; indicatorText: string }>; evidence: Array<{ articleSource: { article: { id: string; title: string; publishedAt: Date | null }; source: { id: string; name: string }; sourceUrl: string } }> }) {
    return { id: alert.id, threatCategory: alert.threatCategory, tacticSummary: alert.tacticSummary, preventionGuidance: alert.preventionGuidance, verificationStatus: alert.verificationStatus, issuedAt: alert.issuedAt, publishedAt: alert.publishedAt, verifiedAt: alert.verifiedAt, indicators: alert.indicators, evidence: alert.evidence.map(({ articleSource }) => ({ articleId: articleSource.article.id, title: articleSource.article.title, sourceId: articleSource.source.id, sourceName: articleSource.source.name, url: articleSource.sourceUrl, publishedAt: articleSource.article.publishedAt })) }
  }
}
