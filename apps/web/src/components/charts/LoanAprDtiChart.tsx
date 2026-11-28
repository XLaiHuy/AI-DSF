'use client'

import { effectiveLoanEarFromApr } from '@fincopilot/financial-math'
import Decimal from 'decimal.js'
import { Badge } from '@/components/ui'
import { formatRate } from '@/lib/financial-format'
import { Bar, BarChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartCard } from './ChartCard'
import { chartAxis, chartColors, chartTooltip, FinancialChartFrame } from './FinancialChartFrame'

const rates = [
  { key: 'nominal', label: 'Lãi công bố', color: chartColors.navy },
  { key: 'apr', label: 'APR thực tế', color: chartColors.green },
] as const
const thresholds = [
  { value: 35, label: '35% · An toàn', color: chartColors.green },
  { value: 50, label: '50% · Ngưỡng quá tải', color: chartColors.red },
]
const rateTooltip = (value: unknown, name: unknown): [string, string] => [formatRate(String(value)), String(name)]

export function LoanAprDtiChart({ offers, dtiPct, selectedOffer, manual = false }: {
  offers: readonly { label: string; effectiveAprPct: string; nominalRatePct?: string }[]
  dtiPct?: string | null
  selectedOffer?: string
  manual?: boolean
}) {
  const series = manual ? [{ ...rates[0], label: 'Lãi suất nhập' }, rates[1]] : rates
  const points = offers.map((offer, index) => {
    const label = 'Gói ' + String.fromCharCode(65 + index)
    return {
      label, name: offer.label.trim(), apr: Number(offer.effectiveAprPct),
      nominal: offer.nominalRatePct == null ? undefined : Number(offer.nominalRatePct),
      originalApr: offer.effectiveAprPct, originalNominal: offer.nominalRatePct,
      ear: effectiveLoanEarFromApr(offer.effectiveAprPct),
      difference: offer.nominalRatePct == null ? null : new Decimal(offer.effectiveAprPct).minus(offer.nominalRatePct),
    }
  })
  const equalRates = points.length > 0 && points.every(({ difference }) => difference?.abs().lt('0.05'))
  const dti = dtiPct == null ? undefined : Number(dtiPct)
  const height = Math.max(128, 36 * points.length + 35)
  return <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
    <ChartCard title={manual ? 'Lãi suất nhập và APR thực tế' : 'Lãi công bố và APR thực tế'} unit="% / năm" className="min-w-0"
      legend={[...series]}>
      <FinancialChartFrame height={height}>
        <BarChart data={points} layout="vertical" accessibilityLayer margin={{ top: 4, right: 22, left: 0, bottom: 2 }}>
          <CartesianGrid horizontal={false} stroke={chartColors.grid} />
          <XAxis type="number" tick={chartAxis} tickLine={false} tickFormatter={formatRate} />
          <YAxis type="category" dataKey="label" width={42} tick={chartAxis} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: 'rgba(172, 72, 55, 0.06)' }} content={({ active, label }) => {
            const point = points.find(item => item.label === label)
            if (!active || !point) return null
            return <div className="max-w-52 break-words rounded-md border p-2" style={chartTooltip}>
              <p className="mb-1 font-semibold">{point.name || point.label}</p>
              {point.originalNominal != null && <p>{series[0].label} · {formatRate(point.originalNominal)}</p>}
              <p>APR thực tế · {formatRate(point.originalApr)}</p>
              <p>EAR hiệu dụng · {formatRate(point.ear)}</p>
            </div>
          }} />
          {series.map(({ key, label, color }) => <Bar key={key} name={label} dataKey={key} fill={color}
            maxBarSize={10} isAnimationActive={false} />)}
        </BarChart>
      </FinancialChartFrame>
      <ul className="grid gap-1 border-t border-border pt-2 text-xs text-muted-foreground">
        {points.map(({ label, name, originalApr, ear, difference }) => <li key={label} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 break-words">
          <span><strong className="text-foreground">{label}</strong>{name && name !== label && <> · {name}</>}</span>
          <span>APR {formatRate(originalApr)} · EAR hiệu dụng {formatRate(ear)}</span>
          {difference?.gte('0.05') && <Badge variant="warning" className="whitespace-normal">
            +{difference.toFixed(1, Decimal.ROUND_HALF_UP).replace('.', ',')}% do phí/cách tính lãi
          </Badge>}
        </li>)}
      </ul>
      {equalRates && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Các gói này tính theo dư nợ giảm dần và không phát sinh phí ẩn nên APR danh nghĩa bằng lãi công bố
        (lãi hiệu dụng ghép tháng EAR cao hơn với lãi suất dương). Hãy thử thêm phí trả trước, phí tháng
        hoặc đổi sang Lãi phẳng để thấy chênh lệch thực.
      </p>}
    </ChartCard>
    <ChartCard title="Tỷ lệ trả nợ (DTI)" className="min-w-0" unit="% thu nhập" subtitle={selectedOffer} legend={thresholds}>
      <FinancialChartFrame height={95}>
        <BarChart data={[{ label: 'DTI', value: dti }]} layout="vertical" accessibilityLayer
          margin={{ top: 10, right: 24, left: 8, bottom: 1 }}>
          <CartesianGrid horizontal={false} stroke={chartColors.grid} />
          <XAxis type="number" domain={[0, Math.max(60, dti ?? 0)]} tick={chartAxis} tickLine={false} tickFormatter={formatRate} />
          <YAxis type="category" dataKey="label" hide />
          {thresholds.map(({ value, color }) => <ReferenceLine key={value} x={value} stroke={color} strokeDasharray="3 2" />)}
          <Bar dataKey="value" name="DTI" fill={chartColors.navy} barSize={15} isAnimationActive={false} />
          <Tooltip contentStyle={chartTooltip} formatter={rateTooltip} />
        </BarChart>
      </FinancialChartFrame>
      <p className="text-xs text-muted-foreground">{dti == null ? 'Cần thu nhập và khoản trả nợ để tính DTI.' : <strong className="tabular-nums">{formatRate(dtiPct ?? '0')} thu nhập</strong>}</p>
    </ChartCard>
  </div>
}
