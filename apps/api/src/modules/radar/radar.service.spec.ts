import { relevantHeadline } from './legal-feed'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../../common/prisma.service'
import { fetchPublicImage } from '../admin/threat-safety'
import { articleImageUrl, categoriesFor, dateOnly, extractOgImageUrl, parseFeed, RadarService } from './radar.service'

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
    Object.assign(service, {
      prisma, ai, logger: { warn: vi.fn() },
      dailyBriefCache: new Map(), dailyBriefInFlight: new Map(),
    })
    return { service, prisma, ai }
  }

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
