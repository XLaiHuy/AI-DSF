'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUpRight } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { RadarDailyBriefResponse } from '@fincopilot/shared-types'

export type DailyBriefItem = RadarDailyBriefResponse['items'][number]
export type DailyBriefResponse = RadarDailyBriefResponse

const labels: Record<string, string> = {
  INTEREST_RATE: 'Lãi suất', BANKING: 'Ngân hàng', MARKET: 'Thị trường', POLICY: 'Chính sách',
  INFLATION: 'Lạm phát', FINANCIAL_FRAUD: 'Cảnh báo lừa đảo',
}
const formatter = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })

function formatTime(value: string | null) {
  if (!value) return 'Chưa rõ thời điểm công bố'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Chưa rõ thời điểm công bố' : formatter.format(date)
}

export function RadarDailyBrief({ data, isPending, isError, onRetry }: {
  data?: DailyBriefResponse
  isPending: boolean
  isError: boolean
  onRetry: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const items = data?.items ?? []
  const visibleItems = expanded ? items.slice(0, 10) : items.slice(0, 3)

  return <section className={`radar-daily-brief ${expanded ? 'is-expanded' : ''}`} aria-labelledby="radar-daily-brief-title">
    <header className="radar-daily-brief-head">
      <div><p className="radar-context-kicker">BẢN TIN · {data?.dateLabel ?? 'HÔM NAY'}</p><h2 id="radar-daily-brief-title">Tóm tắt nhanh trong ngày</h2></div>
      {items.length > 3 && <button type="button" className="radar-daily-brief-toggle" aria-expanded={expanded} aria-controls="radar-daily-brief-items" onClick={() => setExpanded((value) => !value)}>
        {expanded ? 'Thu gọn' : 'Xem đầy đủ'} {expanded ? <ArrowDown className="is-up" size={14} aria-hidden="true" /> : <ArrowUpRight size={14} aria-hidden="true" />}
      </button>}
    </header>
    {isPending && <p className="radar-daily-brief-state" role="status">Đang tổng hợp tin có nguồn dẫn…</p>}
    {isError && <div className="radar-daily-brief-state" role="status"><span>Chưa tải được bản tin hôm nay.</span> <button type="button" onClick={onRetry}>Thử lại</button></div>}
    {!isPending && !isError && data?.status === 'EMPTY' && <p className="radar-daily-brief-state">Chưa có nội dung đủ nguồn để tóm tắt hôm nay.</p>}
    {!isPending && !isError && items.length > 0 && <>
      {(data?.status === 'SOURCE_FALLBACK' || data?.isStale) && <p className="radar-daily-brief-status">
        {data?.status === 'SOURCE_FALLBACK' ? 'Bản tin nguồn gần đây · AI hiện chưa khả dụng' : ''}
        {data?.isStale && <span> · Dữ liệu mới nhất đã quá 24 giờ</span>}
      </p>}
      <ol id="radar-daily-brief-items" className="radar-daily-brief-items" aria-label={`Tóm tắt ngày ${data?.dateLabel ?? ''}`}>
        {visibleItems.map((item, index) => <li className="radar-daily-brief-item" key={item.id} style={{ '--brief-index': index } as CSSProperties}>
          <div className="radar-daily-brief-item-heading"><span className="radar-daily-brief-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span className="radar-daily-brief-category">{labels[item.category] ?? item.category}</span>
            {item.verificationStatus && <span className={`radar-daily-brief-verification ${item.verificationStatus === 'VERIFIED' ? 'is-verified' : 'is-unverified'}`}>{item.verificationStatus === 'VERIFIED' ? 'Đã xác minh' : 'Chưa xác minh'}</span>}
          </div>
          <p className="radar-daily-brief-summary"><span>{item.generatedByAi ? 'Tóm lược AI' : 'Tiêu đề nguồn'}</span> {item.summary}</p>
          {item.interpretation && <p className="radar-daily-brief-interpretation"><span>Góc nhìn AI</span> {item.interpretation}</p>}
          {item.relevance && <p className="radar-daily-brief-relevance"><span>Có thể liên quan</span> {item.relevance}</p>}
          <p className="radar-daily-brief-reason">{item.inclusionReason}</p>
          <div className="radar-daily-brief-citations">
            {item.citations.map((citation, citationIndex) => <a key={`${item.id}-${citation.url}`} href={citation.url} target="_blank" rel="noreferrer">
              <span>{citation.sourceName}{citation.sourceTitle ? ` · ${citation.sourceTitle}` : ''}</span><span className="radar-daily-brief-citation-time">{citation.publishedAt ? formatTime(citation.publishedAt) : ''}</span><span className="sr-only">mở trong tab mới</span>{citationIndex === 0 && <ArrowUpRight size={12} aria-hidden="true" />}
            </a>)}
            {item.publishedAt && <time dateTime={item.publishedAt}>Công bố {formatTime(item.publishedAt)}</time>}
          </div>
        </li>)}
      </ol>
      <p className="radar-daily-brief-updated">Cập nhật {formatTime(data?.updatedAt ?? null)}</p>
    </>}
  </section>
}
