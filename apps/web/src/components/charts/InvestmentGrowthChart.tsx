'use client'

import type { SurveyInvestResponse } from '@fincopilot/shared-types'
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import { formatVnd } from '@/lib/workspace-data'
import { ChartCard } from './ChartCard'
import { chartAxis, chartColors, chartTooltip, compactValue, FinancialChartFrame } from './FinancialChartFrame'

type Offer = SurveyInvestResponse['offers'][number]
type Point = NonNullable<Offer['projection']>[number]
type Series = { key: string; label: string; color: string; dashed?: boolean; values: ReadonlyMap<number, string> }

export function InvestmentGrowthChart({ offers, initial, term }: { offers: readonly Offer[]; initial: string; term: number }) {
  if (!offers.length) return null
  const projection = (offer: Offer): Point[] => offer.projection?.length ? offer.projection : [
    { month: 0, contributedVnd: initial, baseVnd: initial },
    { month: term, contributedVnd: offer.scenario.totalContributedVnd, baseVnd: offer.scenario.netValueVnd,
      conservativeVnd: offer.scenarios?.conservative.netValueVnd, optimisticVnd: offer.scenarios?.optimistic.netValueVnd },
  ]
  const series: Series[] = []
  const add = (key: string, label: string, color: string, points: Point[], field: Exclude<keyof Point, 'month'>, dashed = false) => {
    const values = new Map(points.flatMap((point) => {
      const value = point[field] ?? (point.month === 0 ? initial : undefined)
      return value === undefined ? [] : [[point.month, value] as const]
    }))
    series.push({ key, label, color, values, dashed })
  }
  add('contributed', 'Vốn tự đóng', chartColors.slate, projection(offers[0]), 'contributedVnd', true)
  const saving = offers.find(({ productCategory }) => productCategory === 'SAVING')
  const accumulation = offers.find(({ productCategory }) => productCategory === 'ACCUMULATION')
  const fund = offers.find(({ productCategory }) => productCategory === 'OPEN_FUND')
  if (saving) add('saving', 'Tiết kiệm', chartColors.navy, projection(saving), 'baseVnd')
  if (accumulation) add('accumulation', 'Tích lũy', chartColors.ink, projection(accumulation), 'baseVnd')
  if (fund) {
    const points = projection(fund)
    if (fund.scenarios) add('conservative', 'Quỹ mở · Thận trọng', chartColors.amber, points, 'conservativeVnd')
    add('fund', 'Quỹ mở · Cơ sở', chartColors.green, points, 'baseVnd')
    if (fund.scenarios) add('optimistic', 'Quỹ mở · Tích cực', chartColors.red, points, 'optimisticVnd')
  }
  const months = [...new Set(series.flatMap(({ values }) => [...values.keys()]))].sort((a, b) => a - b)
  const points = months.map((month) => ({
    month, ...Object.fromEntries(series.flatMap(({ key, values }) => values.has(month) ? [[key, Number(values.get(month))]] : [])),
  }))
  return <ChartCard title="Dự phóng tăng trưởng tài sản" unit="VNĐ" className="min-w-0"
    subtitle="Giá trị ròng theo thời gian của phương án đầu tiên mỗi nhóm. Kịch bản quỹ mở thay đổi theo lợi suất NAV.">
    <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
      <FinancialChartFrame height={255}>
        <LineChart data={points} accessibilityLayer margin={{ top: 8, right: 16, left: 0, bottom: 3 }}>
          <CartesianGrid vertical={false} stroke={chartColors.grid} />
          <XAxis dataKey="month" type="number" domain={[0, term]} tickFormatter={(month: number) => 'T' + month}
            tick={chartAxis} tickLine={false} minTickGap={20} />
          <YAxis tick={chartAxis} tickLine={false} axisLine={false} tickFormatter={compactValue} width={55} />
          <Tooltip contentStyle={chartTooltip} labelFormatter={(month) => 'Tháng ' + month}
            formatter={(value, name, item) => {
              const original = series.find(({ label }) => label === name)?.values.get(Number(item.payload?.month))
              return [formatVnd(original ?? String(value ?? '0')), name]
            }} />
          {series.map(({ key, label, color, dashed }) => <Line key={key} name={label} dataKey={key} stroke={color}
            strokeWidth={1.75} strokeDasharray={dashed ? '5 3' : undefined}
            dot={false} connectNulls isAnimationActive={false} />)}
        </LineChart>
      </FinancialChartFrame>
      <dl className="flex min-w-0 flex-wrap gap-2 lg:max-w-40 lg:flex-col lg:justify-center">
        {series.map(({ key, label, values, color }) => <div key={key} className="min-w-0 rounded border px-2 py-1" style={{ borderColor: color }}>
          <dt className="text-[11px] font-medium" style={{ color }}>{label}</dt>
          <dd className="text-xs font-semibold tabular-nums [overflow-wrap:anywhere]">{formatVnd(values.get(term) ?? '0')}</dd>
        </div>)}
      </dl>
    </div>
  </ChartCard>
}
