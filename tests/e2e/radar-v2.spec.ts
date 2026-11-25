import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const articleId = '11111111-1111-4111-8111-111111111111'
const source = { sourceId: '33333333-3333-4333-8333-333333333333', sourceKey: 'nhnn', sourceName: 'NHNN', url: 'https://example.test/rate-news', firstSeenAt: '2026-11-20T08:30:00.000Z', lastSeenAt: '2026-11-20T09:00:00.000Z' }
const sourceStatus = ['CafeF', 'VnEconomy', 'Vietstock', 'NHNN', 'NCSC'].map((name, index) => ({ sourceKey: name.toLocaleLowerCase('en'), name, lastFetchStatus: index === 2 ? 'ERROR' : 'SUCCESS', lastAttemptAt: '2026-11-20T09:00:00.000Z', lastSuccessAt: '2026-11-20T08:00:00.000Z' }))
const makeArticle = (index: number) => ({
  id: index === 0 ? articleId : `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
  title: `Tin minh họa kiểm thử giao diện · Chủ đề lãi suất ${index + 1}`,
  canonicalUrl: `https://example.test/rate-news-${index + 1}`,
  publishedAt: index === 0 ? null : '2026-11-20T08:00:00.000Z',
  image: null,
  categories: ['INTEREST_RATE'],
  sources: [{ ...source, url: `https://example.test/rate-news-${index + 1}` }],
})

async function fixturePage(page: Page, count: number) {
  const articles = Array.from({ length: count }, (_, index) => makeArticle(index))
  await page.route('**/api/v1/radar/articles/highlights', (route) => route.fulfill({ json: { items: articles.map((item) => ({ ...item, editorialPriority: 'STANDARD', priorityReasons: [] })), ranking: 'Synthetic test fixture' } }))
  const response = (url: string) => ({ items: new URL(url).searchParams.get('category') === 'FINANCIAL_FRAUD' ? [] : articles, page: { limit: 100, hasMore: false, nextCursor: null }, sources: sourceStatus })
  await page.route('**/api/v1/radar/articles?**', (route) => route.fulfill({ json: response(route.request().url()) }))
  await page.route('**/api/v1/radar/articles', (route) => route.fulfill({ json: { ...response(route.request().url()), sources: sourceStatus } }))
  await page.route('**/api/v1/radar/alerts**', (route) => route.fulfill({ json: { items: [] } }))
}

for (const count of [0, 1, 5, 20, 100]) {
  test(`Radar xử lý ${count} bài mà không tràn ngang`, async ({ page }) => {
    await fixturePage(page, count)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/radar')
    if (count === 0) await expect(page.getByRole('heading', { name: 'Chưa có tin phù hợp' })).toBeVisible()
    else {
      await expect(page.locator('.radar-feature')).toHaveCount(Math.min(count, 2))
      await expect(page.locator('.radar-story-row')).toHaveCount(Math.max(0, count - 2))
      if (count === 1) await expect(page.getByText('Chưa rõ thời gian công bố')).toBeVisible()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('Radar xuất ma trận ảnh desktop và mobile cho các trạng thái sản phẩm', async ({ page }, info) => {
  test.setTimeout(240_000)
  const directory = 'docs/design/screenshots'
  await mkdir(directory, { recursive: true })
  const cases = [
    { key: 'no-alerts', count: 5, alerts: false, image: false, personalized: false },
    { key: 'verified-alerts', count: 5, alerts: true, image: false, personalized: false },
    { key: 'one-article', count: 1, alerts: false, image: false, personalized: false },
    { key: 'five-articles', count: 5, alerts: false, image: false, personalized: false },
    { key: 'source-image', count: 1, alerts: false, image: true, personalized: false },
    { key: 'no-image', count: 1, alerts: false, image: false, personalized: false },
    { key: 'personalization-enabled', count: 5, alerts: false, image: false, personalized: true },
    { key: 'personalization-disabled', count: 5, alerts: false, image: false, personalized: false },
    { key: 'guest-no-profile', count: 5, alerts: false, image: false, personalized: true },
  ]
  for (const scenario of cases) {
    for (const viewport of [{ width: 1440, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }]) {
      const view = await page.context().newPage()
      const articles = Array.from({ length: scenario.count }, (_, index) => ({
        ...makeArticle(index),
        ...(scenario.image && index === 0 ? { image: { url: 'https://cdn.publisher.example.test/article.svg', alt: 'Biểu đồ lãi suất', credit: 'NHNN', sourceUrl: 'https://publisher.example.test/article' } } : {}),
      }))
      await view.route('**/api/v1/radar/articles/highlights', (route) => route.fulfill({ json: { items: articles.map((item) => ({ ...item, editorialPriority: 'STANDARD', priorityReasons: ['Tin minh họa được công bố gần đây', 'Chủ đề lãi suất'] })), ranking: 'Synthetic screenshot fixture' } }))
      const response = (url: string) => ({ items: new URL(url).searchParams.get('category') === 'FINANCIAL_FRAUD' ? [] : articles, page: { limit: 100, hasMore: false, nextCursor: null }, sources: sourceStatus })
      await view.route('**/api/v1/radar/articles?**', (route) => route.fulfill({ json: response(route.request().url()) }))
      await view.route('**/api/v1/radar/articles', (route) => route.fulfill({ json: response(route.request().url()) }))
      await view.route('**/api/v1/radar/alerts**', (route) => route.fulfill({ json: { items: scenario.alerts ? [{ id: '22222222-2222-4222-8222-222222222222', threatCategory: 'PHISHING', tacticSummary: 'Nội dung cảnh báo minh họa đã xác minh', verificationStatus: 'VERIFIED', publishedAt: '2026-11-20T08:00:00.000Z', evidence: [{ articleId, sourceName: 'NCSC', title: 'Cảnh báo minh họa', url: 'https://example.test/ncsc' }] }] : [] } }))
      await view.route('**/api/v1/radar/recommendation-signals', (route) => route.fulfill({ json: { signals: [{ categoryCode: 'INTEREST_RATE', source: 'SURVEY_TOPIC', reason: 'Dựa trên loại Khảo sát vay gần đây; không dùng số tiền hay kết quả' }] } }))
      if (scenario.image) await view.route('https://cdn.publisher.example.test/article.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 190"><rect width="320" height="190" fill="#d6ded3"/><rect x="35" y="20" width="250" height="138" fill="none" stroke="#174a3a" stroke-width="2"/><path d="M51 37h93M51 45h61M164 37h102M164 45h78M51 59h215M51 68h215M51 83h83M51 91h83M51 99h83M51 107h83M51 115h83M51 123h83M157 59v70M174 83h92M174 91h80M174 103h92M174 111h70M174 123h86" fill="none" stroke="#174a3a" stroke-width="2"/><circle cx="238" cy="139" r="10" fill="none" stroke="#174a3a" stroke-width="2"/></svg>' }))
      const surveyConsent = scenario.personalized && scenario.key !== 'guest-no-profile'
      await view.addInitScript(({ enabled, includeSurveyTopics }) => localStorage.setItem('fincopilot.radar.interests', JSON.stringify({ enabled, topics: [], includeProfileGoal: false, includeSurveyTopics })), { enabled: scenario.personalized, includeSurveyTopics: surveyConsent })
      await view.setViewportSize({ width: viewport.width, height: viewport.height })
      await view.goto('/radar')
      await expect(view.getByRole('heading', { name: 'Radar thị trường' })).toBeVisible()
      await expect(view.locator('.radar-feature')).toHaveCount(Math.min(scenario.count, 2), { timeout: 15_000 })
      if (scenario.alerts) await expect(view.getByText('Đã xác minh').first()).toBeVisible()
      else await expect(view.locator('.radar-v2-alerts--empty')).toBeVisible()
      if (scenario.key === 'personalization-enabled') await expect(view.getByText(/Dựa trên loại Khảo sát vay gần đây/).first()).toBeVisible()
      if (scenario.key === 'guest-no-profile') await expect(view.locator('.radar-v2-recommendations')).toContainText('Chưa có tín hiệu nào được phép dùng')
      if (scenario.key === 'personalization-enabled' || scenario.key === 'personalization-disabled' || scenario.key === 'guest-no-profile') await view.locator('.radar-v2-personal').scrollIntoViewIfNeeded()
      expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const filename = `radar-v2-final-${scenario.key}-${viewport.name}.png`
      const path = `${directory}/${filename}`
      await view.screenshot({ path })
      info.attachments.push({ name: filename, contentType: 'image/png', path })
      await view.close()
    }
  }
})

test('Radar báo lỗi nguồn thay vì thay dữ liệu cũ thành tin mới', async ({ page }) => {
  await page.route('**/api/v1/radar/articles/highlights', (route) => route.fulfill({ json: { items: [], ranking: 'Fixture' } }))
  await page.route('**/api/v1/radar/articles?**', (route) => route.fulfill({ status: 503, json: { errorCode: 'ERR_INTERNAL_SERVER', message: 'Nguồn Radar tạm gián đoạn (fixture kiểm thử).' } }))
  await page.route('**/api/v1/radar/alerts**', (route) => route.fulfill({ json: { items: [] } }))
  await page.goto('/radar')
  await expect(page.locator('.radar-error-state')).toContainText(/Nguồn Radar tạm gián đoạn|Yêu cầu thất bại/, { timeout: 15_000 })
})

test('Radar phân biệt cảnh báo đã xác minh với cảnh báo chưa xác minh', async ({ page }) => {
  await fixturePage(page, 1)
  await page.route('**/api/v1/radar/alerts**', (route) => route.fulfill({ json: { items: [
    { id: '22222222-2222-4222-8222-222222222222', threatCategory: 'PHISHING', tacticSummary: 'Cảnh báo đã xác minh từ nguồn', verificationStatus: 'VERIFIED', publishedAt: '2026-11-20T08:00:00.000Z', evidence: [{ articleId, sourceName: 'NCSC', title: 'Cảnh báo', url: 'https://example.test/ncsc' }] },
    { id: '22222222-2222-4222-8222-222222222223', threatCategory: 'PHISHING', tacticSummary: 'Cảnh báo đang chờ đối chiếu', verificationStatus: 'UNVERIFIED', publishedAt: null, evidence: [] },
  ] } }))
  await page.goto('/radar')
  await expect(page.getByText('Đã xác minh').first()).toBeVisible()
  await expect(page.getByText('Chưa xác minh').first()).toBeVisible()
  await expect(page.getByText('Cảnh báo đang chờ đối chiếu')).toBeVisible()
  await expect(page.getByText('Chưa rõ thời điểm công bố').first()).toBeVisible()
})

test('Khách có thể tắt gợi ý; không cần hồ sơ để đọc tin công khai', async ({ page }) => {
  await fixturePage(page, 1)
  await page.goto('/radar')
  await expect(page.getByRole('heading', { name: 'Radar thị trường' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bật gợi ý cá nhân' })).toBeVisible()
  await expect(page.getByText(/không đọc thu nhập, số tiền vay/i)).toBeVisible()
})

test('Chỉ ưu tiên tin lừa đảo theo lịch sử Giám định sau khi người dùng bật quyền', async ({ page }) => {
  const articles = [
    { ...makeArticle(0), title: 'Tin lãi suất tham khảo', categories: ['INTEREST_RATE'] },
    { ...makeArticle(1), title: 'Cảnh báo giả mạo ứng dụng ngân hàng', categories: ['FINANCIAL_FRAUD'] },
  ]
  await page.route('**/api/v1/radar/articles/highlights', (route) => route.fulfill({ json: { items: articles.map((item) => ({ ...item, editorialPriority: 'STANDARD', priorityReasons: [] })), ranking: 'Fixture' } }))
  await page.route('**/api/v1/radar/articles?**', (route) => route.fulfill({ json: { items: articles, page: { hasMore: false, nextCursor: null }, sources: sourceStatus } }))
  await page.route('**/api/v1/radar/articles', (route) => route.fulfill({ json: { items: articles, page: { hasMore: false, nextCursor: null }, sources: sourceStatus } }))
  await page.route('**/api/v1/radar/alerts**', (route) => route.fulfill({ json: { items: [] } }))
  let consentPayload: Record<string, unknown> | undefined
  await page.route('**/api/v1/radar/recommendation-signals', async (route) => {
    consentPayload = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ json: { signals: [{ categoryCode: 'FINANCIAL_FRAUD', source: 'FORENSIC_HISTORY', reason: 'Ưu tiên cảnh báo lừa đảo theo Giám định rủi ro cao gần đây.' }] } })
  })
  await page.addInitScript(() => localStorage.setItem('fincopilot.radar.interests', JSON.stringify({ enabled: true, topics: ['INTEREST_RATE'], includeForensicHistory: false })))
  await page.goto('/radar')
  await page.getByLabel('Kết quả Giám định rủi ro cao trong 30 ngày').check()
  await expect.poll(() => consentPayload?.includeForensicHistory).toBe(true)
  await expect(page.locator('.radar-recommendation-row').first()).toContainText('Cảnh báo giả mạo ứng dụng ngân hàng')
  await expect(page.locator('.radar-recommendation-row').first()).toContainText('Giám định rủi ro cao gần đây')
})

test('Bộ lọc lưu trữ cung cấp năm 2026 và bộ lọc ngày tự chọn', async ({ page }) => {
  await fixturePage(page, 1)
  let archiveQuery = ''
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('/radar/articles') && url.searchParams.has('year')) archiveQuery = url.search
  })
  await page.goto('/radar')
  await page.getByLabel('Lọc thời gian').selectOption('year')
  await expect(page.getByLabel('Năm công bố').locator('option[value="2026"]')).toHaveCount(1)
  await expect.poll(() => archiveQuery).toContain('year=2026')
  await page.getByLabel('Lọc thời gian').selectOption('custom')
  await expect(page.getByLabel('Từ ngày')).toBeVisible()
  await expect(page.getByLabel('Đến ngày')).toBeVisible()
})

test('Lạm phát được phân loại riêng với dữ kiện CPI', async ({ page }) => {
  const inflation = { ...makeArticle(0), title: 'CPI và giá tiêu dùng — dữ liệu mẫu', categories: ['INFLATION'] }
  await page.route('**/api/v1/radar/articles/highlights', (route) => route.fulfill({ json: { items: [{ ...inflation, editorialPriority: 'STANDARD', priorityReasons: [] }], ranking: 'Fixture' } }))
  await page.route('**/api/v1/radar/articles?**', (route) => route.fulfill({ json: { items: [inflation], page: { limit: 20, hasMore: false, nextCursor: null }, sources: sourceStatus } }))
  await page.route('**/api/v1/radar/articles', (route) => route.fulfill({ json: { items: [inflation], page: { limit: 20, hasMore: false, nextCursor: null }, sources: sourceStatus } }))
  await page.route('**/api/v1/radar/alerts**', (route) => route.fulfill({ json: { items: [] } }))
  await page.goto('/radar')
  await expect(page.locator('.radar-feature-topic').filter({ hasText: 'Lạm phát' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Lạm phát', exact: true }).first()).toBeVisible()
})

test('Ảnh HTTPS hiển thị kèm nguồn; ảnh hỏng rơi về minh họa chủ đề', async ({ page }) => {
  const goodId = articleId
  const brokenId = '11111111-1111-4111-8111-111111111112'
  const detail = (id: string, imageUrl: string) => ({ ...makeArticle(0), id, image: { url: imageUrl, alt: 'Biểu đồ được xuất bản', credit: 'Nguồn NHNN', sourceUrl: 'https://publisher.example.test/article' }, sources: [{ ...source, url: 'https://publisher.example.test/article' }], analysis: null })
  await page.route('**/api/v1/radar/articles/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1) ?? goodId
    return route.fulfill({ json: detail(id, id === goodId ? 'https://publisher.example.test/ok.png' : 'https://publisher.example.test/missing.png') })
  })
  await page.route('https://publisher.example.test/ok.png', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ9sAAAAASUVORK5CYII=', 'base64') }))
  await page.route('https://publisher.example.test/missing.png', (route) => route.abort())
  await page.goto(`/radar/${goodId}`)
  await expect(page.locator('.detail-source-image img')).toBeVisible()
  await expect(page.getByText('Nguồn NHNN')).toBeVisible()
  await page.goto(`/radar/${brokenId}`)
  await expect(page.getByRole('img', { name: /Minh họa chủ đề/ })).toBeVisible()
})

test('Delta có căn cứ mở mô phỏng cú sốc sang Khảo sát', async ({ page }) => {
  await page.route('**/api/v1/radar/articles/*', (route) => route.fulfill({ json: {
    ...makeArticle(0), image: null, sources: [{ ...source, url: 'https://example.test/rate-news' }],
    analysis: { mode: 'GENERAL', facts: ['Lãi suất từ 8% lên 9%.'], assessment: { text: 'Nguồn nêu rõ mức thay đổi.' }, suggestedRateDelta: '1.0' },
  } }))
  await page.goto(`/radar/${articleId}`)
  await expect(page.getByRole('link', { name: /Mô phỏng cú sốc lãi suất 1.0 điểm phần trăm/ })).toHaveAttribute('href', `/survey?shockDelta=1.0&articleId=${articleId}`)
})
