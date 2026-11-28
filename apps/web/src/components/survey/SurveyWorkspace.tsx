'use client'

import { formatCatalogDate, freshnessLabels } from '@/lib/catalog-provenance'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  handoffRoutes, LoanUseCase, ManualCompareRequestSchema, ManualCompareResponseSchema, SurveyInvestResponseSchema, SurveyLoanResponseSchema,
  SurveySessionDetailResponseSchema, SurveyTermMonthsSchema, type SurveyLoanRequest, type parseSurveyHandoff,
} from '@fincopilot/shared-types'
import Decimal from 'decimal.js'
import { AlertTriangle, Calculator, Loader2, ShieldCheck } from 'lucide-react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, TermInfo } from '@/components/ui'
import { stripSpacedAmount } from '@/components/ui/money-input'
import { validChartAmount } from '@/components/charts/chart-math'
import { apiClient, ApiError } from '@/lib/api-client'
import { formatInvestmentReturn, formatRate } from '@/lib/financial-format'
import { formatVnd, profileQuery, surveyHistoryQuery } from '@/lib/workspace-data'
import { decimal, Field, fieldStyle, manualDraft, manualInput, ManualOfferFields, methodLabels, MoneyField } from './SurveyFields'

import { useWorkspaceField, useWorkspaceSession } from '@/components/layout/WorkspaceSessionContext'
import { investmentLabels, refinanceDraft, type InvestmentFilter, type SurveyResult as Result, type SurveyTab as Tab } from './survey-session'
import { RefinanceWorkspace } from './RefinanceWorkspace'

const InvestmentGrowthChart = dynamic(() => import('@/components/charts/InvestmentGrowthChart').then(module => module.InvestmentGrowthChart), { ssr: false })
const LoanAmortizationChart = dynamic(() => import('@/components/charts/LoanAmortizationChart').then(module => module.LoanAmortizationChart), { ssr: false })
const LoanAprDtiChart = dynamic(() => import('@/components/charts/LoanAprDtiChart').then(module => module.LoanAprDtiChart), { ssr: false })

type Handoff = ReturnType<typeof parseSurveyHandoff>
const tabs = [
  ['loan', 'Khảo sát vay'], ['invest', 'Đầu tư / tích lũy'], ['manual', 'Tự nhập so sánh'], ['refinance', 'Đổi khoản vay / Đảo nợ'],
] as const
const manualPresets = [
  {
    label: 'So sánh Dư nợ giảm dần 14,5% vs Lãi phẳng 12% + phí 1 tr',
    offers: [manualDraft(0), { ...manualDraft(1), annualRatePct: '12', calcMethod: 'FLAT_RATE' as const, upfrontFeeVnd: '1000000' }],
  },
  {
    label: 'Cố định 9% vs Ưu đãi 6,5% rồi thả nổi 11%',
    offers: [
      { ...manualDraft(0), principalVnd: '500000000', termMonths: '120', annualRatePct: '9' },
      { ...manualDraft(1), principalVnd: '500000000', termMonths: '120', annualRatePct: '6.5', promoMonths: '12', floatingRatePct: '11' },
    ],
  },
]
const priorities: Record<SurveyLoanRequest['priority'], string> = {
  LOWEST_APR: 'APR thấp nhất',
  LOWEST_MONTHLY_PAYMENT: 'Trả tháng thấp nhất',
  LOWEST_TOTAL_COST: 'Tổng chi phí thấp nhất',
}
const investmentFilters = [['ALL', 'Tất cả'], ['SAVING', 'Tiết kiệm'], ['ACCUMULATION', 'Tích lũy'], ['OPEN_FUND', 'Quỹ mở']] as const
const loanDefaults = {
  UNSECURED_SALARY: { range: '6–60', label: 'Vay tín chấp theo lương', amount: '50000000', term: '24', category: 'UNSECURED_LOAN' },
  HOME_MORTGAGE: { range: '12–420', label: 'Vay mua nhà', amount: '1000000000', term: '240', category: 'SECURED_LOAN' },
  AUTO_LOAN: { range: '12–96', label: 'Vay mua ô tô', amount: '400000000', term: '60', category: 'SECURED_LOAN' },
  BUSINESS_WORKING_CAPITAL: { range: '1–12', label: 'Vay bổ sung vốn kinh doanh', amount: '200000000', term: '12', category: 'SECURED_LOAN' },
  CONSUMER_FLAT_INSTALLMENT: { range: '6–36', label: 'Vay trả góp tiêu dùng', amount: '20000000', term: '12', category: 'UNSECURED_LOAN' },
} satisfies Record<LoanUseCase, { range: string; label: string; amount: string; term: string; category: SurveyLoanRequest['productCategory'] }>
const rateLabels = { FIXED: 'Cố định', FLOATING: 'Thả nổi', PROMO_THEN_FLOATING: 'Ưu đãi rồi thả nổi', VARIABLE_NAV: 'Biến động theo NAV' }
const percent = (value: string) => value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value
const hasHighApr = (value: string) => {
  if (!validChartAmount(value)) return false
  const [whole, fraction = ''] = value.split('.')
  const integer = BigInt(whole)
  return integer > 20n || (integer === 20n && /[1-9]/.test(fraction))
}

export default function SurveyWorkspace({ handoff }: { handoff: Handoff }) {
  const { update } = useWorkspaceSession()
  const [tab, setTab] = useWorkspaceField('survey', 'tab')
  const [form, setForm] = useWorkspaceField('survey', 'form')
  const [category, setCategory] = useWorkspaceField('survey', 'category')
  const [loanUseCase, setLoanUseCase] = useWorkspaceField('survey', 'loanUseCase')
  const [source, setSource] = useWorkspaceField('survey', 'source')
  const [touched, setTouched] = useWorkspaceField('survey', 'touched')
  const [priority, setPriority] = useWorkspaceField('survey', 'priority')
  const [investmentFilter, setInvestmentFilter] = useWorkspaceField('survey', 'investmentFilter')
  const [manualOffers, setManualOffers] = useWorkspaceField('survey', 'manualOffers')
  const [dtiEdits, setDtiEdits] = useWorkspaceField('survey', 'dtiEdits')
  const [resultsByTab, setResultsByTab] = useWorkspaceField('survey', 'resultsByTab')
  const [refinanceSourceAuditId, setRefinanceSourceAuditId] = useWorkspaceField('survey', 'refinanceSourceAuditId')
  const [, setRefinanceForm] = useWorkspaceField('survey', 'refinanceForm')
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(Boolean(handoff.sessionId))
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const queryClient = useQueryClient()
  const profile = useQuery(profileQuery).data?.profile
  const result = tab === 'refinance' ? undefined : resultsByTab[tab]
  const setResult = useCallback((next: Result) => setResultsByTab(old => ({ ...old, [next.tab]: next })), [setResultsByTab])
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

  useEffect(() => {
    const { mode, sessionId, auditId, articleId, amount, term, shockDelta } = handoff
    if (sessionId || (!mode && !auditId && !articleId && !amount && term == null && shockDelta == null)) return
    update('survey', previous => {
      const tab = mode ?? 'loan'
      if (tab === 'refinance' && auditId && auditId !== previous.refinanceSourceAuditId) {
        return { ...previous, tab, refinanceSourceAuditId: auditId, refinanceForm: refinanceDraft(),
          resultsByTab: { ...previous.resultsByTab, refinance: undefined } }
      }
      if (tab === 'invest' && (amount || term != null)) {
        return { ...previous, tab,
          form: { ...previous.form, initial: amount ?? previous.form.initial, invest: term == null ? previous.form.invest : String(term) },
          resultsByTab: { ...previous.resultsByTab, invest: undefined } }
      }
      if (tab === 'loan' && (amount || term != null || auditId || articleId || shockDelta != null)) {
        return { ...previous, tab, loanUseCase: amount || auditId ? '' : previous.loanUseCase,
          source: { sourceArticleId: articleId, sourceAuditId: auditId },
          touched: { amount: Boolean(amount) || previous.touched.amount, term: term != null || previous.touched.term },
          form: { ...previous.form, principal: amount ?? previous.form.principal,
            loan: term == null ? previous.form.loan : String(term), shock: shockDelta ?? '0' },
          resultsByTab: { ...previous.resultsByTab, loan: undefined } }
      }
      return { ...previous, tab }
    })
  }, [handoff, update])

  useEffect(() => {
    if (!handoff.sessionId) return
    const controller = new AbortController()
    apiClient.get('/survey/sessions/' + encodeURIComponent(handoff.sessionId), {
      schema: SurveySessionDetailResponseSchema, signal: controller.signal,
    }).then((saved) => {
      if (controller.signal.aborted) return
      if (saved.sessionMode === 'LOAN_SURVEY') {
        const input = saved.inputParams
        setTab('loan')
        setLoanUseCase(input.loanUseCase ?? '')
        setCategory(input.productCategory)
        setPriority(input.priority)
        setSource({ sourceArticleId: input.sourceArticleId, sourceAuditId: input.sourceAuditId })
        setTouched({ amount: true, term: true })
        setForm((old) => ({ ...old, principal: input.principalVnd, loan: String(input.termMonths),
          shock: input.rateShockDeltaPct ?? '0', entity: input.checkEntityName ?? '' }))
        setDtiEdits({ income: input.dtiOverride?.monthlyIncomeVnd ?? '', expense: input.dtiOverride?.monthlyExpenseVnd ?? '',
          debt: input.dtiOverride?.existingDebtPaymentVnd ?? '' })
        setResult({ tab: 'loan', data: saved.result, term: input.termMonths, amount: input.principalVnd })
      } else if (saved.sessionMode === 'INVESTMENT_SURVEY') {
        const input = saved.inputParams
        setTab('invest')
        setInvestmentFilter(input.productCategory ?? 'ALL')
        setForm((old) => ({ ...old, initial: input.initialVnd, contribution: input.monthlyContributionVnd, invest: String(input.termMonths) }))
        setResult({ tab: 'invest', queriedFilter: input.productCategory ?? 'ALL', data: saved.result, initial: input.initialVnd, term: input.termMonths })
      } else if (saved.sessionMode === 'REFINANCE_COMPARE') {
        setTab('refinance')
        setResultsByTab(old => ({ ...old, refinance: saved.result }))
        setRefinanceForm(refinanceDraft(saved.result.currentContract))
        setRefinanceSourceAuditId(saved.result.currentContract.sourceAuditId ?? undefined)
      } else {
        const inputs = saved.inputParams.offers
        setTab('manual')
        setManualOffers(inputs.map((offer, index) => manualDraft(index, offer)))
        setResult({ tab: 'manual', data: saved.result, inputs })
      }
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof ApiError && failure.status === 404
        ? 'Không tìm thấy phiên khảo sát trong lịch sử của bạn.' : 'Không thể mở lại phiên khảo sát.')
    }).finally(() => {
      if (!controller.signal.aborted) setRestoring(false)
    })
    return () => controller.abort()
  }, [handoff.sessionId, setCategory, setDtiEdits, setForm, setInvestmentFilter, setLoanUseCase, setManualOffers,
    setPriority, setRefinanceForm, setRefinanceSourceAuditId, setResult, setResultsByTab, setSource, setTab, setTouched])

  function changeLoanUseCase(value: string) {
    const next = LoanUseCase.safeParse(value)
    if (!next.success) return
    const defaults = loanDefaults[next.data]
    setLoanUseCase(next.data)
    setCategory(defaults.category)
    setForm((old) => ({ ...old,
      principal: touched.amount ? old.principal : defaults.amount,
      loan: touched.term ? old.loan : defaults.term,
    }))
  }

  function changeTab(next: Tab) {
    if (next === tab) return
    request.current?.abort()
    request.current = null
    setTab(next)
    setLoading(false)
    setError('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (request.current || restoring || tab === 'refinance') return
    const term = Number(tab === 'invest' ? form.invest : form.loan)
    if (tab !== 'manual' && !SurveyTermMonthsSchema.safeParse(term).success) {
      setError('Nhập kỳ hạn nguyên từ 1 đến 600 tháng.')
      return
    }
    if (tab === 'loan' && [income, expense, debt].some(Boolean) && ![income, expense, debt].every(Boolean)) {
      setError('Nhập đủ thu nhập, chi phí và khoản trả nợ để tính DTI. Nhập 0 nếu không phát sinh.')
      return
    }
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    const { signal } = controller
    try {
      let next: Result
      if (tab === 'loan') {
        const amount = stripSpacedAmount(form.principal)
        const data = await apiClient.post('/survey/loan', {
          principalVnd: amount, termMonths: term, productCategory: category, loanUseCase: loanUseCase || undefined, priority,
          checkEntityName: form.entity.trim() || undefined, rateShockDeltaPct: decimal(form.shock) || undefined,
          ...source,
          dtiOverride: income && expense && debt ? {
            monthlyIncomeVnd: stripSpacedAmount(income), monthlyExpenseVnd: stripSpacedAmount(expense),
            existingDebtPaymentVnd: stripSpacedAmount(debt),
          } : undefined,
        }, { schema: SurveyLoanResponseSchema, signal })
        next = { tab, data, amount, term }
      } else if (tab === 'invest') {
        const initial = stripSpacedAmount(form.initial)
        const data = await apiClient.post('/survey/investment', {
          productCategory: investmentFilter === 'ALL' ? undefined : investmentFilter,
          initialVnd: initial, monthlyContributionVnd: stripSpacedAmount(form.contribution), termMonths: term,
        }, { schema: SurveyInvestResponseSchema, signal })
        next = { tab, data, initial, term, queriedFilter: investmentFilter }
      } else {
        const input = ManualCompareRequestSchema.safeParse({ offers: manualOffers.map(manualInput) })
        if (!input.success) {
          setError('Nhập số tiền, lãi suất và kỳ hạn hợp lệ cho 2–4 gói.')
          return
        }
        const data = await apiClient.post('/calculator/manual-compare', input.data, { schema: ManualCompareResponseSchema, signal })
        next = { tab, data, inputs: input.data.offers }
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
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-4">
        <div role="group" aria-label="Chế độ khảo sát" className="grid grid-cols-2 rounded-xl border border-border bg-card p-1 sm:grid-cols-4">
          {tabs.map(([id, label]) => <button type="button" key={id} aria-pressed={tab === id}
            disabled={restoring} onClick={() => changeTab(id)}
            className={`rounded-lg px-2 py-3 text-sm font-semibold ${tab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{label}</button>)}
        </div>
        {restoring ? <p role="status" className="min-h-48 text-sm text-muted-foreground">Đang mở lại phiên khảo sát…</p>
          : tab === 'refinance' ? <RefinanceWorkspace
            sourceAuditId={refinanceSourceAuditId} restored={resultsByTab.refinance} />
          : <form onSubmit={submit}>
          <fieldset className="min-w-0 space-y-4">
          <legend className="sr-only">{tabs.find(([id]) => id === tab)?.[1]}</legend>
          {tab === 'loan' && <>
            {(form.shock !== '0' || source.sourceArticleId) && <p role="status" className="rounded-xl border border-border bg-accent/50 p-4 text-sm">
              Đã nhận cú sốc lãi suất từ Radar{form.shock !== '0' && <> · <strong>{form.shock} điểm phần trăm</strong></>}
              {source.sourceArticleId && <> · <Link className="underline" href={'/radar/' + source.sourceArticleId}>Xem bài viết nguồn</Link></>}
            </p>}
            {source.sourceAuditId && <p role="status" className="rounded-xl border border-border bg-accent/50 p-4 text-sm">
              Đã nạp số tiền và kỳ hạn từ Giám định · <Link className="underline" href={'/forensic/' + source.sourceAuditId}>Xem báo cáo nguồn</Link>
            </p>}
            <div className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
              <label className="min-w-0 space-y-1.5 text-sm font-medium">Mục đích vay
                <select aria-describedby={loanUseCase ? "catalog-term-hint" : undefined} className={fieldStyle} value={loanUseCase} onChange={({ currentTarget }) => changeLoanUseCase(currentTarget.value)}>
                  {loanUseCase === '' && <option value="">{category === 'SECURED_LOAN' ? 'Vay thế chấp' : 'Vay tín chấp'} · Nhóm ban đầu</option>}
                  {LoanUseCase.options.map((value) => <option key={value} value={value}>{loanDefaults[value].label}</option>)}
                </select>
              </label>
              <label className="space-y-1.5 text-sm font-medium">Ưu tiên xếp hạng
                <select className={fieldStyle} value={priority} onChange={({ target }) => setPriority(target.value as SurveyLoanRequest['priority'])}>
                  {Object.entries(priorities).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              {loanUseCase && <p id="catalog-term-hint" className="text-xs text-muted-foreground sm:col-span-2">
                Theo danh mục tham chiếu, {loanDefaults[loanUseCase].label.toLowerCase()} hỗ trợ {loanDefaults[loanUseCase].range} tháng. Bạn có thể tính thử với {formatVnd(loanDefaults[loanUseCase].amount)} trong {loanDefaults[loanUseCase].term} tháng.
              </p>}
            </div>
          </>}
          <Card>
            <CardHeader><CardTitle>{tab === 'loan' ? 'Bạn đang cần vay bao nhiêu?' : tab === 'invest' ? 'Mục tiêu tích lũy của bạn' : 'Nhập 2–4 phương án muốn so sánh'}</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {tab === 'loan' && <>
                <MoneyField id="survey-principal" label="Số tiền cần vay (VNĐ)" value={form.principal}
                  onChange={(v) => { setTouched((old) => ({ ...old, amount: true })); set('principal', v) }} />
                <Field id="survey-loan-term" label="Kỳ hạn (tháng)" value={form.loan}
                  onChange={(v) => { setTouched((old) => ({ ...old, term: true })); set('loan', v) }} term />
                {fromProfile && <p className="sm:col-span-2 text-sm text-muted-foreground" role="status">Đã nạp từ Hồ sơ cá nhân</p>}
                <MoneyField id="survey-income" label="Thu nhập mỗi tháng (VNĐ)" value={income} onChange={(v) => setDtiEdits((old) => ({ ...old, income: v }))} />
                <MoneyField id="survey-expense" label="Chi phí sinh hoạt (VNĐ)" value={expense} onChange={(v) => setDtiEdits((old) => ({ ...old, expense: v }))} />
                <MoneyField id="survey-debt" label="Nợ phải trả hiện tại (VNĐ)" value={debt} onChange={(v) => setDtiEdits((old) => ({ ...old, debt: v }))} />
                <Field id="survey-shock" label="Cú sốc lãi suất từ Radar (điểm phần trăm)" value={form.shock} onChange={(v) => set('shock', v)} />
                <div className="sm:col-span-2"><Field id="survey-entity" label="Tên ngân hàng / tổ chức cần kiểm tra" value={form.entity} onChange={(v) => set('entity', v)} freeText /></div>
              </>}
              {tab === 'invest' && <>
                <MoneyField id="survey-initial" label="Vốn ban đầu (VNĐ)" value={form.initial} onChange={(v) => set('initial', v)} />
                <MoneyField id="survey-contribution" label="Góp thêm mỗi tháng (VNĐ)" value={form.contribution} onChange={(v) => set('contribution', v)} />
                <Field id="survey-invest-term" label="Thời gian (tháng)" value={form.invest} onChange={(v) => set('invest', v)} term />
              </>}
              {tab === 'manual' && <>
                <div className="flex flex-wrap gap-2 sm:col-span-2" role="group" aria-label="Mẫu so sánh khoản vay">
                  {manualPresets.map(preset => <Button key={preset.label} type="button" variant="outline" size="sm"
                    className="h-auto min-h-9 max-w-full justify-start whitespace-normal text-left"
                    onClick={() => setManualOffers(preset.offers)}>{preset.label}</Button>)}
                </div>
                {manualOffers.map((item) => <ManualOfferFields key={item.id} item={item}
                  onChange={(updated) => setManualOffers((old) => old.map((offer) => offer.id === updated.id ? updated : offer))}
                  onRemove={manualOffers.length > 2 ? () => setManualOffers((old) => old.filter(({ id }) => id !== item.id)) : undefined} />)}
                <Button type="button" variant="outline" className="sm:col-span-2" disabled={manualOffers.length >= 4} onClick={() => {
                  const id = Math.max(...manualOffers.map(offer => offer.id)) + 1
                  const slot = ['Gói A', 'Gói B', 'Gói C', 'Gói D'].find((label) => !manualOffers.some((offer) => offer.label === label))
                  setManualOffers((old) => [...old, { ...manualDraft(id), label: slot ?? 'Gói ' + (id + 1) }])
                }}>Thêm phương án</Button>
              </>}
              <Button type="submit" className="sm:col-span-2" size="lg" disabled={loading}>
                {loading ? <Loader2 className="animate-spin" size={17} aria-hidden="true" /> : <Calculator size={17} aria-hidden="true" />}
                {loading ? 'Đang tính…' : 'Tính và xem phương án'}
              </Button>
            </CardContent>
          </Card>
          </fieldset>
        </form>}
        {tab === 'invest' && <div role="group" aria-label="Nhóm đầu tư" className="flex flex-wrap gap-2">
          {investmentFilters.map(([value, label]) => <Button key={value} type="button" size="sm" className="rounded-full"
            variant={investmentFilter === value ? 'default' : 'outline'} aria-pressed={investmentFilter === value}
            onClick={() => setInvestmentFilter(value)}>{label}</Button>)}
        </div>}
        {error && <p role="alert" className="rounded-xl border border-verdict-danger-border bg-verdict-danger-bg p-4 text-sm text-verdict-danger">{error}</p>}
        {result?.data.meta?.savedToHistory === false && <p role="status" className="text-sm text-muted-foreground">Kết quả chưa lưu được vào lịch sử.</p>}
        {result && <Results key={result.data.sessionId} result={result} investmentFilter={investmentFilter} />}
      </div>
      <aside className="min-w-0 space-y-4 self-start lg:sticky lg:top-4">
        <Card><CardHeader><CardTitle>Nguồn được kiểm tra</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm"><p>Mỗi phương án có liên kết đến nguồn niêm yết để bạn đối chiếu lãi và phí.</p>
          <Link className="font-semibold text-primary underline" href="/forensic">Giám định hợp đồng hoặc lời mời vay</Link></CardContent>
        </Card><Card className="bg-accent/50">
        <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck aria-hidden="true" size={19} className="text-primary" />Cách đọc nhanh</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p><strong className="text-foreground">APR</strong> tính chi phí theo số tiền thực nhận và toàn bộ lịch trả.</p>
          <p><strong className="text-foreground">DTI</strong> cho biết phần thu nhập dùng trả nợ mỗi tháng. Đối chiếu cả khoản trả sau ưu đãi.</p>
          <p><strong className="text-foreground">Uy tín</strong> phản ánh độ tin cậy của nguồn. Mở <Link className="font-semibold text-primary underline" href="/forensic">Giám định</Link> để kiểm tra một hợp đồng cụ thể.</p>
        </CardContent>
      </Card></aside>
    </div>
  </main>
}

function Results({ result, investmentFilter }: { result: Result; investmentFilter: InvestmentFilter }) {
  if (result.tab === 'invest' && result.queriedFilter !== 'ALL' && result.queriedFilter !== investmentFilter) {
    return <p role="status" className="text-sm text-muted-foreground">Bấm “Tính và xem phương án” để tra danh mục cho nhóm vừa chọn.</p>
  }
  if (!result.data.offers.length) {
    const status = result.tab === 'manual' ? undefined : result.data.meta?.catalogStatus
    const message = status === 'CATALOG_UNAVAILABLE' ? 'Kho sản phẩm tạm thời không kết nối được.'
      : status === 'EMPTY_CATALOG' ? 'Danh mục hiện chưa có sản phẩm đang dùng trong nhóm này.'
        : status === 'NO_MATCH' ? 'Chưa có gói phù hợp. Hãy điều chỉnh số tiền, kỳ hạn hoặc chọn nhóm sản phẩm khác rồi tính lại.'
        : 'Chưa có gói phù hợp với số tiền và kỳ hạn đã nhập.'
    return <p role="status" className="rounded-xl border border-border bg-card p-5 text-sm">{message}</p>
  }
  if (result.tab === 'invest') return <InvestmentResults result={result} filter={investmentFilter} />
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

const dtiColors = { SAFE: '#227048', MODERATE: '#b48414', HIGH_PRESSURE: '#c25a28', CRITICAL_OVERLOAD: '#ae3034', UNAVAILABLE: '#777' }

function LoanResults({ result }: { result: Extract<Result, { tab: 'loan' }> }) {
  const [open, setOpen] = useState(0)
  const { data, amount, term } = result
  const offer = data.offers[open]
  const dti = offer.dtiAssessment
  return <div className="space-y-4">
    <Card><CardHeader><CardTitle>Phương án từ danh mục</CardTitle>
      <CardDescription>Ưu tiên độ tin cậy của nguồn, sau đó xếp theo tiêu chí chi phí bạn chọn.</CardDescription></CardHeader>
      <CardContent className="space-y-3">{data.offers.map((item, index) => <div key={item.productId}
        className={`relative rounded-xl border p-4 [&_a]:relative [&_button:not([aria-pressed])]:relative ${open === index ? 'border-primary bg-accent/50' : 'border-border'}`}>
        <button type="button" aria-pressed={open === index} onClick={() => setOpen(index)} className="flex w-full flex-wrap justify-between gap-2 rounded text-left after:absolute after:inset-0 after:rounded-xl">
          <span><strong>{item.institutionName}</strong><span className="block text-sm text-muted-foreground">{item.productName}</span></span>
          <strong className="text-xl text-primary">{formatVnd(item.monthlyPaymentFirstVnd)} <span className="text-xs font-normal">/tháng</span></strong>
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <Badge variant={item.trustScore >= 90 ? 'safe' : 'warning'}>Uy tín {item.trustScore}/100</Badge>
          {item.fitScore != null && <Badge variant="outline">Phù hợp hồ sơ {item.fitScore}/100</Badge>}
          <span>APR <TermInfo term="APR" /> <strong>{percent(item.effectiveAprPct)}%</strong></span>
          <span>Tổng trả {formatVnd(item.totalPayableVnd)}</span><span>Tổng chi phí {formatVnd(item.totalInterestAndFeesVnd)}</span>
          <Badge variant="outline">{rateLabels[item.rateType]}</Badge>
          <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline">{item.sourceLabel} · {formatCatalogDate(item.effectiveDate)}</a>
          {item.freshnessTier && <Badge variant="outline">{freshnessLabels[item.freshnessTier]}</Badge>}
        </div>
        {item.rateAssumption && <p className="mt-2 text-xs text-muted-foreground">{item.rateAssumption}</p>}
        <HighAprLink apr={item.effectiveAprPct} amount={amount} term={term} label={item.productName} />
      </div>)}</CardContent>
    </Card>
    {offer.verificationReceipt && <p className="text-sm text-muted-foreground">{offer.verificationReceipt.dayCountNote}</p>}
    <LoanAprDtiChart offers={data.offers.map((item) => ({ label: item.productName, ...item }))}
      dtiPct={offer.dtiPct} selectedOffer={offer.productName} />
    <LoanAmortizationChart schedule={offer.schedule} stressSchedule={offer.stressSchedule} />
    <Card><CardHeader><CardTitle>Lịch trả nợ của phương án đang chọn</CardTitle><CardDescription>{offer.productName}</CardDescription></CardHeader>
      <CardContent>
        <dl className="mb-4 grid gap-3 sm:grid-cols-3">
          <Metric label="Tiền thực nhận" value={formatVnd(offer.principalNetVnd)} />
          <Metric label="Phí trả trước" value={formatVnd(offer.upfrontFeeVnd)} />
          <Metric label="Tổng trả theo lịch" value={formatVnd(offer.totalPayableVnd)} />
        </dl>
        {offer.stressPaymentFirstVnd != null && <dl className="mb-4">
          <Metric label="Khoản trả tham chiếu sau ưu đãi hoặc khi lãi tăng 2 điểm %" value={formatVnd(offer.stressPaymentFirstVnd)} />
        </dl>}
        <dl className="mb-4 grid gap-3 sm:grid-cols-3">
          <Metric label="Tháng đầu" value={formatVnd(offer.monthlyPaymentFirstVnd)} />
          <Metric label="Tổng tiền lãi" value={formatVnd(offer.schedule.reduce((sum, row) => sum + BigInt(row.interestVnd.split('.')[0]), 0n).toString())} />
          <Metric label="APR" value={percent(offer.effectiveAprPct) + '%'} />
        </dl>
        <details open className="min-w-0 space-y-3">
          <summary className="cursor-pointer text-sm font-semibold">Xem bảng trả nợ tháng</summary>
          <div className="max-h-80 overflow-auto rounded-xl border border-border" tabIndex={0} role="region" aria-label="Lịch trả nợ theo tháng">
            <table className="w-full min-w-[580px] text-right text-sm">
              <caption className="sr-only">Lịch trả nợ theo tháng của {offer.productName}</caption>
              <thead className="bg-muted/60"><tr>{['Tháng', 'Khoản trả', 'Gốc', 'Lãi', 'Phí', 'Dư nợ còn lại'].map((label) => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead>
              <tbody>{offer.schedule.map((row) => <tr key={row.month} className="border-t border-border">
                <th scope="row" className="p-2">Tháng {row.month}</th>
                {[row.paymentVnd, row.principalVnd, row.interestVnd, row.feeVnd ?? '0', row.remainingBalanceVnd].map((value, i) => <td key={i} className="p-2">{formatVnd(value)}</td>)}
              </tr>)}</tbody>
            </table>
          </div>
        </details>
      </CardContent>
    </Card>
    {dti && <Card><CardHeader><CardTitle>Khả năng trả nợ · DTI <TermInfo term="DTI" /></CardTitle>
      <CardDescription>{offer.productName}</CardDescription></CardHeader>
      <CardContent>
        <p className="flex flex-wrap items-baseline justify-between gap-2">
          <strong className="text-3xl">{dti.bestOfferDtiPct === null ? 'Chưa xác định với thu nhập hiện có' : percent(dti.bestOfferDtiPct) + '%'}</strong>
          <span>Sau chi phí và nợ, còn khoảng {formatVnd(dti.disposableCashflowVnd)}</span>
        </p>
        {dti.bestOfferDtiPct !== null && <progress aria-label="Tỷ lệ thu nhập dùng trả nợ" className="dti-progress mt-3 block w-full" max="100"
          value={dti.bestOfferDtiPct} style={{ color: dtiColors[dti.riskBand] }} />}
        <p className="mt-2 text-xs text-muted-foreground">{dti.disclaimer}</p></CardContent>
    </Card>}
    {data.aiExplanation && <Card><CardHeader><CardTitle>{data.meta?.degradedMode ? 'Nhận xét từ kết quả tính' : 'Nhận xét và đánh đổi từ AI'}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm"><p>{data.aiExplanation.summary}</p>
        <ul className="list-disc space-y-1 ps-5">{[...data.aiExplanation.tradeoffs, ...(data.aiExplanation.warnings ?? [])].map((item, i) => <li key={i}>{item}</li>)}</ul>
      </CardContent>
    </Card>}
  </div>
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-xl bg-muted/60 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold tabular-nums [overflow-wrap:anywhere]">{value}</dd></div>
}

const scenarioLabels = [['conservative', 'Thận trọng'], ['base', 'Cơ sở'], ['optimistic', 'Tích cực']] as const

function InvestmentResults({ result, filter }: { result: Extract<Result, { tab: 'invest' }>; filter: InvestmentFilter }) {
  const { data, initial, term } = result
  const offers = data.offers.filter(({ productCategory }) => filter === 'ALL' || productCategory === filter)
  if (!offers.length) return <p role="status" className="rounded-xl border border-border bg-card p-5 text-sm">Chưa có phương án trong nhóm đầu tư đã chọn.</p>
  return <div className="min-w-0 space-y-4">
    <p className="text-sm text-muted-foreground">Lãi tiền gửi cá nhân được miễn thuế. Khi bán chứng chỉ quỹ mở, thuế thường là 0,1% giá bán. Phần nắm giữ đủ hai năm được miễn nếu đáp ứng điều kiện.</p>
    <InvestmentGrowthChart offers={offers} initial={initial} term={term} />
    <Card><CardHeader><CardTitle>So sánh đầu tư và tích lũy</CardTitle></CardHeader>
      <CardContent className="min-w-0 space-y-3">
        <div className="max-w-full overflow-x-auto rounded-lg border border-border focus-visible:outline-primary"
          role="region" aria-labelledby="investment-table-caption" tabIndex={0}>
          <table className="w-full min-w-[42rem] border-collapse text-left text-xs tabular-nums">
            <caption id="investment-table-caption" className="bg-muted px-3 py-2 text-left font-semibold">So sánh nhanh các kênh</caption>
            <thead className="border-b border-border bg-muted/60 text-muted-foreground"><tr>
              {['Kênh & Tổ chức', 'Lãi kỳ vọng', 'Vốn tự đóng', 'Phí & Thuế', 'Lãi ròng (+%)', 'Giá trị cuối kỳ'].map(label =>
                <th key={label} scope="col" className="px-3 py-2 font-semibold">{label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-border">
              {offers.map(({ productId, institutionName, productCategory, scenario }) => <tr key={productId}>
                <th scope="row" className="px-3 py-2 font-medium">{investmentLabels[productCategory]}<span className="block text-muted-foreground">{institutionName}</span></th>
                <td className="whitespace-nowrap px-3 py-2">{formatRate(scenario.annualReturnPct)}/năm</td>
                <td className="whitespace-nowrap px-3 py-2">{formatVnd(scenario.totalContributedVnd)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatVnd(new Decimal(scenario.sellFeeVnd).plus(scenario.taxVnd).toFixed())}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatVnd(scenario.netProfitVnd)}
                  <span className="block text-muted-foreground">{formatInvestmentReturn(scenario.netProfitVnd, scenario.totalContributedVnd)}</span></td>
                <td className="whitespace-nowrap px-3 py-2 font-semibold">{formatVnd(scenario.netValueVnd)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {offers.map(({ productId, productName, productCategory, sourceLabel, sourceUrl, effectiveDate, freshnessTier, rateNote, scenario, scenarios }) =>
        <article key={productId} className="space-y-3 rounded-xl border p-4">
          <Badge variant="outline">{investmentLabels[productCategory]}</Badge>
          <h3 className="font-semibold">{productName} · {percent(scenario.annualReturnPct)}%/năm</h3>
          <dl className="grid gap-2 sm:grid-cols-3">
            <Metric label="Tiền mình góp" value={formatVnd(scenario.totalContributedVnd)} />
            <Metric label={'Lãi ròng (' + formatInvestmentReturn(scenario.netProfitVnd, scenario.totalContributedVnd) + ')'}
              value={formatVnd(scenario.netProfitVnd)} />
            <Metric label="Giá trị ròng cuối kỳ" value={formatVnd(scenario.netValueVnd)} />
          </dl>
          <p className="text-xs text-muted-foreground">{new Decimal(scenario.sellFeeVnd).plus(scenario.taxVnd).isZero()
            ? 'Phí & thuế: 0 đ' : <>Phí bán {formatVnd(scenario.sellFeeVnd)} · Thuế {formatVnd(scenario.taxVnd)}</>}</p>
          {scenarios && <dl className="grid grid-cols-3 gap-1.5 sm:gap-2" aria-label="Ba kịch bản quỹ mở">
            {scenarioLabels.map(([key, label]) => {
              const current = scenarios[key]
              return <div key={key} className="min-w-0 rounded-lg border p-1.5 text-xs sm:p-2">
                <dt className="font-medium">{label}</dt>
                <dd className="mt-1 font-semibold tabular-nums [overflow-wrap:anywhere]">{formatVnd(current.netValueVnd)}</dd>
                <dd className="mt-0.5 text-muted-foreground">{formatInvestmentReturn(current.netProfitVnd, current.totalContributedVnd)}</dd>
              </div>
            })}
          </dl>}
          <p className="text-sm text-muted-foreground">{sourceLabel} {formatCatalogDate(effectiveDate)}{freshnessTier && ' · ' + freshnessLabels[freshnessTier]} <a href={sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline">Xem nguồn</a></p>
          {rateNote && <p className="text-xs text-muted-foreground">{rateNote}</p>}
        </article>)}</CardContent>
    </Card>
  </div>
}

function ManualResults({ result }: { result: Extract<Result, { tab: 'manual' }> }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const offers = result.data.offers
  return <div className="min-w-0 space-y-4">
    <Card><CardHeader><CardTitle>So sánh số liệu bạn nhập</CardTitle>
      <CardDescription>Phí trả trước được khấu trừ khi giải ngân. Chọn một gói để xem lịch trả nợ.</CardDescription></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">{offers.map((offer, i) => <article className="min-w-0 space-y-3 rounded-xl border p-3" key={i}>
        <h3><button type="button" aria-pressed={selectedIndex === i} onClick={() => setSelectedIndex(i)}
          className={`w-full break-words rounded px-2 py-1.5 text-left font-semibold ${selectedIndex === i ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}`}>
          {offer.label}
        </button></h3>
        <Badge variant="outline">{methodLabels[offer.calcMethod]}</Badge>
        <dl className="grid gap-2">
          <Metric label="Tiền thực nhận" value={formatVnd(offer.principalNetVnd)} />
          <Metric label="Phí trả trước" value={formatVnd(offer.upfrontFeeVnd)} />
          <Metric label="Khoản trả tháng đầu" value={formatVnd(offer.monthlyPaymentVnd)} />
          <Metric label="Phí quản lý mỗi tháng" value={formatVnd(offer.monthlyFeeVnd)} />
          <Metric label="Tổng trả theo lịch" value={formatVnd(offer.totalPayableVnd)} />
          <Metric label="APR" value={percent(offer.effectiveAprPct) + '%'} />
        </dl>
        {offer.earlySettlement && <section className="space-y-2 border-t pt-3">
          <h4 className="text-sm font-semibold">Tất toán vào tháng {offer.earlySettlement.month}</h4>
          <dl className="grid gap-2">
            <Metric label="Gốc còn lại sau kỳ trả" value={formatVnd(offer.earlySettlement.remainingPrincipalVnd)} />
            <Metric label="Phí tất toán" value={formatVnd(offer.earlySettlement.penaltyFeeVnd)} />
            <Metric label="Tổng đã trả đến khi tất toán" value={formatVnd(offer.earlySettlement.totalPaidUntilExitVnd)} />
            <Metric label="APR khi tất toán" value={percent(offer.earlySettlement.effectiveAprAtExitPct) + '%'} />
          </dl>
        </section>}
        {result.inputs[i] && <HighAprLink apr={offer.effectiveAprPct} amount={result.inputs[i].principalVnd} term={result.inputs[i].termMonths} label={offer.label} />}
      </article>)}</CardContent>
    </Card>
    <LoanAprDtiChart offers={offers.map((offer, index) => ({ ...offer, nominalRatePct: result.inputs[index]?.annualRatePct }))} manual />
    <LoanAmortizationChart schedule={offers[selectedIndex].schedule} />
  </div>
}
