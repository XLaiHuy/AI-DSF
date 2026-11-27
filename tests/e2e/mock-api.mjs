import { createServer, request as httpRequest } from 'node:http'

function proxyHeaders(headers) {
  const hopByHop = new Set(['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade'])
  for (const header of String(headers.connection ?? '').split(',')) hopByHop.add(header.trim().toLowerCase())
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !hopByHop.has(name)))
}

const articleId = '11111111-1111-4111-8111-111111111111'
const alertId = '22222222-2222-4222-8222-222222222222'
const article = {
  id: articleId,
  title: 'NHNN điều chỉnh định hướng lãi suất cho vay',
  canonicalUrl: 'https://example.test/rate-news',
  publishedAt: '2026-11-20T08:00:00.000Z',
  categories: ['INTEREST_RATE'], image: null,
  sources: [{ sourceId: '33333333-3333-4333-8333-333333333333', sourceKey: 'nhnn', sourceName: 'NHNN', url: 'https://example.test/rate-news', firstSeenAt: '2026-11-20T08:30:00.000Z', lastSeenAt: '2026-11-20T08:30:00.000Z' }],
}
const articleCount = Number(process.env.MOCK_ARTICLE_COUNT ?? 1)
const articles = Array.from({ length: Number.isInteger(articleCount) && articleCount > 0 ? Math.min(articleCount, 100) : 0 }, (_, index) => ({
  ...article,
  id: index === 0 ? articleId : `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
  title: index === 0 ? article.title : `${article.title} — cập nhật ${index + 1}`,
  canonicalUrl: index === 0 ? article.canonicalUrl : `https://example.test/rate-news-${index + 1}`,
  sources: article.sources.map((source) => ({ ...source, url: index === 0 ? source.url : `https://example.test/rate-news-${index + 1}` })),
}))
const alert = {
  id: alertId,
  threatCategory: 'PHISHING',
  tacticSummary: 'Mạo danh ngân hàng yêu cầu phí mở khóa',
  preventionGuidance: 'Không chia sẻ OTP.',
  verificationStatus: 'VERIFIED',
  issuedAt: null,
  publishedAt: '2026-11-20T08:00:00.000Z',
  verifiedAt: '2026-11-20T08:00:00.000Z',
  indicators: [{ id: '44444444-4444-4444-8444-444444444444', indicatorType: 'KEYWORD', indicatorText: 'lỗi 102' }],
  evidence: [{ articleId, title: 'Cảnh báo NCSC', sourceId: '55555555-5555-4555-8555-555555555555', sourceName: 'NCSC', url: 'https://example.test/ncsc', publishedAt: null }],
}
const sources = [
  ['cafef', 'CafeF', 'RSS', false, 'SUCCESS'],
  ['vneconomy', 'VnEconomy', 'RSS', false, 'SUCCESS'],
  ['vietstock', 'Vietstock', 'RSS', false, 'ERROR'],
  ['nhnn', 'NHNN', 'WEB', true, 'SUCCESS'],
  ['ncsc', 'NCSC', 'WEB', true, 'SUCCESS'],
].map(([sourceKey, name, sourceType, isTrustedForAlerts, lastFetchStatus], index) => ({
  id: `66666666-6666-4666-8666-${String(index + 1).padStart(12, '0')}`,
  sourceKey, name, sourceType, isTrustedForAlerts, isActive: true, lastFetchStatus,
  lastAttemptAt: '2026-11-22T08:00:00.000Z', lastSuccessAt: lastFetchStatus === 'SUCCESS' ? '2026-11-22T08:00:00.000Z' : '2026-11-22T07:00:00.000Z',
  _count: { articles: index === 2 ? 0 : 1 },
}))

const server = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json; charset=utf-8')
  const liveRequest = /(?:^|;\s*)fincopilot_e2e_mode=phase-two(?:;|$)/.test(request.headers.cookie ?? '')
  if (liveRequest &&
      /^\/api\/v1\/(?:auth|profile|forensic|survey)(?:[/?]|$)/.test(request.url ?? '')) {
    const upstream = httpRequest({
      hostname: '127.0.0.1', port: Number(process.env.PLAYWRIGHT_PHASE_TWO_API_PORT), path: request.url,
      method: request.method, headers: proxyHeaders(request.headers), agent: false,
    }, (reply) => {
      response.writeHead(reply.statusCode ?? 502, proxyHeaders(reply.headers))
      reply.pipe(response)
    })
    response.on('close', () => { if (!response.writableFinished) upstream.destroy() })
    upstream.on('error', () => {
      if (!response.headersSent && !response.destroyed) response.writeHead(502)
      response.end()
    })
    request.pipe(upstream)
    return
  }
  if (request.url === '/api/v1/health') {
    response.end(JSON.stringify({ status: 'ok' }))
    return
  }
  if (request.method === 'GET' && request.url === '/api/v1/auth/session') {
    response.end(JSON.stringify({ kind: 'guest', user: null, oauthProviders: { google: false, github: false } }))
    return
  }
  if (request.method === 'GET' && request.url === '/api/v1/forensic/audits') {
    response.end(JSON.stringify({ audits: [] }))
    return
  }
  if (request.method === 'GET' && request.url === '/api/v1/profile') {
    response.end(JSON.stringify({ profile: null, health: null }))
    return
  }
  if (request.method === 'GET' && request.url === '/api/v1/survey/history') {
    response.end(JSON.stringify({ sessions: [] }))
    return
  }
  if (request.method === 'GET' && request.url === '/api/v1/home/market') {
    const first = articles[0] ?? article
    const second = articles[1] ?? { ...first, id: '11111111-1111-4111-8111-000000000002', title: 'Cập nhật mặt bằng lãi suất huy động ngân hàng' }
    response.end(JSON.stringify({
      alert: {
        id: alert.id,
        tacticSummary: alert.tacticSummary,
        preventionGuidance: alert.preventionGuidance,
        publishedAt: alert.publishedAt,
      },
      articles: articles.slice(0, 6).map((item) => ({
        id: item.id,
        title: item.title,
        imageUrl: item.image?.url ?? null,
        proxyUrl: item.image?.url ? `/api/v1/radar/image-proxy?url=${encodeURIComponent(item.image.url)}` : null,
        sourceName: item.sources[0]?.sourceName ?? 'NHNN',
        publishedAt: item.publishedAt,
        categories: item.categories,
      })),
      trending: [first, second].map((item, idx) => ({
        rank: idx === 0 ? 1 : 2,
        id: item.id,
        title: item.title,
        summary: 'Diễn biến thị trường tài chính đáng chú ý từ nguồn công bố chính thức.',
        imageUrl: item.image?.url ?? null,
        proxyUrl: item.image?.url ? `/api/v1/radar/image-proxy?url=${encodeURIComponent(item.image.url)}` : null,
        sourceName: item.sources[0]?.sourceName ?? 'NHNN',
        publishedAt: item.publishedAt,
        readMinutes: 3,
        categories: item.categories,
        suggestedRateDelta: idx === 0 ? '-1.0' : null,
        trendReason: 'Tin tài chính nổi bật mới ghi nhận',
      })),
      scamFinanceRail: [
        {
          id: alert.id,
          kind: 'ALERT',
          title: alert.tacticSummary,
          badge: 'Cảnh báo Scam · Đã xác minh',
          imageUrl: null,
          proxyUrl: null,
          sourceName: 'NCSC',
          publishedAt: alert.publishedAt,
          handoffHref: `/forensic?from=radar&alertId=${alert.id}`,
        },
        {
          id: first.id,
          kind: 'FINANCE_NEWS',
          title: first.title,
          badge: 'Tài chính · Lãi suất',
          imageUrl: first.image?.url ?? null,
          proxyUrl: null,
          sourceName: first.sources[0]?.sourceName ?? 'NHNN',
          publishedAt: first.publishedAt,
          handoffHref: `/radar/${first.id}`,
        },
      ],
      marketRates: [
        { group: 'LOAN', latestEffectiveDate: '2026-01-01', institutions: ['Đơn vị mẫu'], category: 'SECURED_LOAN', label: 'Vay thế chấp', minRatePct: 6.5, medianRatePct: 6.52, maxRatePct: 6.53, sampleCount: 2 },
        { group: 'LOAN', latestEffectiveDate: '2026-01-01', institutions: ['Đơn vị mẫu'], category: 'UNSECURED_LOAN', label: 'Vay tín chấp', minRatePct: 12.9, medianRatePct: 14.5, maxRatePct: 45, sampleCount: 3 },
        { group: 'INVESTMENT', latestEffectiveDate: '2026-01-01', institutions: ['Đơn vị mẫu'], category: 'SAVING', label: 'Tiết kiệm', minRatePct: 4.7, medianRatePct: 5.3, maxRatePct: 5.8, sampleCount: 5 },
        { group: 'INVESTMENT', latestEffectiveDate: '2026-01-01', institutions: ['Đơn vị minh họa'], category: 'ACCUMULATION', label: 'Tích lũy', minRatePct: 4, medianRatePct: 4, maxRatePct: 4, sampleCount: 2 },
      ],
    }))
    return
  }
  if (request.method === 'GET' && request.url?.startsWith('/api/v1/radar/image-proxy')) {
    const png16x16 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAH0lEQVR42mNk+M9Qz0AEYBxVSF+FAP1UqB81YNQAAFwBAf/L0J9GAAAAAElFTkSuQmCC',
      'base64',
    )
    response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' })
    response.end(png16x16)
    return
  }
  if (process.env.MOCK_RADAR_ERROR === '1' && request.method === 'GET' && request.url?.startsWith('/api/v1/radar/articles')) {
    response.statusCode = 503
    response.end(JSON.stringify({ errorCode: 'ERR_INTERNAL_SERVER', message: 'Nguồn Radar tạm gián đoạn (fixture kiểm thử).' }))
    return
  }
  if (request.method === 'GET' && request.url === `/api/v1/radar/articles/${articleId}`) {
    response.end(JSON.stringify({ ...article, analysis: null }))
    return
  }
  if (request.method === 'GET' && request.url === '/api/v1/radar/articles/highlights') {
    response.end(JSON.stringify({ items: articles.map((item) => ({ ...item, editorialPriority: 'HIGH', priorityReasons: ['Tin mới công bố', 'Có cảnh báo đã xác minh liên quan'] })), ranking: 'Recency and editorial relevance' }))
    return
  }
  if (request.method === 'POST' && request.url === '/api/v1/radar/daily-brief') {
    response.end(JSON.stringify({
      date: '2026-11-24', dateLabel: '24/11/2026', status: 'EMPTY', updatedAt: new Date().toISOString(), isStale: false,
      personalization: { enabled: false, usedSignals: [] }, items: [],
    }))
    return
  }
  if (request.method === 'GET' && request.url?.startsWith('/api/v1/radar/articles')) {
    const requestUrl = new URL(request.url, 'http://localhost')
    const items = requestUrl.searchParams.get('category') === 'FINANCIAL_FRAUD' ? [] : articles
    response.end(JSON.stringify({ items, page: { limit: 100, hasMore: false, nextCursor: null }, sources }))
    return
  }
  if (request.method === 'POST' && request.url === `/api/v1/radar/articles/${articleId}/analyze`) {
    let body = ''
    for await (const chunk of request) body += chunk
    const mode = JSON.parse(body || '{}').mode === 'PERSONALIZED' ? 'PERSONALIZED' : 'GENERAL'
    response.end(JSON.stringify({ mode, facts: ['Nguồn nêu diễn biến lãi suất.'], assessment: 'Có thể ảnh hưởng chi phí vay; đây là nhận định tổng quát.', suggestedRateDelta: '-1.0', assumptions: [], citations: [{ sourceName: 'NHNN', url: 'https://example.test/rate-news' }] }))
    return
  }
  if (request.method === 'GET' && request.url === '/api/v1/radar/alerts') {
    response.end(JSON.stringify({ items: [alert] }))
    return
  }
  if (request.method === 'GET' && request.url === `/api/v1/radar/alerts/${alertId}`) {
    response.end(JSON.stringify(alert))
    return
  }
  if (request.method === 'GET' && request.url === '/api/v1/admin/radar/sources') {
    response.end(JSON.stringify(sources))
    return
  }
  if (request.method === 'POST' && request.url?.startsWith('/api/v1/admin/radar/')) {
    response.end(JSON.stringify({ jobId: `mock-job-${Date.now()}`, queued: true }))
    return
  }
  if (request.method === 'GET' && request.url === '/api/v1/admin/products') {
    response.end(JSON.stringify([]))
    return
  }
  if (request.method === 'POST' && request.url === '/api/v1/admin/products') {
    let body = ''
    for await (const chunk of request) body += chunk
    response.statusCode = 201
    response.end(JSON.stringify({ id: 'mock-product', ...JSON.parse(body) }))
    return
  }
  response.statusCode = 404
  response.end(JSON.stringify({ errorCode: 'ERR_NOT_FOUND', message: 'Mock endpoint not found.' }))
})

server.listen(Number(process.env.MOCK_API_PORT ?? 4400), '0.0.0.0')
