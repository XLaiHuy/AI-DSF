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
    await expect(chart.locator('[title="5 gói niêm yết · Đơn vị mẫu"]')).toContainText('Trung vị 5,3%')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    expect(errors).toEqual([])
    await chart.screenshot({ path: testInfo.outputPath(`benchmark-${width}.png`) })
  })
}
