import { expect, test } from '@playwright/test'

const id = '22222222-2222-4222-8222-222222222222'
const sample = {
  id,
  threatCategory: 'PHISHING',
  tacticSummary: 'Cảnh báo minh họa: giả danh ngân hàng yêu cầu chuyển phí mở tài khoản',
  preventionGuidance: 'Không chuyển phí theo lời nhắn; tự kiểm tra kênh liên hệ chính thức.',
  verificationStatus: 'VERIFIED',
  issuedAt: null,
  publishedAt: '2026-11-20T08:00:00.000Z',
  verifiedAt: '2026-11-20T09:00:00.000Z',
  indicators: [{ indicatorType: 'KEYWORD', indicatorText: 'phí mở khóa' }],
  evidence: [{ articleId: '11111111-1111-4111-8111-111111111111', sourceName: 'Nguồn thử nghiệm A', title: 'Thông báo minh họa', url: 'https://example.test/evidence-a', publishedAt: null }],
}

test('Danh sách rỗng, tải chậm và lỗi API đều có trạng thái rõ', async ({ page }) => {
  await page.route('**/api/v1/radar/alerts', (route) => route.fulfill({ json: { items: [] } }))
  await page.goto('/?tab=alerts')
  await expect(page.getByRole('heading', { name: 'Cảnh báo lừa đảo' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Chưa có cảnh báo được công bố' })).toBeVisible()
  await page.unroute('**/api/v1/radar/alerts')
  await page.route('**/api/v1/radar/alerts', async (route) => { await new Promise((resolve) => setTimeout(resolve, 700)); await route.fulfill({ status: 503, json: { message: 'Lỗi fixture' } }) })
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: 'Đang tải cảnh báo' })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'Không tải được cảnh báo' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Thử lại' }).first()).toBeVisible()
})

test('Bài cảnh báo công bố tách trạng thái, nguồn và lối xem chi tiết; không công khai bản nháp', async ({ page }) => {
  await page.route('**/api/v1/radar/alerts', (route) => route.fulfill({ json: { items: [sample, { ...sample, id: '22222222-2222-4222-8222-222222222223', tacticSummary: 'Bản nháp thử nghiệm', verificationStatus: 'UNVERIFIED' }] } }))
  await page.goto('/?tab=alerts')
  const card = page.locator('.radar-alert-row')
  await expect(card).toHaveCount(1)
  await expect(card.first()).toContainText('Đã xác minh')
  await expect(card.first().locator('.radar-alert-status')).toContainText('Đã xác minh cảnh báo')
  await expect(page.getByText('“Đã xác minh” là trạng thái cảnh báo; mở nguồn để tự đối chiếu trường hợp của bạn.')).toBeVisible()
  await expect(card.first().locator('.radar-alert-published time')).toHaveText('20/11/2026 · 15:00')
  await expect(card.first()).toContainText('Nguồn thử nghiệm A')
  await expect(card.first().locator('.radar-alert-evidence a')).toHaveAttribute('href', 'https://example.test/evidence-a')
  await expect(card.first().getByText('Minh họa gốc · không phải ảnh sự việc')).toBeVisible()
  await expect(card.first().locator('img')).toHaveJSProperty('complete', true)
  await expect(card.first().locator('img')).toHaveAttribute('src', /fraud-transfer\.svg/)
  await expect(card.first().getByRole('link', { name: /Xem dấu hiệu & bằng chứng/ })).toBeVisible()
  await expect(page.getByText('Bản nháp thử nghiệm')).toHaveCount(0)
  await expect(page.getByText('PROVENANCE')).toHaveCount(0)
})

test('Nhiều cảnh báo, tiêu đề dài và nguồn thiếu URL không tạo liên kết giả', async ({ page }) => {
  const second = { ...sample, id: '22222222-2222-4222-8222-222222222223', threatCategory: 'IMPERSONATION', tacticSummary: 'Cảnh báo minh họa về lời mời tự nhận là nhân viên tư vấn với tiêu đề tiếng Việt rất dài để thử xuống dòng trên màn hình điện thoại nhỏ', evidence: [{ ...sample.evidence[0], sourceName: 'Nguồn thử nghiệm B', url: '' }] }
  await page.route('**/api/v1/radar/alerts', (route) => route.fulfill({ json: { items: [sample, second, { ...sample, id: '22222222-2222-4222-8222-222222222224', tacticSummary: 'Cảnh báo chưa công bố', publishedAt: null }] } }))
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/?tab=alerts')
  await expect(page.locator('.radar-alert-row')).toHaveCount(2)
  await expect(page.getByText('Cảnh báo chưa công bố')).toHaveCount(0)
  await expect(page.locator('.radar-alert-row').nth(1)).toContainText('Chưa có liên kết')
  await expect(page.locator('.radar-alert-row').nth(1).locator('.radar-alert-evidence a')).toHaveCount(0)
  const leadTitle = await page.locator('.radar-alert-row.is-lead h2').boundingBox()
  const leadImage = await page.locator('.radar-alert-row.is-lead img').boundingBox()
  expect(leadTitle && leadImage && leadTitle.y < leadImage.y).toBeTruthy()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
})

test('Minh họa theo thủ đoạn: đường dẫn, mạo danh và phí trước', async ({ page }) => {
  await page.route('**/api/v1/radar/alerts', (route) => route.fulfill({ json: { items: [{ ...sample, tacticSummary: 'Cảnh báo minh họa: đường dẫn đăng nhập không rõ nguồn' }] } }))
  await page.goto('/?tab=alerts')
  const artwork = page.locator('.radar-alert-row.is-lead img')
  await expect(artwork).toHaveAttribute('src', /fraud-phishing\.svg/)
  await expect(artwork).toHaveAttribute('alt', /tin nhắn chứa đường dẫn/)
  await page.unroute('**/api/v1/radar/alerts')
  await page.route('**/api/v1/radar/alerts', (route) => route.fulfill({ json: { items: [{ ...sample, threatCategory: 'IMPERSONATION', tacticSummary: 'Cảnh báo minh họa: tự nhận là nhân viên tư vấn' }] } }))
  await page.reload()
  await expect(artwork).toHaveAttribute('src', /fraud-identity\.svg/)
  await page.unroute('**/api/v1/radar/alerts')
  await page.route('**/api/v1/radar/alerts', (route) => route.fulfill({ json: { items: [{ ...sample, threatCategory: 'FAKE_LOAN', tacticSummary: 'Cảnh báo minh họa: yêu cầu nộp phí trước khi giải ngân' }] } }))
  await page.reload()
  await expect(artwork).toHaveAttribute('src', /fraud-advance-fee\.svg/)
})

test('Chi tiết phân biệt ngày, dẫn chứng và che chỉ dấu nhạy cảm', async ({ page }) => {
  await page.route(`**/api/v1/radar/alerts/${id}`, (route) => route.fulfill({ json: { ...sample, indicators: [{ indicatorType: 'BANK_ACCOUNT', indicatorText: '123456789012' }, { indicatorType: 'KEYWORD', indicatorText: 'phí mở khóa' }], evidence: [sample.evidence[0], { ...sample.evidence[0], articleId: '11111111-1111-4111-8111-111111111112', sourceName: 'Nguồn thử nghiệm B', url: '' }] } }))
  await page.goto(`/radar/${id}?kind=alert`)
  await expect(page.getByRole('heading', { name: sample.tacticSummary })).toBeVisible()
  await expect(page.getByText('Dẫn chứng: Nguồn thử nghiệm A, Nguồn thử nghiệm B')).toBeVisible()
  await expect(page.locator('.threat-detail-dates')).toContainText('Công bố')
  await expect(page.locator('.threat-detail-dates')).toContainText('Xác minh')
  await expect(page.getByText('123456789012')).toHaveCount(0)
  await expect(page.getByText('Chỉ dấu được che; đối chiếu trong Giám định')).toBeVisible()
  await expect(page.getByText('Chưa có liên kết nguồn')).toBeVisible()
  await expect(page.locator('.evidence-list a')).toHaveCount(1)
  const forensic = page.getByRole('link', { name: /Đối chiếu trong Giám định/ })
  await expect(forensic).not.toHaveAttribute('href', /123456789012/)
})

test('Chi tiết thiếu dấu hiệu, hướng dẫn, nguồn và ngày nói rõ giới hạn', async ({ page }) => {
  await page.route(`**/api/v1/radar/alerts/${id}`, (route) => route.fulfill({ json: { ...sample, publishedAt: null, verifiedAt: null, indicators: [], preventionGuidance: '', evidence: [] } }))
  await page.goto(`/radar/${id}?kind=alert`)
  await expect(page.getByText('Chưa rõ ngày công bố')).toBeVisible()
  await expect(page.getByText('Chưa có dấu hiệu cụ thể được cung cấp.')).toBeVisible()
  await expect(page.getByText('Nguồn hiện chưa cung cấp hướng dẫn phòng tránh cụ thể.')).toBeVisible()
  await expect(page.getByText('Chưa có nguồn dẫn chứng được cung cấp.').first()).toBeVisible()
})

for (const width of [1440, 390, 320]) {
  test(`Cảnh báo và chi tiết không tràn ngang ở ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 })
    await page.route('**/api/v1/radar/alerts', (route) => route.fulfill({ json: { items: [sample] } }))
    await page.route(`**/api/v1/radar/alerts/${id}`, (route) => route.fulfill({ json: sample }))
    await page.goto('/?tab=alerts')
    await expect(page.locator('.radar-alert-row')).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
    await page.locator('.radar-alert-detail').click()
    await expect(page.locator('.radar-threat-detail')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('A')
  })
}

for (const width of [390, 320]) {
  test(`Nội dung chính và lối Giám định nằm trong màn đầu ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.route('**/api/v1/radar/alerts', (route) => route.fulfill({ json: { items: [sample] } }))
    await page.goto('/?tab=alerts')
    const headline = await page.locator('.radar-alert-row.is-lead h2').boundingBox()
    const guidance = await page.locator('.radar-alert-row.is-lead .radar-alert-guidance').boundingBox()
    expect(headline?.y).toBeLessThan(460)
    expect(guidance && guidance.y + guidance.height).toBeLessThan(650)
    await expect(page.locator('.desk-quick-check input[aria-label="Nội dung cần giám định"]')).toBeVisible()
    await expect(page.locator('.desk-quick-check button[type="submit"]')).toBeVisible()
    await expect(page.locator('.desk-chips')).toBeHidden()
  })
}
