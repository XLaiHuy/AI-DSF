import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const publishedAt = '2026-11-24T09:00:00.000Z'
const source = { sourceId: '33333333-3333-4333-8333-333333333333', sourceKey: 'nhnn', sourceName: 'NHNN', url: 'https://example.test/brief-source', firstSeenAt: publishedAt, lastSeenAt: publishedAt }

function makeBrief(count: number) {
  return {
    date: '2026-11-24', dateLabel: '24/11/2026', status: count === 0 ? 'EMPTY' : 'AI_SUMMARY', updatedAt: publishedAt, isStale: false,
    personalization: { enabled: false, usedSignals: [] },
    items: Array.from({ length: Math.min(count, 12) }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      kind: index === 0 ? 'ALERT' : 'ARTICLE', summary: `Nội dung minh họa kiểm thử số ${index + 1}.`,
      interpretation: index === 1 ? 'Góc nhìn chung được đánh dấu là nội dung AI.' : null, generatedByAi: true,
      category: index === 0 ? 'FINANCIAL_FRAUD' : 'INTEREST_RATE', publishedAt, verificationStatus: index === 0 ? 'VERIFIED' : null,
      inclusionReason: index === 0 ? 'Cảnh báo đã xác minh, được ưu tiên theo ngày công bố.' : 'Tin tài chính minh họa.', relevance: null,
      citations: [{ sourceName: 'NHNN', sourceTitle: `Tiêu đề nguồn ${index + 1}`, url: `https://example.test/brief-source/${index + 1}`, publishedAt }],
    })),
  }
}

async function installStubs(page: import('@playwright/test').Page, count: number) {
  const article = {
    id: '11111111-1111-4111-8111-111111111111', title: 'Tin minh họa kiểm thử giao diện · lãi suất',
    canonicalUrl: 'https://example.test/article', publishedAt, image: null, categories: ['INTEREST_RATE'], sources: [source],
  }
  await page.route('**/api/v1/radar/daily-brief', (route) => route.fulfill({ json: makeBrief(count) }))
  await page.route('**/api/v1/radar/articles/highlights', (route) => route.fulfill({ json: { items: [], ranking: 'Fixture' } }))
  await page.route('**/api/v1/radar/articles?**', (route) => {
    const fraud = new URL(route.request().url()).searchParams.get('category') === 'FINANCIAL_FRAUD'
    return route.fulfill({ json: { items: fraud ? [] : [article], page: { limit: 20, hasMore: false, nextCursor: null }, sources: [] } })
  })
  await page.route('**/api/v1/radar/articles', (route) => route.fulfill({ json: { items: [article], page: { limit: 20, hasMore: false, nextCursor: null }, sources: [] } }))
  await page.route('**/api/v1/radar/alerts**', (route) => route.fulfill({ json: { items: [] } }))
  await page.route('**/api/v1/radar/recommendation-signals', (route) => route.fulfill({ json: { signals: [] } }))
}

test('Bản tin ngày hiển thị 0, 1, 3, 5, 10 và hơn 10 mục đúng trạng thái', async ({ page }) => {
  for (const count of [0, 1, 3, 5, 10, 12]) {
    await page.unrouteAll()
    await installStubs(page, count)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/radar')
    const brief = page.locator('.radar-daily-brief')
    await expect(brief).toBeVisible()
    if (count === 0) {
      await expect(brief).toContainText('Chưa có nội dung đủ nguồn')
      await expect(brief.locator('.radar-daily-brief-toggle')).toHaveCount(0)
    } else {
      await expect(brief.locator('.radar-daily-brief-item')).toHaveCount(Math.min(count, 3))
      if (count > 3) {
        await brief.getByRole('button', { name: 'Xem đầy đủ' }).click()
        await expect(brief.locator('.radar-daily-brief-item')).toHaveCount(Math.min(count, 10))
        await expect(brief.getByRole('button', { name: 'Thu gọn' })).toHaveAttribute('aria-expanded', 'true')
      }
    }
    await page.goto('about:blank')
  }
})

test('Daily brief chụp ảnh desktop/mobile và mở rộng không che điều hướng', async ({ browser }) => {
  const path = 'docs/design/screenshots'
  await mkdir(path, { recursive: true })
  for (const viewport of [
    { width: 1440, height: 900, key: 'desktop' },
    { width: 390, height: 844, key: 'mobile' },
  ]) {
    const page = await browser.newPage({ viewport })
    await installStubs(page, 8)
    await page.goto('/radar')
    await expect(page.locator('.radar-daily-brief')).toContainText('24/11/2026')
    await expect(page.locator('.radar-daily-brief-item')).toHaveCount(3)
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${path}/radar-daily-brief-collapsed-${viewport.key}.png` })
    await page.locator('.radar-daily-brief').getByRole('button', { name: 'Xem đầy đủ' }).click()
    await expect(page.locator('.radar-daily-brief-item')).toHaveCount(8)
    await page.waitForTimeout(1_000)
    await page.screenshot({ path: `${path}/radar-daily-brief-expanded-${viewport.key}.png` })
    if (viewport.key === 'mobile') {
      const nav = page.getByRole('navigation', { name: 'Điều hướng chính' })
      await expect(nav).toBeVisible()
      await nav.getByRole('link', { name: 'Radar' }).click()
      await expect(page).toHaveURL(/\/radar$/)
      await page.setViewportSize({ width: 320, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `${path}/radar-daily-brief-mobile-320.png` })
    }
    await page.close()
  }
})

test('Daily brief giữ citation gốc, hiển thị fallback và tôn trọng reduced motion', async ({ page }) => {
  await installStubs(page, 2)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/radar')
  const brief = page.locator('.radar-daily-brief')
  await expect(brief.getByRole('link', { name: /NHNN/ }).first()).toHaveAttribute('href', 'https://example.test/brief-source/1')
  await expect(brief).toContainText('chưa phải xác minh độc lập')
  await expect(page.locator('.radar-daily-brief-item').first()).not.toHaveCSS('animation-name', 'radar-brief-arrive')
})

test('Daily brief tự làm mới khi qua nửa đêm tại Việt Nam', async ({ page }) => {
  await installStubs(page, 1)
  let requests = 0
  await page.unroute('**/api/v1/radar/daily-brief')
  await page.route('**/api/v1/radar/daily-brief', (route) => {
    requests += 1
    const body = makeBrief(1)
    body.date = requests === 1 ? '2026-11-24' : '2026-11-25'
    body.dateLabel = requests === 1 ? '24/11/2026' : '25/11/2026'
    return route.fulfill({ json: body })
  })
  await page.clock.install({ time: new Date('2026-11-24T16:59:50.000Z') })
  await page.goto('/radar')
  const brief = page.locator('.radar-daily-brief')
  await expect(brief).toContainText('24/11/2026')
  await page.clock.fastForward(15_000)
  await expect(brief).toContainText('25/11/2026')
  expect(requests).toBeGreaterThanOrEqual(2)
})

test('Tin thứ cấp hiện ảnh có nguồn và dùng minh họa chủ đề nếu thiếu ảnh', async ({ page }) => {
  const articles = Array.from({ length: 4 }, (_, index) => ({
    id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    title: `Tin thứ cấp minh họa ${index + 1}`, canonicalUrl: `https://example.test/article-${index + 1}`,
    publishedAt, categories: ['INTEREST_RATE'], sources: [{ ...source, url: `https://example.test/article-${index + 1}` }],
    image: index === 2 ? { url: 'https://example.test/cleared.jpg', alt: 'Biểu đồ lãi suất được cấp quyền', credit: 'NHNN', sourceUrl: `https://example.test/article-${index + 1}` } : null,
  }))
  await page.route('**/api/v1/radar/daily-brief', (route) => route.fulfill({ json: makeBrief(0) }))
  await page.route('**/api/v1/radar/articles/highlights', (route) => route.fulfill({ json: { items: [], ranking: 'Fixture' } }))
  await page.route('**/api/v1/radar/articles?**', (route) => route.fulfill({ json: { items: articles, page: { limit: 20, hasMore: false, nextCursor: null }, sources: [] } }))
  await page.route('**/api/v1/radar/articles', (route) => route.fulfill({ json: { items: articles, page: { limit: 20, hasMore: false, nextCursor: null }, sources: [] } }))
  await page.route('**/api/v1/radar/alerts**', (route) => route.fulfill({ json: { items: [] } }))
  await page.route('**/api/v1/radar/recommendation-signals', (route) => route.fulfill({ json: { signals: [] } }))
  await page.route('https://example.test/cleared.jpg', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ9sAAAAASUVORK5CYII=', 'base64') }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/radar')
  await expect(page.locator('.radar-story-thumb-image')).toHaveCount(1)
  await expect(page.locator('.radar-story-thumb').filter({ hasText: 'Minh họa theo chủ đề' })).toHaveCount(1)
  await expect(page.locator('.radar-story-thumb figcaption').filter({ hasText: 'NHNN' })).toBeVisible()
})
