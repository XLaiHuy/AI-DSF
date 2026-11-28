import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { qrFile } from './test-qr'

const screenshotDir = resolve('test-results/copilot-upgrade-verified')
const masterScreenshots = resolve('test-results/master-plan-verified')
const hybridScreenshots = resolve('test-results/hybrid-copilot-verified')
const surveyTitle = 'Mình cùng tìm phương án phù hợp nhé'
const loanPrompt = 'Lương 18 triệu, chi 8 triệu, muốn vay 100 triệu trong 36 tháng có ổn không?'
const safeLoanPrompt = 'Lương 18 triệu, chi 8 triệu, tôi được vay tối đa bao nhiêu trong 36 tháng để an toàn?'
const goalPrompt = 'Muốn có 300 triệu sau 3 năm, đang có 50 triệu, mỗi tháng cần góp bao nhiêu?'
const transferQr = '00020101021238540010A00000072701240006970422011009876543210208QRIBFTTA5303704540725000005802VN62250821PHI GIAI NGAN LOI 1026304CA92'
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
  // Establish a signed guest per test before audits share the proxy IP.
  expect((await page.request.post('/api/v1/auth/session/guest')).ok()).toBe(true)
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

    test('Copilot tính ngược khoản vay và số tiền cần góp', async ({ page }) => {
      await page.goto('/forensic')
      await ask(page, safeLoanPrompt)
      const loan = page.getByRole('article', { name: 'Câu trả lời của FinCopilot' }).last()
      const loanTitle = loan.getByRole('heading', { name: 'Số tiền vay tối đa theo ngân sách' })
      await expect(loanTitle).toBeVisible({ timeout: 25_000 })
      await expect(loan.locator('summary')).toContainText('Tính số tiền vay tối đa')
      const loanLink = loan.getByRole('link', { name: 'Mở Khảo sát khoản vay' })
      await expect(loanLink).toHaveAttribute('href', /^\/survey\?mode=loan&amount=\d+&term=36$/)
      const principal = new URL((await loanLink.getAttribute('href'))!, page.url()).searchParams.get('amount')!
      await loan.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
      await checkLayout(page)
      await page.screenshot({ path: resolve(masterScreenshots, 'safe-loan-' + viewport.width + '.png') })
      await loanLink.click()
      await expect(page.getByLabel('Số tiền cần vay (VNĐ)')).toHaveValue(principal.replace(/\B(?=(\d{3})+(?!\d))/g, ' '))
      await expect(page.getByLabel('Kỳ hạn (tháng)')).toHaveValue('36')
      await nav(page, 'Giám định lừa đảo & QR')

      await ask(page, goalPrompt)
      const goal = page.getByRole('article', { name: 'Câu trả lời của FinCopilot' }).last()
      await expect(goal.getByRole('heading', { name: 'Khoản góp để đạt mục tiêu' })).toBeVisible({ timeout: 25_000 })
      await expect(goal.locator('summary')).toContainText('Tính khoản góp để đạt mục tiêu')
      const goalLink = goal.getByRole('link', { name: 'Mở Khảo sát đầu tư và tích lũy' })
      await expect(goalLink).toHaveAttribute('href', /^\/survey\?mode=invest&amount=50000000&contribution=\d+&term=36$/)
      const contribution = new URL((await goalLink.getAttribute('href'))!, page.url()).searchParams.get('contribution')!
      await goal.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
      await checkLayout(page)
      await page.screenshot({ path: resolve(masterScreenshots, 'goal-planner-' + viewport.width + '.png') })
      await goalLink.click()
      await expect(page.getByLabel('Vốn ban đầu (VNĐ)')).toHaveValue('50 000 000')
      await expect(page.getByLabel('Góp thêm mỗi tháng (VNĐ)')).toHaveValue(contribution.replace(/\B(?=(\d{3})+(?!\d))/g, ' '))
    })

    test('Mẫu trình báo tạo bản in và bản sao trên trình duyệt', async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: (value: string) => { document.body.dataset.testClipboard = value; return Promise.resolve() } },
        })
        window.print = () => {
          document.body.dataset.testPrint = document.querySelector('.incident-print')?.textContent ?? ''
          window.dispatchEvent(new Event('afterprint'))
        }
      })
      await page.goto('/forensic')
      const composer = page.getByRole('textbox', { name: 'Nội dung cần giám định' })
      await composer.fill('Bên cho vay báo lỗi 102 và yêu cầu đóng phí giải ngân 2 triệu vào tài khoản cá nhân.')
      await page.getByLabel('Chọn tệp giám định').setInputFiles(await qrFile(transferQr, 'bank.png'))
      await page.getByRole('button', { name: 'Gửi giám định' }).click()
      const title = page.getByRole('heading', { name: 'Mẫu trình báo và tra soát' })
      await expect(title).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('Thông tin cá nhân chỉ xử lý trên trình duyệt, không gửi về máy chủ')).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Đơn trình báo A05' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Yêu cầu tra soát ngân hàng' })).toBeVisible()
      await expect(page.getByText(/Đọc từ mã QR: .*BIN 970422/)).toBeVisible()
      await expect(page.getByRole('link', { name: /Tổng đài MBBank/ })).toHaveAttribute('href', 'tel:1900545426')
      const requests: string[] = []
      page.on('request', request => {
        if (request.url().includes('/api/v1/')) requests.push(request.url() + (request.postData() ?? ''))
      })
      const kit = title.locator('xpath=ancestor::*[@aria-labelledby][1]')
      await kit.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
      await checkLayout(page)
      await page.screenshot({ path: resolve(masterScreenshots, 'incident-kit-' + viewport.width + '.png') })
      await page.getByText('Điền thông tin vào mẫu (không bắt buộc)', { exact: true }).click()
      const privateName = 'Private Canary'
      const privatePhone = '0987654329'
      const privateDate = '2026-11-11T02:17'
      const privateAmount = '7654321'
      const privateReference = 'CANARY-TRANS-75364'
      await page.getByLabel('Họ tên người trình báo').fill(privateName)
      await page.getByLabel('SĐT liên hệ').fill(privatePhone)
      await page.getByLabel('Thời điểm chuyển tiền').fill(privateDate)
      await page.getByLabel('Số tiền đã chuyển (đồng)').fill(privateAmount)
      await page.getByLabel('Mã giao dịch').fill(privateReference)
      await page.getByRole('button', { name: 'Sao chép Đơn trình báo A05' }).click()
      await expect(page.getByText('Đã sao chép Đơn trình báo A05.')).toBeVisible()
      const copied = await page.evaluate(() => document.body.dataset.testClipboard)
      expect(copied).toContain('canhbao.ncsc.gov.vn')
      expect(copied).toContain('113')
      await page.getByRole('button', { name: 'In / Lưu PDF Yêu cầu tra soát ngân hàng' }).click()
      const printed = await page.evaluate(() => document.body.dataset.testPrint)
      expect(printed).toMatch(/TRA SOÁT VÀ HỖ TRỢ PHONG TỎA/)
      expect(printed).toContain('BIN 970422')
      expect(printed).toContain('1900 545426')
      const browserState = await page.evaluate(() => [location.href, JSON.stringify(localStorage), JSON.stringify(sessionStorage)].join('|'))
      for (const value of [privateName, privatePhone, privateDate, privateAmount, privateReference]) {
        expect(copied).toContain(value)
        expect(printed).toContain(value)
        expect(browserState).not.toContain(value)
        expect(requests.join('|')).not.toContain(value)
      }
      await page.reload()
      await page.getByText('Điền thông tin vào mẫu (không bắt buộc)', { exact: true }).click()
      await expect(page.getByLabel('Họ tên người trình báo')).toHaveValue('')
    })

    test('Giám định lỗi 102 mở toàn màn hình, giữ vị trí và trả thẻ vay ngay trong follow-up', async ({ page }) => {
      test.setTimeout(70_000)
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.goto('/forensic')
      const shell = page.locator('.desk-shell')
      const geometry = await shell.evaluate(element => {
        const rect = element.getBoundingClientRect()
        return { top: rect.top, left: rect.left, width: rect.width, viewport: window.innerWidth,
          radius: getComputedStyle(element).borderRadius, shadow: getComputedStyle(element).boxShadow }
      })
      expect(geometry).toMatchObject({ top: 0, left: 0, width: geometry.viewport, radius: '0px', shadow: 'none' })
      await page.screenshot({ path: resolve(hybridScreenshots, 'fullscreen-' + viewport.width + '.png') })

      await ask(page, 'Bên cho vay báo lỗi 102 và yêu cầu chuyển phí giải ngân 2 triệu vào tài khoản cá nhân.')
      const skip = page.getByRole('button', { name: 'Hiện nhanh' })
      await expect(skip).toBeVisible({ timeout: 30_000 })
      const visualBlocks = page.locator('.forensic-report .scr-report-block')
      // Bottom cards join the same animation wave as the verdict, while the narrative is still revealing.
      await expect(page.locator('[data-report-section="privacy"].scr-report-block')).toBeAttached()
      await expect(page.locator('[data-report-narrative] [data-scr-streaming]')).toBeAttached()
      const timing = await visualBlocks.evaluateAll(blocks => blocks.map(block => [
        getComputedStyle(block).animationName, getComputedStyle(block).animationDuration, getComputedStyle(block).animationDelay,
      ]))
      expect(timing.length).toBeGreaterThanOrEqual(6)
      expect(timing).toEqual(timing.map((_, i) => ['forensic-report-enter', '0.2s', (i * 45 / 1000).toString() + 's']))
      await skip.click()
      await expect(visualBlocks).toHaveCount(0)

      const followUp = page.getByRole('textbox', { name: 'Câu hỏi tiếp theo' })
      const submit = page.getByRole('button', { name: 'Gửi câu hỏi', exact: true })
      const verdict = page.locator('[data-verdict-heading]')
      const originalVerdict = await verdict.textContent()
      expect(originalVerdict).toMatch(/Dừng giao dịch|Rủi ro cao/i)
      const transcript = page.getByRole('region', { name: 'Nội dung hội thoại' })
      const chatResponse = page.waitForResponse(response => response.url().includes('/chat/stream') && response.request().method() === 'POST')
      await followUp.fill(loanPrompt)
      await submit.click()
      const response = await chatResponse
      expect(response.ok()).toBe(true)
      expect(response.headers()['content-type']).toContain('text/event-stream')
      const loan = page.getByRole('article', { name: 'Câu trả lời của FinCopilot' }).last()
      await expect(loan.getByRole('heading', { name: 'Kế hoạch vay · Vay tín chấp' })).toBeVisible({ timeout: 25_000 })
      await expect(loan.getByText(/VPBank ·/)).toBeVisible()
      await expect(loan.locator('summary')).toContainText('Hồ sơ DTI · Kho ngân hàng NHNN')
      await expect(verdict).toHaveText(originalVerdict ?? '')
      await loan.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
      await checkLayout(page)
      await page.screenshot({ path: resolve(hybridScreenshots, 'follow-up-loan-' + viewport.width + '.png') })

      const probe = await transcript.evaluate(element => {
        element.scrollTop = Math.floor((element.scrollHeight - element.clientHeight) * 0.47)
        return element.scrollTop
      })
      expect(probe).toBeGreaterThan(0)
      await expect.poll(() => transcript.evaluate(element => element.scrollTop)).toBe(probe)
      await nav(page, 'Khảo sát & Tính toán')
      await nav(page, 'Bảng tin & Thị trường')
      await nav(page, 'Giám định lừa đảo & QR')
      await expect(verdict).toHaveText(originalVerdict ?? '')
      await expect(page.locator('[data-report-section="privacy"]')).toBeAttached()
      await expect(loan.getByRole('heading', { name: 'Kế hoạch vay · Vay tín chấp' })).toBeAttached()
      await expect(skip).toHaveCount(0)
      await expect(page.locator('.forensic-report .scr-report-block, [data-scr-streaming]')).toHaveCount(0)
      await expect.poll(() => transcript.evaluate(element => element.scrollTop)).toBe(probe)

      await followUp.fill('Bên kia vừa đòi chuyển thêm 5 triệu phí giải ngân.')
      await submit.click()
      const caution = page.getByRole('article', { name: 'Câu trả lời của FinCopilot' }).last()
      await expect(caution.getByRole('button', { name: 'Giám định lại kèm thông tin vừa bổ sung' })).toBeVisible({ timeout: 25_000 })
      await expect(caution.getByRole('heading', { name: 'Kế hoạch vay · Vay tín chấp' })).toHaveCount(0)
      await expect(verdict).toHaveText(originalVerdict ?? '')
    })

    if (viewport.width === 1280) test('Rời Giám định giữa lúc báo cáo còn chạy thì quay lại thấy đầy đủ nội dung', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.goto('/forensic')
      await ask(page, 'Bên cho vay báo lỗi 102 và yêu cầu chuyển phí giải ngân 2 triệu vào tài khoản cá nhân.')
      const streaming = page.locator('[data-report-narrative] [data-scr-streaming]')
      await expect(streaming).toBeAttached({ timeout: 25_000 })
      const surveyLink = page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Khảo sát & Tính toán' })
      const fullNarrative = await surveyLink.evaluate(link => {
        const text = document.querySelector('[data-report-narrative] [data-scr-streaming] .sr-only')?.textContent
        link.click()
        return text
      })
      expect(fullNarrative).toMatch(/\S/u)
      await expect(page).toHaveURL(url => url.pathname === '/survey')
      await nav(page, 'Giám định lừa đảo & QR')
      await expect(page.locator('[data-verdict-heading]')).toBeVisible()
      await expect(page.locator('[data-report-narrative] p')).toHaveText(fullNarrative ?? '')
      await expect(page.locator('[data-report-section="privacy"]')).toBeAttached()
      await expect(page.locator('.forensic-report .scr-report-block, [data-scr-streaming]')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Hiện nhanh' })).toHaveCount(0)
    })

    test('Follow-up dùng JSON dự phòng và giữ thẻ mục tiêu tài chính', async ({ page }) => {
      await page.goto('/forensic')
      await ask(page, 'Bên cho vay báo lỗi 102 và yêu cầu chuyển phí giải ngân 2 triệu vào tài khoản cá nhân.')
      await expect(page.locator('[data-verdict-heading]')).toBeVisible({ timeout: 25_000 })
      await expect(page.getByRole('button', { name: 'Hiện nhanh' })).toHaveCount(0)
      await page.route('**/forensic/audits/*/chat/stream', route => route.fulfill({ json: { unavailable: true } }))
      const reply = page.waitForResponse(response => response.url().endsWith('/chat') && response.request().method() === 'POST')
      await page.getByRole('textbox', { name: 'Câu hỏi tiếp theo' }).fill('Muốn có 300 triệu sau 3 năm cần góp bao nhiêu?')
      await page.getByRole('button', { name: 'Gửi câu hỏi', exact: true }).click()
      expect((await reply).ok()).toBe(true)
      const goal = page.getByRole('article', { name: 'Câu trả lời của FinCopilot' }).last()
      await expect(goal.getByRole('heading', { name: 'Khoản góp để đạt mục tiêu' })).toBeVisible()
      await expect(goal.getByRole('link', { name: 'Mở Khảo sát đầu tư và tích lũy' })).toHaveAttribute('href', /^\/survey\?mode=invest.*term=36$/)
      await expect(page.locator('[data-scr-streaming]')).toHaveCount(0)
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
      await expect(loan.getByText(/Tham khảo từ nguồn công bố|Danh mục đã xác minh/).first()).toHaveText(/\d{2}\/\d{2}\/\d{4}/)
      await expect(loan.getByText(/Cập nhật trong 30 ngày|Đã 31–60 ngày|Quá 60 ngày/).first()).toBeVisible()
      await expect(loan.getByRole('link', { name: /Mở (bảng trả nợ trong Khảo sát|Khảo sát khoản vay)/ })).toHaveAttribute('href', /^\/survey\?mode=loan&sessionId=/)
      await checkLayout(page)
      if (viewport.width === 320) {
        await trace.click()
        await loan.scrollIntoViewIfNeeded()
        await page.screenshot({ path: resolve(screenshotDir, 'copilot-loan-dti-320.png') })
      } else await loan.screenshot({ path: resolve(screenshotDir, 'copilot-loan-dti-1280.png') })
      await page.screenshot({ path: resolve(masterScreenshots, 'loan-provenance-' + viewport.width + '.png') })
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
