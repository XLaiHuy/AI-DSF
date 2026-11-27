import { expect, test } from '@playwright/test'

for (const width of [1280, 390, 320]) {
  test('Radar lọc xu hướng đã xác minh ở ' + width + 'px', async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 })
    const errors: string[] = []
    let calls = 0
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('request', (request) => { if (request.url().includes('/radar/alerts/trends?')) calls++ })
    await page.goto('/radar')
    await expect(page.getByRole('button', { name: 'Xu hướng', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.waitForLoadState('networkidle')
    expect(calls).toBe(0)
    const board = page.getByRole('region', { name: 'Xu hướng thủ đoạn lừa đảo' })
    await expect(board).toHaveCount(0)

    const selectWithResult = async (name: string, query: string) => {
      const pending = page.waitForResponse((response) => response.url().includes('/radar/alerts/trends?' + query))
      await page.getByRole('button', { name, exact: true }).click()
      const response = await pending
      expect(response.status()).toBe(200)
      expect(response.headers()['cache-control']).toBe('public, max-age=60, stale-while-revalidate=300')
      const result = await response.json()
      if (name === 'Cảnh báo' && width < 640) {
        const disclosure = board.getByRole('button', { name: 'Bộ lọc và danh mục xu hướng' })
        await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
        await disclosure.click()
      }
      expect(result.totalVerifiedInWindow).toBeGreaterThanOrEqual(0)
      await expect(board.getByText(result.totalVerifiedInWindow + ' cảnh báo đã xác minh trong kỳ.', { exact: false })).toBeVisible()
      if (result.totalVerifiedInWindow < 5) {
        await expect(board.getByText('Danh mục thủ đoạn đang theo dõi')).toBeVisible()
        await expect(board.getByText('Đang tăng mạnh')).toHaveCount(0)
      }
      return result
    }
    expect(await selectWithResult('Cảnh báo', 'window=7d&audience=ALL')).toMatchObject({ window: '7d', audience: 'ALL' })
    await board.screenshot({
      path: info.outputPath('radar-threat-trends.png'), style: '.desk-nav { visibility: hidden !important; }',
    })
    expect(await selectWithResult('30 ngày', 'window=30d&audience=ALL')).toMatchObject({ window: '30d' })
    expect(await selectWithResult('90 ngày', 'window=90d&audience=ALL')).toMatchObject({ window: '90d' })
    const filtered = await selectWithResult('Sinh viên', 'window=90d&audience=STUDENT')
    expect(filtered.audience).toBe('STUDENT')
    expect(filtered.items.every((item: { targetAudience: string }) => item.targetAudience === 'STUDENT')).toBe(true)
    const handoff = board.getByRole('link', { name: 'Đối chiếu trong Giám định' }).first()
    await expect(handoff).toHaveAttribute('href', /^\/forensic(?:\?|$)/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await handoff.click()
    await expect(page).toHaveURL(/\/forensic(?:\?|$)/)
    expect(errors).toEqual([])
  })
}
