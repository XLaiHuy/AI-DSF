const { chromium } = require('@playwright/test')
const { mkdir } = require('node:fs/promises')
const path = require('node:path')

const stage = process.argv[2] || 'before'
const root = path.join(__dirname, stage)
const first = '22222222-2222-4222-8222-222222222222'
const second = '22222222-2222-4222-8222-222222222223'
const evidence = [
  { articleId: '11111111-1111-4111-8111-111111111111', sourceName: 'Nguồn thử nghiệm A', title: 'Mẫu bài cảnh báo giả danh tổ chức tài chính', url: 'https://example.test/source-a', publishedAt: '2026-11-20T08:00:00.000Z' },
  { articleId: '11111111-1111-4111-8111-111111111112', sourceName: 'Nguồn thử nghiệm B', title: 'Mẫu thông báo đối chiếu thủ đoạn chuyển phí', url: 'https://example.test/source-b', publishedAt: null },
]
const alerts = [
  { id: first, threatCategory: 'PHISHING', tacticSummary: 'Cảnh báo minh họa: giả danh ngân hàng yêu cầu phí mở khóa tài khoản', preventionGuidance: 'Không chia sẻ mã xác thực hoặc chuyển phí theo lời nhắn. Liên hệ tổ chức qua kênh do bạn tự tìm.', verificationStatus: 'VERIFIED', issuedAt: null, publishedAt: '2026-11-20T08:00:00.000Z', verifiedAt: '2026-11-20T09:00:00.000Z', indicators: [{ indicatorType: 'KEYWORD', indicatorText: 'phí mở khóa' }], evidence },
  { id: second, threatCategory: 'IMPERSONATION', tacticSummary: 'Cảnh báo minh họa: lời mời đầu tư tự nhận là nhân viên hỗ trợ với tiêu đề tiếng Việt dài để kiểm tra khả năng xuống dòng trên màn hình hẹp', preventionGuidance: '', verificationStatus: 'VERIFIED', issuedAt: null, publishedAt: '2026-11-19T08:00:00.000Z', verifiedAt: null, indicators: [], evidence: [{ articleId: '11111111-1111-4111-8111-111111111113', sourceName: 'Nguồn thử nghiệm C', title: 'Mẫu bài thiếu URL', url: '', publishedAt: null }] },
]

;(async () => {
  await mkdir(root, { recursive: true })
  const browser = await chromium.launch()
  for (const [size, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844], ['narrow', 320, 844]]) {
    const context = await browser.newContext({ viewport: { width, height } })
    for (const [name, url] of [['feed', '/?tab=alerts'], ['detail', `/radar/${first}?kind=alert`]]) {
      const page = await context.newPage()
      await page.route('**/api/v1/radar/alerts', (route) => route.fulfill({ json: { items: alerts } }))
      await page.route(`**/api/v1/radar/alerts/${first}`, (route) => route.fulfill({ json: alerts[0] }))
      await page.route('**/api/v1/home/market', (route) => route.fulfill({ json: { alert: null, articles: [], trending: [], scamFinanceRail: [], marketRates: [] } }))
      await page.goto((process.env.RADAR_CAPTURE_BASE_URL || 'http://127.0.0.1:3001') + url, { waitUntil: 'domcontentloaded' })
      await page.getByText(alerts[0].tacticSummary, { exact: true }).first().waitFor({ timeout: 10000 })
      if (name === 'feed') await page.locator('.radar-alert-row.is-lead img').evaluate(async (img) => { if (!img.complete) await img.decode() })
      await page.screenshot({ path: path.join(root, `${name}-${size}.png`), fullPage: name === 'detail' })
      console.log(`${stage} ${name} ${size} overflow=${await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)}`)
      await page.close()
    }
    await context.close()
  }
  await browser.close()
})().catch((error) => { console.error(error); process.exitCode = 1 })
