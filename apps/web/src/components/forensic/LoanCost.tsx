import type { ForensicAuditResponse } from '@fincopilot/shared-types'
import { ChevronDown, Landmark } from 'lucide-react'
import { formatSpacedAmount } from '@/components/ui/money-input'
import { TermInfo } from '@/components/ui'
import { cn } from '@/lib/utils'

type Breakdown = NonNullable<ForensicAuditResponse['mathBreakdown']>

function scaledDecimal(value: string, places: number) {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole + fraction.padEnd(places, '0'))
}

function legacyPayments(math: Breakdown, handoff: ForensicAuditResponse['handoffPayload']) {
  const rate = /^(\d{1,3}(?:\.\d{1,4})?)%\/tháng \(Lãi phẳng\)$/.exec(math.quotedRateLabel)?.[1]
  const term = handoff?.suggestedTermMonths
  const currency = /^\d{1,16}(?:\.\d{1,2})?$/
  if (!rate || !handoff || !term || term > 600 || !currency.test(math.principalNominalVnd) || !currency.test(math.principalNetVnd) ||
      !currency.test(handoff.suggestedAmountVnd)) return null
  const principal = scaledDecimal(math.principalNominalVnd, 2)
  if (principal !== scaledDecimal(handoff.suggestedAmountVnd, 2)) return null
  const months = BigInt(term)
  const rateBase = 1_000_000n
  const numerator = principal * (rateBase + months * scaledDecimal(rate, 4))
  const denominator = rateBase * 100n
  const round = (divisor: bigint) => (numerator + divisor / 2n) / divisor
  const total = round(denominator)
  const extra = total * 100n - scaledDecimal(math.principalNetVnd, 2)
  return {
    term, monthly: String(round(denominator * months)), total: String(total),
    extra: extra < 0n ? null : `${extra / 100n}.${String(extra % 100n).padStart(2, '0')}`.replace(/\.00$/, ''),
  }
}

const money = (value: string) => `${formatSpacedAmount(value)} đ`.replaceAll(' ', '\u00a0')
const percent = (value: string) => value.replace('.', ',')
const annualRate = (value: string | null) => value === null ? 'Chưa xác định' : percent(value) + '%'

function LegalReference({ reference }: { reference: Breakdown['legalReference'] }) {
  const excess = reference?.excessOverCeilingPct
  const comparison = reference?.status === 'WITHIN_CIVIL_LIMIT' ? 'APR nằm trong mốc tham chiếu dân sự.'
    : excess && /[1-9]/.test(excess) ? `APR cao hơn mốc tham chiếu dân sự ${percent(excess)} điểm phần trăm.`
      : 'APR cao hơn mốc tham chiếu dân sự.'
  return (
    <section aria-labelledby="loan-law-heading" className="print-keep space-y-2 rounded-lg border border-border p-4 text-sm leading-relaxed">
      <h3 id="loan-law-heading" className="flex items-start gap-2 font-semibold">
        <Landmark size={17} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" /> Mốc đối chiếu lãi suất
      </h3>
      {reference ? (
        <>
          <p>{reference.status === 'REGULATED_INSTITUTION_EXEMPT'
            ? 'Tổ chức tín dụng do NHNN cấp phép áp dụng quy định chuyên ngành về lãi và phí.'
            : comparison + ' APR gồm phí. Cần đối chiếu lãi suất thỏa thuận và các khoản thu thực tế.'}</p>
        </>
      ) : (
        <>
          <p className="text-muted-foreground">Mốc tham khảo cho lãi suất thỏa thuận trong khoản vay dân sự là 20%/năm, trừ trường hợp luật khác có quy định. Cần xác định loại khoản vay và bên cho vay để biết quy định áp dụng.</p>
        </>
      )}
      <a className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4" target="_blank" rel="noopener noreferrer"
        href={reference?.status === 'REGULATED_INSTITUTION_EXEMPT'
          ? 'https://vanban.chinhphu.vn/?pageid=27160&docid=211190'
          : 'https://vanban.chinhphu.vn/default.aspx?pageid=27160&docid=183188'}>
        {reference?.status === 'REGULATED_INSTITUTION_EXEMPT' ? 'Luật Các tổ chức tín dụng 2024' : 'Điều 468 Bộ luật Dân sự 2015'}
      </a>
    </section>
  )
}

export function LoanCost({ math, handoff }: { math: Breakdown; handoff: ForensicAuditResponse['handoffPayload'] }) {
  const legacy = legacyPayments(math, handoff)
  const monthly = math.monthlyPaymentVnd ?? legacy?.monthly
  const total = math.totalPayableVnd ?? legacy?.total
  const extra = math.totalExtraCostVnd ?? legacy?.extra
  const term = math.termMonths ?? legacy?.term
  const periodic = math.periodicRepayment
  const periodLabel = periodic?.unit === 'DAY' ? 'ngày' : 'tuần'
  const entries = [
    { label: 'Tiền thực nhận về tay', value: math.principalNetVnd, note: `Tiền vay ${money(math.principalNominalVnd)} · phí thu trước ${money(math.upfrontFeeVnd)}` },
    ...(periodic ? [{
      label: 'Tiền phải trả mỗi ' + periodLabel, value: periodic.paymentVnd, note: 'Trong ' + periodic.count + ' ' + periodLabel,
    }] : monthly ? [{
      label: math.maxMonthlyPaymentVnd && math.minMonthlyPaymentVnd !== math.maxMonthlyPaymentVnd ? 'Tháng trả cao nhất' : 'Tiền phải trả mỗi tháng',
      value: math.maxMonthlyPaymentVnd ?? monthly, note: term ? `Trong ${term} tháng` : '',
    }] : []),
    ...(total ? [{ label: 'Tổng tiền phải trả', value: total, note: extra ? `Trả thêm ${money(extra)} so với tiền thực nhận` : '' }] : []),
  ]

  return (
    <section aria-labelledby="loan-math-heading" className="min-w-0 space-y-4">
      <h2 id="loan-math-heading" className="text-lg font-semibold tracking-tight">Tiền thật bạn nhận và phải trả</h2>
      <dl className={cn('scr-stagger-grid grid gap-2.5', entries.length === 3 && 'sm:grid-cols-3')}>
        {entries.map(({ label, value, note }) => (
          <div key={label} className="min-w-0 space-y-1.5 rounded-lg bg-muted p-4 last:bg-accent last:text-accent-foreground">
            <dt className="text-sm font-medium">{label}</dt>
            <dd className="font-numeric text-xl font-bold tracking-tight [overflow-wrap:anywhere]">{money(value)}</dd>
            {note && <dd className="text-xs leading-relaxed [overflow-wrap:anywhere]">{note}</dd>}
          </div>
        ))}
      </dl>
      {!periodic && (!math.scheduleType || math.scheduleType === 'FIXED_FLAT') && !math.hasUncappedFloatingClause && <div className="space-y-1 rounded-lg bg-muted px-4 py-3 text-sm leading-relaxed">
        <h3 className="font-semibold">Lãi phẳng là gì?</h3>
        <p>{math.flatRateExplainer ?? 'Mỗi tháng, tiền lãi vẫn tính trên số tiền vay ban đầu dù bạn đã trả bớt nợ gốc. Phí thu trước làm số tiền bạn cầm về ít hơn, nên chi phí vay thực tế cao hơn con số lãi hằng tháng gợi ra.'}</p>
      </div>}
      {math.hasUncappedFloatingClause && (
        <section className="print-keep space-y-1 rounded-lg border border-verdict-warning-border bg-verdict-warning-bg p-4 text-sm text-verdict-warning">
          <h3 className="font-semibold">Lãi thả nổi chưa nêu mức trần</h3>
          <p>{math.uncappedFloatingNote}</p>
        </section>
      )}
      {math.phaseBreakdown && (math.phaseBreakdown.length > 1 || math.hasUncappedFloatingClause || math.scheduleType === 'DECLINING_WITH_FEES') && (
        <section className="space-y-2">
          <h3 className="font-semibold">Lịch trả theo từng giai đoạn</h3>
          <ul role="list" className="scr-stagger-list divide-y divide-border rounded-lg border border-border px-4">
            {math.phaseBreakdown.map((phase) => (
              <li key={phase.fromMonth} className="print-keep flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3 text-sm">
                <div>
                  <p className="font-semibold">Tháng {phase.fromMonth}–{phase.toMonth} · {phase.label}</p>
                  <p className="text-muted-foreground">Lãi {percent(phase.quotedRateLabel)}
                    {/[1-9]/.test(phase.recurringFeeVnd) && ` · Phí ${money(phase.recurringFeeVnd)}/tháng`}</p>
                </div>
                <p className="font-numeric font-semibold [overflow-wrap:anywhere]">{money(phase.monthlyPaymentVnd)}
                  {math.scheduleType === 'DECLINING_WITH_FEES' ? ' kỳ đầu' : '/tháng'}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {math.stressScenario && <StressComparison math={math} stress={math.stressScenario} />}
      {math.effectiveAprPct !== null && <LegalReference reference={math.legalReference} />}
      <details data-print-open className="print-keep group rounded-lg border border-border">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm font-semibold marker:content-none hover:bg-muted/60 [&::-webkit-details-marker]:hidden">
          Xem chi tiết kỹ thuật (APR / EAR)
          <ChevronDown size={18} className="shrink-0 text-primary group-open:rotate-180" aria-hidden="true" />
        </summary>
        <p className="border-t border-border px-4 pt-3 text-sm leading-relaxed">
          Hợp đồng thường chỉ ghi mức lãi hàng tháng trông có vẻ nhỏ. Hai chỉ số dưới đây quy đổi lãi và các khoản phí đã biết về cùng một thước đo năm để bạn nhìn ra chi phí thật.
        </p>
        <dl className="grid gap-3 px-4 py-3 sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">Lãi suất ghi trong hợp đồng</dt><dd className="text-sm font-medium">{math.quotedRateLabel.replace('.', ',')}</dd></div>
          <div>
            <dt className="text-xs text-muted-foreground">Lãi suất quy năm (APR) <TermInfo term="APR" /></dt>
            <dd className="font-numeric font-semibold">{annualRate(math.effectiveAprPct)}</dd>
            <dd className="text-xs leading-relaxed text-muted-foreground">Chi phí vay thật quy ra một năm sau khi cộng phí, dùng để so sánh các khoản vay và đối chiếu mốc tham chiếu dân sự 20%/năm.</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Lãi suất năm sau ghép lãi (EAR) <TermInfo term="EAR" /></dt>
            <dd className="font-numeric font-semibold">{annualRate(math.effectiveEarPct)}</dd>
            <dd className="text-xs leading-relaxed text-muted-foreground">Mức lãi thực tế cả năm nếu tính luôn phần lãi nhập gốc sinh thêm lãi mỗi tháng, giúp bạn thấy chi phí tăng thế nào khi ghép lãi.</dd>
          </div>
        </dl>
      </details>
    </section>
  )
}

function StressComparison({ math, stress }: { math: Breakdown; stress: NonNullable<Breakdown['stressScenario']> }) {
  return (
    <section className="print-keep space-y-3 rounded-lg border border-verdict-warning-border bg-verdict-warning-bg p-4 text-sm">
      <h3 className="text-base font-semibold">Đóng đúng hạn và nếu dính điều kiện gài</h3>
      <p><strong>Điều kiện kích hoạt</strong> · {stress.triggerCondition}</p>
      <blockquote className="rounded-md bg-card px-3 py-2 [overflow-wrap:anywhere]">{stress.evidenceQuote}</blockquote>
      <dl className="scr-stagger-grid grid gap-2 sm:grid-cols-2">
        {[
          ['Đóng đúng hạn', math.maxMonthlyPaymentVnd, math.totalPayableVnd, math.effectiveAprPct],
          ['Nếu dính điều kiện gài', stress.maxMonthlyPaymentVnd, stress.totalPayableVnd, stress.effectiveAprPct],
        ].map(([label, max, total, apr]) => (
          <div key={label} className="min-w-0 space-y-1 rounded-md bg-card p-3">
            <dt className="font-semibold">{label}</dt>
            <dd className="font-numeric [overflow-wrap:anywhere]">Tháng cao nhất {max ? money(max) : '—'}</dd>
            <dd className="font-numeric [overflow-wrap:anywhere]">Tổng tiền {total ? money(total) : '—'}</dd>
            <dd className="font-numeric">APR {annualRate(apr ?? null)}</dd>
          </div>
        ))}
      </dl>
      <p className="font-semibold text-verdict-warning">Tổng tiền tăng thêm +{money(stress.extraDeltaOverBaseVnd)}
        {' · '}APR từ {annualRate(math.effectiveAprPct)} lên {annualRate(stress.effectiveAprPct)}</p>
      {stress.legalReference?.status === 'POTENTIAL_USURY_CRIME' && (
        <p className="leading-relaxed">APR kịch bản này chạm mốc cần đối chiếu Điều 201. Kiểm tra lãi suất thỏa thuận và số tiền thực thu.</p>
      )}
    </section>
  )
}
