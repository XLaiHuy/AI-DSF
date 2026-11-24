import { expect, test } from '@playwright/test'

test.describe('Survey & financial calculator', () => {
  test('renders the three survey modes', async ({ page }) => {
    await page.goto('/survey')
    await expect(page.getByRole('heading', { name: /Khảo sát & Máy tính tài chính/i })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Khảo sát vay' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Đầu tư / tích lũy' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tự nhập so sánh' })).toBeVisible()
  })

  test('switches to manual comparison inputs', async ({ page }) => {
    await page.goto('/survey')
    await page.getByRole('button', { name: 'Tự nhập so sánh' }).click()
    await expect(page.getByLabel(/Gói A.*Số tiền/i)).toBeVisible()
    await expect(page.getByLabel(/Gói B.*Lãi suất/i)).toBeVisible()
  })

  test('switches to investment inputs', async ({ page }) => {
    await page.goto('/survey')
    await page.getByRole('button', { name: 'Đầu tư / tích lũy' }).click()
    await expect(page.getByLabel(/Vốn ban đầu/i)).toBeVisible()
    await expect(page.getByLabel(/Góp thêm mỗi tháng/i)).toBeVisible()
  })
})
