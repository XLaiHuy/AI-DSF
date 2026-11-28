import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const screenshotDir = resolve('test-results/copilot-upgrade-verified')
const surveyTitle = 'Mình cùng tìm phương án phù hợp nhé'
const loanPrompt = 'Lương 18 triệu, chi 8 triệu, muốn vay 100 triệu trong 36 tháng có ổn không?'
const radarPrompt = 'Gần đây có thủ đoạn lừa đảo và lãi suất ngân hàng nào đáng chú ý?'

async function checkLayout(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

async function nav(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Menu điều hướng' })
  if (await menu.isVisible() && await menu.getAttribute('aria-expanded') === 'false') await menu.click()
  const link = page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name })
  const href = await link.getAttribute('href')
  if (!href) throw new Error('Missing destination for ' + name)
  const path = new URL(href, page.url()).pathname
  await link.click({ timeout: 12_000 })
  await expect(page).toHaveURL(url => url.pathname === path)
}

async function calculate(page: Page, button = 'Tính và xem phương án') {
  await page.getByRole('button', { name: button, exact: true }).click()
}

async function ask(page: Page, question: string) {
  const input = page.getByRole('textbox', { name: 'Nội dung cần giám định' })
  await expect(input).toBeEnabled()
  await input.fill(question)
  await page.getByRole('button', { name: 'Gửi giám định' }).click({ timeout: 12_000 })
}

test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('The Copilot tests need the Playwright base URL.')
  await page.context().addCookies([{ name: 'fincopilot_e2e_mode', value: 'phase-two', url: baseURL }])
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  const seen: string[] = []
  errors.set(page, seen)
  page.on('pageerror', error => seen.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' || /hydration|did not match server|width.*height.*chart/i.test(message.text())) seen.push(message.text())
  })
})
test.afterEach(async ({ page }) => {
  await checkLayout(page)
  expect(errors.get(page)).toEqual([])
})

test('giữ báo cáo, kết quả bốn tab và bản nháp khi chuyển phân hệ ở 390 px', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/forensic?claimedEntity=' + encodeURIComponent('Công ty Tài chính ABC'))
  const privateNumber = '079123456234'
  await ask(page, 'Bên cho vay báo lỗi 102 và yêu cầu đóng phí giải ngân 2 triệu vào tài khoản cá nhân. CCCD ' + privateNumber + '.')
  const report = page.getByRole('link', { name: 'Xuất báo cáo JSON' })
  await expect(report).toBeVisible({ timeout: 30_000 })
  const reportHref = await report.getAttribute('href')
  const followUp = page.getByRole('textbox', { name: 'Câu hỏi tiếp theo' })
  const question = 'Vì sao rủi ro cao?'
  await followUp.fill(question)
  await page.getByRole('button', { name: 'Gửi câu hỏi', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Câu trả lời của FinCopilot' }).last()).toContainText(/rủi ro|nguy hiểm/i)
  await expect(followUp).toBeEnabled()
  await page.reload()
  await expect(report).toHaveAttribute('href', reportHref ?? '')
  await expect(page.getByText(question, { exact: true })).toBeVisible()
  await followUp.fill('Bản nháp hỏi về khoản phí')

  await nav(page, 'Khảo sát & Tính toán')
  await expect(page.getByRole('heading', { name: surveyTitle })).toBeVisible()
  await page.getByLabel('Số tiền cần vay (VNĐ)').fill('60000000')
  const loanRequest = page.waitForResponse(response => response.url().endsWith('/survey/loan') && response.request().method() === 'POST')
  await calculate(page)
  const loanResponse = await loanRequest
  expect(loanResponse.ok()).toBe(true)
  const loanBody = await loanResponse.json()
  const loanResult = loanBody.offers.length ? page.getByRole('heading', { name: 'Phương án từ danh mục' })
    : page.getByText(/Danh mục hiện chưa có sản phẩm|Chưa có gói phù hợp/)
  await expect(loanResult).toBeVisible()

  await page.getByRole('button', { name: 'Đầu tư / tích lũy' }).click()
  await page.getByLabel('Vốn ban đầu (VNĐ)').fill('25000000')
  await calculate(page)
  await expect(page.getByRole('table', { name: 'So sánh nhanh các kênh' })).toBeVisible()

  await page.getByRole('button', { name: 'Tự nhập so sánh' }).click()
  await calculate(page)
  await expect(page.getByRole('heading', { name: 'So sánh số liệu bạn nhập' })).toBeVisible()

  const refinanceTab = page.getByRole('button', { name: 'Đổi khoản vay / Đảo nợ' })
  await refinanceTab.click()
  await page.getByLabel('Số tiền gốc còn nợ (VNĐ)').fill('60000000')
  await page.getByLabel('Kỳ hạn còn lại (tháng)').fill('24')
  await page.getByLabel('Lãi suất hiện tại (%/năm)').fill('19')
  await calculate(page, 'So sánh khoản vay')
  await expect(page.getByRole('heading', { name: 'Đối chiếu với ngân hàng có giấy phép' })).toBeVisible()
  await page.getByLabel('Lãi suất hiện tại (%/năm)').fill('20')

  await nav(page, 'Bảng tin & Thị trường')
  const search = page.getByRole('searchbox', { name: 'Tìm tin theo tiêu đề' })
  await search.fill('lãi suất')
  await nav(page, 'Giám định lừa đảo & QR')
  await expect(report).toHaveAttribute('href', reportHref ?? '')
  await expect(page.getByText(question, { exact: true })).toBeVisible()
  await expect(followUp).toHaveValue('Bản nháp hỏi về khoản phí')
  const cache = await page.evaluate(() => sessionStorage.getItem('fincopilot:conversation'))
  expect(cache).toContain('activeAuditId')
  expect(cache).toContain('followUpTurns')
  expect(cache).not.toContain(privateNumber)

  await nav(page, 'Bảng tin & Thị trường')
  await expect(search).toHaveValue('lãi suất')
  await nav(page, 'Khảo sát & Tính toán')
  await expect(refinanceTab).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Lãi suất hiện tại (%/năm)')).toHaveValue('20')
  await expect(page.getByRole('heading', { name: 'Đối chiếu với ngân hàng có giấy phép' })).toBeVisible()
  await page.getByRole('button', { name: 'Tự nhập so sánh' }).click()
  await expect(page.getByRole('heading', { name: 'So sánh số liệu bạn nhập' })).toBeVisible()
  await page.getByRole('button', { name: 'Đầu tư / tích lũy' }).click()
  await expect(page.getByLabel('Vốn ban đầu (VNĐ)')).toHaveValue('25 000 000')
  await expect(page.getByRole('table', { name: 'So sánh nhanh các kênh' })).toBeVisible()
  await page.getByRole('button', { name: 'Khảo sát vay' }).click()
  await expect(page.getByLabel('Số tiền cần vay (VNĐ)')).toHaveValue('60 000 000')
  await expect(loanResult).toBeVisible()

  await nav(page, 'Giám định lừa đảo & QR')
  await page.reload()
  await expect(report).toHaveAttribute('href', reportHref ?? '')
  await expect(page.getByText(question, { exact: true })).toBeVisible()
  const removed = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().includes('/forensic/conversations/'))
  await page.getByRole('button', { name: 'Phiên mới' }).click()
  expect((await removed).ok()).toBe(true)
  await expect(report).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Nội dung cần giám định' })).toHaveValue('')
  expect(await page.evaluate(() => sessionStorage.getItem('fincopilot:conversation'))).toBeNull()
})

for (const viewport of [{ width: 1280, height: 800 }, { width: 320, height: 844 }]) {
  test.describe(viewport.width + ' px', () => {
    test.use({ viewport })

    test('vùng quỹ mở, bộ lọc biểu đồ và bảng đầu tư', async ({ page }) => {
      await page.goto('/survey?mode=invest')
      await expect(page.getByLabel('Vốn ban đầu (VNĐ)')).toBeVisible()
      const calculation = page.waitForResponse(response => response.url().endsWith('/survey/investment') && response.request().method() === 'POST')
      await calculate(page)
      expect((await calculation).ok()).toBe(true)
      const plot = page.getByRole('heading', { name: 'Dự phóng tăng trưởng tài sản' }).locator('xpath=ancestor::section')
      await expect(plot.locator('.recharts-area-area')).toBeVisible()
      const fund = plot.getByRole('button', { name: 'Quỹ mở', exact: true })
      await fund.click()
      await expect(fund).toHaveAttribute('aria-pressed', 'false')
      await expect(plot.locator('.recharts-area-area')).toHaveCount(0)
      await fund.click()
      const table = page.getByRole('table', { name: 'So sánh nhanh các kênh' })
      await expect(table.getByRole('columnheader', { name: 'Phí & Thuế' })).toBeVisible()
      await expect(page.getByText(/Phí bán|Phí & thuế: 0 đ/i).first()).toBeVisible()
      await checkLayout(page)
      await plot.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
      await page.screenshot({ path: resolve(screenshotDir, 'survey-invest-' + viewport.width + '.png') })
    })

    test('EAR và preset lãi phẳng thể hiện chênh lệch APR', async ({ page }) => {
      await page.goto('/survey?mode=manual')
      await expect(page.getByLabel('Gói A · Lãi suất năm (%)')).toHaveValue('14.5')
      await calculate(page)
      const plot = page.getByRole('heading', { name: 'Lãi suất nhập và APR thực tế' }).locator('xpath=ancestor::section')
      await expect(plot.getByText(/Các gói này tính theo dư nợ giảm dần/)).toBeVisible()
      await expect(plot.getByText(/EAR hiệu dụng/).first()).toBeVisible()
      await expect(plot).not.toContainText('Gói A · Gói A')
      await expect(plot).not.toContainText(/\.5000%/)
      await expect(plot).toContainText(/APR 14,5%/)
      await page.getByRole('button', { name: /Lãi phẳng 12% \+ phí 1 tr/ }).click()
      await expect(page.getByLabel('Gói B · Lãi suất năm (%)')).toHaveValue('12')
      await calculate(page)
      await expect(plot.getByText(/\+\d+,\d% do phí\/cách tính lãi/)).toBeVisible()
      await expect(plot).not.toContainText('Các gói này tính theo dư nợ giảm dần')
      await checkLayout(page)
      await page.mouse.move(0, 0)
      await plot.screenshot({ path: resolve(screenshotDir, 'survey-apr-ear-preset-' + viewport.width + '.png') })
    })

    test('Copilot đối chiếu hồ sơ, khoản vay và tin Radar', async ({ page }) => {
      await page.goto('/forensic')
      await page.getByRole('button', { name: loanPrompt, exact: true }).click()
      const loan = page.getByRole('article', { name: 'Câu trả lời của FinCopilot' })
      const trace = loan.locator('summary', { hasText: /Đã đối chiếu 2 công cụ xác thực/ })
      await expect(trace).toContainText('Hồ sơ DTI · Kho ngân hàng NHNN', { timeout: 25_000 })
      await trace.click()
      await expect(loan.getByText(/\d+ ms/)).toHaveCount(2)
      await expect(loan.getByRole('heading', { name: /Kế hoạch vay/ })).toBeVisible()
      await expect(loan.getByRole('link', { name: /Mở (bảng trả nợ trong Khảo sát|Khảo sát khoản vay)/ })).toHaveAttribute('href', /^\/survey\?mode=loan&sessionId=/)
      await checkLayout(page)
      if (viewport.width === 320) {
        await trace.click()
        await loan.scrollIntoViewIfNeeded()
        await page.screenshot({ path: resolve(screenshotDir, 'copilot-loan-dti-320.png') })
      } else await loan.screenshot({ path: resolve(screenshotDir, 'copilot-loan-dti-1280.png') })
      await expect(loan.getByText(/Tỷ lệ trả nợ.*DTI/)).toBeVisible()
      await loan.getByRole('link', { name: /Mở (bảng trả nợ trong Khảo sát|Khảo sát khoản vay)/ }).click()
      await expect(page.getByLabel('Số tiền cần vay (VNĐ)')).toHaveValue('100 000 000')
      await expect(page.getByLabel('Kỳ hạn (tháng)')).toHaveValue('36')
      await expect(page.getByRole('heading', { name: 'Phương án từ danh mục' })
        .or(page.getByText(/Danh mục hiện chưa có sản phẩm|Chưa có gói phù hợp/))).toBeVisible()
      await nav(page, 'Giám định lừa đảo & QR')
      await expect(loan.getByRole('heading', { name: /Kế hoạch vay/ })).toBeVisible()
      await ask(page, radarPrompt)
      const radar = page.getByRole('article', { name: 'Câu trả lời của FinCopilot' }).last()
      await expect(radar.getByRole('heading', { name: 'Bản tin Radar' })).toBeVisible({ timeout: 25_000 })
      await radar.locator('summary').click()
      await expect(radar.getByText('Radar cảnh báo đã xác minh', { exact: true })).toBeVisible()
      await expect(radar.getByRole('link', { name: 'Mở Radar cảnh báo' })).toHaveAttribute('href', '/radar?tab=alerts')
      if (viewport.width === 1280) await radar.screenshot({ path: resolve(screenshotDir, 'copilot-radar-brief-1280.png') })
      await radar.getByRole('link', { name: 'Mở Radar cảnh báo' }).click()
      await expect(page.getByRole('heading', { name: 'Cảnh báo lừa đảo', exact: true })).toBeVisible()
    })
  })
}
