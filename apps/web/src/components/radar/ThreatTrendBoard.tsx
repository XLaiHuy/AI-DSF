'use client'

import { ThreatTrendsResponseSchema, type ThreatTrendsQuery, type ThreatTrendsResponse } from '@fincopilot/shared-types'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui'
import { apiClient } from '@/lib/api-client'

const windows = [['7d', '7 ngày'], ['30d', '30 ngày'], ['90d', '90 ngày']] as const
const audiences = [
  ['ALL', 'Tất cả'], ['STUDENT', 'Sinh viên'], ['WORKER', 'Người đi làm'],
  ['BUSINESS_OWNER', 'Chủ hộ kinh doanh'], ['ELDERLY', 'Người cao tuổi'], ['GENERAL', 'Đối tượng chung'],
] as const

export function ThreatTrendBoard() {
  const [expanded, setExpanded] = useState(false)
  const [period, setPeriod] = useState<ThreatTrendsQuery['window']>('7d')
  const [audience, setAudience] = useState<ThreatTrendsQuery['audience']>('ALL')
  const trends = useQuery({
    queryKey: ['radar', 'alert-trends', period, audience],
    queryFn: ({ signal }) => apiClient.get('/radar/alerts/trends?' + new URLSearchParams({ window: period, audience }), { schema: ThreatTrendsResponseSchema, signal }),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const data = trends.data
  const monitoring = data?.mode === 'MONITORING_CATALOG'
  const visible = data?.items.slice(0, 6) ?? []
  const more = data?.items.slice(6) ?? []
  return <section aria-labelledby="threat-trends-title" className="min-w-0 rounded-xl border border-border bg-card px-3 py-1.5 sm:p-6">
    <header className="flex min-w-0 items-center justify-between gap-2">
      <h2 id="threat-trends-title" className="text-base font-semibold sm:text-2xl">Xu hướng thủ đoạn lừa đảo</h2>
      <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0 sm:hidden"
        aria-label="Bộ lọc và danh mục xu hướng" aria-controls="threat-trends-body" aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}>
        <ChevronDown className={expanded ? 'rotate-180' : undefined} aria-hidden="true" />
      </Button>
    </header>
    <div id="threat-trends-body" className={expanded ? 'mt-3 space-y-4 pb-2 sm:pb-0' : 'mt-3 hidden space-y-4 sm:block'}>
      <p className="text-sm text-muted-foreground">Tổng hợp từ cảnh báo đã xác minh trên FinCopilot. Tên thủ đoạn dựa trên danh mục của Cục An toàn thông tin.</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Khoảng thời gian">
        {windows.map(([value, label]) => <Button type="button" size="sm" className="min-h-9" key={value}
          variant={value === period ? 'default' : 'outline'} aria-pressed={value === period} onClick={() => setPeriod(value)}>{label}</Button>)}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Đối tượng theo dõi">
        {audiences.map(([value, label]) => <Button type="button" size="sm" className="min-h-9 h-auto whitespace-normal rounded-full px-2.5" key={value}
          variant={value === audience ? 'default' : 'outline'} aria-pressed={value === audience} onClick={() => setAudience(value)}>{label}</Button>)}
      </div>
      {trends.isPending && <p role="status" className="text-sm text-muted-foreground">Đang tải số liệu cảnh báo…</p>}
      {trends.isError && <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="text-sm">Chưa tải được xu hướng cảnh báo.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void trends.refetch()}>Thử lại</Button>
      </div>}
      {data && <>
        <div aria-live="polite" className="space-y-1.5">
          {monitoring && <h3 className="font-semibold">Danh mục thủ đoạn đang theo dõi</h3>}
          <p className="text-sm">{data.totalVerifiedInWindow} cảnh báo đã xác minh trong kỳ.
            {monitoring && ' Cần ít nhất 5 cảnh báo để đánh giá xu hướng.'}</p>
          {!monitoring && !visible.length && <p className="text-sm">Các cảnh báo trong kỳ chưa được gắn nhóm thủ đoạn.</p>}
        </div>
        {!!visible.length && <ol className="grid gap-2" role="list">{visible.map((item) => <TrendItem key={item.vnAisCode} item={item} />)}</ol>}
        {!!more.length && <details className="text-sm">
          <summary className="cursor-pointer py-2 font-medium">Xem thêm {more.length} thủ đoạn</summary>
          <ol start={visible.length + 1} className="grid gap-2" role="list">{more.map((item) => <TrendItem key={item.vnAisCode} item={item} />)}</ol>
        </details>}
        {!visible.some((item) => item.sampleAlertId) && <ForensicLink href="/forensic" />}
      </>}
    </div>
  </section>
}

function TrendItem({ item }: { item: ThreatTrendsResponse['items'][number] }) {
  return <li className="min-w-0 rounded-lg border border-border bg-muted/40 p-3 [overflow-wrap:anywhere]">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="font-semibold">{item.vnAisLabel}</p>
      {item.trendStatus === 'RISING' && <span className="rounded-full bg-verdict-danger-bg px-2 py-1 text-xs font-semibold text-verdict-danger">Đang tăng mạnh</span>}
    </div>
    <p className="mt-1 text-xs text-muted-foreground">{item.vnAisCode} · {item.gasaCategory}
      {(item.currentCount > 0 || item.previousCount > 0) && <> · {item.currentCount} cảnh báo trong kỳ, {item.previousCount} kỳ trước</>}
    </p>
    {item.sampleAlertId && <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-2 text-sm">
      <Link className="underline underline-offset-2" href={'/radar/' + item.sampleAlertId + '?kind=alert'}>Xem cảnh báo dẫn chứng</Link>
      <ForensicLink href={item.handoffHref} />
    </div>}
  </li>
}

function ForensicLink({ href }: { href: string }) {
  return <Link href={href} className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-primary underline underline-offset-2">
    Đối chiếu trong Giám định <ArrowUpRight size={14} className="shrink-0" aria-hidden="true" />
  </Link>
}
