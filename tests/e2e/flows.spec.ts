import { expect, test } from '@playwright/test'

const articleId = '11111111-1111-4111-8111-111111111111'
const alertId = '22222222-2222-4222-8222-222222222222'
test('Luồng 1: Radar phân tích tin và chuyển cú sốc lãi suất sang Khảo sát', async ({ page }) => {
  await page.goto('/radar')
  const article = page.getByRole('link', { name: /NHNN điều chỉnh/ }).first()
  await expect(article).toHaveAttribute('href', '/radar/' + articleId)
  await page.goto('/radar/' + articleId)
  await page.getByRole('button', { name: 'Tin này có thể ảnh hưởng gì đến tôi?' }).click()
  await expect(page.getByText(/nhận định tổng quát/)).toBeVisible()
  await page.getByRole('link', { name: /Mô phỏng cú sốc lãi suất/ }).click()
  await expect(page).toHaveURL(/\/survey\?/)
  const query = new URL(page.url()).searchParams
  expect(query.get('shockDelta')).toBe('-1.0')
  expect(query.get('articleId')).toBe(articleId)
  await expect(page.getByText('-1.0 điểm phần trăm')).toBeVisible()
  await expect(page.getByLabel(/Cú sốc lãi suất từ Radar/)).toHaveValue('-1.0')
  await expect(page.getByRole('link', { name: 'Xem bài viết nguồn' })).toHaveAttribute('href', '/radar/' + articleId)
})

test('Luồng 2: cảnh báo Radar hiển thị threat_indicator và chuyển đối chiếu Giám định', async ({ page }) => {
  await page.goto('/radar')
  await page.getByRole('button', { name: 'Cảnh báo lừa đảo' }).click()
  const alert = page.getByRole('link', { name: /Mạo danh ngân hàng/ })
  const detailPath = '/radar/' + alertId + '?kind=alert'
  await expect(alert).toHaveAttribute('href', detailPath)
  await page.goto(detailPath)
  await expect(page.getByText('Đã xác minh', { exact: true })).toBeVisible()
  await expect(page.getByText('lỗi 102', { exact: true }).first()).toBeVisible()
  await page.getByRole('link', { name: /Đối chiếu trong Giám định/ }).click()
  await expect(page).toHaveURL(new RegExp(`/forensic\\?from=radar&alertId=${alertId}&indicator=`))
})

test('Luồng 3: kết quả Giám định chuyển số tiền và kỳ hạn sang Khảo sát', async ({ page }) => {
  const auditId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  await page.goto('/survey?mode=loan&amount=62000000&term=36&from=forensic&auditId=' + auditId)
  await expect(page.getByLabel('Số tiền cần vay (VNĐ)')).toHaveValue('62 000 000')
  await expect(page.getByLabel('Kỳ hạn (tháng)')).toHaveValue('36')
  await expect(page.getByRole('link', { name: 'Xem báo cáo nguồn' })).toHaveAttribute('href', '/forensic/' + auditId)
})

test('Luồng 4: Trust Filter chuyển tên tổ chức đáng ngờ sang Giám định', async ({ page }) => {
  await page.goto('/forensic?claimedEntity=Cong%20ty%20Tai%20chinh%20Gia%20mao&from=trust-filter')
  await expect(page.getByText('Đơn vị từ Bộ lọc Tin cậy: Cong ty Tai chinh Gia mao')).toBeVisible()
})

test.describe('Survey & financial calculator', () => {
  test('renders the three survey modes', async ({ page }) => {
    await page.goto('/survey')
    await expect(page.getByRole('heading', { name: 'Mình cùng tìm phương án phù hợp nhé' })).toBeVisible()
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
