import type { CopilotRichCard as CardData, CopilotToolTraceItem } from '@fincopilot/shared-types'
import { ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { formatCatalogDate, freshnessLabels } from '@/lib/catalog-provenance'
import { formatRate } from '@/lib/financial-format'
import { formatVietnamTime, formatVnd } from '@/lib/workspace-data'

const statusLabels = { done: 'Đã đối chiếu', empty: 'Chưa có dữ liệu phù hợp', skipped: 'Chưa truy cập được' }
const riskLabels = {
  SAFE: 'An toàn', MODERATE: 'Trung bình', HIGH_PRESSURE: 'Áp lực cao', CRITICAL_OVERLOAD: 'Quá tải', UNAVAILABLE: 'Chưa đủ dữ liệu',
}
const recommendationLabels = {
  WORTH_REFINANCING: 'Có thể cân nhắc chuyển khoản vay',
  MARGINAL: 'Mức tiết kiệm thấp',
  KEEP_CURRENT: 'Giữ khoản vay hiện tại',
}
const optionalRate = (value: string | null) => value == null ? '—' : formatRate(value)
const amount = (value: string | null) => formatVnd(value)

function CardAction({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground [overflow-wrap:anywhere]">
    {children}<ArrowUpRight size={13} aria-hidden="true" className="shrink-0" />
  </Link>
}

function Metrics({ items }: { items: [string, ReactNode][] }) {
  return <dl className="grid min-w-0 grid-cols-2 gap-2 text-xs tabular-nums">
    {items.map(([label, value]) => <div key={label} className="min-w-0 rounded-md bg-muted/60 px-2.5 py-2 [overflow-wrap:anywhere]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold">{value}</dd>
    </div>)}
  </dl>
}

function ToolTrace({ trace }: { trace: readonly CopilotToolTraceItem[] }) {
  const checked = trace.filter(({ status }) => status !== 'skipped')
  return <details className="rounded-lg border border-border bg-muted/40 px-2.5 text-xs">
    <summary className="min-h-9 cursor-pointer py-2 font-medium [overflow-wrap:anywhere] focus-visible:outline-primary">
      {checked.length ? 'Đã đối chiếu ' + checked.length + ' công cụ xác thực · ' + checked.map(({ label }) => label).join(' · ')
        : 'Xem trạng thái công cụ xác thực'}
    </summary>
    <ol className="divide-y divide-border border-t border-border">
      {trace.map(({ tool, label, summary, durationMs, status }) => <li key={tool} className="py-2 [overflow-wrap:anywhere]">
        <p className="font-semibold">{label}</p>
        <p className="text-muted-foreground">{statusLabels[status]} · {durationMs} ms</p>
        <p>{summary}</p>
      </li>)}
    </ol>
  </details>
}

export function CopilotRichCard({ card, trace, surveyActionLabel }: {
  card?: CardData; trace?: readonly CopilotToolTraceItem[]; surveyActionLabel?: string
}) {
  return <div className="min-w-0 space-y-2 pt-2">
    {!!trace?.length && <ToolTrace trace={trace} />}
    {card && <section className="min-w-0 space-y-2.5 rounded-lg border border-border bg-background p-2.5 sm:p-3">
      <CardBody card={card} surveyActionLabel={surveyActionLabel} />
    </section>}
  </div>
}

function OfferProvenance({ offer }: { offer: Extract<CardData, { kind: 'LOAN_PLAN' | 'INVESTMENT_PLAN' }>['topOffers'][number] }) {
  if (!offer.sourceLabel) return null
  const date = formatCatalogDate(offer.effectiveDate)
  return <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-muted-foreground">
    <span>{offer.sourceLabel}{date && ' · ' + date}</span>
    {offer.freshnessTier && <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{freshnessLabels[offer.freshnessTier]}</span>}
  </p>
}

function CardBody({ card, surveyActionLabel }: { card: CardData; surveyActionLabel?: string }) {
  switch (card.kind) {
    case 'LOAN_PLAN':
      return <>
        <h3 className="font-semibold">Kế hoạch vay · {card.categoryLabel}</h3>
        <Metrics items={[
          ['Khoản vay', amount(card.principalVnd)], ['Kỳ hạn', card.termMonths + ' tháng'],
          [card.topOffers.length ? 'Tỷ lệ trả nợ (DTI)' : 'Tỷ lệ trả nợ hiện tại (DTI)', optionalRate(card.dtiPct)],
          [card.topOffers.length ? 'Dòng tiền còn lại' : 'Dòng tiền dư hiện tại', amount(card.disposableCashflowVnd)],
        ]} />
        <p className="text-xs text-muted-foreground">{riskLabels[card.dtiRiskBand]} · {card.profileUsed ? 'Có dùng dữ liệu tài chính' : 'Chưa có đủ dữ liệu tài chính'}</p>
        {!!card.topOffers.length && <ul className="divide-y divide-border text-xs [overflow-wrap:anywhere]">
          {card.topOffers.map((offer, index) => <li key={index} className="space-y-0.5 py-2">
            <p className="font-semibold">{offer.institutionName} · {offer.productName}</p>
            <p>Tháng đầu {amount(offer.monthlyPaymentFirstVnd)} · APR {formatRate(offer.effectiveAprPct)}</p>
            <p className="text-muted-foreground">Lãi và phí {amount(offer.totalInterestAndFeesVnd)} · Uy tín {offer.trustScore}/100</p>
            <OfferProvenance offer={offer} />
          </li>)}
        </ul>}
        <CardAction href={card.openSurveyHref}>{surveyActionLabel ?? 'Mở bảng trả nợ trong Khảo sát'}</CardAction>
      </>
    case 'INVESTMENT_PLAN':
      return <>
        <h3 className="font-semibold">Dự phóng đầu tư và tích lũy</h3>
        <Metrics items={[['Vốn ban đầu', amount(card.initialVnd)], ['Góp mỗi tháng', amount(card.monthlyContributionVnd)]]} />
        <p className="text-xs text-muted-foreground">Kỳ hạn {card.termMonths} tháng · giá trị dự phóng sau phí và thuế</p>
        {!!card.topOffers.length && <ul className="divide-y divide-border text-xs [overflow-wrap:anywhere]">
          {card.topOffers.map((offer, index) => <li key={index} className="space-y-0.5 py-2">
            <p className="font-semibold">{offer.categoryLabel} · {offer.institutionName}</p>
            <p>{offer.productName} · {formatRate(offer.annualReturnPct)}/năm</p>
            <p>Cuối kỳ <strong>{amount(offer.netValueVnd)}</strong></p>
            <p className="text-muted-foreground">Vốn {amount(offer.totalContributedVnd)} · Lãi ròng {amount(offer.netProfitVnd)}</p>
            <OfferProvenance offer={offer} />
          </li>)}
        </ul>}
        <CardAction href={card.openSurveyHref}>{surveyActionLabel ?? 'Mở Khảo sát đầu tư và tích lũy'}</CardAction>
      </>
    case 'REFINANCE_PLAN':
      return <>
        <h3 className="font-semibold">Mô phỏng đổi khoản vay</h3>
        <p className="text-xs text-muted-foreground">{amount(card.remainingPrincipalVnd)} · {card.remainingTermMonths} tháng · {formatRate(card.currentAnnualRatePct)}/năm</p>
        {card.bestBankName && <p className="text-xs font-semibold [overflow-wrap:anywhere]">{card.bestBankName} · {card.recommendation && recommendationLabels[card.recommendation]}</p>}
        {card.recommendation && <Metrics items={[
          ['Chênh lệch tháng đầu', amount(card.monthlySavingsVnd)], ['Chi phí chuyển', amount(card.totalSwitchCostVnd)],
          ['Tháng hòa vốn', card.breakEvenMonth ?? '—'], ['Tiết kiệm ròng', amount(card.netSavingsVnd)],
        ]} />}
        <CardAction href={card.openSurveyHref}>{surveyActionLabel ?? 'Mở mô phỏng đổi khoản vay'}</CardAction>
      </>
    case 'RADAR_BRIEF':
      return <>
        <h3 className="font-semibold">Bản tin Radar</h3>
        <p className="text-xs text-muted-foreground">{card.windowLabel} · {card.totalVerified} cảnh báo đã xác minh</p>
        {!!card.alerts.length && <ul className="divide-y divide-border text-xs [overflow-wrap:anywhere]">
          {card.alerts.map(alert => <li key={alert.id} className="space-y-1 py-2">
            <p className="font-semibold">{alert.title}</p>
            <p className="text-muted-foreground">{formatVietnamTime(alert.publishedAt)}{alert.vnAisLabel && ' · ' + alert.vnAisLabel}</p>
            <Link className="inline-block py-1 text-primary underline underline-offset-2" href={alert.handoffHref}>Đối chiếu trong Giám định</Link>
          </li>)}
        </ul>}
        {!!card.marketRates.length && <div className="space-y-1.5 border-t border-border pt-2 text-xs">
          <h4 className="font-semibold">Mặt bằng lãi niêm yết</h4>
          <ul className="space-y-1.5">
            {card.marketRates.map(rate => <li key={rate.label}>
              <span className="font-medium">{rate.label}</span> · {formatRate(rate.minRatePct)} – {formatRate(rate.maxRatePct)}/năm
              <span className="block text-muted-foreground">Trung vị {formatRate(rate.medianRatePct)} · {rate.sampleCount} sản phẩm</span>
            </li>)}
          </ul>
        </div>}
        <CardAction href={card.openRadarHref}>Mở Radar cảnh báo</CardAction>
      </>
    case 'PROFILE_SNAPSHOT':
      return <>
        <h3 className="font-semibold">Sức khỏe tài chính</h3>
        <p className="text-xs text-muted-foreground">{card.summary}</p>
        <Metrics items={[
          ['Điểm sức khỏe', card.score == null ? '—' : card.score + '/100'], ['Tỷ lệ trả nợ (DTI)', optionalRate(card.dtiPct)],
          ['Quỹ dự phòng', card.emergencyMonths == null ? '—' : card.emergencyMonths.replace('.', ',') + ' tháng'],
          ['Khoản trả nợ thêm tối đa', amount(card.maxSafeEmiVnd)], ['Dòng tiền dư mỗi tháng', amount(card.monthlySurplusVnd)],
        ]} />
        <CardAction href={card.openProfileHref}>Mở Hồ sơ tài chính</CardAction>
      </>
  }
}
