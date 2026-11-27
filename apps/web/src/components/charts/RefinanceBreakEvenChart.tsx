'use client'

import type { SurveyRefinanceResponse } from '@fincopilot/shared-types'
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { formatVnd } from '@/lib/workspace-data'
import { ChartCard } from './ChartCard'
import { chartAxis, chartColors, chartTooltip, compactValue, FinancialChartFrame } from './FinancialChartFrame'

const series = [
  { key: 'current', label: 'Giữ hợp đồng', color: chartColors.navy },
  { key: 'refinance', label: 'Đổi khoản vay', color: chartColors.green },
] as const

export function RefinanceBreakEvenChart({ points, month }: {
  points: SurveyRefinanceResponse['offers'][number]['result']['comparisonPoints']; month: number | null
}) {
  // Recharts needs numeric coordinates. Tooltip values come from the original Decimal strings.
  const plot = points.map((point) => ({
    month: point.month, current: Number(point.currentCumulativeVnd), refinance: Number(point.refinanceCumulativeVnd),
  }))
  const exact = new Map(points.map((point) => [point.month, point]))
  return <ChartCard title="Điểm hòa vốn theo thời gian" unit="VNĐ" className="min-w-0" legend={[...series]}
    subtitle="Cộng dồn các khoản đã trả. Đường đổi khoản vay tính phí chuyển đổi ngay từ đầu.">
    <FinancialChartFrame height={220}>
      <LineChart data={plot} accessibilityLayer margin={{ top: 8, right: 10, left: 0, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke={chartColors.grid} />
        <XAxis type="number" dataKey="month" domain={['dataMin', 'dataMax']} tick={chartAxis} tickLine={false}
          tickFormatter={(value: number) => 'T' + value} minTickGap={16} />
        <YAxis tick={chartAxis} tickLine={false} axisLine={false} width={43} tickFormatter={compactValue} />
        <Tooltip contentStyle={chartTooltip} labelFormatter={(label) => 'Tháng ' + String(label)}
          formatter={(_value, name, item) => {
            const point = exact.get(item.payload?.month)
            return [formatVnd(item.dataKey === 'current' ? point?.currentCumulativeVnd : point?.refinanceCumulativeVnd), name]
          }} />
        {month !== null && <ReferenceLine x={month} stroke={chartColors.amber} strokeDasharray="4 3" />}
        {series.map(({ key, label, color }) => <Line key={key} dataKey={key} name={label} stroke={color}
          strokeWidth={2.5} dot={false} isAnimationActive={false} />)}
      </LineChart>
    </FinancialChartFrame>
  </ChartCard>
}
