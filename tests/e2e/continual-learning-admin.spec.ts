import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 844 }]) {
  test.describe(`Kiểm duyệt học liên tục · ${viewport.width}px`, () => {
    test.use({ viewport })

    test('hiển thị độ phủ, cảnh báo drift và duyệt góp ý', async ({ page }, info) => {
      const consoleErrors: string[] = []
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
      page.on('pageerror', error => consoleErrors.push(error.message))
      const report = {
        id: randomUUID(), auditId: randomUUID(), threatAlertId: null, feedbackType: 'FALSE_POSITIVE', highlightedSpan: null,
        sampleTextMasked: 'Người nhận đã được đối chiếu qua hợp đồng.',
        expectedVerdict: 'SAFE', adminNote: 'Khoản phí đã được ghi trong hợp đồng.',
        rndCategory: null, isActive: false, reviewStatus: 'PENDING', sourceChannel: 'USER_REPORT',
        createdAt: '2026-11-27T03:00:00Z',
      }
      const overview = {
        verifiedAlertsTotal: 25, verifiedAlertsWithEmbedding: 20, embeddingCoveragePct: 80,
        activeFewShotScam: 5, activeFewShotSafe: 2, activeTeencodeAliases: 3, activeIgnoreRules: 1,
        pendingCommunityProposals: 3, pendingUserFeedback: 1, embeddingModels: ['text-embedding-3-small'],
        drift: { windowSize: 200, sampledCount: 20, incorrectCount: 2, errorRatePct: 10, thresholdPct: 5, warning: true },
      }
      let decision: unknown
      await page.route('**/api/v1/auth/session', route => route.fulfill({ json: {
        kind: 'user', user: { id: randomUUID(), email: 'ops@example.test', displayName: 'Vận hành', authProvider: 'EMAIL', role: 'ADMIN' },
        oauthProviders: { google: false, github: false },
      } }))
      await page.route('**/api/v1/admin/**', route => {
        const url = new URL(route.request().url())
        const path = url.pathname
        if (path.endsWith('/feedback/' + report.id) && route.request().method() === 'PATCH') {
          decision = route.request().postDataJSON()
          report.reviewStatus = 'APPROVED'
          report.isActive = true
          overview.pendingUserFeedback = 0
          overview.activeFewShotSafe += 1
          return route.fulfill({ json: { id: report.id, isActive: true, reviewStatus: 'APPROVED' } })
        }
        if (path.endsWith('/learning/overview')) return route.fulfill({ json: overview })
        if (path.endsWith('/feedback') && url.searchParams.get('reviewStatus') === 'PENDING') {
          return route.fulfill({ json: report.reviewStatus === 'PENDING' ? [report] : [] })
        }
        if (path.endsWith('/feedback')) return route.fulfill({ json: [report] })
        if (path.endsWith('/crawl-status')) return route.fulfill({ json: { scheduled: true, nextAt: null } })
        if (path.endsWith('/rnd/summary')) return route.fulfill({ json: { total: 1, active: 1, byCategory: { FALSE_POSITIVE: 1 } } })
        return route.fulfill({ json: [] })
      })
      await page.goto('/admin')
      await expect(page.getByRole('heading', { name: 'Tổng quan Continual Learning' })).toBeVisible()
      await expect(page.getByText('20/25 cảnh báo đã xác minh')).toBeVisible()
      await expect(page.getByText(/2\/20 phản hồi báo sai/)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Kiểm thử R&D' })).toBeVisible()
      const approve = page.getByRole('button', { name: 'Duyệt & Học ngay' })
      await expect(approve).toBeVisible()
      await page.screenshot({ path: info.outputPath('admin-continual-learning.png'), fullPage: true })
      await approve.click()
      await expect(page.getByText('Đã duyệt góp ý.')).toBeVisible()
      await expect(page.getByText('Hàng chờ góp ý đã được xử lý.')).toBeVisible()
      expect(decision).toEqual({ reviewStatus: 'APPROVED' })
      await page.getByText('Phản hồi Giám định & Đề xuất R&D', { exact: true }).click()
      await expect(page.getByText('Đã duyệt', { exact: true })).toBeVisible()
      await expect(page.getByText('Người dùng', { exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
      expect(consoleErrors).toEqual([])
    })
  })
}
