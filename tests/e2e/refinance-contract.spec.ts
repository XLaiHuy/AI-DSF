import { expect, test } from '@playwright/test'

for (const width of [1280, 390, 320]) {
  test('Đối chiếu hợp đồng lãi phẳng ở ' + width + 'px', async ({ page, context, baseURL }, info) => {
    await context.addCookies([{ name: 'fincopilot_e2e_mode', value: 'phase-two', url: baseURL! }])
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    const audit = await context.request.post('/api/v1/forensic/audit', {
      data: { rawText: 'Khoản vay 50 000 000 đồng. Kỳ hạn 24 tháng. Lãi phẳng 3%/tháng. Phí hồ sơ 1 000 000 đồng.' },
    })
    expect(audit.ok()).toBe(true)
    const { auditId, mathBreakdown } = await audit.json()
    expect(mathBreakdown).toMatchObject({ principalNominalVnd: '50000000', termMonths: 24 })
    await page.goto('/forensic/' + auditId)
    const cta = page.getByRole('link', { name: 'So sánh hợp đồng này với ngân hàng' })
    await expect(cta).toHaveAttribute('href', '/survey?mode=refinance&auditId=' + auditId + '&from=forensic')
    const report = page.waitForResponse((response) => response.url().endsWith('/survey/refinance') && response.request().method() === 'POST')
    await cta.click()
    const compared = await report
    expect(compared.ok()).toBe(true)
    const { sessionId, offers } = await compared.json()
    expect(offers).toHaveLength(3)
    expect(new Set(offers.map((item: { institutionName: string }) => item.institutionName)).size).toBe(3)
    await expect(page.getByRole('button', { name: 'Đổi khoản vay / Đảo nợ' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('link', { name: 'Xem báo cáo nguồn' })).toHaveAttribute('href', '/forensic/' + auditId)
    await expect(page.getByLabel('Số tiền gốc còn nợ (VNĐ)')).toHaveValue('50 000 000')
    await expect(page.getByTestId('refinance-bank')).toHaveCount(3)
    const heading = page.getByRole('heading', { name: 'Điểm hòa vốn theo thời gian' })
    await expect(heading).toBeVisible()
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2)
    await expect(page.getByText(/Hòa vốn sau \d+ tháng/)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('region', { name: 'Đổi khoản vay / Đảo nợ' }).screenshot({
      path: info.outputPath('refinance-comparison.png'), style: '.desk-nav { visibility: hidden !important; }',
    })
    await page.goto('/survey?mode=refinance&sessionId=' + sessionId)
    await expect(page.getByTestId('refinance-bank')).toHaveCount(3)
    await expect(heading).toBeVisible()
    expect(errors).toEqual([])
  })
}
