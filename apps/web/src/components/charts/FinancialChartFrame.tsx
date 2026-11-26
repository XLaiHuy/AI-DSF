'use client'

import type { ReactNode } from 'react'
import { ResponsiveContainer } from 'recharts'

export const chartColors = {
  green: '#0f5132', navy: '#1e3a5f', amber: '#b45309', red: '#b42318', ink: '#111827',
  slate: '#526178', grid: '#e5e7eb',
}
export const chartAxis = { fontSize: 11, fill: '#4b5563' }
export const chartTooltip = {
  backgroundColor: '#fff', color: '#111827', borderColor: '#d1d5db', fontSize: 12, fontVariantNumeric: 'tabular-nums',
}
const compact = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 })
export const compactValue = (value: number) => compact.format(value)
export const percentTick = (value: number) => compact.format(value) + '%'

export function FinancialChartFrame({ height, children }: { height: number; children: ReactNode }) {
  return <div className="min-w-0 overflow-hidden tabular-nums" style={{ height }}>
    <ResponsiveContainer width="100%" height={height} minWidth={0} initialDimension={{ width: 280, height }}>
      {children}
    </ResponsiveContainer>
  </div>
}
