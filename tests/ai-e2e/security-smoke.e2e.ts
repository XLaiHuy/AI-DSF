import assert from 'node:assert/strict'
import { expect, test } from 'e2e'

async function securePage(baseUrl: string, path: string) {
  const response = await fetch(new URL(path, baseUrl))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/)
  return response.text()
}

test('Giám định có header bảo mật và mở được với khách', async ({ app, screen }) => {
  await securePage(app.baseUrl, '/forensic')
  await app.open('/forensic')
  await expect(screen.getByRole('heading', { name: 'Giám định tài chính' })).toBeVisible()
  await expect(screen.getByRole('button', { name: 'Phiên mới' })).toBeVisible()
})

test('Khảo sát có header bảo mật và đủ bốn chế độ', async ({ app, screen }) => {
  await securePage(app.baseUrl, '/survey')
  await app.open('/survey')
  for (const name of ['Khảo sát vay', 'Đầu tư / tích lũy', 'Tự nhập so sánh', 'Đổi khoản vay / Đảo nợ']) {
    await expect(screen.getByRole('button', { name })).toBeVisible()
  }
})

test('Radar có header bảo mật và mở được với khách', async ({ app, screen }) => {
  await securePage(app.baseUrl, '/radar')
  await app.open('/radar')
  await expect(screen.getByRole('heading', { name: 'Kiểm tra trước khi chuyển tiền' })).toBeVisible()
})

test('Vận hành có header bảo mật và chỉ hiện cổng đăng nhập với khách', async ({ app, screen }) => {
  const html = await securePage(app.baseUrl, '/admin')
  await app.open('/admin')
  await expect(screen.getByRole('heading', { name: 'Đăng nhập Quản trị' })).toBeVisible()
  await expect(screen.getByRole('textbox', { name: 'Email' })).toBeVisible()
  await expect(screen.getByText('Mật khẩu', { exact: true })).toBeVisible()
  await expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeVisible()
  assert.doesNotMatch(html, /Kiểm duyệt, Góp ý|Nguồn dữ liệu &amp; Kho sản phẩm|Ngắt kết nối khóa API/u)
})

test('Hồ sơ có header bảo mật và ẩn cổng quản trị với khách', async ({ app, screen }) => {
  const html = await securePage(app.baseUrl, '/profile')
  await app.open('/profile')
  await expect(screen.getByRole('heading', { name: 'Hồ sơ tài chính' })).toBeVisible()
  assert.doesNotMatch(html, /Cổng vận hành quản trị/u)
})
