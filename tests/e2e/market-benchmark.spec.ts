import { expect, test } from '@playwright/test'

for (const width of [1280, 390, 320]) {
  test(`Benchmark phân biệt lãi suất cố định và biên độ ở ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 })
    await page.goto('/radar', { waitUntil: 'networkidle' })
    const chart = page.getByRole('heading', { name: 'Mặt bằng lãi suất & lợi suất đang niêm yết' }).locator('xpath=ancestor::section[1]')
    await expect(chart.getByText('4% · 2 gói niêm yết')).toBeVisible()
    await expect(chart.getByText('4% – 4%', { exact: false })).toHaveCount(0)
    const dot = chart.getByTestId('benchmark-rate-dot')
    await expect(dot).toHaveCSS('background-color', 'rgb(57, 117, 97)')
    await expect(dot).toHaveCSS('width', '14px')
    await expect(chart.locator('[title="5 gói niêm yết · Đơn vị mẫu"]')).toContainText('Trung vị 5,3% · 5 gói')
    const loans = chart.getByTestId('benchmark-group-LOAN')
    const investments = chart.getByTestId('benchmark-group-INVESTMENT')
    await expect(loans.getByTestId('benchmark-rate-axis')).toContainText('45%')
    await expect(investments.getByTestId('benchmark-rate-axis')).toContainText('6%')
    const bars = chart.getByTestId('benchmark-rate-range')
    for (const bar of await bars.all()) {
      const geometry = await bar.evaluate(element => {
        const { left, right } = element.getBoundingClientRect()
        const marker = element.nextElementSibling?.getBoundingClientRect()
        return { left, right, center: marker ? marker.x + marker.width / 2 : -1 }
      })
      expect(geometry.center).toBeGreaterThanOrEqual(geometry.left - 0.5)
      expect(geometry.center).toBeLessThanOrEqual(geometry.right + 0.5)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    expect(errors).toEqual([])
    await chart.screenshot({
      path: testInfo.outputPath(`benchmark-${width}.png`), animations: 'disabled',
      style: '.desk-nav { visibility: hidden }',
    })
    const rail = page.locator('.desk-rail')
    await expect(rail.getByRole('heading', { name: 'Cảnh báo & Tài chính' })).toBeVisible()
    await expect(rail.locator('.desk-rail-badge[data-kind="ALERT"]')).toHaveCSS('color', 'rgb(140, 63, 44)')
    await expect(rail.locator('.desk-rail-badge[data-kind="FINANCE_NEWS"]').first()).toHaveCSS('color', 'rgb(39, 98, 77)')
    await rail.screenshot({ path: testInfo.outputPath(`cot-canh-bao-${width}.png`), animations: 'disabled' })
  })
}
