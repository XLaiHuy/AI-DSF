'use client'

import { useQuery } from '@tanstack/react-query'
import { ROUTES } from '@fincopilot/shared-types'
import Link from 'next/link'
import { marketOverviewQuery } from '@/lib/workspace-data'
import { ChartCard } from './ChartCard'

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

  const fmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 4 })
  const floor = Math.min(0, ...rates.map(row => row.minRatePct))
  const span = Math.max(...rates.map(row => row.maxRatePct)) - floor || 1
  const position = (rate: number) => (rate - floor) / span * 100 + '%'
  const latest = rates.map(row => row.latestEffectiveDate).sort().at(-1)
  return <ChartCard title="Mặt bằng lãi suất & lợi suất đang niêm yết" kicker="MARKET FEED · BENCHMARK" className={className} unit="% / năm"
    legend={[{ label: 'Biên độ vay', color: '#c25a46' }, { label: 'Biên độ đầu tư', color: '#397561' }, { label: 'Trung vị', color: '#161719' }]}>
    {(['LOAN', 'INVESTMENT'] as const).map(group => <section key={group} className="mb-5">
      <h3 className="font-semibold">{group === 'LOAN' ? 'Lãi suất vay niêm yết' : 'Lãi suất tiết kiệm & Quỹ mở'}</h3>
      <p className="text-sm text-muted-foreground">{group === 'LOAN' ? 'Lãi thấp hơn có lợi khi các điều kiện và phí tương đương.' : 'Lợi suất tham khảo. Giá trị quỹ mở biến động theo NAV.'}</p>
      {rates.filter(row => row.group === group).map(row => {
        const isSingleRate = Math.abs(row.maxRatePct - row.minRatePct) < 0.0001
        const color = group === 'LOAN' ? '#c25a46' : '#397561'
        const sample = `${row.sampleCount} gói niêm yết`
        const institutions = row.institutions.join(', ')
        const details = [sample, institutions].filter(Boolean).join(' · ')
        return <div key={row.category} className="mt-3" title={details}>
          <div className="flex flex-wrap justify-between gap-1 text-sm tabular-nums">
            <strong>{row.label}</strong>
            {isSingleRate
              ? <span>{fmt.format(row.medianRatePct)}% · {sample}</span>
              : <span>{fmt.format(row.minRatePct)}% – {fmt.format(row.maxRatePct)}% · Trung vị {fmt.format(row.medianRatePct)}%</span>}
          </div>
          {!isSingleRate && <span className="sr-only">{details}</span>}
          {isSingleRate && institutions && <span className="sr-only">{institutions}</span>}
          <div aria-hidden="true" className="relative mx-2 my-2 h-2 rounded-full bg-muted">
            {isSingleRate ? <span data-testid="benchmark-rate-dot"
              className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#161719]"
              style={{ left: position(row.medianRatePct), backgroundColor: color }} />
              : <>
                <span className="absolute inset-y-0 rounded-full" style={{ left: position(row.minRatePct),
                  right: `calc(100% - ${position(row.maxRatePct)})`, minWidth: '8px', backgroundColor: color }} />
                <span className="absolute -top-1 h-4 w-1 -translate-x-1/2 bg-[#161719]" style={{ left: position(row.medianRatePct) }} />
              </>}
          </div>
        </div>
      })}
    </section>)}
    <footer className="space-y-1 border-t pt-3 text-sm"><strong>Xác thực dữ liệu</strong>
      <p>{rates.reduce((sum, row) => sum + row.sampleCount, 0)} gói đang hoạt động · Hiệu lực mới nhất {latest?.split('-').reverse().join('/')}</p>
      <p>{[...new Set(rates.flatMap(row => row.institutions))].join(', ')}</p>
      <Link className="font-semibold text-primary underline" href={ROUTES.survey}>Mô phỏng khoản vay / tích lũy</Link>
    </footer>
  </ChartCard>
}
