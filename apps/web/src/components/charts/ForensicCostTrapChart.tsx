'use client'

import type { ForensicAuditResponse } from '@fincopilot/shared-types'
import { Bar, BarChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { repaymentCostAbovePrincipal, validChartAmount } from './chart-math'
import { formatVnd } from '@/lib/workspace-data'
import { ChartCard } from './ChartCard'
import { chartAxis, chartColors, chartTooltip, compactValue, FinancialChartFrame, percentTick } from './FinancialChartFrame'

type Breakdown = NonNullable<ForensicAuditResponse['mathBreakdown']>
const series = [
  { key: 'net', label: 'Tiền thực cầm về tay', color: chartColors.navy },
  { key: 'upfront', label: 'Phí thu trước', color: chartColors.amber },
  { key: 'overhead', label: 'Lãi và phí phát sinh', color: chartColors.red },
] as const

export function ForensicCostTrapChart({ math }: { math: Breakdown }) {
  const { principalNetVnd: net, principalNominalVnd, upfrontFeeVnd: upfront, totalPayableVnd, stressScenario, effectiveAprPct } = math
  if (![net, principalNominalVnd, upfront].every(validChartAmount)) return <p>Chưa đủ số liệu để vẽ biểu đồ chi phí.</p>
  const makeRow = (label: string, total: string) => {
    const overhead = repaymentCostAbovePrincipal(total, principalNominalVnd)
    return { label, total, net: Number(net), upfront: Number(upfront), overhead: Number(overhead), amounts: { net, upfront, overhead } }
  }
  const points = [
    { label: 'Thực nhận', total: net, net: Number(net), upfront: 0, overhead: 0, amounts: { net, upfront: '0', overhead: '0' } },
    ...(validChartAmount(totalPayableVnd) ? [makeRow('Tổng phải trả', totalPayableVnd)] : []),
    ...(stressScenario && validChartAmount(stressScenario.totalPayableVnd) ? [makeRow('Nếu dính điều kiện gài', stressScenario.totalPayableVnd)] : []),
  ]
  return <ChartCard title="Chênh lệch chi phí vay" className="min-w-0" unit="VNĐ"
    legend={[...series]}>
    <FinancialChartFrame height={points.length > 2 ? 173 : 135}>
      <BarChart data={points} layout="vertical" accessibilityLayer margin={{ top: 6, right: 22, bottom: 2, left: 0 }}>
        <CartesianGrid horizontal={false} stroke={chartColors.grid} />
        <XAxis type="number" tick={chartAxis} tickLine={false} tickFormatter={compactValue} />
        <YAxis type="category" dataKey="label" width={82} tick={chartAxis} axisLine={false} tickLine={false}
          tickFormatter={(label: string) => label.startsWith('Nếu') ? 'Nếu bị gài' : label} />
        <Tooltip contentStyle={chartTooltip} formatter={(value, name, item) => {
          const key = series.find(({ label }) => label === name)?.key
          const point = item.payload as (typeof points)[number] | undefined
          return [formatVnd(key && point?.amounts[key] || String(value ?? '0')), name]
        }} />
        {series.map(({ key, label, color }) => <Bar key={key} dataKey={key} name={label} stackId="cost"
          fill={color} maxBarSize={20} isAnimationActive={false} />)}
      </BarChart>
    </FinancialChartFrame>
    <dl className="flex flex-wrap gap-x-5 gap-y-2 border-y border-border py-2.5 text-xs">
      {points.map(({ label, total }) => <div key={label}><dt className="text-muted-foreground">{label}</dt>
        <dd className="break-all font-semibold tabular-nums">{formatVnd(total)}</dd></div>)}
    </dl>
    <h4 className="mt-4 text-sm font-semibold">APR thực tế và mốc tham chiếu 20%/năm</h4>
    {validChartAmount(effectiveAprPct) ? <>
      <p className="text-xs text-muted-foreground">Điều 468 Bộ luật Dân sự. Luật chuyên ngành có thể quy định khác.</p>
      <FinancialChartFrame height={83}>
        <BarChart data={[{ label: 'APR thực tế', rate: Number(effectiveAprPct) }]} layout="vertical" accessibilityLayer
          margin={{ top: 8, right: 25, bottom: 0, left: 8 }}>
          <CartesianGrid horizontal={false} stroke={chartColors.grid} />
          <XAxis type="number" domain={[0, Math.max(25, Number(effectiveAprPct))]} tick={chartAxis} tickLine={false} tickFormatter={percentTick} />
          <YAxis type="category" dataKey="label" hide />
          <Bar dataKey="rate" name="APR thực tế" fill={chartColors.navy} barSize={15} isAnimationActive={false} />
          <ReferenceLine x={20} stroke={chartColors.red} strokeDasharray="4 3" />
          <Tooltip contentStyle={chartTooltip} formatter={() => [effectiveAprPct + '%', 'APR thực tế']} />
        </BarChart>
      </FinancialChartFrame>
      <p className="text-xs font-semibold tabular-nums">APR thực tế {effectiveAprPct}% · Mốc tham chiếu 20%/năm</p>
    </> : <p className="text-sm text-muted-foreground">Hợp đồng thiếu dữ liệu trả định kỳ theo kỳ hạn cố định để quy đổi APR theo năm. Xem tổng chi phí phải trả ở trên.</p>}
  </ChartCard>
}
