import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const articleId = '11111111-1111-4111-8111-111111111111'
const source = { sourceId: '33333333-3333-4333-8333-333333333333', sourceKey: 'nhnn', sourceName: 'NHNN', url: 'https://example.test/rate-news', firstSeenAt: '2026-11-20T08:30:00.000Z', lastSeenAt: '2026-11-20T09:00:00.000Z' }
const sourceStatus = ['CafeF', 'VnEconomy', 'Vietstock', 'NHNN', 'NCSC'].map((name, index) => ({ sourceKey: name.toLocaleLowerCase('en'), name, lastFetchStatus: index === 2 ? 'ERROR' : 'SUCCESS', lastAttemptAt: '2026-11-20T09:00:00.000Z', lastSuccessAt: '2026-11-20T08:00:00.000Z' }))
const emptyMarket = { alert: null, articles: [], trending: [], scamFinanceRail: [], marketRates: [] }
test.beforeEach(async ({ page }) => { await page.route('**/api/v1/home/market', (route) => route.fulfill({ json: emptyMarket })) })
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
      await expect(page.locator('.desk-feature')).toHaveCount(Math.min(count, 2))
      await expect(page.locator('.desk-row')).toHaveCount(Math.max(0, count - 2))
      if (count === 1) await expect(page.locator('.desk-feature').getByText('Chưa rõ thời gian công bố')).toBeVisible()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('Radar xuất ma trận ảnh desktop và mobile cho các trạng thái sản phẩm', async ({ page }, info) => {
  test.setTimeout(240_000)
  const directory = info.outputPath('screenshots')
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
    for (const viewport of [{ width: 1280, height: 800, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }]) {
      const view = await page.context().newPage()
      await view.route('**/api/v1/home/market', (route) => route.fulfill({ json: emptyMarket }))
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
      await expect(view.getByRole('heading', { name: 'Kiểm tra trước khi chuyển tiền' })).toBeVisible()
      await expect(view.locator('.desk-feature')).toHaveCount(Math.min(scenario.count, 2), { timeout: 15_000 })
      await view.getByRole('group', { name: 'Loại nội dung' }).getByRole('button', { name: 'Cảnh báo', exact: true }).click()
      if (scenario.alerts) await expect(view.getByText('Đã xác minh').first()).toBeVisible()
      else await expect(view.getByRole('heading', { name: 'Chưa có cảnh báo được công bố' })).toBeVisible()
      if (scenario.personalized) {
        await view.getByRole('button', { name: 'Dành cho bạn', exact: true }).click()
        if (scenario.key === 'personalization-enabled') await expect(view.getByText(/Dựa trên loại Khảo sát vay gần đây/).first()).toBeVisible()
        if (scenario.key === 'guest-no-profile') await expect(view.locator('.radar-personal-feed')).toContainText('Chưa có tín hiệu cá nhân được phép dùng')
      } else await view.getByRole('group', { name: 'Loại nội dung' }).getByRole('button', { name: 'Xu hướng', exact: true }).click()
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

test('Hub dùng trending và rail từ home/market, lưu tin và mở lại lịch sử đọc', async ({ page }) => {
  const main = makeArticle(0)
  await fixturePage(page, 3)
  await page.unroute('**/api/v1/home/market')
  await page.route('**/api/v1/home/market', (route) => route.fulfill({ json: {
    ...emptyMarket,
    trending: [{ rank: 1, id: articleId, title: main.title, summary: null, imageUrl: null, proxyUrl: null, sourceName: 'NHNN', publishedAt: null, readMinutes: 3, categories: ['INTEREST_RATE'], suggestedRateDelta: null, trendReason: 'Đang được quan tâm' }],
    scamFinanceRail: [{ id: articleId, kind: 'FINANCE_NEWS', title: main.title, badge: 'Lãi suất', imageUrl: null, proxyUrl: null, sourceName: 'NHNN', publishedAt: null, handoffHref: '/survey?mode=loan' }],
  } }))
  await page.route(`**/api/v1/radar/articles/${articleId}`, (route) => route.fulfill({ json: { ...main, analysis: null } }))
  await page.goto('/')
  await expect(page.locator('.desk-feature')).toHaveCount(1)
  await expect(page.locator('.desk-pick')).toHaveCount(1)
  await page.getByRole('button', { name: `Lưu ${main.title}` }).click()
  await page.getByRole('group', { name: 'Loại nội dung' }).getByRole('button', { name: 'Đã lưu' }).click()
  await expect(page.getByRole('region', { name: 'Tin đã lưu' }).getByRole('link', { name: main.title })).toBeVisible()
  await page.getByRole('region', { name: 'Tin đã lưu' }).getByRole('link', { name: main.title }).click()
  await expect(page).toHaveURL(new RegExp(`/radar/${articleId}$`))
  await expect(page.getByRole('heading', { name: main.title })).toBeVisible()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fincopilot.radar.history.v1') ?? '[]').length)).toBe(1)
  await page.goto('/?feed=history')
  await expect(page.getByRole('region', { name: 'Lịch sử đọc' }).getByRole('link', { name: main.title })).toBeVisible()
})

test('Ảnh proxy 1×1 bị loại và hiện minh họa đúng chủ đề', async ({ page }) => {
  const tracked = { ...makeArticle(0), image: { url: 'https://example.test/article.png', proxyUrl: '/api/v1/radar/image-proxy?url=https%3A%2F%2Fexample.test%2Farticle.png', alt: 'Ảnh bài báo', credit: 'NHNN', sourceUrl: 'https://example.test/article' } }
  await fixturePage(page, 1)
  await page.route('**/api/v1/radar/articles?**', (route) => route.fulfill({ json: { items: [tracked], page: { hasMore: false, nextCursor: null }, sources: sourceStatus } }))
  await page.route('**/api/v1/radar/image-proxy?**', (route) => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ9sAAAAASUVORK5CYII=', 'base64') }))
  await page.route('https://example.test/article.png', (route) => route.abort())
  await page.goto('/radar')
  await expect(page.locator('.desk-feature').getByRole('img', { name: /Minh họa chủ đề Lãi suất/ })).toBeVisible()
})

test('Radar hiển thị cảnh báo đã công bố và bỏ qua bản nháp', async ({ page }) => {
  await fixturePage(page, 1)
  await page.route('**/api/v1/radar/alerts**', (route) => route.fulfill({ json: { items: [
    { id: '22222222-2222-4222-8222-222222222222', threatCategory: 'PHISHING', tacticSummary: 'Cảnh báo đã xác minh từ nguồn', verificationStatus: 'VERIFIED', publishedAt: '2026-11-20T08:00:00.000Z', evidence: [{ articleId, sourceName: 'NCSC', title: 'Cảnh báo', url: 'https://example.test/ncsc' }] },
    { id: '22222222-2222-4222-8222-222222222223', threatCategory: 'PHISHING', tacticSummary: 'Cảnh báo đang chờ đối chiếu', verificationStatus: 'UNVERIFIED', publishedAt: null, evidence: [] },
  ] } }))
  await page.goto('/radar')
  await page.getByRole('group', { name: 'Loại nội dung' }).getByRole('button', { name: 'Cảnh báo', exact: true }).click()
  await expect(page.getByText('Đã xác minh').first()).toBeVisible()
  await expect(page.getByText('Cảnh báo đang chờ đối chiếu')).toHaveCount(0)
})

test('Khách có thể tắt gợi ý; không cần hồ sơ để đọc tin công khai', async ({ page }) => {
  await fixturePage(page, 1)
  await page.goto('/radar')
  await expect(page.getByRole('heading', { name: 'Kiểm tra trước khi chuyển tiền' })).toBeVisible()
  await page.getByRole('button', { name: 'Dành cho bạn', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Dành cho bạn', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tin thị trường công khai' })).toBeVisible()
  await expect(page.locator('.radar-personal-feed')).toContainText('Gợi ý cá nhân đang tắt')
  await expect(page.locator('.radar-recommendation-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Tùy chỉnh' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bật gợi ý cá nhân' })).toBeVisible()
  await expect(page.getByText(/Chỉ dùng từng tín hiệu khi bạn bật quyền tương ứng/)).toBeVisible()
})

test('Phiên khách chỉ nhận tiêu đề theo chủ đề thực sự đã chọn', async ({ page }) => {
  await fixturePage(page, 2)
  await page.route('**/api/v1/auth/session', (route) => route.fulfill({ json: { kind: 'guest', user: null, oauthProviders: { google: false, github: false } } }))
  await page.addInitScript(() => localStorage.setItem('fincopilot.radar.interests', JSON.stringify({ enabled: true, topics: ['INTEREST_RATE'], includeProfileGoal: false, includeSurveyTopics: false, includeForensicHistory: false })))
  await page.goto('/radar?tab=personal')
  await expect(page.getByRole('heading', { name: 'Tin theo lựa chọn của bạn' })).toBeVisible()
  await expect(page.locator('.radar-recommendation-row').first()).toContainText('Chủ đề bạn đã chọn: lãi suất')
  await expect(page.locator('.radar-personal-feed')).not.toContainText('hồ sơ tài chính')
})

test('Giao diện bỏ qua tín hiệu trả về khi quyền tương ứng chưa bật', async ({ page }) => {
  const rate = { ...makeArticle(0), title: 'Lãi suất cho vay tham khảo', categories: ['INTEREST_RATE'] }
  const fraud = { ...makeArticle(1), title: 'Cảnh báo giả mạo ngân hàng', categories: ['FINANCIAL_FRAUD'] }
  const items = [rate, fraud]
  await page.route('**/api/v1/radar/articles/highlights', (route) => route.fulfill({ json: { items: [], ranking: 'Fixture' } }))
  await page.route('**/api/v1/radar/articles?**', (route) => route.fulfill({ json: { items, page: { hasMore: false, nextCursor: null }, sources: sourceStatus } }))
  await page.route('**/api/v1/radar/articles', (route) => route.fulfill({ json: { items, page: { hasMore: false, nextCursor: null }, sources: sourceStatus } }))
  await page.route('**/api/v1/radar/alerts**', (route) => route.fulfill({ json: { items: [] } }))
  await page.route('**/api/v1/radar/recommendation-signals', (route) => route.fulfill({ json: { signals: [{ categoryCode: 'FINANCIAL_FRAUD', source: 'FORENSIC_HISTORY', reason: 'Từ Giám định gần đây' }] } }))
  await page.addInitScript(() => localStorage.setItem('fincopilot.radar.interests', JSON.stringify({ enabled: true, topics: ['INTEREST_RATE'], includeProfileGoal: false, includeSurveyTopics: true, includeForensicHistory: false })))
  await page.goto('/radar?tab=personal')
  await expect(page.locator('.radar-recommendation-row')).toHaveCount(1)
  await expect(page.locator('.radar-recommendation-row')).not.toContainText('Giám định')
  await page.getByRole('button', { name: 'Tùy chỉnh' }).click()
  await page.getByLabel('Kết quả Giám định rủi ro cao trong 30 ngày').check()
  await page.keyboard.press('Escape')
  await expect(page.locator('.radar-recommendation-row')).toHaveCount(2)
  await expect(page.locator('.radar-recommendation-row').first()).toContainText('Cảnh báo giả mạo ngân hàng')
  await expect(page.locator('.radar-recommendation-row').first()).toContainText('Chưa có trạng thái xác minh cảnh báo')
})

test('Cột Cảnh báo & Tài chính không lặp bài đang đọc và không gán xác minh cho bài viết', async ({ page }) => {
  await fixturePage(page, 2)
  const rail = (id: string, kind: 'SCAM_NEWS' | 'FINANCE_NEWS', title: string) => ({ id, kind, title, badge: 'Nhãn API', imageUrl: null, proxyUrl: null, sourceName: 'NCSC', publishedAt: null, handoffHref: `/radar/${id}` })
  await page.unroute('**/api/v1/home/market')
  await page.route('**/api/v1/home/market', (route) => route.fulfill({ json: { ...emptyMarket, scamFinanceRail: [rail(articleId, 'FINANCE_NEWS', makeArticle(0).title), rail('44444444-4444-4444-8444-444444444444', 'SCAM_NEWS', 'Bài khác về lừa đảo')] } }))
  await page.goto('/radar?tab=personal')
  await expect(page.locator('.radar-recommendation-row')).toHaveCount(2)
  await expect(page.locator('.desk-rail .desk-pick')).toHaveCount(1)
  await expect(page.locator('.desk-rail .desk-pick')).toContainText(/Tin lừa đảo\s*NCSC/)
  await expect(page.locator('.desk-rail .desk-pick')).not.toContainText(makeArticle(0).title)
})

test('Tiêu đề tiếng Việt dài, menu mobile và hộp tùy chỉnh dùng được bằng bàn phím', async ({ page }) => {
  await fixturePage(page, 1)
  const longTitle = 'Thông báo về biến động lãi suất cho vay đối với doanh nghiệp nhỏ và vừa trong bối cảnh thị trường tài chính thay đổi liên tục — Hướng dẫn đọc điều kiện áp dụng và ngày hiệu lực'
  await page.route('**/api/v1/radar/articles/highlights', (route) => route.fulfill({ json: { items: [{ ...makeArticle(0), title: longTitle, editorialPriority: 'STANDARD', priorityReasons: [] }], ranking: 'Fixture' } }))
  await page.route('**/api/v1/radar/articles?**', (route) => route.fulfill({ json: { items: [{ ...makeArticle(0), title: longTitle }], page: { hasMore: false, nextCursor: null }, sources: sourceStatus } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/radar?tab=personal')
  await expect(page.locator('.radar-recommendation-row h3')).toContainText(longTitle)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Menu điều hướng' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Menu điều hướng' })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('link', { name: /Giám định lừa đảo/ })).toBeVisible()
  await page.getByRole('link', { name: /Giám định lừa đảo/ }).focus()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Menu điều hướng' })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('button', { name: 'Menu điều hướng' })).toBeFocused()
  await page.getByRole('button', { name: 'Tùy chỉnh' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('Bản tin cá nhân báo đang tải và rỗng đúng trạng thái', async ({ page }) => {
  await page.route('**/api/v1/radar/articles/highlights', (route) => route.fulfill({ json: { items: [], ranking: 'Fixture' } }))
  await page.route('**/api/v1/radar/articles?**', async (route) => { await new Promise((resolve) => setTimeout(resolve, 900)); await route.fulfill({ json: { items: [], page: { hasMore: false, nextCursor: null }, sources: sourceStatus } }) })
  await page.route('**/api/v1/radar/alerts**', (route) => route.fulfill({ json: { items: [] } }))
  await page.goto('/radar?tab=personal')
  await expect(page.getByRole('status').filter({ hasText: 'Đang tải tin thị trường' })).toBeVisible()
  await expect(page.locator('.radar-personal-feed')).not.toContainText('Chưa có tin công khai')
  await expect(page.getByText('Hiện chưa có tin công khai để hiển thị. Bạn có thể xem lại sau.')).toBeVisible()
  await expect(page.locator('.radar-recommendation-row')).toHaveCount(0)
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
  await page.getByRole('button', { name: 'Dành cho bạn', exact: true }).click()
  await page.getByRole('button', { name: 'Tùy chỉnh' }).click()
  await page.getByLabel('Kết quả Giám định rủi ro cao trong 30 ngày').check()
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng' }).click()
  await expect.poll(() => consentPayload?.includeForensicHistory).toBe(true)
  await expect(page.locator('.radar-recommendation-row').first()).toContainText('Cảnh báo giả mạo ứng dụng ngân hàng')
  await expect(page.locator('.radar-recommendation-row').first()).toContainText('Giám định rủi ro cao gần đây')
})

test('Tin công khai và quyền riêng tư giữ nguyên khi chuyển tùy chỉnh sang hộp thoại', async ({ page }) => {
  await fixturePage(page, 3)
  let signalCalls = 0
  await page.route('**/api/v1/radar/recommendation-signals', (route) => { signalCalls += 1; return route.fulfill({ json: { signals: [] } }) })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/radar?tab=personal')
  await expect(page.locator('.radar-recommendation-row')).toHaveCount(3)
  await expect(page.locator('.radar-recommendation-row').first()).toContainText('NHNN')
  await expect(page.locator('.radar-recommendation-row').first()).toContainText('Chưa rõ thời gian công bố')
  await expect(page.locator('.radar-recommendation-row').nth(1)).toContainText('Công bố')
  await expect(page.locator('.radar-recommendation-row').first()).toContainText('Vì sao hiển thị')
  await expect(page.locator('.radar-recommendation-row').first().locator('.desk-thumb')).toBeVisible()
  for (const utility of await page.locator('.desk-rail .desk-section').all()) await expect(utility).toBeHidden()
  await expect(page.locator('.desk-nav-item')).toHaveCount(8)
  expect(signalCalls).toBe(0)
  await page.getByRole('button', { name: 'Tùy chỉnh' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('group', { name: 'Chọn chủ đề quan tâm' }).getByRole('button', { name: 'Lãi suất' }).click()
  await dialog.getByRole('checkbox', { name: 'Mục tiêu trong hồ sơ tài chính' }).check()
  expect(signalCalls).toBe(0)
  await dialog.getByRole('button', { name: 'Bật gợi ý cá nhân' }).click()
  await expect.poll(() => signalCalls).toBe(1)
  await dialog.getByRole('button', { name: 'Đóng' }).click()
  await page.reload()
  await expect(page.locator('.radar-recommendation-row')).toHaveCount(2)
  await page.getByRole('button', { name: 'Tùy chỉnh' }).click()
  await expect(page.getByRole('dialog').getByRole('checkbox', { name: 'Mục tiêu trong hồ sơ tài chính' })).toBeChecked()
  await expect(page.getByRole('dialog').getByRole('checkbox', { name: 'Loại Khảo sát đã dùng gần đây' })).not.toBeChecked()
  await expect(page.getByRole('dialog').getByRole('group', { name: 'Chọn chủ đề quan tâm' }).getByRole('button', { name: 'Lãi suất' })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('Bộ lọc lưu trữ cung cấp năm 2026 và bộ lọc ngày tự chọn', async ({ page }) => {
  await fixturePage(page, 1)
  let archiveQuery = ''
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('/radar/articles') && url.searchParams.has('year')) archiveQuery = url.search
  })
  await page.goto('/radar')
  await page.getByRole('button', { name: 'Chủ đề & thời gian' }).click()
  await page.getByLabel('Lọc thời gian').selectOption('year')
  await expect(page.getByLabel('Năm công bố').locator(`option[value="${new Date().getFullYear()}"]`)).toHaveCount(1)
  await expect.poll(() => archiveQuery).toContain(`year=${new Date().getFullYear()}`)
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
  await expect(page.locator('.desk-feature .desk-byline').filter({ hasText: 'Lạm phát' }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Chủ đề & thời gian' }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Lạm phát', exact: true })).toBeVisible()
})

test('Ảnh HTTPS qua proxy hiển thị kèm nguồn; ảnh hỏng rơi về minh họa chủ đề', async ({ page }) => {
  const goodId = articleId
  const brokenId = '11111111-1111-4111-8111-111111111112'
  const detail = (id: string, imageUrl: string) => ({ ...makeArticle(0), id, image: { url: imageUrl, proxyUrl: '/api/v1/radar/image-proxy?url=' + encodeURIComponent(imageUrl), alt: 'Biểu đồ được xuất bản', credit: 'Nguồn NHNN', sourceUrl: 'https://publisher.example.test/article' }, sources: [{ ...source, url: 'https://publisher.example.test/article' }], analysis: null })
  await page.route('**/api/v1/radar/articles/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1) ?? goodId
    return route.fulfill({ json: detail(id, id === goodId ? 'https://publisher.example.test/ok.png' : 'https://publisher.example.test/missing.png') })
  })
  await page.route('**/api/v1/radar/image-proxy?url=*', route => {
    const url = new URL(route.request().url()).searchParams.get('url')
    return url?.endsWith('/ok.png') ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="190"><rect width="320" height="190" fill="#d6ded3"/></svg>' })
      : route.fulfill({ status: 404 })
  })
  await page.goto(`/radar/${goodId}`)
  await expect(page.locator('.detail-source-image img')).toBeVisible()
  await expect(page.locator('.detail-source-image .editorial-image-credit')).toContainText('Nguồn NHNN')
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
