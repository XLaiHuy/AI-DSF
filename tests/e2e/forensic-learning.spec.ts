import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { ForensicAuditResponseSchema } from '@fincopilot/shared-types'

for (const width of [1280, 390, 320]) {
  test('Hội thoại giám định giữ số tiền và kỳ hạn ở ' + width + 'px', async ({ context, page, baseURL }, info) => {
    await context.addCookies([{ name: 'fincopilot_e2e_mode', value: 'phase-two', url: baseURL! }])
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto('/forensic')
    const composer = page.locator('#forensic-text')
    const submit = async (text: string) => {
      await composer.fill(text)
      const request = page.waitForResponse(response => response.url().endsWith('/forensic/audit/stream'))
      await composer.press('Enter')
      expect((await request).ok()).toBe(true)
      await expect(composer).toBeEnabled()
    }
    await submit('tôi muốn vay vốn kinh doanh')
    await expect(page.getByRole('link', { name: 'Mở Khảo sát khoản vay' })).toHaveAttribute('href', '/survey?mode=loan')
    await submit('200 triệu trong 36 tháng')
    const handoff = page.getByRole('link', { name: 'Mở Khảo sát khoản vay' }).last()
    await expect(handoff).toHaveAttribute('href', '/survey?mode=loan&amount=200000000&term=36')
    await handoff.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath('chatbot-multi-turn.png') })
    await submit('mình vừa bị lừa chuyển 20 triệu rồi phải làm sao')
    const steps = page.getByRole('list', { name: 'Các bước ứng cứu' })
    await expect(steps.getByRole('listitem')).toHaveCount(5)
    await steps.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath('chatbot-recovery.png') })
    await submit('bạn là ai vậy')
    await expect(page.getByText(/Chào bạn, mình là FinCopilot/)).toBeVisible()
    await submit('APR là gì?')
    await expect(page.getByText(/APR là tỷ lệ chi phí/)).toBeVisible()
    await submit('người lạ gọi kêu chuyển tiền có phải lừa đảo không?')
    await expect(page.getByText(/Tạm dừng giao dịch/)).toBeVisible()
    await submit('kiểm tra sức khỏe tài chính')
    await expect(page.getByRole('link', { name: 'Mở Hồ sơ tài chính' })).toHaveAttribute('href', '/profile')
    await submit('cảm ơn bạn nhé')
    await expect(page.getByText(/sẵn sàng nếu bạn có câu hỏi/)).toBeVisible()
    await submit('Hôm nay ăn gì ngon?')
    await expect(page.getByText(/Mình có thể giúp kiểm tra giao dịch/)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Xuất báo cáo JSON' })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    expect(errors).toEqual([])
  })
}

test('Góp ý báo cáo thật qua giao diện và đọc lại trạng thái', async ({ context, page, browser, baseURL }, info) => {
  const mode = { name: 'fincopilot_e2e_mode', value: 'phase-two', url: baseURL! }
  await context.addCookies([mode])
  const session = await context.request.post('/api/v1/auth/register', {
    data: { email: randomUUID() + '@example.test', password: 'fin-e2e-feedback-test' },
  })
  expect(session.ok()).toBe(true)
  const auditResponse = await context.request.post('/api/v1/forensic/audit', {
    data: { rawText: 'Mình xem lại hóa đơn tiền ăn.' },
  })
  expect(auditResponse.ok()).toBe(true)
  const audit = ForensicAuditResponseSchema.parse(await auditResponse.json())
  const url = '/api/v1/forensic/audits/' + audit.auditId + '/feedback'
  const another = await browser.newContext()
  try {
    await another.addCookies([mode])
    const unauthorized = await another.request.post(baseURL + url, { data: { assessment: 'ACCURATE' } })
    expect(unauthorized.status()).toBe(404)
  } finally { await another.close() }

  await page.goto('/forensic/' + audit.auditId)
  const feedback = page.getByRole('region', { name: 'Góp ý chất lượng giám định' })
  await feedback.getByRole('button', { name: 'Báo sai / Chưa đủ' }).click()
  await feedback.getByLabel('Mức rủi ro bạn đề xuất').selectOption('SAFE')
  const note = feedback.getByLabel('Ghi chú (tùy chọn)')
  await note.fill('Đối chiếu <em>hóa đơn</em>.')
  await expect(note).toHaveValue('Đối chiếu <em>hóa đơn</em>.')
  await expect(feedback.locator('em')).toHaveCount(0)
  await feedback.getByRole('button', { name: 'Gửi góp ý' }).click()
  await expect(feedback.getByRole('status')).toContainText('chờ kiểm duyệt')
  await page.reload()
  await expect(feedback.getByRole('status')).toContainText('chờ kiểm duyệt')
  await expect(feedback.getByRole('button', { name: 'Chính xác' })).toHaveCount(0)
  const duplicate = await context.request.post(url, { data: { assessment: 'ACCURATE' } })
  expect(duplicate.status()).toBe(409)
  expect((await duplicate.json()).message).toContain('đã gửi góp ý')
  await feedback.screenshot({ path: info.outputPath('audit-feedback.png') })
})
