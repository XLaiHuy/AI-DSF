import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { expect, test, type Page, type TestInfo } from '@playwright/test'

const qr1 = '00020101021238540010A00000072701240006970422011009876543210208QRIBFTTA5303704540725000005802VN62250821PHI GIAI NGAN LOI 1026304CA92'
const entity = 'Công ty Tài chính ABC'
const evidence = 'Khoản vay bị lỗi 102 và đóng băng vốn. Đóng phí giải ngân 2.500.000đ qua mã QR vào tài khoản cá nhân NGUYEN VAN HUNG, số tài khoản 0987654321. CCCD 079123456234.'
const momo = '2|99|0901000001|Nguyen Thanh|fixture@example.test|0|0|transfer_myqr'
const viewports = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } }

const loadApi = createRequire(resolve('apps/api/package.json'))
const writer: {
  prepareZXingModule: (options: { overrides: { wasmBinary: ArrayBuffer } }) => void
  writeBarcode: (value: string, options: { format: 'QRCode'; scale: number }) => Promise<{ image: Blob | null }>
} = loadApi('zxing-wasm/writer')

async function qrFile(value: string, name: string) {
  const wasm = readFileSync(loadApi.resolve('zxing-wasm/writer/zxing_writer.wasm'))
  writer.prepareZXingModule({ overrides: { wasmBinary: Uint8Array.from(wasm).buffer } })
  const { image } = await writer.writeBarcode(value, { format: 'QRCode', scale: 5 })
  if (!image) throw new Error('Could not render the test QR')
  return { name, mimeType: 'image/png', buffer: Buffer.from(await image.arrayBuffer()) }
}

async function verifyLayout(page: Page, info: TestInfo, name: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow, `Horizontal overflow on ${name}`).toBe(false)
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true })
}

for (const [name, viewport] of Object.entries(viewports)) {
  test(`Phase 2 finance profile and VietQR flow on ${name}`, async ({ page, browser }, info) => {
    test.setTimeout(160_000)
    await page.setViewportSize(viewport)
    const clientErrors: string[] = []
    page.on('pageerror', (error) => clientErrors.push(error.message))
    page.on('console', (message) => {
      if (/hydration|did not match server/i.test(message.text())) clientErrors.push(message.text())
    })

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Tổng quan tài chính' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Khảo sát nhanh khoản vay' })).toBeVisible()
    await verifyLayout(page, info, 'home')
    await page.getByRole('button', { name: 'Khảo sát khoản vay' }).click()
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
      response.url().endsWith('/api/v1/forensic/audit') && response.request().method() === 'POST',
    { timeout: 85_000 })
    await page.getByRole('button', { name: 'Gửi giám định' }).click()
    const created = await auditRequest
    expect(created.status()).toBe(201)
    const report = await created.json()
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
    await expect(page.getByText('Nguy hiểm cao', { exact: true }).first()).toBeVisible()
    const question = 'Mình đã chuyển rồi, giờ nên làm gì?'
    await page.getByRole('textbox', { name: 'Câu hỏi tiếp theo' }).fill(question)
    const followUp = page.waitForResponse((response) => response.url().endsWith('/' + report.auditId + '/chat'))
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
    expect(download.suggestedFilename()).toBe('fincopilot-' + report.auditId + '.json')
    const reportApi = '/api/v1/forensic/audits/' + report.auditId
    const exported = await page.request.get(reportApi + '/export')
    expect(exported.status()).toBe(200)
    expect(await exported.json()).toMatchObject({ auditId: report.auditId, verdictLevel: 'HIGH_RISK',
      qrPayloads: expect.arrayContaining([expect.objectContaining({ qrScheme: 'EWALLET_VN', providerLabel: 'MoMo' })]) })
    const outsider = await browser.newContext()
    try {
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
    await expect(page.locator('#monthlyIncomeVnd')).toHaveValue('18000000')
    const savedReport = page.getByRole('link', { name: new RegExp(entity) })
    await expect(savedReport).toBeVisible()
    await verifyLayout(page, info, 'profile-user')
    expect((await page.request.get(reportApi)).status()).toBe(200)
    await savedReport.click()
    await expect(page).toHaveURL(new RegExp('/forensic/' + report.auditId + '$'))
    await expect(page.getByRole('heading', { name: 'Nguy hiểm cao' })).toBeVisible()
    await page.goto('/profile')

    await page.getByRole('button', { name: 'Đăng xuất' }).click()
    await expect(page.getByRole('heading', { name: 'Bạn đang dùng phiên khách' })).toBeVisible()
    expect((await page.request.get(reportApi)).status()).toBe(404)
    await page.goto('/forensic')
    await page.locator('header a[href="/profile?returnTo=%2Fforensic"]').click()
    await expect(page).toHaveURL(/\/profile\?returnTo=%2Fforensic/)
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Đăng nhập bằng email' }).click()
    await expect(page).toHaveURL(/\/forensic$/)

    if (name === 'desktop') {
      await page.goto('/forensic')
      await page.getByRole('button', { name: 'Lãi phẳng và phí giữ lại' }).click()
      const quoteRequest = page.waitForResponse((response) =>
        response.url().endsWith('/api/v1/forensic/audit') && response.request().method() === 'POST',
      { timeout: 85_000 })
      await page.getByRole('button', { name: 'Gửi giám định' }).click()
      const quote = await quoteRequest
      expect(quote.status()).toBe(201)
      const loan = await quote.json()
      expect(loan.mathBreakdown).toMatchObject({
        principalNetVnd: '45000000', effectiveAprPct: '30.7436', effectiveEarPct: '35.4678',
      })
      await expect(page).toHaveURL(/\/forensic$/)
      await expect(page.getByText('APR · Lãi suất quy năm')).toBeVisible()
      await expect(page.getByText('EAR · Lãi suất sau ghép lãi')).toBeVisible()
      await page.getByRole('link', { name: 'Khảo sát phương án vay' }).click()
      await expect(page).toHaveURL(/\/survey\?.*amount=50000000.*term=24.*from=forensic/)
    }
    expect(clientErrors).toEqual([])
  })
}
