'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  handoffRoutes, ManualCompareResponseSchema, SurveyInvestResponseSchema, SurveyLoanResponseSchema,
  SurveyTermMonthsSchema, type ManualCompareResponse, type SurveyInvestResponse,
  type SurveyLoanRequest, type SurveyLoanResponse, type parseSurveyHandoff,
} from '@fincopilot/shared-types'
import { AlertTriangle, Calculator, Loader2, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, TermInfo } from '@/components/ui'
import { MoneyInput, stripSpacedAmount } from '@/components/ui/money-input'
import { apiClient, ApiError } from '@/lib/api-client'
import { formatVnd, profileQuery, surveyHistoryQuery } from '@/lib/workspace-data'

type Handoff = ReturnType<typeof parseSurveyHandoff>
type Tab = 'loan' | 'invest' | 'manual'
type Result =
  | { tab: 'loan'; data: SurveyLoanResponse; amount: string; term: number }
  | { tab: 'invest'; data: SurveyInvestResponse }
  | { tab: 'manual'; data: ManualCompareResponse; amounts: string[]; term: number }

const tabs = [
  ['loan', 'Khảo sát vay'], ['invest', 'Đầu tư / tích lũy'], ['manual', 'Tự nhập so sánh'],
] as const
const priorities: Record<SurveyLoanRequest['priority'], string> = {
  LOWEST_APR: 'APR thấp nhất',
  LOWEST_MONTHLY_PAYMENT: 'Trả tháng thấp nhất',
  LOWEST_TOTAL_COST: 'Tổng chi phí thấp nhất',
}
const investmentLabels = { SAVING: 'Tiết kiệm', ACCUMULATION: 'Tích lũy', OPEN_FUND: 'Quỹ mở' }
const rateLabels = { FIXED: 'Cố định', FLOATING: 'Thả nổi', PROMO_THEN_FLOATING: 'Ưu đãi rồi thả nổi', VARIABLE_NAV: 'Biến động theo NAV' }
const fieldStyle = 'min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
const percent = (value: string) => value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value
const decimal = (value: string) => value.trim().replace(',', '.')
const hasHighApr = (value: string) => {
  const [whole, fraction = ''] = value.split('.')
  const integer = BigInt(whole)
  return integer > 20n || (integer === 20n && /[1-9]/.test(fraction))
}

export default function SurveyWorkspace({ handoff }: { handoff: Handoff }) {
  const [tab, setTab] = useState<Tab>(handoff.mode ?? 'loan')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const request = useRef<AbortController | null>(null)
  const queryClient = useQueryClient()
  const profile = useQuery(profileQuery).data?.profile
  const [form, setForm] = useState({
    principal: handoff.amount ?? '50000000', initial: '20000000', contribution: '3000000',
    loan: String(handoff.term ?? 24), invest: '12', manual: '24',
    manualA: '50000000', manualB: '50000000', rateA: '14.5', rateB: '16', feeA: '', feeB: '',
    entity: '', shock: handoff.shockDelta ?? '0',
  })
  const [category, setCategory] = useState<SurveyLoanRequest['productCategory']>('UNSECURED_LOAN')
  const [priority, setPriority] = useState<SurveyLoanRequest['priority']>('LOWEST_APR')
  const [dtiEdits, setDtiEdits] = useState<Partial<Record<'income' | 'expense' | 'debt', string>>>({})
  const income = dtiEdits.income ?? profile?.monthlyIncomeVnd ?? ''
  const expense = dtiEdits.expense ?? profile?.monthlyExpenseVnd ?? ''
  const debt = dtiEdits.debt ?? profile?.existingDebtPaymentVnd ?? ''
  const fromProfile = Boolean(profile && (
    dtiEdits.income === undefined && profile.monthlyIncomeVnd != null ||
    dtiEdits.expense === undefined && profile.monthlyExpenseVnd != null ||
    dtiEdits.debt === undefined && profile.existingDebtPaymentVnd != null
  ))
  const set = (key: keyof typeof form, value: string) => setForm((old) => ({ ...old, [key]: value }))

  useEffect(() => () => request.current?.abort(), [])

  function changeTab(next: Tab) {
    if (next === tab) return
    request.current?.abort()
    request.current = null
    setTab(next)
    setLoading(false)
    setError('')
    setResult(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (request.current) return
    const term = SurveyTermMonthsSchema.safeParse(Number(form[tab]))
    if (!term.success) { setError('Nhập kỳ hạn nguyên từ 1 đến 600 tháng.'); return }
    if (tab === 'loan' && [income, expense, debt].some(Boolean) && ![income, expense, debt].every(Boolean)) {
      setError('Nhập đủ thu nhập, chi phí và khoản trả nợ để tính DTI. Nhập 0 nếu không phát sinh.')
      return
    }
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    setResult(null)
    const { signal } = controller
    try {
      let next: Result
      if (tab === 'loan') {
        const amount = stripSpacedAmount(form.principal)
        const data = await apiClient.post('/survey/loan', {
          principalVnd: amount, termMonths: term.data, productCategory: category, priority,
          checkEntityName: form.entity.trim() || undefined, rateShockDeltaPct: decimal(form.shock) || undefined,
          sourceArticleId: handoff.articleId, sourceAuditId: handoff.auditId,
          dtiOverride: income && expense && debt ? {
            monthlyIncomeVnd: stripSpacedAmount(income), monthlyExpenseVnd: stripSpacedAmount(expense),
            existingDebtPaymentVnd: stripSpacedAmount(debt),
          } : undefined,
        }, { schema: SurveyLoanResponseSchema, signal })
        next = { tab, data, amount, term: term.data }
      } else if (tab === 'invest') {
        const data = await apiClient.post('/survey/investment', {
          initialVnd: stripSpacedAmount(form.initial), monthlyContributionVnd: stripSpacedAmount(form.contribution),
          termMonths: term.data,
        }, { schema: SurveyInvestResponseSchema, signal })
        next = { tab, data }
      } else {
        const offers = [
          ['Gói A', form.manualA, form.rateA, form.feeA],
          ['Gói B', form.manualB, form.rateB, form.feeB],
        ].map(([label, principal, rate, fee]) => ({
          label, principalVnd: stripSpacedAmount(principal), annualRatePct: decimal(rate), termMonths: term.data,
          upfrontFeeVnd: fee ? stripSpacedAmount(fee) : undefined,
        }))
        const data = await apiClient.post('/calculator/manual-compare', { offers }, { schema: ManualCompareResponseSchema, signal })
        next = { tab, data, amounts: offers.map(({ principalVnd }) => principalVnd), term: term.data }
      }
      if (request.current !== controller || signal.aborted) return
      setResult(next)
      if (next.data.meta?.savedToHistory) void queryClient.invalidateQueries({ queryKey: surveyHistoryQuery.queryKey })
    } catch (failure) {
      if (request.current !== controller || signal.aborted) return
      if (failure instanceof ApiError && failure.errorCode === 'ERR_TRUST_FILTER_BLOCKED' && form.entity.trim()) {
        window.location.assign(handoffRoutes.trustFilterToForensic({ claimedEntity: form.entity.trim() }))
      }
      setError(failure instanceof ApiError ? failure.message : 'Không thể tải kết quả tính toán.')
    } finally {
      if (request.current === controller) {
        request.current = null
        setLoading(false)
      }
    }
  }

  return <main className="mx-auto max-w-6xl space-y-6">
    <header><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Mình cùng tìm phương án phù hợp nhé</h1></header>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.65fr)]">
      <div className="min-w-0 space-y-4">
        <div className="grid grid-cols-3 rounded-xl border border-border bg-card p-1">
          {tabs.map(([id, label]) => <button type="button" key={id} aria-pressed={tab === id}
            onClick={() => changeTab(id)}
            className={`rounded-lg px-2 py-3 text-sm font-semibold ${tab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{label}</button>)}
        </div>
        <form className="space-y-4" onSubmit={submit}>
          {tab === 'loan' && <>
            {(handoff.shockDelta != null || handoff.articleId) && <p role="status" className="rounded-xl border border-border bg-accent/50 p-4 text-sm">
              Đã nhận cú sốc lãi suất từ Radar{handoff.shockDelta != null && <> · <strong>{handoff.shockDelta} điểm phần trăm</strong></>}
              {handoff.articleId && <> · <Link className="underline" href={'/radar/' + handoff.articleId}>Xem bài viết nguồn</Link></>}
            </p>}
            {handoff.auditId && <p role="status" className="rounded-xl border border-border bg-accent/50 p-4 text-sm">
              Đã nạp số tiền và kỳ hạn từ Giám định · <Link className="underline" href={'/forensic/' + handoff.auditId}>Xem báo cáo nguồn</Link>
            </p>}
            <div className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm font-medium">Loại khoản vay
                <select className={fieldStyle} value={category} onChange={({ target }) => setCategory(target.value === 'SECURED_LOAN' ? 'SECURED_LOAN' : 'UNSECURED_LOAN')}>
                  <option value="UNSECURED_LOAN">Vay tín chấp</option>
                  <option value="SECURED_LOAN">Vay thế chấp</option>
                </select>
              </label>
              <label className="space-y-1.5 text-sm font-medium">Ưu tiên xếp hạng
                <select className={fieldStyle} value={priority} onChange={({ target }) => setPriority(target.value as SurveyLoanRequest['priority'])}>
                  {Object.entries(priorities).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
            </div>
          </>}
          <Card>
            <CardHeader><CardTitle>{tab === 'loan' ? 'Bạn đang cần vay bao nhiêu?' : tab === 'invest' ? 'Mục tiêu tích lũy của bạn' : 'Nhập hai phương án muốn so sánh'}</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {tab === 'loan' && <>
                <MoneyField id="survey-principal" label="Số tiền cần vay (VNĐ)" value={form.principal} onChange={(v) => set('principal', v)} />
                <Field id="survey-loan-term" label="Kỳ hạn (tháng)" value={form.loan} onChange={(v) => set('loan', v)} term />
                {fromProfile && <p className="sm:col-span-2 text-sm text-muted-foreground" role="status">Đã nạp từ Hồ sơ cá nhân</p>}
                <MoneyField id="survey-income" label="Thu nhập mỗi tháng (VNĐ)" value={income} onChange={(v) => setDtiEdits((old) => ({ ...old, income: v }))} />
                <MoneyField id="survey-expense" label="Chi phí sinh hoạt (VNĐ)" value={expense} onChange={(v) => setDtiEdits((old) => ({ ...old, expense: v }))} />
                <MoneyField id="survey-debt" label="Nợ phải trả hiện tại (VNĐ)" value={debt} onChange={(v) => setDtiEdits((old) => ({ ...old, debt: v }))} />
                <Field id="survey-shock" label="Cú sốc lãi suất từ Radar (điểm phần trăm)" value={form.shock} onChange={(v) => set('shock', v)} />
                <div className="sm:col-span-2"><Field id="survey-entity" label="Tên ngân hàng / tổ chức cần kiểm tra" value={form.entity} onChange={(v) => set('entity', v)} /></div>
              </>}
              {tab === 'invest' && <>
                <MoneyField id="survey-initial" label="Vốn ban đầu (VNĐ)" value={form.initial} onChange={(v) => set('initial', v)} />
                <MoneyField id="survey-contribution" label="Góp thêm mỗi tháng (VNĐ)" value={form.contribution} onChange={(v) => set('contribution', v)} />
                <Field id="survey-invest-term" label="Thời gian (tháng)" value={form.invest} onChange={(v) => set('invest', v)} term />
              </>}
              {tab === 'manual' && <>
                {(['A', 'B'] as const).map((letter) => <fieldset key={letter} className="space-y-3 rounded-xl border p-3">
                  <legend className="px-1 font-semibold">Gói {letter}</legend>
                  <MoneyField id={'manual-principal-' + letter} label={`Gói ${letter} · Số tiền (VNĐ)`} value={form['manual' + letter as 'manualA' | 'manualB']} onChange={(v) => set(letter === 'A' ? 'manualA' : 'manualB', v)} />
                  <Field id={'manual-rate-' + letter} label={`Gói ${letter} · Lãi suất năm (%)`} value={letter === 'A' ? form.rateA : form.rateB} onChange={(v) => set(letter === 'A' ? 'rateA' : 'rateB', v)} />
                  <MoneyField id={'manual-fee-' + letter} label={`Gói ${letter} · Phí trả trước (VNĐ)`} value={letter === 'A' ? form.feeA : form.feeB} onChange={(v) => set(letter === 'A' ? 'feeA' : 'feeB', v)} />
                </fieldset>)}
                <Field id="survey-manual-term" label="Kỳ hạn chung (tháng)" value={form.manual} onChange={(v) => set('manual', v)} term />
              </>}
              <Button type="submit" className="sm:col-span-2" size="lg" disabled={loading}>
                {loading ? <Loader2 className="animate-spin" size={17} aria-hidden="true" /> : <Calculator size={17} aria-hidden="true" />}
                {loading ? 'Đang tính…' : 'Tính và xem phương án'}
              </Button>
            </CardContent>
          </Card>
        </form>
        {error && <p role="alert" className="rounded-xl border border-verdict-danger-border bg-verdict-danger-bg p-4 text-sm text-verdict-danger">{error}</p>}
        {result?.data.meta?.savedToHistory === false && <p role="status" className="text-sm text-muted-foreground">Kết quả chưa lưu được vào lịch sử.</p>}
        {result && <Results result={result} />}
      </div>
      <aside><Card className="bg-accent/50">
        <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck size={19} className="text-primary" />Nguồn được kiểm tra</CardTitle></CardHeader>
        <CardContent className="text-sm leading-relaxed text-muted-foreground">
          Danh mục ưu tiên nguồn có bằng chứng về sản phẩm và mức lãi. Bạn có thể mở <Link className="font-semibold text-primary underline" href="/forensic">Giám định</Link> để kiểm tra tổ chức hoặc hợp đồng cụ thể.
        </CardContent>
      </Card></aside>
    </div>
  </main>
}

function Field({ id, label, value, onChange, term }: {
  id: string; label: string; value: string; onChange: (value: string) => void; term?: boolean
}) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>
    <Input id={id} value={value} onChange={(event) => onChange(event.target.value)}
      type={term ? 'number' : 'text'} inputMode={term ? 'numeric' : 'decimal'}
      min={term ? 1 : undefined} max={term ? 600 : undefined} step={term ? 1 : undefined} required={term} />
  </div>
}

function MoneyField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>
    <MoneyInput id={id} value={value} onAmountChange={onChange} integerOnly />
  </div>
}

function Results({ result }: { result: Result }) {
  if (!result.data.offers.length) {
    const status = result.tab === 'manual' ? undefined : result.data.meta?.catalogStatus
    const message = status === 'CATALOG_UNAVAILABLE' ? 'Kho sản phẩm tạm thời không kết nối được.'
      : status === 'EMPTY_CATALOG' ? 'Danh mục hiện chưa có sản phẩm đang dùng trong nhóm này.'
        : 'Chưa có gói phù hợp với số tiền và kỳ hạn đã nhập.'
    return <p role="status" className="rounded-xl border border-border bg-card p-5 text-sm">{message}</p>
  }
  if (result.tab === 'invest') return <InvestmentResults data={result.data} />
  if (result.tab === 'manual') return <ManualResults result={result} />
  return <LoanResults result={result} />
}

function HighAprLink({ apr, amount, term, label }: { apr: string; amount: string; term: number; label: string }) {
  if (!hasHighApr(apr)) return null
  return <p className="flex flex-wrap items-center gap-2 pt-2 text-sm">
    <AlertTriangle aria-hidden="true" size={16} className="text-verdict-warning" />
    <Link className="font-semibold text-primary underline" href={handoffRoutes.surveyHighAprToForensic({
      amount, term, annualRatePct: apr, label: label.slice(0, 200),
    })}>Kiểm tra phương án APR trên 20% trong Giám định</Link>
  </p>
}

function LoanResults({ result }: { result: Extract<Result, { tab: 'loan' }> }) {
  const [open, setOpen] = useState(0)
  const { data, amount, term } = result
  const offer = data.offers[open]
  const dti = offer.dtiAssessment
  return <div className="space-y-4">
    <Card><CardHeader><CardTitle>Phương án từ danh mục</CardTitle>
      <CardDescription>Ưu tiên độ tin cậy của nguồn, sau đó xếp theo tiêu chí chi phí bạn chọn.</CardDescription></CardHeader>
      <CardContent className="space-y-3">{data.offers.map((item, index) => <div key={item.productId}
        className={`rounded-xl border p-4 ${open === index ? 'border-primary bg-accent/50' : 'border-border'}`}>
        <button type="button" aria-pressed={open === index} onClick={() => setOpen(index)} className="flex w-full flex-wrap justify-between gap-2 rounded text-left">
          <span><strong>{item.institutionName}</strong><span className="block text-sm text-muted-foreground">{item.productName}</span></span>
          <strong>{formatVnd(item.monthlyPaymentFirstVnd)} <span className="text-xs font-normal">tháng đầu</span></strong>
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span>APR <TermInfo term="APR" /> <strong>{percent(item.effectiveAprPct)}%</strong></span>
          <span>Tổng chi phí {formatVnd(item.totalInterestAndFeesVnd)}</span>
          <Badge variant="outline">{rateLabels[item.rateType]}</Badge>
          <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline">{item.sourceLabel}</a>
        </div>
        {item.rateAssumption && <p className="mt-2 text-xs text-muted-foreground">{item.rateAssumption}</p>}
        <HighAprLink apr={item.effectiveAprPct} amount={amount} term={term} label={item.productName} />
      </div>)}</CardContent>
    </Card>
    <Card><CardHeader><CardTitle>Lịch trả nợ của phương án đang chọn</CardTitle><CardDescription>{offer.productName}</CardDescription></CardHeader>
      <CardContent>
        <dl className="mb-4 grid gap-3 sm:grid-cols-3">
          <Metric label="Tiền thực nhận" value={formatVnd(offer.principalNetVnd)} />
          <Metric label="Phí trả trước" value={formatVnd(offer.upfrontFeeVnd)} />
          <Metric label="Tổng trả theo lịch" value={formatVnd(offer.totalPayableVnd)} />
        </dl>
        <div className="overflow-x-auto rounded-xl border border-border" tabIndex={0} role="region" aria-label="Lịch trả nợ theo tháng">
          <table className="w-full min-w-[580px] text-right text-sm">
            <thead className="bg-muted/60"><tr>{['Tháng', 'Khoản trả', 'Gốc', 'Lãi', 'Phí', 'Dư nợ'].map((label) => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead>
            <tbody>{offer.schedule.map((row) => <tr key={row.month} className="border-t border-border">
              <th scope="row" className="p-2">{row.month}</th>
              {[row.paymentVnd, row.principalVnd, row.interestVnd, row.feeVnd ?? '0', row.remainingBalanceVnd].map((value, i) => <td key={i} className="p-2">{formatVnd(value)}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
      </CardContent>
    </Card>
    {dti && <Card><CardHeader><CardTitle>Khả năng trả nợ · DTI <TermInfo term="DTI" /></CardTitle>
      <CardDescription>{offer.productName}</CardDescription></CardHeader>
      <CardContent><dl className="grid gap-3 sm:grid-cols-2">
        <Metric label="Tỷ lệ trả nợ" value={dti.bestOfferDtiPct === null ? 'Chưa xác định với thu nhập hiện có' : percent(dti.bestOfferDtiPct) + '%'} />
        <Metric label="Dòng tiền còn lại mỗi tháng" value={formatVnd(dti.disposableCashflowVnd)} />
      </dl><p className="mt-2 text-xs text-muted-foreground">{dti.disclaimer}</p></CardContent>
    </Card>}
    {data.aiExplanation && <Card><CardHeader><CardTitle>{data.meta?.degradedMode ? 'Nhận xét từ kết quả tính' : 'Nhận xét và đánh đổi từ AI'}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm"><p>{data.aiExplanation.summary}</p>
        <ul className="list-disc space-y-1 ps-5">{[...data.aiExplanation.tradeoffs, ...(data.aiExplanation.warnings ?? [])].map((item, i) => <li key={i}>{item}</li>)}</ul>
      </CardContent>
    </Card>}
  </div>
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-muted/60 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-semibold">{value}</dd></div>
}

function InvestmentResults({ data }: { data: SurveyInvestResponse }) {
  return <Card><CardHeader><CardTitle>So sánh đầu tư và tích lũy</CardTitle></CardHeader>
    <CardContent className="space-y-3">{data.offers.map(({ productId, productName, productCategory, sourceLabel, sourceUrl, scenario }) =>
      <article key={productId} className="space-y-3 rounded-xl border p-4">
        <Badge variant="outline">{investmentLabels[productCategory]}</Badge>
        <h3 className="font-semibold">{productName} · {percent(scenario.annualReturnPct)}%/năm</h3>
        <dl className="grid gap-2 sm:grid-cols-3">
          <Metric label="Tiền mình góp" value={formatVnd(scenario.totalContributedVnd)} />
          <Metric label="Lãi ròng" value={formatVnd(scenario.netProfitVnd)} />
          <Metric label="Giá trị cuối kỳ" value={formatVnd(scenario.netValueVnd)} />
        </dl>
        <p className="text-sm text-muted-foreground">{sourceLabel} <a href={sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline">Xem nguồn</a></p>
      </article>)}</CardContent>
  </Card>
}

function ManualResults({ result }: { result: Extract<Result, { tab: 'manual' }> }) {
  return <Card><CardHeader><CardTitle>So sánh số liệu bạn nhập</CardTitle>
    <CardDescription>Tính theo dư nợ giảm dần. Phí trả trước được khấu trừ khi giải ngân.</CardDescription></CardHeader>
    <CardContent className="grid gap-3 sm:grid-cols-2">{result.data.offers.map((offer, i) => <article className="space-y-3 rounded-xl border p-3" key={i}>
      <h3 className="font-semibold">{offer.label}</h3><dl className="grid gap-2">
        <Metric label="Tiền thực nhận" value={formatVnd(offer.principalNetVnd)} />
        <Metric label="Phí trả trước" value={formatVnd(offer.upfrontFeeVnd)} />
        <Metric label="Khoản trả tháng đầu" value={formatVnd(offer.monthlyPaymentVnd)} />
        <Metric label="Tổng trả theo lịch" value={formatVnd(offer.totalPayableVnd)} />
        <Metric label="APR" value={percent(offer.effectiveAprPct) + '%'} />
      </dl>
      <HighAprLink apr={offer.effectiveAprPct} amount={result.amounts[i]} term={result.term} label={offer.label} />
    </article>)}</CardContent>
  </Card>
}
