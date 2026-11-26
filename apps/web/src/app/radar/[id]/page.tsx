'use client'

import { handoffRoutes } from '@fincopilot/shared-types'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight, ExternalLink, ShieldAlert, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'
import { CategoryArtwork } from '@/components/radar/CategoryArtwork'
import { EditorialImage } from '@/components/radar/EditorialImage'
import { recordArticleRead } from '@/components/radar/ReadingStore'
import { ApiError, apiClient } from '@/lib/api-client'

type ArticleDetail = { id: string; title: string; publishedAt: string | null; image?: { url: string; proxyUrl?: string | null; alt: string; credit: string | null; sourceUrl: string | null } | null; categories: string[]; sources: { sourceName: string; sourceId: string; url: string; firstSeenAt: string; lastSeenAt: string }[]; analysis: { mode: string; facts: unknown; assessment: unknown; suggestedRateDelta: string | null } | null }
type AlertDetail = { id: string; threatCategory: string; tacticSummary: string; preventionGuidance: string; verificationStatus: string; issuedAt: string | null; publishedAt?: string | null; verifiedAt?: string | null; indicators: { indicatorType: string; indicatorText: string }[]; evidence: { articleId: string; title: string; sourceName: string; url: string; publishedAt: string | null }[] }
type Analysis = { mode: string; facts: string[]; assessment: string | null; suggestedRateDelta: string | null; assumptions: string[]; citations: { sourceName: string; url: string }[]; unavailable?: boolean }

const dateTimeFormat = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })
const categoryLabels: Record<string, string> = { INTEREST_RATE: 'Lãi suất', BANKING: 'Ngân hàng', MARKET: 'Thị trường', POLICY: 'Chính sách', INFLATION: 'Lạm phát', FINANCIAL_FRAUD: 'Lừa đảo tài chính' }
const categoryLabel = (value: string) => categoryLabels[value] ?? value.replaceAll('_', ' ')
const threatCategoryLabels: Record<string, string> = { PHISHING: 'Lừa đảo qua đường dẫn hoặc tin nhắn', IMPERSONATION: 'Mạo danh', FAKE_LOAN: 'Vay giả mạo', INVESTMENT_SCAM: 'Đầu tư giả mạo' }
const threatCategoryLabel = (value: string) => threatCategoryLabels[value] ?? value.replaceAll('_', ' ').toLocaleLowerCase('vi-VN')
const indicatorLabels: Record<string, string> = { KEYWORD: 'Cụm từ', DOMAIN: 'Tên miền', PHONE: 'Số điện thoại', BANK_ACCOUNT: 'Tài khoản nhận tiền', QR_PATTERN: 'Mẫu QR' }
const isHashedIndicator = (value: string) => /^sha256:[a-f0-9]{64}$/i.test(value)
const concealedIndicator = (type: string, value: string) => isHashedIndicator(value) || type === 'PHONE' || type === 'BANK_ACCOUNT' || type === 'QR_PATTERN'
function formatDateTime(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : dateTimeFormat.format(date)
}

export default function RadarArticlePage() {
  const { id } = useParams<{ id: string }>()
  const search = useSearchParams()
  const isAlert = search.get('kind') === 'alert'
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [analysisError, setAnalysisError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const activeAnalysis = useRef(false)
  const article = useQuery({ queryKey: ['radar-article', id], queryFn: () => apiClient.get<ArticleDetail>(`/radar/articles/${encodeURIComponent(id)}`), enabled: !isAlert })
  const alert = useQuery({ queryKey: ['radar-alert', id], queryFn: () => apiClient.get<AlertDetail>(`/radar/alerts/${encodeURIComponent(id)}`), enabled: isAlert })
  useEffect(() => {
    if (!article.data || isAlert) return
    recordArticleRead({ id: article.data.id, title: article.data.title, publishedAt: article.data.publishedAt, sourceName: article.data.sources[0]?.sourceName ?? null })
  }, [article.data, isAlert])

  async function analyze(mode: 'GENERAL' | 'PERSONALIZED') {
    if (activeAnalysis.current) return
    activeAnalysis.current = true
    setAnalyzing(true)
    setAnalysisError('')
    try { setAnalysis(await apiClient.post<Analysis>(`/radar/articles/${encodeURIComponent(id)}/analyze`, { mode })) }
    catch (error) { setAnalysisError(error instanceof ApiError ? error.message : 'Phân tích chưa khả dụng.') }
    finally {
      activeAnalysis.current = false
      setAnalyzing(false)
    }
  }

  if ((isAlert && alert.isPending) || (!isAlert && article.isPending)) return <div className="radar-detail-state" role="status">Đang tải nội dung…</div>
  if ((isAlert && alert.isError) || (!isAlert && article.isError)) return <div className="radar-detail-state"><p role="alert">{isAlert ? 'Không tải được cảnh báo.' : 'Không tải được bài viết.'}</p><div className="detail-error-actions"><Button variant="outline" onClick={() => void (isAlert ? alert.refetch() : article.refetch())}>Thử lại</Button><Link href="/radar" className="detail-back"><ArrowLeft size={15} aria-hidden="true"/> Quay lại Radar</Link></div></div>

  if (isAlert && alert.data) {
    const verified = alert.data.verificationStatus === 'VERIFIED'
    const visibleIndicator = alert.data.indicators.find((item) => item.indicatorType === 'KEYWORD' && !isHashedIndicator(item.indicatorText))
    const evidenceSources = [...new Set(alert.data.evidence.map((item) => item.sourceName).filter(Boolean))]
    return <div className="radar-detail radar-threat-detail">
      <Link href="/radar" className="detail-back"><ArrowLeft size={15} aria-hidden="true"/> Tất cả tin và cảnh báo</Link>
      <header className="detail-header threat-detail-hero">
        <p className="page-kicker">CẢNH BÁO ĐÃ CÔNG BỐ</p>
        <div className="detail-meta"><span className={`verification-label ${verified ? 'is-verified' : 'is-pending'}`}>{verified ? 'Đã xác minh' : 'Chưa xác minh'}</span><span>{threatCategoryLabel(alert.data.threatCategory)}</span></div>
        <h1>{alert.data.tacticSummary}</h1>
        <p className="threat-detail-dek">Đọc dấu hiệu và nguồn dẫn chứng dưới đây. Nội dung này không thay thế việc kiểm tra trường hợp bạn đang gặp.</p>
        <div className="threat-detail-dates"><span>{alert.data.publishedAt ? <>Công bố <time dateTime={alert.data.publishedAt}>{formatDateTime(alert.data.publishedAt)}</time></> : 'Chưa rõ ngày công bố'}</span>{alert.data.verifiedAt && <span>Xác minh <time dateTime={alert.data.verifiedAt}>{formatDateTime(alert.data.verifiedAt)}</time></span>}{alert.data.issuedAt && <span>Nguồn phát hành <time dateTime={alert.data.issuedAt}>{formatDateTime(alert.data.issuedAt)}</time></span>}</div>
        <p className="threat-detail-source-summary">{evidenceSources.length ? <>Dẫn chứng: {evidenceSources.join(', ')} · <a href="#evidence-heading">Xem nguồn</a></> : 'Chưa có nguồn dẫn chứng được cung cấp.'}</p>
      </header>
      <section className="detail-section threat-detail-section" aria-labelledby="indicators-heading">
        <div className="detail-section-heading"><span className="threat-section-number">01</span><h2 id="indicators-heading">Dấu hiệu cần chú ý</h2></div>
        <p className="detail-intro">Chỉ dấu để đối chiếu, không phải kết luận tự động về mọi trường hợp tương tự.</p>
        {alert.data.indicators.length > 0 ? <ul className="indicator-list">{alert.data.indicators.map((item, i) => <li key={`${item.indicatorType}-${i}`}><span>{indicatorLabels[item.indicatorType] ?? item.indicatorType}</span><code>{concealedIndicator(item.indicatorType, item.indicatorText) ? 'Chỉ dấu được che; đối chiếu trong Giám định' : item.indicatorText}</code></li>)}</ul> : <p className="detail-muted">Chưa có dấu hiệu cụ thể được cung cấp.</p>}
      </section>
      <section className="detail-section threat-detail-section threat-evidence-section" aria-labelledby="evidence-heading">
        <div className="detail-section-heading"><span className="threat-section-number">02</span><h2 id="evidence-heading">Bằng chứng &amp; nguồn</h2></div>
        <p className="detail-intro">Các liên kết bên dưới đến từ dữ liệu nguồn của cảnh báo.</p>
        {alert.data.evidence.length > 0 ? <ul className="evidence-list">{alert.data.evidence.map((item) => <li key={`${item.articleId}-${item.url}`}><span className="threat-evidence-source">{item.sourceName}</span><span className="threat-evidence-title">{item.title}</span>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">Mở nguồn gốc <ExternalLink size={13} aria-hidden="true"/><span className="sr-only"> trong tab mới</span></a> : <span className="detail-muted">Chưa có liên kết nguồn</span>}<p>{item.publishedAt ? <>Nguồn công bố <time dateTime={item.publishedAt}>{formatDateTime(item.publishedAt) ?? 'chưa rõ thời gian'}</time></> : 'Chưa rõ ngày nguồn công bố'}</p></li>)}</ul> : <p className="detail-muted">Chưa có nguồn dẫn chứng được cung cấp.</p>}
      </section>
      <section className="detail-section threat-detail-section threat-precautions" aria-labelledby="prevention-heading">
        <div className="detail-section-heading"><span className="threat-section-number">03</span><ShieldAlert size={17} aria-hidden="true"/><h2 id="prevention-heading">Cách phòng tránh</h2></div>
        {alert.data.preventionGuidance?.trim() ? <p>{alert.data.preventionGuidance}</p> : <p className="detail-muted">Nguồn hiện chưa cung cấp hướng dẫn phòng tránh cụ thể.</p>}
      </section>
      <section className="threat-detail-handoff" aria-labelledby="threat-handoff-heading"><h2 id="threat-handoff-heading">Bạn gặp tình huống tương tự?</h2><p>Đọc cảnh báo không phải là đã giám định trường hợp của bạn.</p><Link className="detail-inline-link" href={`/forensic?from=radar&alertId=${encodeURIComponent(alert.data.id)}${visibleIndicator ? `&indicator=${encodeURIComponent(visibleIndicator.indicatorText)}` : ''}`}>Đối chiếu trong Giám định <ArrowUpRight size={14} aria-hidden="true"/></Link></section>
    </div>
  }

  const data = article.data!
  const assessment = analysis ?? (data.analysis?.assessment as { text?: string } | null)
  const assessmentText = analysis?.assessment ?? (typeof assessment === 'string' ? assessment : assessment && typeof assessment === 'object' && 'text' in assessment ? String(assessment.text ?? '') : '')
  const suggestedRateDelta = analysis?.suggestedRateDelta ?? data.analysis?.suggestedRateDelta ?? null
  return <div className="radar-detail editorial-detail">
    <Link href="/radar" className="detail-back"><ArrowLeft size={15} aria-hidden="true"/> Tất cả tin và cảnh báo</Link>
    <header className="detail-header">
      <div className="detail-meta">{data.categories.map((category) => <span key={category}>{categoryLabel(category)}</span>)}</div>
      <p className="page-kicker">BÀI VIẾT THỊ TRƯỜNG</p>
      <h1>{data.title}</h1>
      <p className="detail-time">{data.publishedAt ? <>Công bố <time dateTime={data.publishedAt}>{formatDateTime(data.publishedAt) ?? 'chưa rõ thời gian'}</time></> : 'Chưa rõ thời gian công bố'}</p>
    </header>
      {data.image && <figure className="detail-source-image"><EditorialImage imageUrl={data.image.url} proxyUrl={data.image.proxyUrl} alt={data.image.alt} credit={data.image.credit} sourceUrl={data.image.sourceUrl} categories={data.categories} /></figure>}
      {!data.image && <figure className="detail-source-image detail-image-fallback"><CategoryArtwork categories={data.categories} /><figcaption>Chưa có ảnh bài viết; đây là minh họa chủ đề, không mô tả sự kiện cụ thể.</figcaption></figure>}

    <section className="detail-section provenance-section" aria-labelledby="provenance-heading">
      <div className="detail-section-heading"><h2 id="provenance-heading">Nguồn gốc</h2></div>
      {data.sources.length > 0 ? <ul className="provenance-list">{data.sources.map((source) => <li key={`${source.sourceId}-${source.url}`}><a href={source.url} target="_blank" rel="noreferrer">{source.sourceName}<ExternalLink size={13} aria-hidden="true"/><span className="sr-only"> mở trong tab mới</span></a><p><span>Thu thập lần đầu</span> <time dateTime={source.firstSeenAt}>{formatDateTime(source.firstSeenAt) ?? 'chưa rõ'}</time><span className="provenance-separator">·</span><span>Gặp gần nhất</span> <time dateTime={source.lastSeenAt}>{formatDateTime(source.lastSeenAt) ?? 'chưa rõ'}</time></p></li>)}</ul> : <p className="detail-muted">Chưa có nguồn gốc được cung cấp.</p>}
    </section>

    {data.categories.includes('FINANCIAL_FRAUD') && <Link className="detail-inline-link" href={handoffRoutes.homeQuickForensic({ prefillText: data.title.slice(0, 2000) })}>
      Đối chiếu dấu hiệu trong Giám định <ArrowUpRight size={14} aria-hidden="true" />
    </Link>}

    <section className="analysis-section" aria-labelledby="analysis-heading">
      <div className="analysis-heading">
        <span className="analysis-mark"><Sparkles size={16} aria-hidden="true"/></span>
        <div><p className="page-kicker">DIỄN GIẢI — KHÔNG PHẢI XÁC MINH</p><h2 id="analysis-heading">Phân tích tác động</h2></div>
      </div>
      <p className="detail-intro">Tin này có thể ảnh hưởng đến lãi suất, chi phí vay hoặc sức mua như thế nào? Phân tích tổng quát là mặc định. Nguồn Radar hiện cung cấp tiêu đề và metadata, không phải toàn văn đã đối chiếu. Cá nhân hóa là tùy chọn và chỉ dùng mục tiêu đã chọn trong hồ sơ.</p>
      <div className="analysis-actions"><Button onClick={() => void analyze('GENERAL')} disabled={analyzing}><Sparkles size={15} aria-hidden="true"/> {analyzing ? 'Đang phân tích…' : 'Tin này có thể ảnh hưởng gì đến tôi?'}</Button><Button variant="outline" onClick={() => void analyze('PERSONALIZED')} disabled={analyzing}>Thêm mục tiêu hồ sơ vào phân tích</Button></div>
      {analysis && <p className="assumption-note"><span>{analysis.mode === 'PERSONALIZED' ? 'Cá nhân hóa có chọn lọc' : 'Chế độ tổng quát'}</span>{analysis.mode === 'PERSONALIZED' ? 'Diễn giải dựa trên mục tiêu tài chính đã lưu; không phải khuyến nghị hay phép tính.' : 'Không dùng dữ liệu hồ sơ cá nhân.'}</p>}
      {analysisError && <p role="alert" className="detail-error">{analysisError}</p>}
      {analysis?.unavailable && <p role="status" className="detail-muted">AI hiện chưa khả dụng; không tạo nhận định thay thế.</p>}
      {analysis && analysis.facts.length > 0 && <section className="analysis-copy"><h3>Dữ kiện trích xuất từ tiêu đề và metadata</h3><p className="detail-muted">Chưa đối chiếu toàn văn bài báo; các chi tiết dưới đây cần mở nguồn gốc để kiểm chứng.</p><ul>{analysis.facts.map((fact, i) => <li key={i}>{fact}</li>)}</ul></section>}
      {assessment && assessmentText && <section className="analysis-copy assessment-copy"><h3>Nhận định AI</h3><p>{assessmentText}</p></section>}
      {analysis?.assumptions.map((assumption) => <p key={assumption} className="assumption-note"><span>Giả định</span>{assumption}</p>)}
      {suggestedRateDelta !== null && <Link className="detail-inline-link" href={`/survey?shockDelta=${encodeURIComponent(suggestedRateDelta)}&articleId=${encodeURIComponent(data.id)}`}>Mô phỏng cú sốc lãi suất {suggestedRateDelta} điểm phần trăm trong Khảo sát <ArrowUpRight size={14} aria-hidden="true" /></Link>}
      {analysis?.citations.length ? <section className="analysis-citations" aria-label="Nguồn AI trích dẫn"><p>Nguồn được AI trích dẫn</p>{analysis.citations.map((citation) => <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer">{citation.sourceName}<ExternalLink size={12} aria-hidden="true"/></a>)}</section> : null}
    </section>

  </div>
}
