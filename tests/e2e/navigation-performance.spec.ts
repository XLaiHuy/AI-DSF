import { expect, test } from '@playwright/test'

for (const width of [1280, 390, 320]) {
  test('Chuyển trang giữ thanh điều hướng ở ' + width + 'px', async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto('/')
    const navigation = page.locator('nav.desk-nav')
    const sameNav = await navigation.elementHandle()
    expect(sameNav).not.toBeNull()
    const shellWidth = await page.locator('.desk-shell').evaluate(frame => frame.getBoundingClientRect().width)
    for (const [path, title] of [
      ['/forensic', 'Giám định tài chính'], ['/survey', 'Mình cùng tìm phương án phù hợp nhé'], ['/profile', 'Hồ sơ tài chính'], ['/', 'Kiểm tra trước khi chuyển tiền'],
    ]) {
      if (width < 901 && path !== '/') await navigation.getByRole('button', { name: 'Menu điều hướng' }).click()
      const link = path === '/' ? navigation.locator('.desk-brand') : navigation.locator(`a[href="${path}"], a[href^="${path}?"]`).first()
      await link.click()
      await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible()
      expect(await sameNav!.evaluate(element => element === document.querySelector('nav.desk-nav'))).toBe(true)
      expect(await page.locator('.desk-shell').evaluate(frame => frame.getBoundingClientRect().width)).toBeCloseTo(shellWidth)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    expect(errors).toEqual([])
    if (width === 320) {
      const loans = page.getByTestId('benchmark-group-LOAN')
      const tick = loans.getByText('45%', { exact: true })
      const box = await tick.boundingBox()
      expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true)
      await loans.screenshot({ path: info.outputPath('benchmark-320.png'), style: '.desk-nav { visibility: hidden }' })
    }
  })
}

test('Tab Radar chỉ gọi dữ liệu cần dùng và focus lại không làm mới', async ({ page }) => {
  const counts = { brief: 0, market: 0, alerts: 0, fraud: 0, rsc: 0 }
  const routeRequests: string[] = []
  let switching = false
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname === '/api/v1/radar/daily-brief') counts.brief++
    if (url.pathname === '/api/v1/home/market') counts.market++
    if (url.pathname === '/api/v1/radar/alerts') counts.alerts++
    if (url.pathname.endsWith('/radar/articles') && url.searchParams.get('category') === 'FINANCIAL_FRAUD') counts.fraud++
    const headers = request.headers()
    const prefetch = headers['next-router-prefetch'] === '1' || Boolean(headers['next-router-segment-prefetch'])
    if (switching && !prefetch && (headers.rsc === '1' || url.searchParams.has('_rsc'))) {
      counts.rsc++
      routeRequests.push(url.pathname + url.search)
    }
  })
  await page.clock.install({ time: new Date('2026-11-27T03:00:00Z') })
  await page.goto('/')
  await expect(page.getByTestId('benchmark-group-LOAN')).toBeVisible()
  await expect.poll(() => counts.brief).toBeGreaterThan(0)
  expect(counts.alerts).toBe(0)
  expect(counts.fraud).toBe(0)
  const focused = { brief: counts.brief, market: counts.market }
  await page.clock.fastForward(11 * 60_000)
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
  })
  await page.clock.runFor(250)
  expect({ brief: counts.brief, market: counts.market }).toEqual(focused)
  switching = true
  await page.getByRole('button', { name: 'Cảnh báo', exact: true }).click()
  await expect(page).toHaveURL(/tab=alerts/)
  await expect.poll(() => counts.alerts).toBe(1)
  await expect.poll(() => counts.fraud).toBe(1)
  await page.getByRole('button', { name: 'Dành cho bạn', exact: true }).click()
  await expect(page).toHaveURL(/tab=personal/)
  await page.getByRole('button', { name: 'Xu hướng', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Xu hướng', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(counts.rsc, routeRequests.join('\n')).toBe(0)
})

test('Khảo sát chưa tính toán không tải Recharts', async ({ page }) => {
  const scripts: Promise<boolean>[] = []
  page.on('response', response => {
    if (response.request().resourceType() === 'script' && new URL(response.url()).pathname.startsWith('/_next/')) {
      scripts.push(response.text().then(body => /recharts-(?:wrapper|cartesian-grid|legend-wrapper)/.test(body)))
    }
  })
  await page.goto('/survey')
  await expect(page.getByRole('group', { name: 'Chế độ khảo sát' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(scripts.length).toBeGreaterThan(0)
  expect(await Promise.all(scripts)).not.toContain(true)
})
