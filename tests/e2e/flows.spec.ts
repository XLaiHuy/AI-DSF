import { expect, test } from '@playwright/test'
import type { ManualCompareRequest, ManualCompareResponse, SurveyInvestResponse, SurveyLoanRequest, SurveyLoanResponse } from '@fincopilot/shared-types'
import { amortizeLoan, compoundDca, effectiveLoanApr, openFundScenarioBands, simulateEarlySettlement } from '../../packages/financial-math/src'

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
    await expect(page.getByLabel('Gói B · Lãi suất năm (%)', { exact: true })).toBeVisible()
  })

  test('switches to investment inputs', async ({ page }) => {
    await page.goto('/survey')
    await page.getByRole('button', { name: 'Đầu tư / tích lũy' }).click()
    await expect(page.getByLabel(/Vốn ban đầu/i)).toBeVisible()
    await expect(page.getByLabel(/Góp thêm mỗi tháng/i)).toBeVisible()
  })
})

const loanSessionId = '90000000-0000-4000-8000-000000000001'
const manualSessionId = '90000000-0000-4000-8000-000000000002'
const investSessionId = '90000000-0000-4000-8000-000000000003'
const useCases = [
  ['UNSECURED_SALARY', '50 000 000', '24'],
  ['HOME_MORTGAGE', '1 000 000 000', '240'],
  ['AUTO_LOAN', '400 000 000', '60'],
  ['BUSINESS_WORKING_CAPITAL', '200 000 000', '12'],
  ['CONSUMER_FLAT_INSTALLMENT', '20 000 000', '12'],
] as const
const source = {
  institutionName: 'Ngân hàng mô phỏng',
  dataProvenance: 'WEB_REFERENCE',
  sourceUrl: 'https://example.test/product',
  effectiveDate: '2026-11-25',
  sourceLabel: 'Tham khảo từ nguồn công bố',
  rateType: 'FIXED',
} as const

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test('Survey offers, charts and history at ' + viewport.width + 'px', async ({ page }) => {
    await page.setViewportSize(viewport)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' || /width.*height.*chart|hydration/i.test(message.text())) errors.push(message.text())
    })
    const casesSeen: SurveyLoanRequest[] = []
    await page.route('**/api/v1/survey/loan', async (route) => {
      const input: SurveyLoanRequest = route.request().postDataJSON()
      casesSeen.push(input)
      const loan = amortizeLoan(input.principalVnd, '12', input.termMonths, 'DECLINING_PRINCIPAL')
      const stress = amortizeLoan(input.principalVnd, '14', input.termMonths, 'DECLINING_PRINCIPAL')
      const dti = { bestOfferDtiPct: '38.5', riskBand: 'MODERATE' as const, disposableCashflowVnd: '10000000', disclaimer: 'Kết quả ước tính.' }
      const result: SurveyLoanResponse = {
        sessionId: loanSessionId, aiExplanation: null, dtiAssessment: dti,
        trustFilterSummary: { totalLicensedFound: 1, blockedEntities: [] },
        offers: [{ ...source, productId: 'loan-1', productName: 'Khoản vay thử nghiệm', loanUseCase: input.loanUseCase,
          trustScore: 78, fitScore: 62, calcMethod: 'DECLINING_PRINCIPAL', nominalRatePct: '12', effectiveAprPct: '12',
          principalNetVnd: input.principalVnd, upfrontFeeVnd: '0', monthlyFeeVnd: '0',
          monthlyPaymentFirstVnd: loan.monthlyPaymentVnd, totalInterestAndFeesVnd: loan.totalInterestVnd,
          totalPayableVnd: loan.totalPayableVnd, dtiPct: '38.5', dtiAssessment: dti,
          schedule: loan.schedule, stressPaymentFirstVnd: stress.monthlyPaymentVnd, stressSchedule: stress.schedule }],
      }
      await route.fulfill({ json: result })
    })
    let savedManual: { inputParams: ManualCompareRequest; result: ManualCompareResponse } | undefined
    await page.route('**/api/v1/calculator/manual-compare', async (route) => {
      const inputParams: ManualCompareRequest = route.request().postDataJSON()
      const offers = inputParams.offers.map((offer) => {
        const calcMethod = offer.calcMethod ?? 'REDUCING_BALANCE'
        const monthlyFeeVnd = offer.monthlyFeeVnd ?? '0'
        const loan = amortizeLoan(offer.principalVnd, offer.annualRatePct, offer.termMonths, calcMethod, {
          monthlyFeeVnd, laterRate: offer.promoMonths != null && offer.floatingRatePct != null
            ? { afterMonths: offer.promoMonths, annualRatePct: offer.floatingRatePct } : undefined,
        })
        return { ...loan, label: offer.label, calcMethod, monthlyFeeVnd, principalNetVnd: offer.principalVnd,
          upfrontFeeVnd: '0', effectiveAprPct: effectiveLoanApr(offer.principalVnd, loan.schedule),
          earlySettlement: offer.earlySettlementMonth
            ? simulateEarlySettlement(offer.principalVnd, loan.schedule, offer.earlySettlementMonth, offer.earlySettlementFeePct ?? '0') : null }
      })
      savedManual = { inputParams, result: { sessionId: manualSessionId, offers } }
      await route.fulfill({ json: savedManual.result })
    })
    await page.route('**/api/v1/survey/sessions/' + manualSessionId, async (route) => {
      if (!savedManual) throw new Error('Manual calculation has not been saved')
      await route.fulfill({ json: { ...savedManual, id: manualSessionId, sessionMode: 'MANUAL_COMPARE', createdAt: '2026-11-25T12:00:00.000Z' } })
    })
    await page.route('**/api/v1/survey/investment', async (route) => {
      const bands = (month: number) => openFundScenarioBands('20000000', '3000000', month, '9', '0', '0.1')
      const scenarios = bands(12)
      const toScenario = (rate: string) => ({ annualReturnPct: rate, ...compoundDca('20000000', '3000000', 12, rate, '0', '0') })
      const result: SurveyInvestResponse = { sessionId: investSessionId, offers: [
        { ...source, productId: 'saving', productName: 'Tiết kiệm kỳ hạn', productCategory: 'SAVING', scenario: toScenario('5') },
        { ...source, productId: 'accumulation', productName: 'Tích lũy định kỳ', productCategory: 'ACCUMULATION', scenario: toScenario('6') },
        { ...source, productId: 'fund', productName: 'Quỹ trái phiếu', productCategory: 'OPEN_FUND', rateType: 'VARIABLE_NAV',
          scenario: scenarios.base, scenarios,
          projection: [0, 6, 12].map((month) => {
            const { base, conservative, optimistic } = bands(month)
            return { month, contributedVnd: base.totalContributedVnd, baseVnd: base.netValueVnd,
              conservativeVnd: conservative.netValueVnd, optimisticVnd: optimistic.netValueVnd }
          }),
        },
      ] }
      await route.fulfill({ json: result })
    })

    const submit = page.getByRole('button', { name: 'Tính và xem phương án' })
    const chart = (name: string) => page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) }).last()
    const noOverflow = () => expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.goto('/survey')
    const purpose = page.getByLabel('Mục đích vay')
    expect(await purpose.locator('option').count()).toBe(5)
    for (const [loanUseCase, amount, term] of useCases) {
      await purpose.selectOption(loanUseCase)
      await expect(page.getByLabel('Số tiền cần vay (VNĐ)')).toHaveValue(amount)
      await expect(page.getByLabel('Kỳ hạn (tháng)', { exact: true })).toHaveValue(term)
      await submit.click()
      await expect(page.getByText('Uy tín 78/100')).toBeVisible()
      await expect(page.getByText('Phù hợp hồ sơ 62/100')).toBeVisible()
      await expect(chart('Lịch trả nợ theo dòng tiền').locator('svg.recharts-surface')).toBeVisible()
    }
    expect(casesSeen.map(({ loanUseCase }) => loanUseCase)).toEqual(useCases.map(([loanUseCase]) => loanUseCase))
    await expect(chart('Lãi công bố và APR thực tế').locator('svg.recharts-surface')).toBeVisible()
    await expect(chart('Tỷ lệ trả nợ (DTI)').locator('svg.recharts-surface')).toBeVisible()
    await page.getByText('Xem bảng trả nợ tháng', { exact: true }).click()
    await expect(page.getByRole('table', { name: /Lịch trả nợ theo tháng/ })).toBeVisible()
    await noOverflow()

    await page.getByRole('button', { name: 'Tự nhập so sánh' }).click()
    const add = page.getByRole('button', { name: 'Thêm phương án' })
    await add.click()
    await add.click()
    await expect(add).toBeDisabled()
    await page.getByRole('button', { name: 'Xóa Gói D' }).click()
    await expect(add).toBeEnabled()
    await page.getByLabel('Gói A · Phương thức tính lãi').selectOption('FLAT_RATE')
    await page.getByLabel('Gói A · Phí quản lý mỗi tháng (VNĐ)').fill('25000')
    await page.getByText('Gói A · Ưu đãi và tất toán', { exact: true }).click()
    await page.getByLabel('Gói A · Số tháng ưu đãi').fill('3')
    await page.getByLabel('Gói A · Lãi suất sau ưu đãi (%/năm)').fill('18')
    await page.getByLabel('Gói A · Tháng tất toán trước hạn').fill('6')
    await page.getByLabel('Gói A · Phí tất toán (% dư nợ)').fill('2')
    await submit.click()
    await expect(page.getByRole('heading', { name: 'Tất toán vào tháng 6' })).toBeVisible()
    expect(savedManual?.inputParams.offers).toHaveLength(3)
    expect(savedManual?.inputParams.offers[0]).toMatchObject({
      calcMethod: 'FLAT_RATE', monthlyFeeVnd: '25000', promoMonths: 3, floatingRatePct: '18',
      earlySettlementMonth: 6, earlySettlementFeePct: '2',
    })
    await expect(chart('Lãi suất nhập và APR thực tế').locator('svg.recharts-surface')).toBeVisible()
    await noOverflow()

    await page.goto('/survey?sessionId=' + manualSessionId)
    await expect(page.getByRole('button', { name: 'Tự nhập so sánh' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('Gói A · Phí quản lý mỗi tháng (VNĐ)')).toHaveValue('25 000')
    await expect(page.getByLabel('Gói A · Tháng tất toán trước hạn')).toHaveValue('6')
    await expect(chart('Lịch trả nợ theo dòng tiền').locator('svg.recharts-surface')).toBeVisible()
    await noOverflow()

    await page.getByRole('button', { name: 'Đầu tư / tích lũy' }).click()
    await submit.click()
    await expect(page.getByRole('heading', { name: /Tiết kiệm kỳ hạn/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Tích lũy định kỳ/ })).toBeVisible()
    await page.getByRole('button', { name: 'Quỹ mở', exact: true }).click()
    await expect(page.getByRole('heading', { name: /Tiết kiệm kỳ hạn/ })).toHaveCount(0)
    const fund = page.locator('article').filter({ has: page.getByRole('heading', { name: /Quỹ trái phiếu/ }) })
    for (const label of ['Thận trọng', 'Cơ sở', 'Tích cực']) await expect(fund.getByText(new RegExp('^' + label))).toBeVisible()
    await expect(chart('Dự phóng tăng trưởng tài sản').locator('svg.recharts-surface')).toBeVisible()
    await noOverflow()
    expect(errors).toEqual([])
  })
}
