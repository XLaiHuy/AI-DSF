import assert from 'node:assert/strict'
import { expect, test } from 'e2e'

test('Trang Giám định trả header bảo mật và hiển thị với khách', async ({ app, screen }) => {
  const response = await fetch(new URL('/forensic', app.baseUrl))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/)
  await response.body?.cancel()

  await app.open('/forensic')
  await expect(screen.getByRole('heading', { name: 'Giám định tài chính' })).toBeVisible()
  await expect(screen.getByRole('button', { name: 'Phiên mới' })).toBeVisible()
})
