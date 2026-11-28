import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test, type Page, type Response, type TestInfo } from '@playwright/test'
import { qrFile } from './test-qr'

const qr1 = '00020101021238540010A00000072701240006970422011009876543210208QRIBFTTA5303704540725000005802VN62250821PHI GIAI NGAN LOI 1026304CA92'
const entity = 'Công ty Tài chính ABC'
const evidence = 'Khoản vay bị lỗi 102 và đóng băng vốn. Đóng phí giải ngân 2.500.000đ qua mã QR vào tài khoản cá nhân NGUYEN VAN HUNG, số tài khoản 0987654321. CCCD 079123456234.'
const momo = '2|99|0901000001|Nguyen Thanh|fixture@example.test|0|0|transfer_myqr'
const viewports = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } }

async function verifyLayout(page: Page, info: TestInfo, name: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow, `Horizontal overflow on ${name}`).toBe(false)
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true })
}

async function persistedStreamedAudit(page: Page, response: Response) {
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('text/event-stream')
  const exportLink = page.getByRole('link', { name: 'Xuất báo cáo JSON' })
  await expect(exportLink).toHaveAttribute('href', /^\/api\/v1\/forensic\/audits\/[\da-f-]+\/export$/i, { timeout: 25_000 })
  const path = await exportLink.getAttribute('href')
  if (!path) throw new Error('The rendered audit has no export link')
  const audit = await page.request.get(path.replace(/\/export$/, ''))
  expect(audit.status(), audit.ok() ? '' : await audit.text()).toBe(200)
  return audit.json()
}

for (const [name, viewport] of Object.entries(viewports)) {
  test(`Phase 2 finance profile and VietQR flow on ${name}`, async ({ page, browser, baseURL }, info) => {
    test.setTimeout(160_000)
    const liveApiCookie = { name: 'fincopilot_e2e_mode', value: 'phase-two', url: baseURL }
    await page.context().addCookies([liveApiCookie])
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize(viewport)
    const clientErrors: string[] = []
    page.on('pageerror', (error) => clientErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' || /hydration|did not match server|width.*height.*chart/i.test(message.text())) clientErrors.push(message.text())
    })

    await page.goto('/', { waitUntil: 'networkidle' })
    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' })
    await expect(nav).toBeVisible()
    await verifyLayout(page, info, 'home')
    if (name === 'mobile') await nav.getByRole('button', { name: 'Menu điều hướng' }).click()
    await nav.getByRole('button', { name: 'Khảo sát nhanh' }).click()
    const quickDialog = page.getByRole('dialog', { name: 'Khảo sát nhanh' })
    await expect(quickDialog.getByRole('heading', { name: 'Khảo sát nhanh khoản vay' })).toBeVisible()
    await quickDialog.getByRole('button', { name: 'Khảo sát khoản vay' }).click()
    await expect(page).toHaveURL(/\/survey\?.*amount=50000000.*term=24/)

    await page.goto('/profile')
    await expect(page.getByRole('heading', { name: 'Bạn đang dùng phiên khách' })).toBeVisible()
    await page.locator('#monthlyIncomeVnd').fill('18000000')
    await page.locator('#monthlyExpenseVnd').fill('8000000')
    await page.locator('#existingDebtPaymentVnd').fill('2000000')
    await page.locator('#liquidSavingsVnd').fill('50000000')
    await expect(page.getByText('11,11%', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Lưu hồ sơ tài chính' }).click()
    await expect(page.getByText('Đã lưu hồ sơ tài chính.')).toBeVisible()
    await verifyLayout(page, info, 'profile-guest')

    await page.goto('/forensic?claimedEntity=' + encodeURIComponent(entity))
    await expect(page.getByText('Đơn vị từ Bộ lọc Tin cậy: ' + entity)).toBeVisible()
    const composer = page.getByRole('textbox', { name: 'Nội dung cần giám định' })
    await composer.fill(evidence)
    const fixtures = await Promise.all([qrFile(qr1, 'bank.png'), qrFile(momo, 'wallet.png')])
    if (name === 'desktop') {
      await composer.evaluate((element, files) => {
        const transfer = new DataTransfer()
        for (const { name, base64 } of files) {
          const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
          transfer.items.add(new File([bytes], name, { type: 'image/png' }))
        }
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
      }, fixtures.map(({ name, buffer }) => ({ name, base64: buffer.toString('base64') })))
    } else {
      await page.getByLabel('Chọn tệp giám định').setInputFiles(fixtures)
    }
    await expect(page.getByText('wallet.png', { exact: true })).toBeVisible()
    await verifyLayout(page, info, 'forensic-workbench')
    const auditRequest = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/forensic/audit/stream') && response.request().method() === 'POST',
    { timeout: 85_000 })
    await page.getByRole('button', { name: 'Gửi giám định' }).click()
    const report = await persistedStreamedAudit(page, await auditRequest)
    expect(report).toMatchObject({
      verdictLevel: 'HIGH_RISK', riskScore: 95, deterministicOverride: true,
      qrPayloads: expect.arrayContaining([
        expect.objectContaining({ qrScheme: 'VIETQR_NAPAS', acqBin: '970422', accountNumberMasked: '098****321',
          serviceCode: 'QRIBFTTA', crcValid: true, entityMismatchFlag: true }),
        expect.objectContaining({ qrScheme: 'EWALLET_VN', providerLabel: 'MoMo' }),
      ]),
    })
    const rulePrefixes = report.findings.map(({ ruleCode }: { ruleCode: string }) => ruleCode.slice(0, 7))
    expect(rulePrefixes).toEqual(expect.arrayContaining(['RULE_01', 'RULE_02', 'RULE_03', 'RULE_04',
      ...(process.env.PHASE2_VERIFIED_FIXTURE === '1' ? ['RULE_05'] : []),
    ]))
    expect(Number.isNaN(Date.parse(report.privacyProof.sourceFilesPurgedAt))).toBe(false)
    expect(report.privacyProof.rawTextMasked).toContain('079******234')
    expect(JSON.stringify(report)).not.toContain('0987654321')
    expect(JSON.stringify(report)).not.toContain('NGUYEN VAN HUNG')
    await expect(page).toHaveURL(/\/forensic\?claimedEntity=/)
    await expect(page.getByText('QRIBFTTA', { exact: false }).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Dừng giao dịch ngay', exact: true })).toBeVisible()
    const question = 'Mình đã chuyển rồi, giờ nên làm gì?'
    await page.getByRole('textbox', { name: 'Câu hỏi tiếp theo' }).fill(question)
    const followUp = page.waitForResponse((response) => response.url().endsWith('/' + report.auditId + '/chat/stream'))
    await page.getByRole('button', { name: 'Gửi câu hỏi' }).click()
    const chat = await followUp
    expect(chat.status()).toBe(200)
    await expect(page.getByRole('article', { name: 'Câu trả lời của FinCopilot' })).toContainText('95/100')
    await expect(page.getByRole('textbox', { name: 'Câu hỏi tiếp theo' }).locator('xpath=ancestor::form'))
      .toHaveCSS('position', 'static')
    await verifyLayout(page, info, 'forensic-report')

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Xuất báo cáo JSON' }).click(),
    ])
    const reportApi = '/api/v1/forensic/audits/' + report.auditId
    const exported = await page.request.get(reportApi + '/export')
    expect(exported.status()).toBe(200)
    expect(exported.headers()['content-disposition']).toBe('attachment; filename="fincopilot-' + report.auditId + '.json"')
    expect(download.suggestedFilename()).toBe('fincopilot-' + report.auditId + '.json')
    expect(JSON.parse(readFileSync(await download.path(), 'utf8'))).toMatchObject({ auditId: report.auditId, verdictLevel: 'HIGH_RISK' })
    expect(await exported.json()).toMatchObject({ auditId: report.auditId, verdictLevel: 'HIGH_RISK',
      qrPayloads: expect.arrayContaining([expect.objectContaining({ qrScheme: 'EWALLET_VN', providerLabel: 'MoMo' })]) })
    const outsider = await browser.newContext()
    try {
      await outsider.addCookies([liveApiCookie])
      const absolute = new URL(reportApi, page.url()).href
      expect((await outsider.request.get(absolute)).status()).toBe(404)
      expect((await outsider.request.get(absolute + '/export')).status()).toBe(404)
      expect((await outsider.request.post(absolute + '/chat', { data: { question } })).status()).toBe(404)
    } finally {
      await outsider.close()
    }

    const email = `phase2-${name}-${randomUUID()}@example.test`
    const password = 'Synthetic test password 24!'
    await page.goto('/profile')
    await page.getByRole('tab', { name: 'Đăng ký' }).click()
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Đăng ký bằng email' }).click()
    await expect(page.getByRole('heading', { name: 'Tài khoản của bạn' })).toBeVisible()
    const authCookie = (await page.context().cookies()).find(({ name }) => name === 'auth_token')
    expect({ httpOnly: authCookie?.httpOnly, sameSite: authCookie?.sameSite })
      .toEqual({ httpOnly: true, sameSite: 'Lax' })
    await expect(page.locator('#monthlyIncomeVnd')).toHaveValue('18 000 000')
    const savedReport = page.getByRole('link', { name: new RegExp(entity) })
    await expect(savedReport).toBeVisible()
    await verifyLayout(page, info, 'profile-user')
    expect((await page.request.get(reportApi)).status()).toBe(200)
    await savedReport.click()
    await expect(page).toHaveURL(new RegExp('/forensic/' + report.auditId + '$'))
    await expect(page.getByRole('heading', { name: 'Dừng giao dịch ngay' })).toBeVisible()
    await page.goto('/profile')

    await page.getByRole('button', { name: 'Đăng xuất' }).click()
    await expect(page.getByRole('heading', { name: 'Bạn đang dùng phiên khách' })).toBeVisible()
    expect((await page.request.get(reportApi)).status()).toBe(404)
    await page.goto('/forensic')
    if (name === 'mobile') await nav.getByRole('button', { name: 'Menu điều hướng' }).click()
    await nav.locator('a[href="/profile?returnTo=%2Fforensic"]').click()
    await expect(page).toHaveURL(/\/profile\?returnTo=%2Fforensic/)
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Đăng nhập bằng email' }).click()
    await expect(page).toHaveURL(/\/forensic$/)

    {
      await page.goto('/forensic')
      await page.getByRole('button', { name: 'Lãi phẳng và phí giữ lại' }).click()
      const quoteRequest = page.waitForResponse((response) =>
        response.url().endsWith('/api/v1/forensic/audit/stream') && response.request().method() === 'POST',
      { timeout: 85_000 })
      await page.getByRole('button', { name: 'Gửi giám định' }).click()
      const loan = await persistedStreamedAudit(page, await quoteRequest)
      expect(loan.mathBreakdown).toMatchObject({
        termMonths: 12, principalNetVnd: '45000000', effectiveAprPct: '40.2398', effectiveEarPct: '48.5569',
      })
      await expect(page).toHaveURL(/\/forensic$/)
      const costChart = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Chênh lệch chi phí vay' }) }).last()
      await expect(costChart.locator('svg.recharts-surface')).toHaveCount(2)
      await expect(costChart.getByRole('heading', { name: 'APR thực tế và mốc tham chiếu 20%/năm' })).toBeVisible()
      await verifyLayout(page, info, 'forensic-cost-trap')
      await costChart.screenshot({ path: info.outputPath('forensic-cost-chart.png') })
      await page.getByText('Xem chi tiết kỹ thuật (APR / EAR)').click()
      await expect(page.getByText('Lãi suất quy năm (APR)')).toBeVisible()
      await expect(page.getByText('Lãi suất năm sau ghép lãi (EAR)')).toBeVisible()
      await page.getByRole('link', { name: 'Khảo sát phương án vay' }).click()
      await expect(page).toHaveURL(/\/survey\?/)
      const query = new URL(page.url()).searchParams
      expect(query.get('amount')).toBe('50000000')
      expect(query.get('term')).toBe('12')
      expect(query.get('from')).toBe('forensic')
      expect(query.get('auditId')).toBe(loan.auditId)

      await page.route('**/api/v1/forensic/audits/' + loan.auditId, (route) => route.fulfill({
        json: { ...loan, mathBreakdown: { ...loan.mathBreakdown, effectiveAprPct: null } },
      }))
      await page.goto('/forensic/' + loan.auditId)
      await page.route('**/api/v1/forensic/audits/' + loan.auditId, (route) => route.fulfill({
        json: { ...loan, mathBreakdown: { ...loan.mathBreakdown, effectiveAprPct: null } },
      }))
      await page.goto('/forensic/' + loan.auditId)
      await expect(costChart.getByText(/Hợp đồng thiếu dữ liệu trả định kỳ/)).toBeVisible()
      await expect(costChart.locator('svg.recharts-surface')).toHaveCount(1)
      await expect(costChart).not.toContainText('null%')
      await verifyLayout(page, info, 'forensic-cost-missing-apr')
    }

    // The phase-two mock proxy forwards survey history. Use the live API for calculator writes.
    const calculatorUrl = new URL('/api/v1/calculator/manual-compare', baseURL)
    calculatorUrl.port = process.env.PLAYWRIGHT_PHASE_TWO_API_PORT ?? '4401'
    const comparison = await page.request.post(calculatorUrl.href, { data: { offers: [
      { label: 'Gói kiểm thử A', principalVnd: '12000000', annualRatePct: '12', termMonths: 12,
        calcMethod: 'FLAT_RATE', earlySettlementMonth: 6, earlySettlementFeePct: '2' },
      { label: 'Gói kiểm thử B', principalVnd: '12000000', annualRatePct: '9', termMonths: 12,
        calcMethod: 'DECLINING_PRINCIPAL' },
    ] } })
    expect(comparison.status()).toBe(201)
    const saved: { sessionId: string; meta?: { savedToHistory: boolean } } = await comparison.json()
    expect(saved.meta?.savedToHistory).toBe(true)
    await page.goto('/survey?sessionId=' + saved.sessionId)
    await expect(page.getByRole('button', { name: 'Tự nhập so sánh' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('Gói kiểm thử A · Phương thức tính lãi')).toHaveValue('FLAT_RATE')
    await expect(page.getByRole('heading', { name: 'Tất toán vào tháng 6' })).toBeVisible()
    const replayChart = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Lịch trả nợ theo dòng tiền' }) }).last()
    await expect(replayChart.locator('svg.recharts-surface')).toBeVisible()
    await verifyLayout(page, info, 'survey-session-replay')
    expect(clientErrors).toEqual([])
  })
}
