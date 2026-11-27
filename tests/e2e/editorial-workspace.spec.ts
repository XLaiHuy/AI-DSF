import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

for (const width of [1280, 390, 320]) {
  test('Khung biên tập và điều hướng ' + width, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(page.url() + ' ' + error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(page.url() + ' ' + message.text() + ' ' + message.location().url) })
    for (const path of ['/', '/forensic', '/survey', '/profile', '/admin']) {
      await page.goto(path, { waitUntil: 'networkidle' })
      await expect(page.locator('.desk-shell')).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      if (width < 901) {
        const menu = page.getByRole('button', { name: 'Menu điều hướng' })
        await menu.click()
        await page.locator('.desk-profile').focus()
        await page.keyboard.press('Escape')
        await expect(menu).toBeFocused()
        await expect(menu).toHaveAttribute('aria-expanded', 'false')
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath((path.slice(1) || 'home') + '.png') })
    }
    expect(errors).toEqual([])
  })
}

test('Ảnh chân dung còn sau đăng nhập lại và có thể xóa', async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'fincopilot_e2e_mode', value: 'phase-two', url: baseURL! }])
  const api = context.request
  const credentials = { email: randomUUID() + '@example.test', password: 'avatar-test-password' }
  expect((await api.post('/api/v1/auth/register', { data: credentials })).ok()).toBe(true)
  const avatar = '/api/v1/profile/avatar'
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQImWPY42kOQQxYWACrbwsdOwNnEwAAAABJRU5ErkJggg==', 'base64')
  const upload = await api.post(avatar, { multipart: { avatar: { name: 'avatar.png', mimeType: 'image/png', buffer: png } } })
  expect(upload.ok()).toBe(true)
  const { avatarUrl } = await upload.json()
  expect((await api.post('/api/v1/auth/logout')).ok()).toBe(true)
  expect((await api.delete(avatar)).status()).toBe(401)
  const login = await api.post('/api/v1/auth/login', { data: credentials })
  expect((await login.json()).user.avatarUrl).toBe(avatarUrl)
  const image = await api.get(avatarUrl)
  expect(image.headers()['content-type']).toContain('image/webp')
  expect((await image.body()).toString('ascii', 8, 12)).toBe('WEBP')
  expect((await api.delete(avatar)).ok()).toBe(true)
  expect((await api.get(avatarUrl)).status()).toBe(404)
})

test('Lời chào và nhu cầu vay dẫn tới hướng dẫn trong hội thoại', async ({ context, page, baseURL }) => {
  await context.addCookies([{ name: 'fincopilot_e2e_mode', value: 'phase-two', url: baseURL! }])
  await page.goto('/forensic')
  const composer = page.locator('#forensic-text')
  await composer.fill('bạn là ai')
  await composer.press('Enter')
  await page.getByRole('button', { name: 'Tôi muốn vay', exact: true }).click()
  await expect(composer).toHaveValue('Tôi muốn vay')
  await composer.press('Enter')
  await expect(page.getByRole('link', { name: 'Mở Khảo sát khoản vay' })).toHaveAttribute('href', '/survey?mode=loan')
  await expect(page.getByRole('link', { name: 'Xuất báo cáo JSON' })).toHaveCount(0)
})

test('Vận hành hiển thị bốn lịch và kết quả chạy từng luồng thu thập', async ({ page }, info) => {
  await page.route('**/api/v1/auth/session', route => route.fulfill({ json: {
    kind: 'user', user: { id: randomUUID(), email: 'ops@example.test', displayName: 'Vận hành', authProvider: 'EMAIL', role: 'ADMIN' },
    oauthProviders: { google: false, github: false },
  } }))
  const names = ['Tin thị trường', 'Cảnh báo lừa đảo', 'Lãi suất & sản phẩm']
  const schedulerNames = [...names, 'Bảo trì dữ liệu']
  await page.route('**/api/v1/admin/**', route => {
    const path = new URL(route.request().url()).pathname
    const json = path.endsWith('/schedulers') ? schedulerNames.map((name, i) => ({ name, intervalLabel: i === 0 ? '15 phút' : '24 giờ', scheduled: true, nextAt: '2026-11-28T00:00:00Z' })) :
      path.endsWith('/hot-crawl-all') ? names.map((name, i) => ({ name, summary: ['Đã xếp hàng', null, 'Hoàn tất'][i], status: ['QUEUED', 'ERROR', 'SUCCESS'][i] })) :
      path.endsWith('/rnd/summary') ? { total: 0, active: 0, byCategory: {} } :
      path.endsWith('/crawl-status') ? { scheduled: true, nextAt: null } : []
    return route.fulfill({ json })
  })
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Nguồn dữ liệu & Kho sản phẩm' }).click()
  await expect(page.getByRole('table', { name: 'Lịch tự động' }).getByRole('row')).toHaveCount(5)
  await expect(page.getByRole('rowheader', { name: 'Bảo trì dữ liệu' })).toBeVisible()
  await page.getByRole('button', { name: 'Thu thập ngay từ mọi nguồn' }).click()
  await expect(page.getByText('Tin thị trường · Đã xếp hàng')).toBeVisible()
  await expect(page.getByText('Cảnh báo lừa đảo · Lỗi')).toBeVisible()
  await expect(page.getByText('Lãi suất & sản phẩm · Hoàn tất')).toBeVisible()
  await page.screenshot({ path: info.outputPath('admin-catalog.png') })
})
