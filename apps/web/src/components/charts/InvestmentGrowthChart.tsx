'use client'

import type { SurveyInvestResponse } from '@fincopilot/shared-types'
import Decimal from 'decimal.js'
import { useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui'
import { formatInvestmentReturn } from '@/lib/financial-format'
import { formatVnd } from '@/lib/workspace-data'
import { ChartCard } from './ChartCard'
import { chartAxis, chartColors, chartTooltip, compactValue, FinancialChartFrame } from './FinancialChartFrame'

type Offer = SurveyInvestResponse['offers'][number]
type Point = NonNullable<Offer['projection']>[number]
const channels = [
  { key: 'saving', label: 'Tiết kiệm', color: chartColors.navy, category: 'SAVING' },
  { key: 'accumulation', label: 'Tích lũy', color: chartColors.amber, category: 'ACCUMULATION' },
  { key: 'fund', label: 'Quỹ mở', color: chartColors.green, category: 'OPEN_FUND' },
  { key: 'contributed', label: 'Vốn tự đóng', color: chartColors.slate, category: undefined },
] as const
type Channel = typeof channels[number]['key']

export function InvestmentGrowthChart({ offers, initial, term }: { offers: readonly Offer[]; initial: string; term: number }) {
  const [hidden, setHidden] = useState<Partial<Record<Channel, boolean>>>({})
  if (!offers.length) return null
  const projection = (offer: Offer): Point[] => offer.projection?.length ? offer.projection : [
    { month: 0, contributedVnd: initial, baseVnd: initial, conservativeVnd: initial, optimisticVnd: initial },
    { month: term, contributedVnd: offer.scenario.totalContributedVnd, baseVnd: offer.scenario.netValueVnd,
      conservativeVnd: offer.scenarios?.conservative.netValueVnd, optimisticVnd: offer.scenarios?.optimistic.netValueVnd },
  ]
  const series = channels.flatMap(channel => {
    const offer = channel.category ? offers.find(item => item.productCategory === channel.category) : offers[0]
    if (!offer) return []
    const points = projection(offer)
    const values = new Map(points.map(point => [point.month, channel.category ? point.baseVnd : point.contributedVnd]))
    return [{ ...channel, values, scenario: offer.scenario,
      range: channel.key === 'fund' && offer.scenarios ? new Map(points.flatMap(point =>
        point.conservativeVnd != null && point.optimisticVnd != null
          ? [[point.month, [Number(point.conservativeVnd), Number(point.optimisticVnd)]] as const] : [])) : undefined }]
  })
  const visible = series.filter(({ key }) => !hidden[key])
  const range = visible.find(({ key }) => key === 'fund')?.range
  const months = [...new Set(visible.flatMap(({ values }) => [...values.keys()]))].sort((a, b) => a - b)
  // The chart uses numeric coordinates. The tooltip and KPI use the original decimal strings.
  const points = months.map(month => ({
    month, range: range?.get(month),
    ...Object.fromEntries(visible.flatMap(({ key, values }) => values.has(month) ? [[key, Number(values.get(month))]] : [])),
  }))

  return <ChartCard title="Dự phóng tăng trưởng tài sản" unit="VNĐ" className="min-w-0"
    subtitle="Vùng tô của quỹ mở thể hiện khoảng từ kịch bản thận trọng đến tích cực.">
    <div className="flex flex-wrap gap-2" role="group" aria-label="Kênh trên biểu đồ">
      {series.map(({ key, label, color }) => <Button key={key} size="sm" type="button"
        variant={hidden[key] ? 'ghost' : 'outline'} aria-pressed={!hidden[key]} className="rounded-full"
        onClick={() => setHidden(old => ({ ...old, [key]: !old[key] }))}>
        <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: color, opacity: hidden[key] ? 0.4 : 1 }} />
        {label}
      </Button>)}
    </div>
    {visible.length ? <FinancialChartFrame height={255}>
      <ComposedChart data={points} accessibilityLayer margin={{ top: 8, right: 16, left: 0, bottom: 3 }}>
        <CartesianGrid vertical={false} stroke={chartColors.grid} />
        <XAxis dataKey="month" type="number" domain={[0, term]} tickFormatter={(month: number) => 'T' + month}
          tick={chartAxis} tickLine={false} minTickGap={20} />
        <YAxis tick={chartAxis} tickLine={false} axisLine={false} tickFormatter={compactValue} width={55} />
        <Tooltip cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} content={({ active, label }) => {
          if (!active || label == null) return null
          const rows = visible.flatMap(({ values, label: name, color }) => {
            const value = values.get(Number(label))
            return value == null ? [] : [{ name, color, value }]
          }).sort((a, b) => new Decimal(b.value).cmp(a.value))
          return <div className="max-w-48 rounded-md border p-2" style={chartTooltip}>
            <p className="mb-1 font-semibold">Tháng {label}</p>
            <ul className="space-y-1">{rows.map(({ name, color, value }) => <li key={name} style={{ color }}>
              {name} · <strong>{formatVnd(value)}</strong>
            </li>)}</ul>
          </div>
        }} />
        {range && <Area name="Kịch bản quỹ mở" dataKey="range" stroke="none" fill={chartColors.green} fillOpacity={0.14} isAnimationActive={false} />}
        {visible.map(({ key, label, color }) => <Line key={key} name={label} dataKey={key} stroke={color}
          strokeWidth={key === 'fund' ? 2.25 : 2} strokeDasharray={key === 'contributed' ? '5 3' : undefined}
          dot={false} connectNulls isAnimationActive={false} />)}
      </ComposedChart>
    </FinancialChartFrame> : <p className="py-12 text-center text-sm text-muted-foreground">Bật một kênh để xem đường tăng trưởng.</p>}
    <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {series.map(({ key, label, values, color, scenario }) => <div key={key} className="min-w-0 rounded-lg bg-muted/60 p-2.5">
        <dt className="text-xs font-semibold" style={{ color }}>{label}</dt>
        <dd className="mt-1 text-sm font-bold tabular-nums [overflow-wrap:anywhere]">{formatVnd(values.get(term))}</dd>
        <dd className="text-xs text-muted-foreground">{key === 'contributed' ? 'Vốn gốc' : formatInvestmentReturn(scenario.netProfitVnd, scenario.totalContributedVnd)}</dd>
      </div>)}
    </dl>
  </ChartCard>
}
