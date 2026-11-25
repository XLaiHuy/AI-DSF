'use client'

import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ROUTES } from '@fincopilot/shared-types'
import Link from 'next/link'
import { marketOverviewQuery } from '@/lib/workspace-data'
import { ChartCard } from './ChartCard'

const barPalette: Record<string, string> = {
  SECURED_LOAN: '#0f5132',
  UNSECURED_LOAN: '#b45309',
  SAVING: '#1e3a5f',
  ACCUMULATION: '#3b6e5c',
  OPEN_FUND: '#111827',
}

export function MarketRateBenchmarkChart({ className }: { className?: string }) {
  const { data, isPending } = useQuery(marketOverviewQuery)
  const rates = data?.marketRates ?? []

  if (isPending) {
    return (
      <ChartCard
        title="Mặt bằng lãi suất & lợi suất thị trường"
        kicker="MARKET BENCHMARK"
        unit="% / năm"
        className={className}
      >
        <div className="h-52 animate-pulse rounded bg-muted/40" aria-busy="true" />
      </ChartCard>
    )
  }

  if (!rates.length) return null

  const chartData = rates.map((item) => ({
    ...item,
    spread: Number((item.maxRatePct - item.minRatePct).toFixed(2)),
    fill: barPalette[item.category] ?? '#1f2937',
  }))

  return (
    <ChartCard
      title="Mặt bằng lãi suất & lợi suất đang niêm yết"
      subtitle="Tổng hợp theo dữ liệu danh mục đã đối chiếu nguồn chính thức (mức trung vị và biên độ)."
      kicker="MARKET FEED · BENCHMARK"
      unit="% / năm"
      className={className}
      legend={[
        { label: 'Mức trung vị (% / năm)', color: '#111827' },
        { label: 'Vay vốn', color: '#b45309' },
        { label: 'Tiết kiệm & Quỹ', color: '#1e3a5f' },
      ]}
      summaryText={chartData
        .map((row) => `${row.label}: trung vị ${row.medianRatePct}% (${row.minRatePct}% – ${row.maxRatePct}%)`)
        .join('; ')}
    >
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height={224} minWidth={0} initialDimension={{ width: 520, height: 224 }}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
            <CartesianGrid stroke="#e5e7eb" strokeDasharray="2 2" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: '#4b5563' }}
              tickFormatter={(value: number) => `${value}%`}
              axisLine={{ stroke: '#d1d5db' }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={96}
              tick={{ fontSize: 12, fill: '#111827', fontWeight: 500 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value, _name, item) => {
                const payload = item?.payload as (typeof chartData)[number] | undefined
                if (!payload) return [`${String(value ?? '')}%`, 'Trung vị']
                return [
                  `${payload.medianRatePct}% (từ ${payload.minRatePct}% – ${payload.maxRatePct}%, ${payload.sampleCount} gói)`,
                  payload.label,
                ]
              }}
              contentStyle={{
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '12px',
                backgroundColor: '#ffffff',
              }}
            />
            <Bar dataKey="medianRatePct" radius={[0, 3, 3, 0]} barSize={18}>
              {chartData.map((entry) => (
                <Cell key={entry.category} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
        <span>Cập nhật trực tiếp từ danh mục ngân hàng &amp; quỹ được cấp phép.</span>
        <Link href={ROUTES.survey} className="font-semibold text-foreground underline underline-offset-4 hover:text-primary">
          Mô phỏng khoản vay / tích lũy
        </Link>
      </div>
    </ChartCard>
  )
}
