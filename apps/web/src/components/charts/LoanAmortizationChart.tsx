'use client'

import { Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts'
import { summarizeAmortizationForChart, type ScheduleRow } from '../../../../../packages/financial-math/src'
import { formatVnd } from '@/lib/workspace-data'
import { ChartCard } from './ChartCard'
import { chartAxis, chartColors, chartTooltip, compactValue, FinancialChartFrame } from './FinancialChartFrame'

export function LoanAmortizationChart({ schedule, stressSchedule }: {
  schedule: readonly ScheduleRow[]; stressSchedule?: readonly ScheduleRow[]
}) {
  if (!schedule.length) return null
  const yearly = schedule.length > 36
  const points = summarizeAmortizationForChart(schedule, stressSchedule).map((row) => ({
    label: yearly ? 'N' + Math.ceil(row.month / 12) : 'T' + row.month,
    original: row,
    principal: Number(row.principalVnd),
    interest: Number(row.interestVnd),
    fee: Number(row.feeVnd ?? 0),
    balance: Number(row.remainingBalanceVnd),
    stress: row.stressPaymentVnd == null ? undefined : Number(row.stressPaymentVnd),
  }))
  const costs = [
    { key: 'principal', amount: 'principalVnd', label: 'Gốc', color: chartColors.navy },
    { key: 'interest', amount: 'interestVnd', label: 'Lãi', color: chartColors.amber },
    { key: 'fee', amount: 'feeVnd', label: 'Phí tháng', color: chartColors.red },
    { key: 'balance', amount: 'remainingBalanceVnd', label: 'Dư nợ còn lại (trục phải)', color: chartColors.ink },
  ] as const
  const legend = [...costs, ...(stressSchedule ? [{ key: 'stress', amount: 'stressPaymentVnd',
    label: 'Khoản trả khi lãi tăng tối đa 2 điểm %', color: chartColors.green } as const] : [])]
  return <ChartCard title="Lịch trả nợ theo dòng tiền" unit="VNĐ" className="min-w-0"
    subtitle={yearly ? 'Cộng các khoản trả theo năm. Dư nợ lấy cuối mỗi năm vay.' : 'Gốc, lãi, phí và dư nợ cuối mỗi tháng.'}
    legend={legend}>
    <FinancialChartFrame height={240}>
      <ComposedChart data={points} accessibilityLayer margin={{ top: 6, right: 8, bottom: 2, left: 0 }}>
        <CartesianGrid yAxisId="payment" vertical={false} stroke={chartColors.grid} />
        <XAxis dataKey="label" tick={chartAxis} tickLine={false} minTickGap={20} />
        <YAxis yAxisId="payment" tick={chartAxis} tickLine={false} axisLine={false} width={50} tickFormatter={compactValue} />
        <YAxis yAxisId="balance" orientation="right" tick={chartAxis} tickLine={false} axisLine={false} width={50} tickFormatter={compactValue} />
        <Tooltip contentStyle={chartTooltip} labelFormatter={(label) => (yearly ? 'Năm ' : 'Tháng ') + String(label).slice(1)}
          formatter={(value, name, item) => {
            const field = legend.find(({ label }) => label === name)?.amount
            const point = item.payload as (typeof points)[number] | undefined
            return [formatVnd(field && point?.original[field] || String(value ?? '0')), name]
          }} />
        {costs.slice(0, 3).map(({ key, label, color }) => <Bar key={key} name={label} dataKey={key} fill={color}
          yAxisId="payment" stackId="payment" maxBarSize={28} isAnimationActive={false} />)}
        <Line yAxisId="balance" name={costs[3].label} dataKey="balance" stroke={chartColors.ink} strokeWidth={1.75} dot={false} isAnimationActive={false} />
        {stressSchedule && <Line name={legend.at(-1)?.label} dataKey="stress" stroke={chartColors.green} strokeWidth={1.75}
          yAxisId="payment" strokeDasharray="5 3" dot={false} isAnimationActive={false} />}
      </ComposedChart>
    </FinancialChartFrame>
  </ChartCard>
}
