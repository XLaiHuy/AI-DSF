'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowUpRight, Clock3, ExternalLink, RefreshCw, Search } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Button, Input } from '@/components/ui'
import { ApiError, apiClient } from '@/lib/api-client'

type Source = { sourceKey: string; name: string; lastFetchStatus: string | null; lastAttemptAt: string | null; lastSuccessAt: string | null }
type ArticleSource = { sourceName: string; url: string; firstSeenAt?: string | null; lastSeenAt?: string | null }
type Article = { id: string; title: string; canonicalUrl: string; publishedAt: string | null; categories: string[]; sources: ArticleSource[] }
type AlertItem = { id: string; threatCategory: string; tacticSummary: string; verificationStatus: string; publishedAt: string | null; evidence: { sourceName: string }[] }

const categoryLabels: Record<string, string> = { INTEREST_RATE: 'Lãi suất', BANKING: 'Ngân hàng', MARKET: 'Thị trường', POLICY: 'Chính sách', FINANCIAL_FRAUD: 'Lừa đảo tài chính' }

const dateTimeFormat = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  timeZone: 'Asia/Ho_Chi_Minh',
})

function formatDateTime(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : dateTimeFormat.format(date)
}

function sourceState(status: string | null) {
  if (status === 'SUCCESS') return { label: 'Hoạt động', className: 'text-[#176B49]', mark: '●' }
  if (status === 'ERROR') return { label: 'Có lỗi', className: 'text-[#A62D25]', mark: '!' }
  return { label: 'Chưa quét', className: 'text-[#65736B]', mark: '—' }
}

export default function RadarPage() {
  const [tab, setTab] = useState<'articles' | 'alerts'>('articles')
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const articles = useQuery({ queryKey: ['radar-articles', category, search], queryFn: () => apiClient.get<{ items: Article[]; page: { hasMore: boolean; nextCursor: string | null }; sources: Source[] }>(`/radar/articles?${new URLSearchParams({ ...(category ? { category } : {}), ...(search ? { search } : {}) })}`) })
  const alerts = useQuery({ queryKey: ['radar-alerts'], queryFn: () => apiClient.get<{ items: AlertItem[] }>('/radar/alerts') })
  const staleSources = useMemo(() => (articles.data?.sources ?? []).filter((source) => source.lastFetchStatus === 'ERROR'), [articles.data])

  return <div className="mx-auto max-w-[1120px] space-y-8 px-5 py-7 sm:px-8 sm:py-10">
    <header className="border-b border-[#D9E1DA] pb-6 sm:pb-8">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#145C46]">
        <span className="size-1.5 rounded-full bg-[#145C46]" aria-hidden="true" /> FinCopilot / Radar
      </div>
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div className="max-w-2xl">
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.04em] text-[#17231D] sm:text-[36px]">Tin tức thị trường</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#52635A] sm:text-[15px]">Nguồn gốc và thời điểm được giữ rõ. Nhận định AI được trình bày riêng ở phần phân tích.</p>
        </div>
        <div className="flex items-baseline gap-2 text-sm text-[#52635A]">
          <span className="font-mono text-base font-semibold tabular-nums text-[#17231D]">{articles.data?.sources.length ? articles.data.sources.length : '—'}</span>
          <span>nguồn theo dõi</span>
        </div>
      </div>
    </header>

    <div className="grid gap-9 lg:grid-cols-[minmax(0,1fr)_268px] lg:gap-12">
      <section className="min-w-0" aria-label="Bản tin Radar">
        <div className="mb-5 space-y-4 border-b border-[#D9E1DA] pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-5" role="group" aria-label="Loại nội dung">
              <button type="button" aria-pressed={tab === 'articles'} onClick={() => setTab('articles')} className={`min-h-11 border-b-2 px-0.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145C46] ${tab === 'articles' ? 'border-[#145C46] text-[#145C46]' : 'border-transparent text-[#65736B] hover:text-[#17231D]'}`}>Tin thị trường</button>
              <button type="button" aria-pressed={tab === 'alerts'} onClick={() => setTab('alerts')} className={`min-h-11 border-b-2 px-0.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145C46] ${tab === 'alerts' ? 'border-[#145C46] text-[#145C46]' : 'border-transparent text-[#65736B] hover:text-[#17231D]'}`}>Cảnh báo lừa đảo</button>
            </div>
            {tab === 'articles' && <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <label className="relative min-w-0 flex-1 sm:w-[220px]">
                <span className="sr-only">Tìm tin theo tiêu đề</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#65736B]" size={15} aria-hidden="true" />
                <Input aria-label="Tìm tin theo tiêu đề" className="h-10 rounded-md border-[#D9E1DA] bg-white pl-9 text-sm shadow-none focus-visible:ring-[#145C46]" placeholder="Tìm theo tiêu đề" value={search} onChange={(event) => setSearch(event.target.value)} />
              </label>
              <label className="min-w-0 sm:w-[166px]">
                <span className="sr-only">Lọc chủ đề</span>
                <select aria-label="Lọc chủ đề" className="h-10 w-full rounded-md border border-[#D9E1DA] bg-white px-3 text-sm text-[#17231D] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145C46]" value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="">Mọi chủ đề</option>{Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </label>
            </div>}
          </div>
        </div>

        {staleSources.length > 0 && <div role="status" className="mb-4 flex gap-2 border-l-2 border-[#A62D25] bg-[#FBF3F1] px-3 py-2.5 text-sm leading-5 text-[#67241F]">
          <AlertTriangle className="mt-0.5 shrink-0" size={15} aria-hidden="true" />
          <p><span className="font-semibold">Một số nguồn đang gián đoạn:</span> {staleSources.map((source) => source.name).join(', ')}. Tin hiện có giữ nguyên thời điểm xuất bản.</p>
        </div>}

        {tab === 'articles' ? <div aria-label="Tin tức" className="divide-y divide-[#D9E1DA] border-t border-[#D9E1DA]">
          {articles.isPending && <p role="status" className="py-8 text-sm text-[#52635A]">Đang tải tin…</p>}
          {articles.isError && <div className="flex flex-wrap items-center justify-between gap-3 py-6"><p role="alert" className="text-sm text-[#67241F]">{articles.error instanceof ApiError ? articles.error.message : 'Không tải được Radar.'} Hãy kiểm tra kết nối rồi thử lại.</p><Button variant="outline" size="sm" onClick={() => void articles.refetch()}><RefreshCw size={14} aria-hidden="true"/> Thử lại</Button></div>}
          {articles.data?.items.map((article) => <article key={article.id} className="py-6 first:pt-6 sm:py-7">
            <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#145C46]">
              {article.categories.length ? article.categories.map((item) => <span key={item}>{categoryLabels[item] ?? item}</span>) : <span>Tin thị trường</span>}
            </div>
            <h2 className="max-w-3xl text-[21px] font-semibold leading-[1.35] tracking-[-0.025em] text-[#17231D] sm:text-[25px]">
              <Link href={`/radar/${article.id}`} className="decoration-[#145C46] decoration-1 underline-offset-4 hover:text-[#145C46] hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#145C46]">{article.title}</Link>
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-5 text-[#52635A]">
              <Clock3 size={14} className="shrink-0" aria-hidden="true" />
              <span>{article.publishedAt ? <>Công bố <time dateTime={article.publishedAt}>{formatDateTime(article.publishedAt) ?? 'chưa rõ thời gian'}</time></> : 'Chưa rõ thời gian công bố'}</span>
              {article.sources.map((source, index) => <span key={`${source.sourceName}-${source.url}`} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true">·</span><span className="font-medium text-[#17231D]">{source.sourceName}</span>
                {index === article.sources.length - 1 && formatDateTime(source.firstSeenAt) && <span className="text-[#65736B]">· Thu thập lần đầu {formatDateTime(source.firstSeenAt)}</span>}
              </span>)}
              {article.sources.length === 0 && <span>· Chưa rõ nguồn</span>}
            </div>
            <div className="mt-4 flex items-center gap-5 text-[13px] font-semibold">
              <Link href={`/radar/${article.id}`} className="inline-flex min-h-9 items-center gap-1 text-[#145C46] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145C46]">Mở phân tích <ArrowUpRight size={14} aria-hidden="true" /></Link>
              {article.sources.map((source) => <a key={`${source.sourceName}-${source.url}-original`} className="inline-flex min-h-9 items-center gap-1 text-[#52635A] hover:text-[#17231D] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145C46]" href={source.url} target="_blank" rel="noreferrer">Bài gốc <ExternalLink size={13} aria-hidden="true"/><span className="sr-only"> mở trong tab mới</span></a>)}
            </div>
          </article>)}
          {articles.data?.items.length === 0 && <div className="py-10"><p className="text-xl font-semibold text-[#17231D]">Không có tin phù hợp</p><p className="mt-2 text-sm leading-6 text-[#52635A]">Thử bỏ bớt bộ lọc hoặc đổi chủ đề.</p></div>}
        </div> : <div aria-label="Cảnh báo lừa đảo" className="divide-y divide-[#D9E1DA] border-t border-[#D9E1DA]">
          {alerts.isPending && <p role="status" className="py-8 text-sm text-[#52635A]">Đang tải cảnh báo…</p>}
          {alerts.isError && <div className="py-6"><p role="alert" className="text-sm text-[#67241F]">Không tải được cảnh báo.</p><Button className="mt-3" variant="outline" size="sm" onClick={() => void alerts.refetch()}><RefreshCw size={14} aria-hidden="true"/> Thử lại</Button></div>}
          {alerts.data?.items.map((alert) => <article key={alert.id} className="py-6 sm:py-7">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#52635A]">
              <span>{alert.threatCategory}</span><span aria-hidden="true">·</span>
              <span className={`normal-case tracking-normal ${alert.verificationStatus === 'VERIFIED' ? 'text-[#176B49]' : 'text-[#8A5A08]'}`}>
                {alert.verificationStatus === 'VERIFIED' ? 'Đã xác minh' : 'Chưa xác minh'}
              </span>
            </div>
            <h2 className="max-w-3xl text-[21px] font-semibold leading-[1.35] tracking-[-0.025em] text-[#17231D] sm:text-[25px]"><Link href={`/radar/${alert.id}?kind=alert`} className="hover:text-[#145C46] hover:underline hover:decoration-1 hover:underline-offset-4">{alert.tacticSummary}</Link></h2>
            <p className="mt-3 text-[13px] leading-5 text-[#52635A]">{alert.publishedAt ? <>Công bố <time dateTime={alert.publishedAt}>{formatDateTime(alert.publishedAt) ?? 'chưa rõ thời gian'}</time></> : 'Chưa rõ thời điểm công bố'}{alert.evidence.length > 0 && <> · Dẫn chứng từ {alert.evidence.map((item) => item.sourceName).join(', ')}</>}</p>
            <Link href={`/radar/${alert.id}?kind=alert`} className="mt-3 inline-flex min-h-9 items-center gap-1 text-[13px] font-semibold text-[#145C46] hover:underline">Xem dấu hiệu và bằng chứng <ArrowUpRight size={14} aria-hidden="true" /></Link>
          </article>)}
          {alerts.data?.items.length === 0 && <div className="py-10"><p className="text-xl font-semibold text-[#17231D]">Chưa có cảnh báo được công bố</p><p className="mt-2 text-sm leading-6 text-[#52635A]">Chỉ cảnh báo đã công bố mới xuất hiện tại đây.</p></div>}
        </div>}
      </section>

      <aside aria-label="Trạng thái nguồn" className="border-t border-[#D9E1DA] pt-5 lg:border-t-0 lg:border-l lg:pl-7 lg:pt-0">
        <h2 className="text-sm font-semibold text-[#17231D]">Trạng thái nguồn</h2>
        <p className="mt-1 text-xs leading-5 text-[#65736B]">Lần quét gần nhất được hiển thị theo dữ liệu hệ thống.</p>
        {articles.data?.sources.length ? <ul className="mt-4 divide-y divide-[#E6EBE6]">
          {articles.data.sources.map((source) => {
            const state = sourceState(source.lastFetchStatus)
            return <li key={source.sourceKey} className="flex items-start justify-between gap-3 py-3 first:pt-0">
              <div className="min-w-0"><p className="text-sm font-medium text-[#17231D]">{source.name}</p><p className="mt-1 text-xs text-[#65736B]">{source.lastSuccessAt ? `Thành công ${formatDateTime(source.lastSuccessAt)}` : source.lastAttemptAt ? `Thử gần nhất ${formatDateTime(source.lastAttemptAt)}` : 'Chưa có lần quét'}</p></div>
              <span className={`shrink-0 text-xs font-semibold ${state.className}`}><span aria-hidden="true">{state.mark}</span><span className="sr-only"> trạng thái </span> {state.label}</span>
            </li>
          })}
        </ul> : <p className="mt-4 border-l border-[#D9E1DA] py-1 pl-3 text-xs leading-5 text-[#65736B]">Trạng thái nguồn chưa được API cung cấp.</p>}
        <p className="mt-5 border-t border-[#D9E1DA] pt-4 text-xs leading-5 text-[#65736B]">Lỗi lấy tin không làm thay đổi ngày công bố của bài viết.</p>
      </aside>
    </div>
  </div>
}
