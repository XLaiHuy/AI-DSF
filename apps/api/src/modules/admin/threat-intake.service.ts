import { createHash, randomUUID } from 'node:crypto'
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import { BadRequestException, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common'
import { AI_TASK_SCHEMAS, type ThreatDraft, type ThreatExtract, type ThreatIndicatorInput } from '@fincopilot/shared-types'
import type { Job, Queue } from 'bullmq'
import { PrismaService } from '../../common/prisma.service'
import { homeMarketCacheKey } from '../../common/public-cache-keys'
import { RedisService } from '../../common/redis.service'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { normalizeVietnamese } from '../forensic/data/trusted-institutions'
import { maskForensicText } from '../forensic/qr-evidence'
import { attachThreatDraft } from '../forensic/threat-draft'
import { ThreatMemoryService } from '../forensic/threat-memory.service'
import { articleBody, fetchPublicDocument, normalizeThreatIndicator, stripDocument } from './threat-safety'

export const threatIntakeQueue = 'admin-threat-intake'
const dayMs = 24 * 60 * 60_000
const fraudTerms = /\b(?:lua dao|gia danh|mao danh|gia mao|chiem doat|sinh trac hoc|dich vu cong|cai app|cai dat ung dung|danh cap otp|ma otp|quet ma qr|tin dung den|viec nhe luong cao|san ao|tien ao|loi 102|phi giai ngan|phi mo khoa|phishing|scam|canh bao)\b/
const nonScamOffenses = /\b(?:trom cap|tham o|hoi lo|tong tien|cuong doat|buon lau|danh bac)\b/
const explicitScamMechanism = /\b(?:lua dao|gia danh|mao danh|gia mao|phishing|scam|sinh trac hoc|ma otp|quet ma qr|tien ao|tin dung den)\b/

function canonicalArticleUrl(raw: string, base: string) {
  const url = URL.parse(raw, base)
  if (!url || !/^https?:$/.test(url.protocol) || url.username || url.password) return undefined
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref)/i.test(key)) url.searchParams.delete(key)
  url.hostname = url.hostname.replace(/^www\./, '')
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString()
}

function readEntries(text: string, endpoint: string, isWeb: boolean) {
  const tag = (block: string, name: string) => stripDocument(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(block)?.[1] ?? '')
  const entries = Array.from(text.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)).slice(0, 40).flatMap(([, block]) => {
    const title = tag(block, 'title')
    const rawLink = tag(block, 'link') || /<link\b[^>]*href=["']([^"']+)["']/i.exec(block)?.[1]
    const url = rawLink && canonicalArticleUrl(rawLink, endpoint)
    const date = new Date(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated'))
    const description = tag(block, 'description') || tag(block, 'summary') || tag(block, 'content')
    return url && title ? [{ title, url, description, publishedAt: Number.isNaN(date.getTime()) ? null : date }] : []
  })
  if (entries.length || !isWeb) return [...new Map(entries.map((entry) => [entry.url, entry])).values()]
  const listing = canonicalArticleUrl(endpoint, endpoint)
  const hostname = URL.parse(endpoint)?.hostname.replace(/^www\./, '')
  const seen = new Set<string>()
  const body = text.replace(/<(header|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
  return Array.from(body.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)).flatMap(([, rawLink, label]) => {
    const title = stripDocument(label)
    const url = canonicalArticleUrl(stripDocument(rawLink), endpoint)
    const parsed = url && URL.parse(url)
    if (!url || !parsed || parsed.hostname !== hostname || url === listing || parsed.pathname.length < 20 ||
        (hostname === 'tingia.gov.vn' && !parsed.pathname.endsWith('.html')) ||
        seen.has(url) || title.length < 20 || !fraudTerms.test(normalizeVietnamese(title))) return []
    seen.add(url)
    return [{ title, url, description: '', publishedAt: null }]
  }).slice(0, 15)
}

export function locateThreatSpans(text: string, indicators: readonly ThreatIndicatorInput[]) {
  return indicators.flatMap((indicator) => {
    const phrase = indicator.indicatorText
    const pattern = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
    return [...text.matchAll(pattern)].map((match) => ({ start: match.index, end: match.index + match[0].length, phrase: match[0], ...indicator }))
  }).sort((a, b) => a.start - b.start || b.end - a.end)
}

@Processor(threatIntakeQueue)
@Injectable()
export class ThreatIntakeService extends WorkerHost implements OnModuleInit {
  private readonly log = new Logger(ThreatIntakeService.name)
  private readonly running = new Map<string, ReturnType<ThreatIntakeService['crawl']>>()

  constructor(
    @InjectQueue(threatIntakeQueue) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly ai: AiGatewayService,
    private readonly memory: ThreatMemoryService,
    @Optional() private readonly redis?: RedisService,
  ) { super() }

  scheduler() { return this.queue.getJobScheduler('daily-threat-intake') }

  async onModuleInit() {
    await this.queue.upsertJobScheduler('daily-threat-intake', { every: dayMs }, { name: 'daily' })
  }

  async process(job: Job) {
    if (job.name === 'daily') return this.hotCrawlNow()
  }

  async status() {
    const scheduler = await this.queue.getJobScheduler('daily-threat-intake')
    return { scheduled: Boolean(scheduler), nextAt: scheduler?.next ? new Date(scheduler.next).toISOString() : null }
  }

  async extractFromInput(input: ThreatExtract) {
    const text = 'rawText' in input ? input.rawText : await fetchPublicDocument(input.sourceUrl)
      .then(({ text }) => articleBody(text))
      .catch(() => { throw new BadRequestException('Không thể đọc nội dung từ URL công khai này.') })
    if (!text.trim()) throw new BadRequestException('Nguồn không có nội dung văn bản.')
    const draft = await this.classify(text)
    if (!draft) throw new BadRequestException('Không tìm thấy cảnh báo lừa đảo tài chính hoặc qua mạng trong nguồn.')
    return { ...draft.data, spans: locateThreatSpans(draft.data.sourceExcerpt ?? '', draft.data.indicators) }
  }

  private async classify(text: string, title = '') {
    const headline = normalizeVietnamese(title)
    if (nonScamOffenses.test(headline) && !explicitScamMechanism.test(headline)) return null
    const raw = text.slice(0, 12_000)
    const excerpt = maskForensicText(raw).slice(0, 8000)
    const memory = await this.memory.get()
    const classified = await this.ai.generateStructured('THREAT_ARTICLE_EXTRACT', AI_TASK_SCHEMAS.THREAT_ARTICLE_EXTRACT, {
      text: raw,
      avoidanceRules: memory.avoidanceRules,
    })
    if (!classified.isScamAlert || classified.tacticSummary.length < 20) return null
    const unique = new Map<string, ThreatIndicatorInput>()
    for (const item of classified.indicators) {
      if (!raw.includes(item.indicatorText)) continue
      const candidate = normalizeThreatIndicator(item)
      if (!candidate) continue
      const { indicatorType, indicatorText } = candidate
      if (memory.exclusions.has(indicatorText) || memory.exclusions.has(normalizeVietnamese(indicatorText)) ||
          memory.exclusions.has(this.memory.fingerprint(indicatorType, indicatorText))) continue
      unique.set(`${indicatorType}:${normalizeVietnamese(indicatorText)}`, candidate)
    }
    const data: ThreatDraft = {
      threatCategory: classified.threatCategory, tacticSummary: maskForensicText(classified.tacticSummary).slice(0, 800),
      preventionGuidance: maskForensicText(classified.preventionGuidance).slice(0, 2000),
      sourceExcerpt: excerpt, indicators: [...unique.values()].slice(0, 40),
    }
    return { data, trusted: memory.trusted }
  }

  hotCrawlNow(sourceKey?: string) {
    const key = sourceKey ?? '*'
    const current = this.running.get(key)
    if (current) return current
    const crawl = this.crawl(sourceKey).finally(async () => {
      this.memory.invalidate()
      await this.redis?.del(homeMarketCacheKey)
      this.running.delete(key)
    })
    this.running.set(key, crawl)
    return crawl
  }

  private async crawl(sourceKey?: string) {
    const sources = await this.prisma.marketSource.findMany({
      where: { isActive: true, ...(sourceKey ? { sourceKey } : {}) }, orderBy: { sourceKey: 'asc' },
    })
    const stats = { sourcesScanned: 0, newArticles: 0, newProposals: 0, newIocsAttached: 0, skippedDuplicates: 0 }
    for (const source of sources) {
      stats.sourcesScanned += 1
      const attemptedAt = new Date()
      try {
        const feed = await fetchPublicDocument(source.endpointUrl)
        const entries = readEntries(feed.text, feed.url, source.sourceType === 'WEB')
        for (const entry of entries) {
          const titleAndDescription = `${entry.title}\n${entry.description}`
          const candidateArticle = fraudTerms.test(normalizeVietnamese(titleAndDescription))
          const prior = await this.prisma.marketArticle.findUnique({
            where: { canonicalUrl: entry.url }, select: { id: true, threatScannedAt: true },
          })
          if (prior && (!candidateArticle || prior.threatScannedAt)) {
            stats.skippedDuplicates += 1
            continue
          }
          let body = ''
          let candidate: Awaited<ReturnType<ThreatIntakeService['classify']>> = null
          if (candidateArticle) {
            try {
              body = await fetchPublicDocument(entry.url).then(({ text }) => articleBody(text))
              if (!body) throw new Error('Empty article')
              const hash = createHash('sha256').update(normalizeVietnamese(body)).digest('hex')
              if (await this.prisma.marketArticle.findFirst({ where: { contentHash: hash, threatScannedAt: { not: null } }, select: { id: true } })) {
                stats.skippedDuplicates += 1
                continue
              }
              candidate = await this.classify(`${entry.title}\n${body}`, entry.title)
            } catch {
              this.log.warn(`Chưa phân loại được bài viết từ nguồn ${source.sourceKey}`)
              continue
            }
          }
          const hash = createHash('sha256').update(normalizeVietnamese(body || titleAndDescription)).digest('hex')
          const embedding = candidate ? await this.memory.computeEmbedding([candidate.data.tacticSummary, candidate.data.sourceExcerpt].join('\n')) : null
          const result = await this.prisma.$transaction(async (tx) => {
            // Serialize crawl writers across API instances for the same canonical content.
            const lock = [entry.url, hash].sort()
            for (const value of lock) await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${value}, 0))`
            const byUrl = { where: { canonicalUrl: entry.url }, select: { id: true, threatScannedAt: true } } as const
            const article = await tx.marketArticle.findUnique(byUrl) ??
              await tx.marketArticle.findFirst({ where: { contentHash: hash }, select: byUrl.select, orderBy: { threatScannedAt: { sort: 'desc', nulls: 'last' } } })
            if (article && (!candidateArticle || article.threatScannedAt)) return null
            let articleId = article?.id ?? randomUUID()
            const newArticle = !article && Boolean((await tx.marketArticle.createMany({ skipDuplicates: true, data: {
              id: articleId, canonicalUrl: entry.url, title: maskForensicText(entry.title), publishedAt: entry.publishedAt, contentHash: hash,
            } })).count)
            if (!article && !newArticle) {
              const concurrent = await tx.marketArticle.findUnique(byUrl)
              if (!concurrent || !candidateArticle || concurrent.threatScannedAt) return null
              articleId = concurrent.id
            }
            if (candidateArticle) {
              await tx.marketArticle.update({ where: { id: articleId }, data: { threatScannedAt: attemptedAt } })
            }
            if (newArticle || candidate) await tx.articleSource.upsert({
              where: { articleId_sourceId: { articleId, sourceId: source.id } },
              create: { articleId, sourceId: source.id, sourceUrl: entry.url, normalizedSourceUrl: entry.url,
                firstSeenAt: attemptedAt, lastSeenAt: attemptedAt },
              update: { lastSeenAt: attemptedAt },
            })
            if (!candidate) return { newArticle, proposal: 0, attached: 0 }
            const result = await attachThreatDraft(tx, this.memory, {
              source: { articleId, sourceId: source.id, url: entry.url, title: entry.title, publishedAt: entry.publishedAt },
              draft: candidate.data, trusted: candidate.trusted, origin: 'ADMIN_INGEST', embedding,
            })
            return { newArticle, ...result }
          })
          if (!result) { stats.skippedDuplicates += 1; continue }
          if (result.newArticle) stats.newArticles += 1
          else stats.skippedDuplicates += 1
          stats.newProposals += result.proposal
          stats.newIocsAttached += result.attached
        }
        await this.prisma.marketSource.update({ where: { id: source.id }, data: { lastFetchStatus: 'SUCCESS',
          lastAttemptAt: attemptedAt, lastSuccessAt: new Date(), updatedAt: new Date() } })
      } catch {
        await this.prisma.marketSource.update({ where: { id: source.id }, data: { lastFetchStatus: 'ERROR', lastAttemptAt: attemptedAt, updatedAt: new Date() } })
        this.log.warn(`Không đọc được nguồn ${source.sourceKey}`)
      }
    }
    return stats
  }
}
