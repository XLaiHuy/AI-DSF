'use client'

import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, ShieldAlert, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { handoffRoutes } from '@fincopilot/shared-types'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'
import { ApiError, apiClient } from '@/lib/api-client'

type ArticleDetail = { id: string; title: string; publishedAt: string | null; categories: string[]; sources: { sourceName: string; sourceId: string; url: string; firstSeenAt: string; lastSeenAt: string }[]; analysis: { mode: string; facts: unknown; assessment: unknown; suggestedRateDelta: string | null } | null }
type AlertDetail = { id: string; threatCategory: string; tacticSummary: string; preventionGuidance: string; verificationStatus: string; issuedAt: string | null; indicators: { indicatorType: string; indicatorText: string }[]; evidence: { articleId: string; title: string; sourceName: string; url: string; publishedAt: string | null }[] }
type Analysis = { mode: string; facts: string[]; assessment: string | null; suggestedRateDelta: string | null; assumptions: string[]; citations: { sourceName: string; url: string }[]; unavailable?: boolean }

export default function RadarArticlePage() {
  const { id } = useParams<{ id: string }>()
  const search = useSearchParams()
  const isAlert = search.get('kind') === 'alert'
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [analysisError, setAnalysisError] = useState('')
  const article = useQuery({ queryKey: ['radar-article', id], queryFn: () => apiClient.get<ArticleDetail>(`/radar/articles/${encodeURIComponent(id)}`), enabled: !isAlert })
  const alert = useQuery({ queryKey: ['radar-alert', id], queryFn: () => apiClient.get<AlertDetail>(`/radar/alerts/${encodeURIComponent(id)}`), enabled: isAlert })

  async function analyze() {
    setAnalysisError('')
    try { setAnalysis(await apiClient.post<Analysis>(`/radar/articles/${encodeURIComponent(id)}/analyze`, {})) }
    catch (error) { setAnalysisError(error instanceof ApiError ? error.message : 'Phân tích chưa khả dụng.') }
  }

  if ((isAlert && alert.isPending) || (!isAlert && article.isPending)) return <div className="p-8" role="status">Đang tải…</div>
  if ((isAlert && alert.isError) || (!isAlert && article.isError)) return <div className="mx-auto max-w-3xl space-y-4 p-8"><p role="alert">{isAlert ? 'Không tải được cảnh báo.' : 'Không tải được bài viết.'}</p><Link href="/radar">Quay lại Radar</Link></div>

  if (isAlert && alert.data) return <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
    <Link href="/radar" className="inline-flex items-center gap-2 text-sm text-primary"><ArrowLeft size={16}/> Quay lại Radar</Link>
    <header className="space-y-3"><Badge variant={alert.data.verificationStatus === 'VERIFIED' ? 'safe' : 'warning'}>{alert.data.verificationStatus === 'VERIFIED' ? 'Đã xác minh' : 'Chưa xác minh'}</Badge><p className="text-sm uppercase tracking-wide text-muted-foreground">{alert.data.threatCategory}</p><h1 className="text-3xl font-bold">{alert.data.tacticSummary}</h1>{alert.data.issuedAt ? <p className="text-muted-foreground">Phát hành: {new Date(alert.data.issuedAt).toLocaleString('vi-VN')}</p> : <p className="text-muted-foreground">Chưa rõ thời điểm phát hành từ nguồn.</p>}</header>
    <Card><CardHeader><CardTitle>Cách phòng tránh</CardTitle></CardHeader><CardContent>{alert.data.preventionGuidance}</CardContent></Card>
    <Card><CardHeader><CardTitle>Dấu hiệu cần đối chiếu</CardTitle><CardDescription>Các chỉ dấu dưới đây được chuyển cho hệ thống Giám định để so khớp.</CardDescription></CardHeader><CardContent className="space-y-2">{alert.data.indicators.map((item, i) => <div key={`${item.indicatorType}-${i}`} className="flex items-center gap-2"><ShieldAlert size={16}/><Badge variant="outline">{item.indicatorType}</Badge><code>{item.indicatorText}</code></div>)}{alert.data.indicators.length === 0 && <p>Chưa trích xuất chỉ dấu.</p>}<Link className="inline-block pt-2 text-sm text-primary underline" href={`/forensic?from=radar&alertId=${encodeURIComponent(alert.data.id)}${alert.data.indicators[0] ? `&indicator=${encodeURIComponent(alert.data.indicators[0].indicatorText)}` : ''}`}>Đối chiếu trong Giám định →</Link></CardContent></Card>
    <Card><CardHeader><CardTitle>Nguồn dẫn chứng</CardTitle></CardHeader><CardContent className="space-y-3">{alert.data.evidence.map((item) => <div key={item.url}><a href={item.url} target="_blank" rel="noreferrer" className="font-medium text-primary">{item.sourceName}: {item.title} <ExternalLink className="inline" size={14}/></a><p className="text-sm text-muted-foreground">{item.publishedAt ? new Date(item.publishedAt).toLocaleString('vi-VN') : 'Chưa rõ thời gian công bố'}</p></div>)}</CardContent></Card>
  </main>

  const data = article.data!
  const assessment = analysis ?? (data.analysis?.assessment as { text?: string } | null)
  const delta = analysis?.suggestedRateDelta ?? data.analysis?.suggestedRateDelta
  const assessmentText = analysis?.assessment ?? (typeof assessment === 'string' ? assessment : assessment && typeof assessment === 'object' && 'text' in assessment ? String(assessment.text ?? '') : '')
  return <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
    <Link href="/radar" className="inline-flex items-center gap-2 text-sm text-primary"><ArrowLeft size={16}/> Quay lại Radar</Link>
    <header className="space-y-3"><div className="flex flex-wrap gap-2">{data.categories.map((category) => <Badge key={category} variant="info">{category}</Badge>)}</div><h1 className="text-3xl font-bold">{data.title}</h1><p className="text-muted-foreground">{data.publishedAt ? `Công bố ${new Date(data.publishedAt).toLocaleString('vi-VN')}` : 'Chưa rõ thời gian công bố'}</p></header>
    <Card><CardHeader><CardTitle>Nguồn gốc</CardTitle></CardHeader><CardContent className="space-y-3">{data.sources.map((source) => <div key={`${source.sourceId}-${source.url}`}><a href={source.url} target="_blank" rel="noreferrer" className="font-medium text-primary">{source.sourceName} <ExternalLink className="inline" size={14}/></a><p className="text-xs text-muted-foreground">Thu thập lần đầu {new Date(source.firstSeenAt).toLocaleString('vi-VN')} · Lần gần nhất {new Date(source.lastSeenAt).toLocaleString('vi-VN')}</p></div>)}</CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Sparkles size={18}/> Phân tích tác động</CardTitle><CardDescription>Tách dữ kiện đã thu thập khỏi nhận định AI. Khi không có hồ sơ R07, phân tích ở mức tổng quát.</CardDescription></CardHeader><CardContent className="space-y-4"><Button onClick={() => void analyze()} disabled={false}><Sparkles size={15}/> Phân tích bằng AI</Button>{analysisError && <p role="alert">{analysisError}</p>}{analysis?.unavailable && <p role="status">AI hiện chưa khả dụng; không tạo nhận định thay thế.</p>}{analysis && analysis.facts.length > 0 && <section><h2 className="font-semibold">Dữ kiện</h2><ul className="list-disc pl-5">{analysis.facts.map((fact, i) => <li key={i}>{fact}</li>)}</ul></section>}{assessment && <section><h2 className="font-semibold">Nhận định AI</h2><p>{assessmentText}</p></section>}{analysis?.assumptions.map((assumption) => <p key={assumption} className="text-sm text-muted-foreground">Giả định: {assumption}</p>)}{analysis?.citations.map((citation) => <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer" className="mr-3 text-sm text-primary">{citation.sourceName} ↗</a>)}</CardContent></Card>
    {delta && <Card><CardHeader><CardTitle>Mô phỏng cú sốc lãi suất</CardTitle><CardDescription>Độ biến động được AI đề xuất; hãy xem như giả định để tự mô phỏng, không phải điều chỉnh hợp đồng.</CardDescription></CardHeader><CardContent><Link className="text-primary underline" href={handoffRoutes.radarToSurvey({ shockDelta: delta, articleId: data.id })}>Mở trong Khảo sát →</Link></CardContent></Card>}
  </main>
}
