import { expect, test } from '@playwright/test'

const articleId = '11111111-1111-4111-8111-111111111111'
const alertId = '22222222-2222-4222-8222-222222222222'
test('Luồng 1: Radar phân tích tin và chuyển cú sốc lãi suất sang Khảo sát', async ({ page }) => {
  await page.goto('/radar')
  await page.getByRole('link', { name: /NHNN điều chỉnh/ }).click()
  await page.getByRole('button', { name: /Phân tích bằng AI/ }).click()
  await expect(page.getByText(/nhận định tổng quát/)).toBeVisible()
  await page.getByRole('link', { name: /Mở trong Khảo sát/ }).click()
  await expect(page).toHaveURL(/\/survey\?.*shockDelta=-1.0.*articleId=/)
  await expect(page.getByText('-1.0 điểm phần trăm')).toBeVisible()
})

test('Luồng 2: cảnh báo Radar hiển thị threat_indicator và chuyển đối chiếu Giám định', async ({ page }) => {
  await page.goto('/radar')
  await page.getByRole('button', { name: 'Cảnh báo lừa đảo' }).click()
  await page.getByRole('link', { name: /Mạo danh ngân hàng/ }).click()
  await expect(page.getByText('Chưa xác minh')).toBeVisible()
  await expect(page.getByText('lỗi 102')).toBeVisible()
  await page.getByRole('link', { name: /Đối chiếu trong Giám định/ }).click()
  await expect(page).toHaveURL(new RegExp(`/forensic\\?from=radar&alertId=${alertId}&indicator=`))
})

test('Luồng 3: kết quả Giám định chuyển số tiền và kỳ hạn sang Khảo sát', async ({ page }) => {
  await page.goto('/survey?mode=loan&amount=50000000&term=24&from=forensic&auditId=audit-demo')
  await expect(page.getByText('Đã nhận tham số URL Handoff')).toBeVisible()
  await expect(page.getByText('50000000 VND')).toBeVisible()
  await expect(page.getByText('24 tháng')).toBeVisible()
  await expect(page.getByText('audit-demo')).toBeVisible()
})

test('Luồng 4: Trust Filter chuyển tên tổ chức đáng ngờ sang Giám định', async ({ page }) => {
  await page.goto('/forensic?claimedEntity=Cong%20ty%20Tai%20chinh%20Gia%20mao&from=trust-filter')
  await expect(page.getByText('Đã nhận yêu cầu kiểm tra đơn vị từ Bộ lọc Tin cậy')).toBeVisible()
  await expect(page.getByText('Cong ty Tai chinh Gia mao')).toBeVisible()
  await expect(page.getByText('Bộ lọc tin cậy (Khảo sát)')).toBeVisible()
})

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
