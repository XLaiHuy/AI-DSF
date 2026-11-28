'use client'

import {
  LoanCategory, SurveyRefinanceRequestSchema, SurveyRefinanceResponseSchema, SurveyRefinanceTermsSchema,
  type SurveyRefinanceContract, type SurveyRefinanceRequest, type SurveyRefinanceResponse,
} from '@fincopilot/shared-types'
import { useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useWorkspaceField } from '@/components/layout/WorkspaceSessionContext'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { stripSpacedAmount } from '@/components/ui/money-input'
import { apiClient } from '@/lib/api-client'
import { auditHref, formatVnd, requestError, surveyHistoryQuery } from '@/lib/workspace-data'
import { decimal, Field, fieldStyle, methodLabels, MoneyField } from './SurveyFields'

import { refinanceDraft } from './survey-session'

const RefinanceBreakEvenChart = dynamic(() => import('@/components/charts/RefinanceBreakEvenChart').then((module) => module.RefinanceBreakEvenChart), { ssr: false })
const categories = { UNSECURED_LOAN: 'Vay tín chấp', SECURED_LOAN: 'Vay có tài sản bảo đảm' } as const
const percent = (value: string) => value.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '').replace('.', ',') + '%/năm'

export function RefinanceWorkspace({ sourceAuditId, restored }: {
  sourceAuditId?: string; restored?: SurveyRefinanceResponse
}) {
  const [form, setForm] = useWorkspaceField('survey', 'refinanceForm')
  const [, setResults] = useWorkspaceField('survey', 'resultsByTab')
  const [loading, setLoading] = useState(Boolean(sourceAuditId && !restored))
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  const request = useRef<AbortController | null>(null)
  const queryClient = useQueryClient()
  const source = restored?.currentContract
  const offer = restored?.offers.find((item) => item.productId === selected) ?? restored?.offers[0]
  const edit = <K extends keyof typeof form>(key: K) => (value: typeof form[K]) => setForm((previous) => ({ ...previous, [key]: value }))

  const calculate = useCallback(async (input: SurveyRefinanceRequest, controller: AbortController) => {
    request.current = controller
    setLoading(true)
    setError('')
    try {
      const result = await apiClient.post('/survey/refinance', input, { schema: SurveyRefinanceResponseSchema, signal: controller.signal })
      if (controller.signal.aborted) return
      setResults(old => ({ ...old, refinance: result }))
      setForm(refinanceDraft(result.currentContract))
      setSelected('')
      if (result.meta.savedToHistory) void queryClient.invalidateQueries({ queryKey: surveyHistoryQuery.queryKey })
    } catch (failure) {
      if (!controller.signal.aborted) setError(requestError(failure, 'Chưa tính được phương án đổi khoản vay. Bạn có thể thử lại.'))
    } finally {
      if (request.current === controller && !controller.signal.aborted) {
        request.current = null
        setLoading(false)
      }
    }
  }, [queryClient, setForm, setResults])

  const loadedSource = restored?.currentContract.sourceAuditId
  useEffect(() => {
    const controller = new AbortController()
    if (sourceAuditId && sourceAuditId !== loadedSource) {
      queueMicrotask(() => {
        if (!controller.signal.aborted) void calculate({ sourceAuditId }, controller)
      })
    }
    return () => {
      controller.abort()
      request.current?.abort()
      request.current = null
    }
  }, [calculate, sourceAuditId, loadedSource])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (request.current) return
    const checked = SurveyRefinanceTermsSchema.safeParse({
      remainingPrincipalVnd: stripSpacedAmount(form.principal), remainingTermMonths: Number(form.months),
      currentAnnualRatePct: decimal(form.rate), currentCalcMethod: form.method,
      currentFlatInterestBaseVnd: form.method === 'FLAT_RATE' ? stripSpacedAmount(form.flatBase) || undefined : undefined,
      currentMonthlyFeeVnd: stripSpacedAmount(form.monthlyFee) || '0', earlySettlementFeePct: decimal(form.exitFee) || '0',
      productCategory: form.category, newTermMonths: form.newMonths ? Number(form.newMonths) : undefined,
    })
    if (!checked.success) {
      setError('Nhập số tiền còn nợ, lãi suất và kỳ hạn hợp lệ trước khi tính.')
      return
    }
    void calculate(SurveyRefinanceRequestSchema.parse({ ...checked.data, sourceAuditId: source?.sourceAuditId }), new AbortController())
  }

  return <section className="min-w-0 space-y-4" aria-label="Đổi khoản vay / Đảo nợ">
    {source?.sourceAuditId && <div className="rounded-xl border bg-accent/60 p-4 text-sm">
      <p className="font-semibold">Đã nạp hợp đồng từ Giám định</p>
      <p className="mt-1 [overflow-wrap:anywhere]">{source.claimedEntityName && <>{source.claimedEntityName} · </>}
        <Link className="underline" href={auditHref(source.sourceAuditId)}>Xem báo cáo nguồn</Link>
        {source.referenceAprPct && <> · Chi phí vay quy đổi {percent(source.referenceAprPct)}</>}
      </p>
      <p className="mt-2">Số tiền và kỳ hạn lấy từ hợp đồng. Kiểm tra dư nợ, số tháng còn lại và phí tất toán trước khi dùng kết quả.</p>
      {source.rateIsEstimate && <p className="mt-2 font-medium">Lãi suất hoặc cách tính lãi đang được ước tính từ báo cáo. Hãy đối chiếu các mục này với hợp đồng.</p>}
    </div>}
    <Card>
      <CardHeader><CardTitle>Khoản vay hiện tại</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <fieldset disabled={loading} className="grid min-w-0 gap-4 sm:grid-cols-2">
            <legend className="sr-only">Thông tin hợp đồng để so sánh</legend>
            <MoneyField id="refinance-principal" label="Số tiền gốc còn nợ (VNĐ)" value={form.principal} onChange={edit('principal')} />
            <Field id="refinance-term" label="Kỳ hạn còn lại (tháng)" value={form.months} onChange={edit('months')} term />
            <Field id="refinance-rate" label="Lãi suất hiện tại (%/năm)" value={form.rate} onChange={edit('rate')} />
            <label className="min-w-0 space-y-1.5 text-sm font-medium">Cách tính lãi
              <select className={fieldStyle} value={form.method} onChange={({ target }) => edit('method')(target.value as typeof form.method)}>
                {Object.entries(methodLabels).map(([method, label]) => <option key={method} value={method}>{label}</option>)}
              </select>
            </label>
            {form.method === 'FLAT_RATE' && <div className="space-y-1.5">
              <MoneyField id="refinance-flat-base" label="Số tiền vay ban đầu (VNĐ)" value={form.flatBase} onChange={edit('flatBase')} />
              <p className="text-xs text-muted-foreground">Lãi phẳng tính trên khoản vay ban đầu. Nếu bỏ trống, phép tính dùng phần gốc còn nợ.</p>
            </div>}
            <MoneyField id="refinance-monthly-fee" label="Phí mỗi tháng (VNĐ)" value={form.monthlyFee} onChange={edit('monthlyFee')} />
            <Field id="refinance-exit" label="Phí tất toán (% dư nợ)" value={form.exitFee} onChange={edit('exitFee')} />
            <label className="min-w-0 space-y-1.5 text-sm font-medium">Loại khoản vay mới
              <select className={fieldStyle} value={form.category} onChange={({ target }) => edit('category')(LoanCategory.parse(target.value))}>
                {Object.entries(categories).map(([category, label]) => <option key={category} value={category}>{label}</option>)}
              </select>
            </label>
            <Field id="refinance-new-term" label="Kỳ hạn mới (tháng, tùy chọn)" value={form.newMonths} onChange={edit('newMonths')} term optional />
            <Button type="submit" className="sm:col-span-2">{loading ? 'Đang đối chiếu…' : 'So sánh khoản vay'}</Button>
          </fieldset>
        </form>
      </CardContent>
    </Card>
    {loading && <p role="status" className="text-sm text-muted-foreground">Đang tính chi phí giữ và đổi khoản vay.</p>}
    {error && <p role="alert" className="rounded-xl border border-verdict-danger-border bg-verdict-danger-bg p-4 text-sm text-verdict-danger">{error}</p>}
    {restored && <Card>
      <CardHeader><CardTitle>Đối chiếu với ngân hàng có giấy phép</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm" aria-live="polite">{restored.bestOptionSummary}</p>
        {restored.offers.length > 0 && <p className="text-sm text-muted-foreground">Kết quả dựa trên lãi và phí trong danh mục. Hỏi ngân hàng về điều kiện dùng khoản vay mới để trả nợ cũ và mức lãi áp dụng cho bạn.</p>}
        {restored.meta.catalogStatus === 'CATALOG_UNAVAILABLE' && <p className="text-sm">Chưa kết nối được danh mục. Bạn có thể tính lại.</p>}
        {restored.meta.savedToHistory === false && <p role="status" className="text-sm">Kết quả chưa lưu được vào lịch sử.</p>}
        {!!restored.offers.length && <div role="group" aria-label="Gói vay ngân hàng" className="grid gap-2 sm:grid-cols-3">
          {restored.offers.map((item) => <Button type="button" key={item.productId} data-testid="refinance-bank"
            className="h-auto min-h-11 w-full whitespace-normal text-left [overflow-wrap:anywhere]"
            variant={offer?.productId === item.productId ? 'default' : 'outline'} aria-pressed={offer?.productId === item.productId}
            onClick={() => setSelected(item.productId)}>{item.institutionName}</Button>)}
        </div>}
        {offer && <RefinanceOffer key={offer.productId} offer={offer} contract={restored.currentContract} />}
      </CardContent>
    </Card>}
  </section>
}

function RefinanceOffer({ offer, contract }: {
  offer: SurveyRefinanceResponse['offers'][number]; contract: SurveyRefinanceContract
}) {
  const value = offer.result
  const rows = [
    ['Cách tính lãi', methodLabels[contract.currentCalcMethod], methodLabels[offer.calcMethod]],
    ['Lãi suất tính thử', percent(contract.currentAnnualRatePct), percent(offer.newAnnualRatePct)],
    ['Thời gian trả', contract.remainingTermMonths + ' tháng', offer.newTermMonths + ' tháng'],
    ['Kỳ trả đầu tiên', formatVnd(value.currentMonthlyPaymentVnd), formatVnd(value.newMonthlyPaymentVnd)],
    ['Tổng tiền trả theo lịch', formatVnd(value.currentTotalRemainingPayableVnd), formatVnd(value.newTotalPayableVnd)],
  ]
  const metrics = [
    ['Phí tất toán', formatVnd(value.earlySettlementPenaltyVnd)],
    ['Phí trả trước khoản mới', formatVnd(value.newUpfrontFeeVnd)],
    ['Chi phí chuyển đổi', formatVnd(value.totalSwitchCostVnd)],
    ['Tiết kiệm kỳ đầu tiên', formatVnd(value.monthlySavingsVnd)],
    ['Tổng tiền tiết kiệm ròng', formatVnd(value.netSavingsVnd)],
    ['Điểm hòa vốn', value.breakEvenMonth === null ? 'Không hòa vốn' : 'Hòa vốn sau ' + value.breakEvenMonth + ' tháng'],
  ]
  return <div className="space-y-4">
    <div className="text-sm [overflow-wrap:anywhere]">
      <h3 className="text-lg font-semibold">{offer.productName}</h3>
      <p className="mt-1 text-muted-foreground">{offer.sourceLabel} · Dữ liệu lưu ngày <time dateTime={offer.effectiveDate}>{offer.effectiveDate.split('-').reverse().join('/')}</time></p>
      <a href={offer.sourceUrl} target="_blank" rel="noreferrer" className="font-medium underline">Xem nguồn niêm yết</a>
      {offer.newLaterRate && <p className="mt-1">Sau {offer.newLaterRate.afterMonths} tháng, mô phỏng dùng mức {percent(offer.newLaterRate.annualRatePct)} công bố trong danh mục.</p>}
      {offer.rateType === 'FLOATING' && <p className="mt-1">Mô phỏng dùng mức thả nổi cao nhất trong khoảng lãi suất niêm yết.</p>}
    </div>
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {metrics.map(([label, amount]) => <div key={label} className="min-w-0 rounded-lg bg-muted/60 p-2.5">
        <dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold tabular-nums [overflow-wrap:anywhere]">{amount}</dd>
      </div>)}
    </dl>
    {value.breakEvenMonth === null && <p className="text-sm">Chưa nên đổi khoản vay theo số liệu đã nhập. Sau khi tính phí chuyển đổi, phương án này không tiết kiệm được.</p>}
    <table className="w-full table-fixed border-collapse text-left text-xs [overflow-wrap:anywhere] sm:text-sm">
      <caption className="pb-2 text-left font-semibold">So sánh hai lịch trả</caption>
      <thead><tr className="border-b"><th scope="col" className="py-2 pe-1">Khoản mục</th><th scope="col" className="py-2 pe-1">Giữ hợp đồng</th><th scope="col" className="py-2">Đổi khoản vay</th></tr></thead>
      <tbody>{rows.map(([label, before, after]) => <tr key={label} className="border-b align-top">
        <th scope="row" className="py-2 pe-1 font-medium">{label}</th><td className="py-2 pe-1">{before}</td><td className="py-2">{after}</td>
      </tr>)}</tbody>
    </table>
    <RefinanceBreakEvenChart points={value.comparisonPoints} month={value.breakEvenMonth} />
  </div>
}
