import { relevantHeadline } from './legal-feed'
import { describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import type { PrismaService } from '../../common/prisma.service'
import { fetchPublicImage } from '../admin/threat-safety'
import { articleImageUrl, categoriesFor, dateOnly, extractOgImageUrl, parseFeed, RadarService } from './radar.service'

describe('Radar analysis reuse and ingestion limits', () => {
  const session = { kind: 'guest', guestSessionId: 'guest-1' } as const
  const article = { id: 'article-1', title: 'Lãi suất điều chỉnh', publishedAt: new Date(), sources: [] }
  const saved = { extractedFactsJson: ['Dữ kiện nguồn'], aiAssessmentJson: { text: 'Phân tích đã lưu' },
    suggestedRateDelta: '1.25', createdAt: new Date() }
  function analysisHarness() {
    const findFirst = vi.fn().mockResolvedValue(saved)
    const create = vi.fn().mockResolvedValue(saved)
    const analysis = { findFirst, create }
    const tx = { articleImpactAnalysis: analysis, $queryRaw: vi.fn() }
    const prisma = { articleImpactAnalysis: analysis, marketArticle: { findUnique: vi.fn().mockResolvedValue(article) },
      $transaction: vi.fn((run: (client: typeof tx) => unknown) => run(tx)) }
    const generateStructured = vi.fn().mockResolvedValue({ extractedFacts: ['Dữ kiện nguồn'], aiAssessment: 'Phân tích đã lưu', topics: [], isFraudAlert: false })
    const getActiveProfile = vi.fn().mockResolvedValue({ id: 'profile-1', primaryGoal: 'BORROW_SAFE' })
    const service = Object.create(RadarService.prototype) as RadarService
    Object.assign(service, {
      prisma, ai: { generateStructured }, profiles: { getActiveProfile }, impactInFlight: new Map(), logger: { warn: vi.fn() },
    })
    return { service, prisma, findFirst, create, generateStructured, tx, getActiveProfile }
  }

  it('reuses the latest general analysis without another model call or write', async () => {
    const { service, prisma, findFirst, create, generateStructured, getActiveProfile } = analysisHarness()
    await expect(service.analyzeArticle(article.id, session)).resolves.toMatchObject({
      mode: 'GENERAL', assessment: 'Phân tích đã lưu', facts: ['Dữ kiện nguồn'], suggestedRateDelta: '1.25',
    })
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { articleId: article.id, analysisMode: 'GENERAL', profileId: null } }))
    expect(generateStructured).not.toHaveBeenCalled()
    expect(getActiveProfile).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('checks the most recent 24 hours for the active profile only', async () => {
    const { service, findFirst, generateStructured } = analysisHarness()
    const start = Date.now()
    await service.analyzeArticle(article.id, session, 'PERSONALIZED')
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      articleId: article.id, analysisMode: 'PERSONALIZED', profileId: 'profile-1', createdAt: { gte: expect.any(Date) },
    } }))
    const cutoff = (findFirst.mock.calls[0][0] as { where: { createdAt: { gte: Date } } }).where.createdAt.gte.getTime()
    expect(cutoff).toBeGreaterThanOrEqual(start - 86_400_000)
    expect(cutoff).toBeLessThanOrEqual(Date.now() - 86_400_000)
    expect(generateStructured).not.toHaveBeenCalled()
  })

  it('coalesces concurrent requests and rechecks for other workers after taking the DB lock', async () => {
    const { service, findFirst, create, generateStructured, tx } = analysisHarness()
    findFirst.mockResolvedValueOnce(null)
    const both = await Promise.all([service.analyzeArticle(article.id, session), service.analyzeArticle(article.id, session)])
    expect(both[0]).toEqual(both[1])
    expect(generateStructured).toHaveBeenCalledOnce()
    expect(findFirst).toHaveBeenCalledTimes(2)
    expect(tx.$queryRaw).toHaveBeenCalledWith(expect.arrayContaining([expect.stringContaining('pg_advisory_xact_lock')]), 'radar-impact:article-1:general')
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(findFirst.mock.invocationCallOrder[1])
    expect(create).not.toHaveBeenCalled()
  })

  it('creates a replacement for an expired personalized analysis once', async () => {
    const { service, findFirst, create, generateStructured, tx } = analysisHarness()
    findFirst.mockResolvedValue(null)
    await expect(service.analyzeArticle(article.id, session, 'PERSONALIZED')).resolves.toMatchObject({
      mode: 'PERSONALIZED', facts: saved.extractedFactsJson,
    })
    expect(findFirst).toHaveBeenCalledTimes(2)
    expect(generateStructured).toHaveBeenCalledWith('RADAR_CLASSIFY_IMPACT', expect.anything(), expect.objectContaining({
      profile: { primaryGoal: 'BORROW_SAFE' },
    }))
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0])
    expect(create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({
      articleId: article.id, profileId: 'profile-1', analysisMode: 'PERSONALIZED',
    }) })
  })

  it('uses the app-wide BullMQ retention options for manual scans', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'job-1' })
    const service = Object.create(RadarService.prototype) as RadarService
    Object.assign(service, { queue: { add } })
    await expect(service.enqueueFetch('publisher')).resolves.toEqual({ jobId: 'job-1', queued: true })
    expect(add).toHaveBeenCalledExactlyOnceWith('fetch-all', { sourceKey: 'publisher' }, {
      jobId: expect.stringMatching(/^manual-publisher-\d+$/), attempts: 1,
    })
  })

  it('runs no more than three sources concurrently and preserves result order', async () => {
    const sources = Array.from({ length: 8 }, (_, index) => ({ sourceKey: String(index) }))
    let running = 0
    let peak = 0
    const fetchSource = vi.fn(async ({ sourceKey }: { sourceKey: string }) => {
      peak = Math.max(peak, ++running)
      await Promise.resolve()
      running -= 1
      return { sourceKey, status: 'SUCCESS', items: 1 }
    })
    const service = Object.create(RadarService.prototype) as RadarService
    Object.assign(service, {
      prisma: { marketSource: { findMany: vi.fn().mockResolvedValue(sources) } }, fetchSource,
    })
    await expect(service.process({ name: 'fetch-all', data: {} } as Job)).resolves.toEqual({
      results: sources.map(source => ({ ...source, status: 'SUCCESS', items: 1 })),
    })
    expect(peak).toBe(3)
  })

  it('persists every feed item but tries AI only for ten new items per source and crawl', async () => {
    const existing = new Set(['https://publisher.example/articles/0'])
    const articleSource = {
      findFirst: vi.fn(({ where }) => existing.has(where.normalizedSourceUrl) ? { articleId: 'prior' } : null),
      upsert: vi.fn(({ create }) => { existing.add(create.normalizedSourceUrl) }),
    }
    const marketArticle = { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue({ id: 'prior' }),
      upsert: vi.fn(({ create }) => create) }
    const classifyIngestion = vi.fn()
    const source = { id: 'source', sourceKey: 'publisher', endpointUrl: 'https://publisher.example/rss', sourceType: 'RSS' }
    const feed = Array.from({ length: 13 }, (_, index) => `<item><title>Tin lãi suất ${index}</title><link>https://publisher.example/articles/${index}</link><media:content url="https://publisher.example/photo.jpg" medium="image"/></item>`)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<rss><channel>${feed.join('')}</channel></rss>`)))
    try {
      const service = Object.create(RadarService.prototype) as RadarService
      Object.assign(service, {
        prisma: { articleSource, marketArticle, articleCategory: { upsert: vi.fn() },
          marketSource: { findMany: vi.fn().mockResolvedValue([source]), update: vi.fn() } },
        classifyIngestion, logger: { warn: vi.fn() },
      })
      marketArticle.findUnique.mockResolvedValue({ id: 'prior', imageUrl: 'https://publisher.example/photo.jpg' })
      const job = { name: 'fetch-all', data: {} } as Job
      await expect(service.process(job)).resolves.toMatchObject({ results: [{ status: 'SUCCESS', items: 13 }] })
      expect(classifyIngestion).toHaveBeenCalledTimes(10)
      expect(classifyIngestion).not.toHaveBeenCalledWith('prior')
      expect(articleSource.upsert).toHaveBeenCalledTimes(13)
      await service.process(job)
      expect(classifyIngestion).toHaveBeenCalledTimes(10)
    } finally { vi.unstubAllGlobals() }
  })
})

describe('Radar V2 parsing and date rules', () => {
  function dailyBriefHarness({ articles = [], alerts = [], aiResult, aiFailure }: { articles?: unknown[]; alerts?: unknown[]; aiResult?: unknown; aiFailure?: Error } = {}) {
    const prisma = {
      threatAlert: {
        findMany: vi.fn().mockImplementation(() => Promise.resolve(alerts)),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      marketArticle: { findMany: vi.fn().mockImplementation(() => Promise.resolve(articles)) },
      forensicAudit: { findFirst: vi.fn().mockResolvedValue(null) },
      financialProfile: { findUnique: vi.fn().mockResolvedValue(null) },
      calculationSession: { findMany: vi.fn().mockResolvedValue([]) },
    }
    const ai = { generateStructured: vi.fn().mockImplementation(() => aiFailure ? Promise.reject(aiFailure) : Promise.resolve(aiResult ?? { items: [] })) }
    const service = Object.create(RadarService.prototype) as RadarService
    const dailyBriefCache = new Map()
    Object.assign(service, {
      prisma, ai, logger: { warn: vi.fn() },
      dailyBriefCache, dailyBriefInFlight: new Map(),
    })
    return { service, prisma, ai, dailyBriefCache }
  }

  it('evicts the oldest daily brief after caching 32 versions for the day', async () => {
    const articles = [briefArticle('00000000-0000-4000-8000-000000000111')]
    const { service, dailyBriefCache } = dailyBriefHarness({ articles })
    const session = { kind: 'guest', guestSessionId: 'guest-1' } as const
    await service.dailyBrief(session, {})
    const firstKey = dailyBriefCache.keys().next().value
    expect(firstKey).toBeDefined()
    for (let index = 1; index <= 32; index += 1) {
      articles[0].updatedAt = new Date(articles[0].publishedAt.getTime() + index)
      await service.dailyBrief(session, {})
    }
    expect(dailyBriefCache.size).toBe(32)
    expect(dailyBriefCache.has(firstKey)).toBe(false)
  })

  it('requires verified, published alerts at every public read entry point', async () => {
    const { service, prisma } = dailyBriefHarness()
    const session = { kind: 'guest', guestSessionId: '11111111-1111-4111-8111-111111111111' } as const
    await service.listAlerts()
    await service.dailyBrief(session, {})
    await expect(service.alertDetail('draft')).rejects.toMatchObject({ status: 404 })
    expect(prisma.threatAlert.findMany).toHaveBeenCalledTimes(2)
    for (const call of [1, 2]) {
      expect(prisma.threatAlert.findMany).toHaveBeenNthCalledWith(call, expect.objectContaining({
        where: { verificationStatus: 'VERIFIED', publishedAt: { not: null } },
      }))
    }
    expect(prisma.threatAlert.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'draft', verificationStatus: 'VERIFIED', publishedAt: { not: null } },
    }))
  })

  function briefArticle(id: string, publishedAt = new Date()) {
    return {
      id, title: `Tin nguồn ${id}`, canonicalUrl: `https://publisher.example/${id}`, publishedAt,
      updatedAt: publishedAt, feedStatus: 'ACTIVE',
      categories: [{ categoryCode: 'INTEREST_RATE' }],
      sources: [{ sourceUrl: `https://publisher.example/${id}`, source: { name: 'Publisher' } }],
      impactAnalyses: [],
    }
  }

  function briefAlert(id: string, verificationStatus: string, publishedAt = new Date()) {
    return {
      id, tacticSummary: `Cảnh báo nguồn ${id}`, preventionGuidance: 'Xác minh qua kênh chính thức.',
      verificationStatus, publishedAt, updatedAt: publishedAt, indicators: [],
      evidence: [{ articleSource: { sourceUrl: `https://ncsc.example/${id}`, source: { name: 'NCSC' }, article: { publishedAt } } }],
    }
  }

  it('returns valid HTTPS source images without a manual rights review gate', () => {
    const service = Object.create(RadarService.prototype) as RadarService
    const imageDto = service as unknown as { articleDto: (row: Record<string, unknown>) => { image: { url: string } | null } }
    const row: Record<string, unknown> = {
      id: '00000000-0000-4000-8000-000000000119', title: 'Tin có ảnh', canonicalUrl: 'https://publisher.example/story', publishedAt: new Date(),
      imageUrl: 'https://cdn.publisher-cdn.example/photo.jpg',
      categories: [{ categoryCode: 'MARKET' }], sources: [{ sourceId: 's1', sourceUrl: 'https://publisher.example/story', firstSeenAt: new Date(), lastSeenAt: new Date(), source: { id: 's1', name: 'Publisher', sourceKey: 'publisher' } }],
    }
    expect(imageDto.articleDto(row).image).toMatchObject({ url: 'https://cdn.publisher-cdn.example/photo.jpg', credit: 'Publisher', sourceUrl: 'https://publisher.example/story' })
    expect(imageDto.articleDto({ ...row, imageUrl: 'http://publisher.example/photo.jpg' }).image).toBeNull()
    expect(imageDto.articleDto({ ...row, imageUrl: null }).image).toBeNull()
  })

  it('classifies inflation signals without manufacturing statistics', () => {
    expect(categoriesFor('CPI và giá tiêu dùng tăng')).toContain('INFLATION')
    expect(categoriesFor('Lạm phát và sức mua hộ gia đình')).toContain('INFLATION')
  })

  it('reads HTTPS RSS media URLs including publisher CDN hosts and CDATA description img tags', () => {
    const feed = `<rss><channel><item><title>Giá tiêu dùng</title><link>https://cafef.vn/tin/1</link><pubDate>Tue, 24 Nov 2026 09:00:00 +0700</pubDate><media:content url="https://cafef.vn/images/tin.jpg" medium="image"/><description>CPI</description></item></channel></rss>`
    expect(parseFeed(feed, 'RSS', 'https://cafef.vn/rss').map((item) => item.imageUrl)).toEqual(['https://cafef.vn/images/tin.jpg'])
    expect(articleImageUrl('<media:content url="http://cafef.vn/image.jpg"/>', 'https://cafef.vn/rss')).toBeNull()
    expect(articleImageUrl('<media:content url="https://images.cdn-example.net/image.jpg"/>', 'https://cafef.vn/rss')).toBe('https://images.cdn-example.net/image.jpg')
    expect(articleImageUrl('<description><![CDATA[<img width="1" height="1" src="https://vnexpress.net/pixel.gif"/><img data-src="https://vneconomy.vn/uploads/chart.png?w=800&amp;h=450"/>]]></description>', 'https://vneconomy.vn/rss')).toBe('https://vneconomy.vn/uploads/chart.png?w=800&h=450')
    expect(articleImageUrl('<description>&lt;a href="https://cafef.vn"&gt;&lt;img src="https://cafefcdn.com/thumb.jpg" /&gt;&lt;/a&gt;</description>', 'https://cafef.vn/rss')).toBe('https://cafefcdn.com/thumb.jpg')
    expect(extractOgImageUrl('<html><head><meta property="og:image" content="https://cafefcdn.com/hero.webp"/></head></html>', 'https://cafef.vn/bai-1')).toBe('https://cafefcdn.com/hero.webp')
  })

  it('treats date-only filters as Asia/Ho_Chi_Minh calendar days', () => {
    expect(dateOnly('2026-11-24').toISOString()).toBe('2026-11-23T17:00:00.000Z')
    expect(dateOnly('2026-11-24', true).toISOString()).toBe('2026-11-24T17:00:00.000Z')
    expect(() => dateOnly('2026-02-30')).toThrow()
  })

  it('rejects invalid historical date filters before querying Prisma', async () => {
    const service = Object.create(RadarService.prototype) as RadarService
    await expect(service.listArticles({ from: '2026-02-30' })).rejects.toThrow('Ngày lọc không hợp lệ.')
  })

  it('prioritizes a verified threat evidence and explains the editorial reasons', async () => {
    const verifiedId = '00000000-0000-4000-8000-000000000001'
    const recentId = '00000000-0000-4000-8000-000000000002'
    const makeArticle = (id: string, publishedAt: Date, categoryCode: string, sourceIds: string[]) => ({
      id, title: `Bài kiểm thử ${id}`, canonicalUrl: `https://publisher.example/${id}`, publishedAt,
      imageUrl: null, imageAlt: null, imageCredit: null, imageSourceUrl: null, imageLicenseStatus: 'UNKNOWN',
      categories: [{ categoryCode }],
      sources: sourceIds.map((sourceId) => ({ sourceId, sourceUrl: `https://publisher.example/${id}`, firstSeenAt: publishedAt, lastSeenAt: publishedAt,
        source: { id: sourceId, name: sourceId, sourceKey: sourceId } })),
    })
    const prisma = {
      marketArticle: { findMany: vi.fn().mockResolvedValue([
        makeArticle(verifiedId, new Date(Date.now() - 48 * 3_600_000), 'FINANCIAL_FRAUD', ['ncsc', 'nhnn']),
        makeArticle(recentId, new Date(), 'MARKET', ['cafef']),
      ]) },
      threatEvidence: { findMany: vi.fn().mockResolvedValue([{ articleId: verifiedId, threatAlert: { verificationStatus: 'VERIFIED' } }]) },
    }
    const service = Object.create(RadarService.prototype) as RadarService
    ;(service as unknown as { prisma: PrismaService }).prisma = prisma as unknown as PrismaService
    const result = await service.articleHighlights()
    expect(result.items[0]).toMatchObject({ id: verifiedId, editorialPriority: 'HIGH' })
    expect(result.items[0].priorityReasons).toContain('Có cảnh báo liên quan đã xác minh')
    expect(result.items[0].priorityReasons).toContain('Chủ đề phòng tránh lừa đảo')
    expect(result.ranking).toContain('no popularity score')
  })

  it('does not read profile or survey records without explicit consent', async () => {
    const prisma = { financialProfile: { findUnique: vi.fn() }, calculationSession: { findMany: vi.fn() }, forensicAudit: { findFirst: vi.fn() } }
    const service = Object.create(RadarService.prototype) as RadarService
    ;(service as unknown as { prisma: PrismaService }).prisma = prisma as unknown as PrismaService
    expect(await service.recommendationSignals({ kind: 'guest', guestSessionId: 'guest-1' }, {})).toEqual({ signals: [] })
    expect(prisma.financialProfile.findUnique).not.toHaveBeenCalled()
    expect(prisma.calculationSession.findMany).not.toHaveBeenCalled()
    expect(prisma.forensicAudit.findFirst).not.toHaveBeenCalled()
  })

  it('reads only the selected profile goal and survey mode for the current guest', async () => {
    const prisma = {
      financialProfile: { findUnique: vi.fn().mockResolvedValue({ primaryGoal: 'SAVE_INVEST' }) },
      calculationSession: { findMany: vi.fn().mockResolvedValue([{ sessionMode: 'INVESTMENT_SURVEY' }]) },
    }
    const service = Object.create(RadarService.prototype) as RadarService
    ;(service as unknown as { prisma: PrismaService }).prisma = prisma as unknown as PrismaService
    const result = await service.recommendationSignals({ kind: 'guest', guestSessionId: 'guest-1' }, { includeProfileGoal: true, includeSurveyTopics: true })
    expect(prisma.financialProfile.findUnique).toHaveBeenCalledWith({ where: { guestSessionId: 'guest-1' }, select: { primaryGoal: true } })
    expect(prisma.calculationSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ guestSessionId: 'guest-1', sessionMode: { in: ['LOAN_SURVEY', 'INVESTMENT_SURVEY', 'MANUAL_COMPARE'] } }),
      select: { sessionMode: true }, take: 8,
    }))
    expect(JSON.stringify(prisma.calculationSession.findMany.mock.calls)).not.toContain('inputParamsJson')
    expect(result.signals.map(({ categoryCode }) => categoryCode)).toEqual(['MARKET', 'INFLATION', 'MARKET', 'INFLATION'])
    expect(result.signals.every(({ reason }) => reason.length > 0)).toBe(true)
  })

  it('reads only the current guest latest high-risk verdict with explicit forensic-history consent', async () => {
    const prisma = {
      financialProfile: { findUnique: vi.fn() },
      calculationSession: { findMany: vi.fn() },
      forensicAudit: { findFirst: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    }
    const service = Object.create(RadarService.prototype) as RadarService
    ;(service as unknown as { prisma: PrismaService }).prisma = prisma as unknown as PrismaService
    const result = await service.recommendationSignals({ kind: 'guest', guestSessionId: 'guest-1' }, { includeForensicHistory: true })
    expect(prisma.forensicAudit.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ guestSessionId: 'guest-1', verdictLevel: 'HIGH_RISK' }),
      select: { id: true },
    }))
    expect(result.signals).toEqual([expect.objectContaining({ categoryCode: 'FINANCIAL_FRAUD', source: 'FORENSIC_HISTORY' })])
    expect(JSON.stringify(prisma.forensicAudit.findFirst.mock.calls)).not.toContain('rawTextMasked')
    expect(prisma.financialProfile.findUnique).not.toHaveBeenCalled()
    expect(prisma.calculationSession.findMany).not.toHaveBeenCalled()
  })

  it('rejects unknown personalization consent fields', async () => {
    const service = Object.create(RadarService.prototype) as RadarService
    await expect(service.recommendationSignals({ kind: 'guest', guestSessionId: 'guest-1' }, { includeProfileGoal: true, includeForensicData: true })).rejects.toThrow('Tùy chọn cá nhân hóa không hợp lệ.')
  })

  it('filters ordinary crime on general legal feeds', () => {
    expect(relevantHeadline('vnexpress_phapluat', 'Tai nạn giao thông')).toBe(false)
    expect(relevantHeadline('dantri_phapluat', 'Mạo danh ngân hàng để lừa đảo')).toBe(true)
  })

  it('builds source citations from records and discards model references that do not exist', async () => {
    const id = '00000000-0000-4000-8000-000000000111'
    const { service, ai } = dailyBriefHarness({ articles: [briefArticle(id)], aiResult: { items: [
      { referenceId: id, sourceTitle: 'Sai tiêu đề', summary: 'Sai nguồn.', interpretation: null },
      { referenceId: id, sourceTitle: 'Tin nguồn ' + id, summary: 'Tóm lược có căn cứ.', interpretation: 'Ý nghĩa chung.' },
      { referenceId: '00000000-0000-4000-8000-000000000999', sourceTitle: 'Unknown', summary: 'Tin bịa.', interpretation: null },
    ] } })
    const result = await service.dailyBrief({ kind: 'guest', guestSessionId: 'g-1' }, {})
    expect(result.items).toHaveLength(1)
    expect(result.items[0].citations).toEqual([{ sourceName: 'Publisher', sourceTitle: `Tin nguồn ${id}`, url: `https://publisher.example/${id}`, publishedAt: expect.any(Date) }])
    expect(result.items[0].summary).toBe('Tóm lược có căn cứ.')
    expect(ai.generateStructured).toHaveBeenCalledOnce()
  })

  it('uses source-backed headlines and labels fallback when AI is unavailable', async () => {
    const id = '00000000-0000-4000-8000-000000000112'
    const { service } = dailyBriefHarness({ articles: [briefArticle(id)], aiFailure: new Error('provider unavailable') })
    const result = await service.dailyBrief({ kind: 'guest', guestSessionId: 'g-2' }, {})
    expect(result.status).toBe('SOURCE_FALLBACK')
    expect(result.items[0]).toMatchObject({ summary: `Tin nguồn ${id}`, generatedByAi: false, citations: [{ sourceName: 'Publisher' }] })
  })

  it('prioritizes a newly published verified warning over a general article', async () => {
    const alertId = '00000000-0000-4000-8000-000000000113'
    const articleId = '00000000-0000-4000-8000-000000000114'
    const { service } = dailyBriefHarness({ alerts: [briefAlert(alertId, 'VERIFIED')], articles: [briefArticle(articleId)], aiResult: { items: [
      { referenceId: articleId, sourceTitle: 'Tin nguồn ' + articleId, summary: 'Tin thị trường.', interpretation: null },
    ] } })
    const result = await service.dailyBrief({ kind: 'guest', guestSessionId: 'g-3' }, {})
    expect(result.items[0]).toMatchObject({ id: alertId, kind: 'ALERT', summary: `Cảnh báo nguồn ${alertId}`, verificationStatus: 'VERIFIED', generatedByAi: false })
  })

  it('caches by content version and refreshes when a verified warning arrives', async () => {
    const articleId = '00000000-0000-4000-8000-000000000115'
    const articles = [briefArticle(articleId)]
    const alerts: unknown[] = []
    const { service, ai } = dailyBriefHarness({ articles, alerts, aiResult: { items: [{ referenceId: articleId, sourceTitle: 'Tin nguồn ' + articleId, summary: 'Tin nguồn.', interpretation: null }] } })
    await service.dailyBrief({ kind: 'guest', guestSessionId: 'g-4' }, {})
    await service.dailyBrief({ kind: 'guest', guestSessionId: 'g-4' }, {})
    expect(ai.generateStructured).toHaveBeenCalledOnce()
    alerts.push(briefAlert('00000000-0000-4000-8000-000000000116', 'VERIFIED', new Date()))
    await service.dailyBrief({ kind: 'guest', guestSessionId: 'g-4' }, {})
    expect(ai.generateStructured).toHaveBeenCalledTimes(2)
  })

  it('returns an honest empty state when there are no cited records', async () => {
    const { service, ai } = dailyBriefHarness()
    const result = await service.dailyBrief({ kind: 'guest', guestSessionId: 'g-empty' }, {})
    expect(result.status).toBe('EMPTY')
    expect(result.items).toEqual([])
    expect(ai.generateStructured).not.toHaveBeenCalled()
  })

  it('uses only explicitly consented topic/profile signals for personal relevance, outside the AI prompt', async () => {
    const id = '00000000-0000-4000-8000-000000000118'
    const { service, prisma, ai } = dailyBriefHarness({ articles: [briefArticle(id)], aiResult: { items: [{ referenceId: id, sourceTitle: 'Tin nguồn ' + id, summary: 'Nguồn về lãi suất.', interpretation: null }] } })
    prisma.financialProfile.findUnique.mockResolvedValue({ primaryGoal: 'BORROW_SAFE' })
    const result = await service.dailyBrief({ kind: 'guest', guestSessionId: 'g-consent' }, { personalizationEnabled: true, includeProfileGoal: true })
    expect(prisma.financialProfile.findUnique).toHaveBeenCalledWith({ where: { guestSessionId: 'g-consent' }, select: { primaryGoal: true } })
    expect(result.items[0].relevance).toContain('khoản vay an toàn')
    expect(JSON.stringify(ai.generateStructured.mock.calls)).not.toContain('BORROW_SAFE')
    expect(JSON.stringify(ai.generateStructured.mock.calls)).not.toContain('amount')
  })

  it('rejects profile consent when personalization is disabled', async () => {
    const { service, prisma } = dailyBriefHarness()
    await expect(service.dailyBrief({ kind: 'guest', guestSessionId: 'g-no-consent' }, { personalizationEnabled: false, includeProfileGoal: true })).rejects.toThrow('Tùy chọn bản tin cá nhân chưa hợp lệ.')
    expect(prisma.financialProfile.findUnique).not.toHaveBeenCalled()
  })

  it('starts a new Vietnam-calendar cache entry at midnight and never reads profile signals unless consented', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-24T16:59:00.000Z'))
    try {
      const id = '00000000-0000-4000-8000-000000000117'
      const { service, prisma, ai } = dailyBriefHarness({ articles: [briefArticle(id)], aiResult: { items: [{ referenceId: id, sourceTitle: 'Tin nguồn ' + id, summary: 'Tin ngày.', interpretation: null }] } })
      const session = { kind: 'guest' as const, guestSessionId: 'g-5' }
      expect((await service.dailyBrief(session, {})).date).toBe('2026-11-24')
      await service.dailyBrief(session, {})
      expect(ai.generateStructured).toHaveBeenCalledOnce()
      expect(prisma.financialProfile.findUnique).not.toHaveBeenCalled()
      vi.setSystemTime(new Date('2026-11-24T17:01:00.000Z'))
      expect((await service.dailyBrief(session, {})).date).toBe('2026-11-25')
      expect(ai.generateStructured).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })

  it('blocks non-HTTPS and private/loopback targets in fetchPublicImage', async () => {
    await expect(fetchPublicImage('http://example.com/a.png')).rejects.toThrow('Chỉ hỗ trợ ảnh qua HTTPS.')
    await expect(fetchPublicImage('https://127.0.0.1/a.png')).rejects.toThrow('Địa chỉ mạng không được phép.')
  })
})
