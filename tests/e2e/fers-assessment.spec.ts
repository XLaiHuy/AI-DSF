import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

for (const width of [1280, 390, 320]) {
  test('Báo cáo FERS và tải hồ sơ ở ' + width + 'px', async ({ page, context, baseURL }, info) => {
    await context.addCookies([{ name: 'fincopilot_e2e_mode', value: 'phase-two', url: baseURL! }])
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    const audit = await context.request.post('/api/v1/forensic/audit', {
      data: { rawText: 'Bên cho vay báo lỗi 102, yêu cầu nộp 500.000 đồng phí giải ngân để mở khóa khoản vay.' },
    })
    expect(audit.ok()).toBe(true)
    const { auditId } = await audit.json()
    await page.goto('/forensic/' + auditId)
    const hero = page.getByTestId('fers-risk-scale')
    await expect(hero.getByRole('listitem')).toHaveCount(4)
    await expect(hero.locator('[aria-current="step"]')).toHaveCount(1)
    const heading = page.locator('[data-verdict-heading]')
    await expect(heading).toHaveText('Dừng giao dịch ngay')
    const help = page.locator('summary[aria-label="Cách FinCopilot đánh giá"]')
    await help.click()
    await expect(help.locator('..').getByRole('listitem')).toHaveCount(4)
    const ledger = page.getByText('Sổ bằng chứng & Chuẩn đối chiếu', { exact: true })
    await ledger.click()
    await expect(page.getByRole('table', { name: 'Chuỗi bằng chứng' })).toBeVisible()
    await expect(page.getByText('FERS-v1 · T3', { exact: false })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.locator('[data-verdict-heading]').locator('xpath=ancestor::header[1]').screenshot({ path: info.outputPath('fers-hero.png') })
    await ledger.locator('..').screenshot({ path: info.outputPath('fers-evidence.png') })
    const exportLink = page.getByRole('link', { name: 'Tải hồ sơ STIX 2.1 (JSON)' })
    const downloaded = page.waitForEvent('download')
    await exportLink.click()
    const file = await downloaded
    expect(file.suggestedFilename()).toBe(`fincopilot-${auditId}-stix21.json`)
    expect(JSON.parse(await readFile(await file.path(), 'utf8'))).toMatchObject({ type: 'bundle', spec_version: '2.1' })
    expect(errors).toEqual([])
  })
}
