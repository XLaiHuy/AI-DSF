import type { ProductScheduler } from './product-scheduler'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Queue } from 'bullmq'
import type { PrismaService } from '../../common/prisma.service'
import type { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import type { ThreatMemoryService } from '../forensic/threat-memory.service'
import { AdminController } from './admin.controller'
import type { AdminService } from './admin.service'
import { ThreatIntakeService } from './threat-intake.service'
import { ThreatReviewService } from './threat-review.service'
import * as safety from './threat-safety'

afterEach(() => vi.restoreAllMocks())

function mockMemory(exclusions: string[] = []) {
  const invalidate = vi.fn()
  const memory = {
    invalidate,
    computeEmbedding: vi.fn(async () => ({ vector: Array<number>(256).fill(0.0625), model: 'text-embedding-3-small' })),
    fingerprint: (type: string, text: string) => `fingerprint:${type}:${text}`,
    get: async () => ({ exclusions: new Set(exclusions), aliases: [{ alias: 'dvc', expansion: 'dịch vụ công' }],
      avoidanceRules: [{ feedbackType: 'EXTRACTION_FIX', note: 'Bỏ tên miền trong phần liên hệ tòa soạn.' }], trusted: [
      { code: 'VCB', name: 'Vietcombank', vietqrBin: '970436', officialWebsite: 'https://www.vietcombank.com.vn' },
    ] }),
    retrieve: vi.fn(async () => ({ indicators: [], examples: [], learningTrace: { retrievalMode: 'exact_only' } })),
  } as unknown as ThreatMemoryService
  return { memory, invalidate }
}

describe('admin threat operations', () => {
  it.each(['file:///alerts.txt', 'http://127.0.0.1/alert', 'http://169.254.169.254/', 'https://[::1]/', 'https://user@example.com/'])(
    'rejects a disallowed document target %s', async (input) => {
      const lookup = vi.fn(async () => [])
      await expect(safety.resolvePublicTarget(new URL(input), lookup)).rejects.toThrow()
      expect(lookup).not.toHaveBeenCalled()
    },
  )

  it('rejects a DNS response containing both public and private addresses', async () => {
    await expect(safety.resolvePublicTarget(new URL('https://news.example.org'), async () => [
      { address: '8.8.8.8', family: 4 }, { address: '10.0.0.2', family: 4 },
    ])).rejects.toThrow('Địa chỉ mạng không được phép.')
  })

  it('passes intake feedback to the dedicated task and retains only verbatim indicators', async () => {
    const { memory } = mockMemory()
    const classify = vi.fn(async () => ({
      isScamAlert: true, threatCategory: 'IMPERSONATION',
      tacticSummary: 'Giả danh đơn vị hỗ trợ và yêu cầu cài ứng dụng lạ.',
      preventionGuidance: 'Kiểm tra ứng dụng qua trang chính thức của đơn vị.',
      indicators: [
        { indicatorType: 'KEYWORD', indicatorText: 'cài ứng dụng lạ' },
        { indicatorType: 'DOMAIN', indicatorText: 'gian-mao.example' },
        { indicatorType: 'DOMAIN', indicatorText: 'hallucinated.example' },
      ],
    }))
    const intake = new ThreatIntakeService({} as Queue, {} as PrismaService, { generateStructured: classify } as unknown as AiGatewayService, memory)
    const draft = await intake.extractFromInput({ rawText: 'Cảnh báo cài ứng dụng lạ tại gian-mao.example để đóng phí sửa lỗi 102.' })
    expect(classify).toHaveBeenCalledWith('THREAT_ARTICLE_EXTRACT', expect.anything(), expect.objectContaining({
      avoidanceRules: [{ feedbackType: 'EXTRACTION_FIX', note: 'Bỏ tên miền trong phần liên hệ tòa soạn.' }],
    }))
    expect(draft.threatCategory).toBe('IMPERSONATION')
    expect(draft.indicators.map(({ indicatorText }) => indicatorText)).toEqual(expect.arrayContaining([
      'gian-mao.example', 'cài ứng dụng lạ',
    ]))
    expect(draft.indicators.map(({ indicatorText }) => indicatorText)).not.toContain('hallucinated.example')
    for (const { start, end, phrase } of draft.spans) expect(draft.sourceExcerpt?.slice(start, end)).toBe(phrase)
  })

  it('runs a hot crawl idempotently, retains previous alerts and removes ignored IOCs', async () => {
    const { memory, invalidate } = mockMemory(['ignored.example', 'loi 102', 'phi sua loi 102'])
    const feed = '<rss><item><title>Cảnh báo lừa đảo</title><link>https://news.example.org/first</link><description>Truy cập ignored.example để đóng tiền.</description></item><item><title>Cảnh báo giả danh</title><link>https://news.example.org/second</link><description>Truy cập already.example để đóng tiền.</description></item><item><title>Khởi tố hai người cưỡng đoạt tài sản</title><link>https://news.example.org/extortion</link><description>Chiếm đoạt tài sản bằng cách đe dọa.</description></item></rss>'
    const articles = {
      '/feed': feed,
      '/first': '<main>Đối tượng yêu cầu nộp phí qua ignored.example.</main>',
      '/second': '<main>Đối tượng yêu cầu nộp phí qua already.example.</main>',
      '/extortion': '<main>Hai người dùng lời đe dọa để cưỡng đoạt tài sản.</main>',
    }
    const fetch = vi.spyOn(safety, 'fetchPublicDocument').mockImplementation(async (url) => ({
      url, text: articles[new URL(url).pathname as keyof typeof articles],
    }))
    const inserted = new Map([['https://news.example.org/first', { id: 'radar-article', threatScannedAt: null as Date | null }]])
    const findArticle = vi.fn(async () => null)
    const createArticle = vi.fn(async ({ data }: { data: { id: string; canonicalUrl: string } }) => {
      inserted.set(data.canonicalUrl, { id: data.id, threatScannedAt: null })
      return { count: 1 }
    })
    const updateAlert = vi.fn(async () => ({}))
    const createAlert = vi.fn(async () => ({}))
    const tx = {
      $queryRaw: vi.fn(async () => []),
      marketArticle: { findFirst: findArticle, createMany: createArticle,
        findUnique: async ({ where }: { where: { canonicalUrl: string } }) => inserted.get(where.canonicalUrl) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: { threatScannedAt: Date } }) => {
          const row = [...inserted.values()].find(({ id }) => id === where.id)
          if (row) row.threatScannedAt = data.threatScannedAt
        },
      },
      articleSource: { upsert: vi.fn() },
      threatAlert: {
        findFirst: vi.fn(async ({ where }: { where: { OR: unknown[] } }) =>
          where.OR.length > 1 ? { id: 'existing-alert' } : null),
        findMany: async () => [], create: createAlert, update: updateAlert,
      },
      threatEvidence: { createMany: vi.fn(async () => ({ count: 1 })) },
    }
    const prisma = {
      marketSource: { findMany: async () => [{ id: 'source', sourceKey: 'news', sourceType: 'RSS', endpointUrl: 'https://news.example.org/feed' }], update: vi.fn() },
      marketArticle: tx.marketArticle, $transaction: (work: (client: typeof tx) => unknown) => work(tx),
    } as unknown as PrismaService
    const classify = vi.fn(async (_task, _schema, { text }: { text: string }) => ({
      isScamAlert: true, threatCategory: 'IMPERSONATION', tacticSummary: 'Đối tượng mạo danh và yêu cầu nộp phí.',
      preventionGuidance: 'Kiểm tra qua số điện thoại được niêm yết chính thức.',
      indicators: [{ indicatorType: 'DOMAIN', indicatorText: text.includes('ignored.example') ? 'ignored.example' : 'already.example' }],
    }))
    const ai = { generateStructured: classify } as unknown as AiGatewayService
    const intake = new ThreatIntakeService({} as Queue, prisma, ai, memory)
    const first = intake.hotCrawlNow('news')
    expect(intake.hotCrawlNow('news')).toBe(first)
    expect(await first).toMatchObject({ sourcesScanned: 1, newArticles: 2, newProposals: 1, skippedDuplicates: 1 })
    expect(fetch).toHaveBeenCalledWith('https://news.example.org/first')
    expect(fetch).toHaveBeenCalledWith('https://news.example.org/second')
    expect(fetch).toHaveBeenCalledWith('https://news.example.org/extortion')
    expect(classify).toHaveBeenCalledTimes(2)
    expect(await intake.hotCrawlNow('news')).toMatchObject({ newArticles: 0, skippedDuplicates: 3 })
    expect(createAlert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ data: expect.objectContaining({ indicators: { create: [] } }) }))
    expect(updateAlert).toHaveBeenCalledExactlyOnceWith({ where: { id: 'existing-alert' }, data: { hitCount: { increment: 1 } } })
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('checks twelve safe messages and catches custom hard IOC matches', () => {
    expect(safety.runSafetyShadowTest([{ indicatorType: 'KEYWORD', indicatorText: 'phí sửa lỗi 102' }]))
      .toMatchObject({ passed: true, safeCases: 12, hits: [] })
    expect(safety.runSafetyShadowTest([{ indicatorType: 'KEYWORD', indicatorText: 'hạn mức chuyển khoản' }]).passed).toBe(false)
    expect(safety.runSafetyShadowTest([{ indicatorType: 'DOMAIN', indicatorText: 'gian-mao.example' }], 'Mở gian-mao.example để xác nhận.')
      .custom?.indicators).toEqual(['gian-mao.example'])
    expect(safety.normalizeThreatIndicator({ indicatorType: 'KEYWORD', indicatorText: 'chuyển khoản' })).toBeUndefined()
  })

  it('blocks whitelisted indicators at publish and supports publish, revoke, and case export', async () => {
    const { memory, invalidate } = mockMemory()
    const id = randomUUID()
    const row = { id, indicators: [{ id: randomUUID(), threatAlertId: id, indicatorType: 'DOMAIN', indicatorText: 'login.vietcombank.com.vn' }],
      verificationStatus: 'UNVERIFIED', originSource: 'ADMIN_INGEST', publishedAt: null, verifiedAt: null }
    const update = vi.fn(async () => ({ id }))
    const tx = { $queryRaw: vi.fn(), threatAlert: { findUnique: async () => row, update } }
    const prisma = {
      $transaction: (work: (client: typeof tx) => unknown) => work(tx),
      threatFeedbackExample: {
        groupBy: async () => [{ rndCategory: 'RULE_GAP', feedbackType: 'FALSE_POSITIVE', isActive: true, _count: 1 }],
        findMany: async () => [{ id, feedbackType: 'FALSE_POSITIVE', sampleTextMasked: 'Chuyển khoản bình thường', expectedVerdict: 'SAFE' }],
      },
    } as unknown as PrismaService
    const review = new ThreatReviewService(prisma, memory)
    await expect(review.patch(id, { verificationStatus: 'VERIFIED' })).rejects.toThrow('tổ chức được cấp phép')
    expect(update).not.toHaveBeenCalled()
    row.indicators[0].indicatorText = 'gian-mao.example'
    await review.patch(id, { verificationStatus: 'VERIFIED' })
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({
      verificationStatus: 'VERIFIED', publishedAt: expect.any(Date),
    }) }))
    await review.patch(id, { verificationStatus: 'UNVERIFIED' })
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({
      verificationStatus: 'UNVERIFIED', publishedAt: null,
    }) }))
    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(await review.summary()).toEqual({ total: 1, active: 1, byCategory: { RULE_GAP: 1 } })
    expect(await review.exportCases()).toMatchObject([{ fields: { rawText: 'Chuyển khoản bình thường' },
      expectedVerdicts: ['SAFE'], mustNotTriggerRules: ['RULE_05_NCSC_THREAT_MATCH'] }])
  })

  it('publishes a tactic-only alert with a 256-dimensional embedding and lists distinct provenance links', async () => {
    const { memory } = mockMemory()
    const id = randomUUID()
    const row = { id, indicators: [], verificationStatus: 'UNVERIFIED', publishedAt: null, verifiedAt: null,
      tacticSummary: 'Giả làm nhân viên điện lực và dọa cắt điện để yêu cầu nộp phí.',
      preventionGuidance: 'Đối chiếu hóa đơn qua trang chính thức của công ty điện lực.' }
    const provenance = { articleSource: { source: { name: 'Nguồn báo' },
      article: { title: 'Cảnh báo giả danh', canonicalUrl: 'https://news.example.org/canh-bao' } } }
    const update = vi.fn(async () => ({ id }))
    const tx = { $queryRaw: vi.fn(), threatAlert: { findUnique: async () => row, update } }
    const prisma = { threatAlert: { findMany: async () => [{ ...row, evidence: [provenance, provenance] }] },
      $transaction: (work: (client: typeof tx) => unknown) => work(tx) } as unknown as PrismaService
    const review = new ThreatReviewService(prisma, memory)
    await review.patch(id, { verificationStatus: 'VERIFIED' })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      verificationStatus: 'VERIFIED', embeddingJson: expect.arrayContaining([0.0625]),
    }) }))
    expect(await review.list()).toMatchObject([{ sourceLinks: [{ sourceName: 'Nguồn báo', url: provenance.articleSource.article.canonicalUrl }] }])
  })

  it('reports independent scheduler clocks and partial crawl failures', async () => {
    const scheduler = async () => ({ next: 1000 })
    const admin = new AdminController({ scheduler, fetch: vi.fn().mockResolvedValue({ jobId: 'manual' }), syncProducts: vi.fn().mockResolvedValue({ productsUpserted: 1, sourcesReachable: 1, sourcesChecked: 1 }) } as unknown as AdminService,
      { scheduler, hotCrawlNow: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as ThreatIntakeService,
      {} as ThreatReviewService, { scheduler } as unknown as ProductScheduler)
    expect(await admin.schedulers()).toEqual(['15 phút', '24 giờ', '24 giờ'].map(intervalLabel =>
      expect.objectContaining({ scheduled: true, intervalLabel, nextAt: new Date(1000).toISOString() })))
    expect((await admin.hotCrawlAll()).map(row => row.status)).toEqual(['QUEUED', 'ERROR', 'SUCCESS'])
  })

  it('wires the R&D endpoint to the 12 clean cases and evaluates active aliases', async () => {
    const { memory } = mockMemory()
    const prisma = { threatFeedbackExample: { findMany: async () => [{
      id: 'alias', feedbackType: 'TEENCODE_ALIAS', highlightedSpan: 'dvc', adminNote: 'dịch vụ công',
    }] } } as unknown as PrismaService
    const controller = new AdminController({} as AdminService, {} as ThreatIntakeService, new ThreatReviewService(prisma, memory), {} as ProductScheduler)
    expect(await controller.runEval()).toMatchObject({
      cleanPassed: 12, cleanTotal: 12, feedbackPassed: 1, feedbackTotal: 1,
      cases: expect.arrayContaining([{ id: 'alias', kind: 'TEENCODE_ALIAS', expected: 'dich vu cong',
        actual: 'dich vu cong', passed: true, detail: 'dvc' }]),
    })
  })
})
