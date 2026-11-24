import { createServer } from 'node:http'

const articleId = '11111111-1111-4111-8111-111111111111'
const alertId = '22222222-2222-4222-8222-222222222222'
const article = {
  id: articleId,
  title: 'NHNN điều chỉnh định hướng lãi suất cho vay',
  canonicalUrl: 'https://example.test/rate-news',
  publishedAt: '2026-11-20T08:00:00.000Z',
  categories: ['INTEREST_RATE'],
  sources: [{ sourceId: '33333333-3333-4333-8333-333333333333', sourceKey: 'nhnn', sourceName: 'NHNN', url: 'https://example.test/rate-news', firstSeenAt: '2026-11-20T08:30:00.000Z', lastSeenAt: '2026-11-20T08:30:00.000Z' }],
}
const alert = {
  id: alertId,
  threatCategory: 'PHISHING',
  tacticSummary: 'Mạo danh ngân hàng yêu cầu phí mở khóa',
  preventionGuidance: 'Không chia sẻ OTP.',
  verificationStatus: 'UNVERIFIED',
  issuedAt: null,
  publishedAt: '2026-11-20T08:00:00.000Z',
  verifiedAt: null,
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
  if (request.url === '/api/v1/health') {
    response.end(JSON.stringify({ status: 'ok' }))
    return
  }
  if (request.method === 'GET' && request.url === `/api/v1/radar/articles/${articleId}`) {
    response.end(JSON.stringify({ ...article, analysis: null }))
    return
  }
  if (request.method === 'GET' && request.url?.startsWith('/api/v1/radar/articles')) {
    response.end(JSON.stringify({ items: [article], page: { limit: 20, hasMore: false, nextCursor: null }, sources: [] }))
    return
  }
  if (request.method === 'POST' && request.url === `/api/v1/radar/articles/${articleId}/analyze`) {
    response.end(JSON.stringify({ mode: 'GENERAL', facts: ['Nguồn nêu diễn biến lãi suất.'], assessment: 'Có thể ảnh hưởng chi phí vay; đây là nhận định tổng quát.', suggestedRateDelta: '-1.0', assumptions: ['Không có hồ sơ R07.'], citations: [{ sourceName: 'NHNN', url: 'https://example.test/rate-news' }] }))
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
