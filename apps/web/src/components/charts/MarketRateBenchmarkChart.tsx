'use client'

import { useQuery } from '@tanstack/react-query'
import { ROUTES } from '@fincopilot/shared-types'
import Link from 'next/link'
import { marketOverviewQuery } from '@/lib/workspace-data'
import { ChartCard } from './ChartCard'

const fmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 4 })

function rateAxis(min: number, max: number) {
  const roughStep = (max - min || 1) / 3
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const step = ([1, 1.5, 2, 2.5, 3, 5, 7.5, 10].find(value => value * magnitude >= roughStep) ?? 10) * magnitude
  const first = Math.floor(min / step)
  const last = Math.ceil(max / step) || (first === 0 ? 3 : 0)
  return {
    ticks: Array.from({ length: last - first + 1 }, (_, index) => (first + index) * step),
    percent: (rate: number) => (rate / step - first) / (last - first) * 100,
  }
}

export function MarketRateBenchmarkChart({ className }: { className?: string }) {
  const { data, isPending } = useQuery(marketOverviewQuery)
  const rates = data?.marketRates ?? []

  if (isPending) {
    return (
      <ChartCard
        title="Mặt bằng lãi suất & lợi suất thị trường"
        kicker="THỊ TRƯỜNG"
        unit="% / năm"
        className={className}
      >
        <div className="h-52 animate-pulse rounded bg-muted/40" aria-busy="true" />
      </ChartCard>
    )
  }

  if (!rates.length) return null

  const latest = rates.map(row => row.latestEffectiveDate).sort().at(-1)
  return <ChartCard title="Mặt bằng lãi suất & lợi suất đang niêm yết" kicker="THỊ TRƯỜNG" className={className} unit="% / năm"
    legend={[{ label: 'Biên độ vay', color: '#c25a46' }, { label: 'Biên độ đầu tư', color: '#397561' }, { label: 'Trung vị', color: '#161719' }]}>
    {(['LOAN', 'INVESTMENT'] as const).map(group => {
      const rows = rates.filter(row => row.group === group)
      if (!rows.length) return null
      const { ticks, percent } = rateAxis(Math.min(0, ...rows.map(row => row.minRatePct)), Math.max(0, ...rows.map(row => row.maxRatePct)))
      const color = group === 'LOAN' ? '#c25a46' : '#397561'
      return <section key={group} className="mb-5" data-testid={`benchmark-group-${group}`}>
        <h3 className="font-semibold">{group === 'LOAN' ? 'Lãi suất vay niêm yết' : 'Lãi suất tiết kiệm & Quỹ mở'}</h3>
        <p className="text-sm text-muted-foreground">{group === 'LOAN' ? 'Lãi thấp hơn có lợi khi các điều kiện và phí tương đương.' : 'Lợi suất quỹ mở chỉ để tham khảo và có thể thay đổi.'}</p>
        {rows.map(row => {
          const isSingleRate = row.maxRatePct === row.minRatePct
          const start = percent(row.minRatePct)
          const end = percent(row.maxRatePct)
          const median = percent(row.medianRatePct)
          const width = Math.max(end - start, 1.5)
          const left = Math.max(0, Math.min(100 - width, (start + end - width) / 2))
          const sample = `${row.sampleCount} gói`
          const institutions = row.institutions.join(', ')
          const details = [sample + ' niêm yết', institutions].filter(Boolean).join(' · ')
          return <div key={row.category} className="mt-3" title={details}>
            <div className="flex flex-wrap justify-between gap-1 text-sm tabular-nums">
              <strong>{row.label}</strong>
              {isSingleRate
                ? <span>{fmt.format(row.medianRatePct)}% · {sample} niêm yết</span>
                : <span>{fmt.format(row.minRatePct)}% – {fmt.format(row.maxRatePct)}% · Trung vị {fmt.format(row.medianRatePct)}% · {sample}</span>}
            </div>
            {institutions && <span className="sr-only">{institutions}</span>}
            <div aria-hidden="true" className="relative mx-2 my-2 h-2 rounded-full bg-muted">
              {isSingleRate ? <span data-testid="benchmark-rate-dot"
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#161719]"
                style={{ left: `${median}%`, backgroundColor: color }} />
                : <>
                  <span data-testid="benchmark-rate-range" className="absolute inset-y-0 rounded-full"
                    style={{ left: `${left}%`, width: `${width}%`, backgroundColor: color }} />
                  <span data-testid="benchmark-rate-median" className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 bg-[#161719]" style={{ left: `${median}%` }} />
                </>}
            </div>
          </div>
        })}
        <div className="relative mx-2 mt-3 h-7 border-t text-xs tabular-nums text-muted-foreground" aria-label="Thang tỷ lệ theo năm" data-testid="benchmark-rate-axis">
          {ticks.map((tick, index) => {
            const align = index === 0 ? 'items-start' : index === ticks.length - 1 ? '-translate-x-full items-end' : '-translate-x-1/2 items-center'
            return <span className={`absolute flex flex-col ${align}`} key={tick} style={{ left: `${percent(tick)}%` }}>
              <span className="mb-1 h-1.5 w-px bg-current" aria-hidden="true" />{fmt.format(tick)}%
            </span>
          })}
        </div>
      </section>
    })}
    <footer className="space-y-1 border-t pt-3 text-sm"><strong>Nguồn số liệu</strong>
      <p>Trung vị là mức ở giữa các gói niêm yết, ít bị kéo lệch bởi vài gói có tỷ lệ quá cao hoặc quá thấp.</p>
      <p>{rates.reduce((sum, row) => sum + row.sampleCount, 0)} gói đang hoạt động · Hiệu lực mới nhất {latest?.split('-').reverse().join('/')}</p>
      <p>{[...new Set(rates.flatMap(row => row.institutions))].join(', ')}</p>
      <Link className="font-semibold text-primary underline" href={ROUTES.survey}>Tính thử khoản vay &amp; tích lũy</Link>
    </footer>
  </ChartCard>
}
