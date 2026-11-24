'use client'

import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight, ExternalLink, ShieldAlert, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui'
import { CategoryArtwork } from '@/components/radar/CategoryArtwork'
import { ApiError, apiClient } from '@/lib/api-client'

type ArticleDetail = { id: string; title: string; publishedAt: string | null; image?: { url: string; alt: string; credit: string | null; sourceUrl: string | null; licenseIdentifier: string; licenseUrl: string | null; rightsEvidenceUrl: string | null } | null; categories: string[]; sources: { sourceName: string; sourceId: string; url: string; firstSeenAt: string; lastSeenAt: string }[]; analysis: { mode: string; facts: unknown; assessment: unknown; suggestedRateDelta: string | null } | null }
type AlertDetail = { id: string; threatCategory: string; tacticSummary: string; preventionGuidance: string; verificationStatus: string; issuedAt: string | null; indicators: { indicatorType: string; indicatorText: string }[]; evidence: { articleId: string; title: string; sourceName: string; url: string; publishedAt: string | null }[] }
type Analysis = { mode: string; facts: string[]; assessment: string | null; suggestedRateDelta: string | null; assumptions: string[]; citations: { sourceName: string; url: string }[]; unavailable?: boolean }

const dateTimeFormat = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })
const categoryLabels: Record<string, string> = { INTEREST_RATE: 'Lãi suất', BANKING: 'Ngân hàng', MARKET: 'Thị trường', POLICY: 'Chính sách', INFLATION: 'Lạm phát', FINANCIAL_FRAUD: 'Lừa đảo tài chính' }
const categoryLabel = (value: string) => categoryLabels[value] ?? value.replaceAll('_', ' ')
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
  const [imageFailed, setImageFailed] = useState(false)
  const article = useQuery({ queryKey: ['radar-article', id], queryFn: () => apiClient.get<ArticleDetail>(`/radar/articles/${encodeURIComponent(id)}`), enabled: !isAlert })
  const alert = useQuery({ queryKey: ['radar-alert', id], queryFn: () => apiClient.get<AlertDetail>(`/radar/alerts/${encodeURIComponent(id)}`), enabled: isAlert })

  async function analyze(mode: 'GENERAL' | 'PERSONALIZED') {
    setAnalysisError('')
    try { setAnalysis(await apiClient.post<Analysis>(`/radar/articles/${encodeURIComponent(id)}/analyze`, { mode })) }
    catch (error) { setAnalysisError(error instanceof ApiError ? error.message : 'Phân tích chưa khả dụng.') }
  }

  if ((isAlert && alert.isPending) || (!isAlert && article.isPending)) return <div className="radar-detail-state" role="status">Đang tải nội dung…</div>
  if ((isAlert && alert.isError) || (!isAlert && article.isError)) return <div className="radar-detail-state"><p role="alert">{isAlert ? 'Không tải được cảnh báo.' : 'Không tải được bài viết.'}</p><Link href="/radar" className="detail-back"><ArrowLeft size={15} aria-hidden="true"/> Quay lại Radar</Link></div>

  if (isAlert && alert.data) {
    const verified = alert.data.verificationStatus === 'VERIFIED'
    return <div className="radar-detail radar-alert-detail">
      <Link href="/radar" className="detail-back"><ArrowLeft size={15} aria-hidden="true"/> Tất cả tin và cảnh báo</Link>
      <header className="detail-header">
        <div className="detail-meta"><span className={`verification-label ${verified ? 'is-verified' : 'is-pending'}`}>{verified ? 'Đã xác minh' : 'Chưa xác minh'}</span><span>{categoryLabel(alert.data.threatCategory)}</span></div>
        <p className="page-kicker">CẢNH BÁO RỦI RO</p>
        <h1>{alert.data.tacticSummary}</h1>
        <p className="detail-time">{alert.data.issuedAt ? <>Phát hành <time dateTime={alert.data.issuedAt}>{formatDateTime(alert.data.issuedAt)}</time></> : 'Chưa rõ thời điểm phát hành từ nguồn'}</p>
      </header>
      <section className="detail-section prevention-section" aria-labelledby="prevention-heading">
        <div className="detail-section-heading"><ShieldAlert size={17} aria-hidden="true"/><h2 id="prevention-heading">Cách phòng tránh</h2></div>
        <p>{alert.data.preventionGuidance}</p>
      </section>
      <section className="detail-section" aria-labelledby="indicators-heading">
        <div className="detail-section-heading"><h2 id="indicators-heading">Dấu hiệu cần đối chiếu</h2></div>
        <p className="detail-intro">Các chỉ dấu được trích xuất để đối chiếu; chúng không tự xác nhận nội dung cảnh báo.</p>
        {alert.data.indicators.length > 0 ? <ul className="indicator-list">{alert.data.indicators.map((item, i) => <li key={`${item.indicatorType}-${i}`}><span>{item.indicatorType}</span><code>{item.indicatorText}</code></li>)}</ul> : <p className="detail-muted">Chưa trích xuất chỉ dấu.</p>}
        <Link className="detail-inline-link" href={`/forensic?from=radar&alertId=${encodeURIComponent(alert.data.id)}${alert.data.indicators[0] ? `&indicator=${encodeURIComponent(alert.data.indicators[0].indicatorText)}` : ''}`}>Đối chiếu trong Giám định <ArrowUpRight size={14} aria-hidden="true"/></Link>
      </section>
      <section className="detail-section" aria-labelledby="evidence-heading">
        <div className="detail-section-heading"><h2 id="evidence-heading">Nguồn dẫn chứng</h2></div>
        {alert.data.evidence.length > 0 ? <ul className="evidence-list">{alert.data.evidence.map((item) => <li key={`${item.articleId}-${item.url}`}><a href={item.url} target="_blank" rel="noreferrer">{item.sourceName}: {item.title}<ExternalLink size={13} aria-hidden="true"/><span className="sr-only"> mở trong tab mới</span></a><p>{item.publishedAt ? <>Công bố <time dateTime={item.publishedAt}>{formatDateTime(item.publishedAt) ?? 'chưa rõ thời gian'}</time></> : 'Chưa rõ thời gian công bố'}</p></li>)}</ul> : <p className="detail-muted">Chưa có nguồn dẫn chứng được cung cấp.</p>}
      </section>
    </div>
  }

  const data = article.data!
  const assessment = analysis ?? (data.analysis?.assessment as { text?: string } | null)
  const assessmentText = analysis?.assessment ?? (typeof assessment === 'string' ? assessment : assessment && typeof assessment === 'object' && 'text' in assessment ? String(assessment.text ?? '') : '')
  return <div className="radar-detail">
    <Link href="/radar" className="detail-back"><ArrowLeft size={15} aria-hidden="true"/> Tất cả tin và cảnh báo</Link>
    <header className="detail-header">
      <div className="detail-meta">{data.categories.map((category) => <span key={category}>{categoryLabel(category)}</span>)}</div>
      <p className="page-kicker">BÀI VIẾT THỊ TRƯỜNG</p>
      <h1>{data.title}</h1>
      <p className="detail-time">{data.publishedAt ? <>Công bố <time dateTime={data.publishedAt}>{formatDateTime(data.publishedAt) ?? 'chưa rõ thời gian'}</time></> : 'Chưa rõ thời gian công bố'}</p>
    </header>
      {data.image && <figure className="detail-source-image">{imageFailed ? <div role="img" aria-label="Ảnh nguồn không tải được">Ảnh nguồn không khả dụng</div> : <img src={data.image.url} alt={data.image.alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />}<figcaption>{data.image.credit ?? 'Ảnh từ nhà xuất bản'} · {data.image.licenseIdentifier}{data.image.licenseUrl && <> · <a href={data.image.licenseUrl} target="_blank" rel="noreferrer">Điều khoản giấy phép</a></>}{data.image.sourceUrl && <> · <a href={data.image.sourceUrl} target="_blank" rel="noreferrer">Bài nguồn</a></>}</figcaption></figure>}
      {!data.image && <figure className="detail-source-image detail-image-fallback"><CategoryArtwork categories={data.categories} /><figcaption>Chưa có ảnh được duyệt. Minh họa chủ đề do FINCOPILOT sở hữu, không mô tả sự kiện cụ thể.</figcaption></figure>}

    <section className="detail-section provenance-section" aria-labelledby="provenance-heading">
      <div className="detail-section-heading"><h2 id="provenance-heading">Nguồn gốc</h2></div>
      {data.sources.length > 0 ? <ul className="provenance-list">{data.sources.map((source) => <li key={`${source.sourceId}-${source.url}`}><a href={source.url} target="_blank" rel="noreferrer">{source.sourceName}<ExternalLink size={13} aria-hidden="true"/><span className="sr-only"> mở trong tab mới</span></a><p><span>Thu thập lần đầu</span> <time dateTime={source.firstSeenAt}>{formatDateTime(source.firstSeenAt) ?? 'chưa rõ'}</time><span className="provenance-separator">·</span><span>Gặp gần nhất</span> <time dateTime={source.lastSeenAt}>{formatDateTime(source.lastSeenAt) ?? 'chưa rõ'}</time></p></li>)}</ul> : <p className="detail-muted">Chưa có nguồn gốc được cung cấp.</p>}
    </section>

    <section className="analysis-section" aria-labelledby="analysis-heading">
      <div className="analysis-heading">
        <span className="analysis-mark"><Sparkles size={16} aria-hidden="true"/></span>
        <div><p className="page-kicker">DIỄN GIẢI — KHÔNG PHẢI XÁC MINH</p><h2 id="analysis-heading">Phân tích tác động</h2></div>
      </div>
      <p className="detail-intro">Tin này có thể ảnh hưởng đến lãi suất, chi phí vay hoặc sức mua như thế nào? Phân tích tổng quát là mặc định. Nguồn Radar hiện cung cấp tiêu đề và metadata, không phải toàn văn đã đối chiếu. Cá nhân hóa là tùy chọn và chỉ dùng mục tiêu đã chọn trong hồ sơ.</p>
      <div className="analysis-actions"><Button onClick={() => void analyze('GENERAL')} disabled={article.isFetching}><Sparkles size={15} aria-hidden="true"/> {article.isFetching ? 'Đang phân tích…' : 'Tin này có thể ảnh hưởng gì đến tôi?'}</Button><Button variant="outline" onClick={() => void analyze('PERSONALIZED')} disabled={article.isFetching}>Thêm mục tiêu hồ sơ vào phân tích</Button></div>
      {analysis && <p className="assumption-note"><span>{analysis.mode === 'PERSONALIZED' ? 'Cá nhân hóa có chọn lọc' : 'Chế độ tổng quát'}</span>{analysis.mode === 'PERSONALIZED' ? 'Diễn giải dựa trên mục tiêu tài chính đã lưu; không phải khuyến nghị hay phép tính.' : 'Không dùng dữ liệu hồ sơ cá nhân.'}</p>}
      {analysisError && <p role="alert" className="detail-error">{analysisError}</p>}
      {analysis?.unavailable && <p role="status" className="detail-muted">AI hiện chưa khả dụng; không tạo nhận định thay thế.</p>}
      {analysis && analysis.facts.length > 0 && <section className="analysis-copy"><h3>Dữ kiện trích xuất từ tiêu đề và metadata</h3><p className="detail-muted">Chưa đối chiếu toàn văn bài báo; các chi tiết dưới đây cần mở nguồn gốc để kiểm chứng.</p><ul>{analysis.facts.map((fact, i) => <li key={i}>{fact}</li>)}</ul></section>}
      {assessment && assessmentText && <section className="analysis-copy assessment-copy"><h3>Nhận định AI</h3><p>{assessmentText}</p></section>}
      {analysis?.assumptions.map((assumption) => <p key={assumption} className="assumption-note"><span>Giả định</span>{assumption}</p>)}
      {analysis?.citations.length ? <section className="analysis-citations" aria-label="Nguồn AI trích dẫn"><p>Nguồn được AI trích dẫn</p>{analysis.citations.map((citation) => <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer">{citation.sourceName}<ExternalLink size={12} aria-hidden="true"/></a>)}</section> : null}
    </section>

  </div>
}
