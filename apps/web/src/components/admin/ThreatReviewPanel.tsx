'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, FlaskConical, RefreshCw } from 'lucide-react'
import { Fragment, useId, useRef, useState } from 'react'
import { z } from 'zod'
import {
  ThreatAlertReviewSchema, ThreatCrawlStatsSchema, ThreatDraftSchema, ThreatFeedbackRecordSchema, ThreatIndicatorInputSchema,
  ThreatRecentAuditSchema, ThreatRndEvalResultSchema, ThreatRndSummarySchema, ThreatShadowResultSchema,
  type ThreatAlertReview, type ThreatDraft, type ThreatFeedback, type ThreatIndicatorInput, type ThreatPatch, type ThreatRndEvalResult,
} from '@fincopilot/shared-types'
import { Badge, Button, Card, CardContent } from '@/components/ui'
import { formatVietnamTime, requestError } from '@/lib/workspace-data'
import { adminClient, adminField, type AdminCredentials } from './admin-client'

const originLabel = { RADAR_AUTO: 'Radar', ADMIN_INGEST: 'Vận hành', FORENSIC_COMMUNITY: 'Cộng đồng' }
const mutationsError = 'Không thể lưu thay đổi. Kiểm tra quyền quản trị và thử lại.'
type Client = ReturnType<typeof adminClient>

export function ThreatReviewPanel({ credentials }: { credentials: AdminCredentials }) {
  const client = adminClient(credentials)
  const queries = useQueryClient()
  const stem = ['admin', credentials.revision] as const
  const refresh = () => { void queries.invalidateQueries({ queryKey: stem }) }
  const list = useQuery({ queryKey: [...stem, 'alerts'], queryFn: () => client.get('/alerts', z.array(ThreatAlertReviewSchema)), retry: false, gcTime: 0 })
  const schedule = useQuery({ queryKey: [...stem, 'crawl-status'], queryFn: () => client.get('/crawl-status',
    z.object({ scheduled: z.boolean(), nextAt: z.string().nullable() })), retry: false, gcTime: 0 })
  const crawl = useMutation({ mutationFn: () => client.post('/crawl-now', {}, ThreatCrawlStatsSchema), onSettled: refresh })
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
      <p className="text-sm"><Badge variant={schedule.data?.scheduled ? 'safe' : 'secondary'}>
        {schedule.isPending ? 'Đang đọc lịch quét' : schedule.data?.scheduled ? 'Tự động quét hằng ngày' : 'Chưa đọc được lịch quét'}
      </Badge>{schedule.data?.nextAt && <span className="ml-2 text-muted-foreground">Kế tiếp {formatVietnamTime(schedule.data.nextAt)}</span>}</p>
      <Button type="button" onClick={() => crawl.mutate()} disabled={crawl.isPending}><RefreshCw size={15} aria-hidden="true" />
        {crawl.isPending ? 'Đang quét nguồn…' : 'Hot Crawl ngay'}
      </Button>
      {crawl.data && <p className="w-full text-sm text-muted-foreground" role="status">
        {crawl.data.newArticles} tin mới · {crawl.data.newProposals} đề xuất · {crawl.data.skippedDuplicates} mục trùng
      </p>}
      {crawl.isError && <p className="w-full text-sm text-destructive" role="alert">{requestError(crawl.error, 'Chưa quét được nguồn tin.')}</p>}
    </div>
    <IntakeDrawer client={client} refresh={refresh} />
    {list.isPending && <p role="status" className="text-sm text-muted-foreground">Đang tải cảnh báo…</p>}
    {list.isError && <p role="alert" className="text-sm text-destructive">{requestError(list.error, 'Không đọc được cảnh báo. Kiểm tra khóa quản trị.')}</p>}
    {list.data && (['UNVERIFIED', 'VERIFIED'] as const).map((status) => {
      const rows = list.data.filter((alert) => alert.verificationStatus === status)
      return <section key={status} className="space-y-3" aria-labelledby={`review-${status}`}>
        <h2 id={`review-${status}`} className="text-lg font-semibold">{status === 'UNVERIFIED' ? 'Chờ duyệt' : 'Đã công bố'} <span className="text-sm font-normal text-muted-foreground">({rows.length})</span></h2>
        {rows.length ? rows.map((alert) => <ReviewCard key={alert.id} alert={alert} client={client} refresh={refresh} />)
          : <p className="text-sm text-muted-foreground">{status === 'UNVERIFIED' ? 'Hàng chờ đã được xử lý.' : 'Chưa có cảnh báo đã công bố.'}</p>}
      </section>
    })}
    <FeedbackDrawer credentials={credentials} client={client} refresh={refresh} />
  </div>
}

function IntakeDrawer({ client, refresh }: { client: Client; refresh: () => void }) {
  const [mode, setMode] = useState<'rawText' | 'sourceUrl'>('rawText')
  const [input, setInput] = useState('')
  const extract = useMutation({ mutationFn: () => client.post('/alerts/extract', { [mode]: input.trim() }, ThreatDraftSchema.strip()) })
  const save = useMutation({ mutationFn: (draft: ThreatDraft) => client.post('/alerts', draft), onSuccess: () => {
    refresh()
    extract.reset()
    setInput('')
  } })
  return <details className="rounded-xl border border-border bg-card p-4">
    <summary className="cursor-pointer font-medium">Dán Link / Chữ nạp tin</summary>
    <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); extract.mutate() }}>
      <label className="grid gap-1 text-sm">Loại nguồn
        <select value={mode} onChange={(event) => { setMode(event.target.value === 'sourceUrl' ? 'sourceUrl' : 'rawText'); setInput(''); extract.reset() }} className={adminField}>
          <option value="rawText">Văn bản</option><option value="sourceUrl">Liên kết công khai</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">{mode === 'sourceUrl' ? 'URL nguồn' : 'Văn bản nguồn'}
        {mode === 'sourceUrl' ? <input type="url" required maxLength={2000} value={input} className={adminField} onChange={(event) => setInput(event.target.value)} />
          : <textarea required rows={5} maxLength={30000} value={input} className={adminField} onChange={(event) => setInput(event.target.value)} />}
      </label>
      <Button type="submit" disabled={extract.isPending || !input.trim()}>{extract.isPending ? 'Đang trích xuất…' : 'Trích xuất bản nháp'}</Button>
    </form>
    {extract.isError && <p role="alert" className="mt-3 text-sm text-destructive">{requestError(extract.error, 'Không trích xuất được nội dung.')}</p>}
    {extract.data && <div className="mt-4 border-t pt-4">
      <ThreatForm key={extract.submittedAt} initial={extract.data} busy={save.isPending} onSave={save.mutate} submitLabel="Đưa vào hàng chờ" />
    </div>}
    {save.isError && <p role="alert" className="mt-3 text-sm text-destructive">{requestError(save.error, mutationsError)}</p>}
    {save.isSuccess && <p role="status" className="mt-3 text-sm">Đã đưa bản nháp vào hàng chờ.</p>}
  </details>
}

function ThreatForm({ initial, busy, onSave, submitLabel }: { initial: ThreatDraft; busy: boolean; onSave: (draft: ThreatDraft) => void; submitLabel: string }) {
  const [data, setData] = useState(initial)
  const [validation, setValidation] = useState('')
  return <form className="grid gap-3" onSubmit={(event) => {
    event.preventDefault()
    const parsed = ThreatDraftSchema.safeParse(data)
    if (!parsed.success) { setValidation('Kiểm tra tiêu đề, hướng dẫn và chỉ dấu trước khi lưu.'); return }
    setValidation('')
    onSave(parsed.data)
  }}>
    <label className="grid gap-1 text-sm">Tóm tắt thủ đoạn
      <input required maxLength={800} value={data.tacticSummary} className={adminField} onChange={(event) => setData({ ...data, tacticSummary: event.target.value })} />
    </label>
    <label className="grid gap-1 text-sm">Hướng dẫn phòng tránh
      <textarea required maxLength={2000} rows={2} value={data.preventionGuidance} className={adminField} onChange={(event) => setData({ ...data, preventionGuidance: event.target.value })} />
    </label>
    <label className="grid gap-1 text-sm">Trích đoạn nguồn
      <textarea maxLength={8000} rows={4} value={data.sourceExcerpt ?? ''} className={adminField} onChange={(event) => setData({ ...data, sourceExcerpt: event.target.value })} />
    </label>
    <fieldset className="grid gap-2"><legend className="mb-1 text-sm font-medium">Chỉ dấu</legend>
      {data.indicators.map((indicator, index) => <div key={index} className="grid gap-2 sm:grid-cols-[9rem_1fr_auto]">
        <select aria-label={`Loại chỉ dấu ${index + 1}`} value={indicator.indicatorType} className={adminField} onChange={(event) => {
          const parsed = ThreatIndicatorInputSchema.shape.indicatorType.safeParse(event.target.value)
          if (parsed.success) {
            setData({ ...data, indicators: data.indicators.map((item, i) => i === index ? { ...item, indicatorType: parsed.data } : item) })
          }
        }}>{ThreatIndicatorInputSchema.shape.indicatorType.options.map((type) => <option key={type}>{type}</option>)}</select>
        <input required maxLength={256} className={adminField} aria-label={`Nội dung chỉ dấu ${index + 1}`} value={indicator.indicatorText}
          onChange={(event) => setData({ ...data, indicators: data.indicators.map((item, i) => i === index ? { ...item, indicatorText: event.target.value } : item) })} />
        <Button type="button" variant="outline" onClick={() => setData({ ...data, indicators: data.indicators.filter((_, i) => i !== index) })}>Bỏ</Button>
      </div>)}
      <Button type="button" variant="outline" className="w-fit" disabled={data.indicators.length >= 40} onClick={() => {
        setData({ ...data, indicators: [...data.indicators, { indicatorType: 'KEYWORD', indicatorText: '' }] })
      }}>Thêm chỉ dấu</Button>
    </fieldset>
    {validation && <p role="alert" className="text-sm text-destructive">{validation}</p>}
    <Button type="submit" className="w-fit" disabled={busy}>{submitLabel}</Button>
  </form>
}

function displayIndicator(value: string) {
  return value.startsWith('sha256:') ? 'Chỉ dấu cộng đồng đã che' : value
}

function ReviewCard({ alert, client, refresh }: { alert: ThreatAlertReview; client: Client; refresh: () => void }) {
  const [probe, setProbe] = useState('')
  const editor = useRef<HTMLDetailsElement>(null)
  const patch = useMutation({
    mutationFn: (value: ThreatPatch) => client.patch(`/alerts/${alert.id}`, value),
    onSuccess: () => { if (editor.current) editor.current.open = false; refresh() },
  })
  const test = useMutation({ mutationFn: () => client.post(`/alerts/${alert.id}/test`, { message: probe.trim() || undefined }, ThreatShadowResultSchema) })
  const sourceExcerpt = alert.sourceExcerpt ?? ''
  const spans = alert.indicators.flatMap((indicator) => {
    if (indicator.indicatorText.startsWith('sha256:')) return []
    const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const raw = indicator.indicatorText
    const masked = ['PHONE', 'BANK_ACCOUNT', 'CRYPTO_WALLET'].includes(indicator.indicatorType) && raw.length > 6
      ? raw.slice(0, 3) + '*'.repeat(raw.length - 6) + raw.slice(-3) : raw
    const regex = new RegExp([...new Set([raw, masked])].map(escaped).join('|'), 'giu')
    return [...sourceExcerpt.matchAll(regex)].map((match) => ({ indicator, start: match.index, end: match.index + match[0].length, text: match[0] }))
  }).sort((a, b) => a.start - b.start || b.end - a.end)
  let end = 0
  const highlights = spans.flatMap((span) => {
    if (span.start < end) return []
    const preceding = sourceExcerpt.slice(end, span.start)
    end = span.end
    return [{ ...span, preceding }]
  })
  const highlightedIndicators = new Set(highlights.map(({ indicator }) => indicator))
  const additionalIndicators = alert.indicators.filter((indicator) => !highlightedIndicators.has(indicator))
  const startEdit = () => { if (editor.current) { editor.current.open = true; editor.current.querySelector('input')?.focus() } }
  const actions = { alert, client, refresh, startEdit }

  return <Card className={alert.whitelistCollisions.length ? 'border-verdict-danger' : ''}>
    <CardContent className="grid gap-4 pt-5">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant="secondary">{originLabel[alert.originSource]}</Badge>
          <Badge variant="outline">{alert.indicators.length ? 'Có chỉ dấu (Tier 1 + Tier 2)' : 'Thủ đoạn ngữ nghĩa (Tier 2 Few-Shot)'}</Badge>
          <span>{alert.hitCount} lượt ghi nhận</span><time dateTime={alert.updatedAt}>{formatVietnamTime(alert.updatedAt)}</time></div>
        <h3 className="break-words text-base font-semibold">{alert.tacticSummary}</h3>
        <p className="break-words text-sm text-muted-foreground">{alert.preventionGuidance}</p>
        {!!alert.sourceLinks?.length && <ul aria-label="Nguồn bài viết" className="flex min-w-0 flex-wrap gap-2">
          {alert.sourceLinks.map(({ sourceName, title, url }) => <li key={url} className="min-w-0 max-w-full">
            <a href={url} target="_blank" rel="noopener noreferrer" title={title}
              aria-label={`${sourceName} · ${title} (mở thẻ mới)`}
              className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <ExternalLink size={13} className="shrink-0" aria-hidden="true" /><span>{sourceName}</span>
            </a>
          </li>)}
        </ul>}
      </div>
      {alert.whitelistCollisions.length > 0 && <p role="alert" className="rounded-md border border-verdict-danger bg-verdict-danger-bg p-2 text-sm">Trùng thông tin tổ chức được cấp phép. Kiểm tra trước khi công bố.</p>}
      {sourceExcerpt && <blockquote className="whitespace-pre-wrap break-words rounded-lg bg-muted/60 p-3 text-sm leading-7">
        {highlights.map(({ indicator, preceding, start, text }) => <Fragment key={start}>{preceding}<Critique {...actions} indicator={indicator} label={text} /></Fragment>)}
        {sourceExcerpt.slice(end)}
      </blockquote>}
      {additionalIndicators.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Chỉ dấu">
        {additionalIndicators.map((indicator, index) => <Critique key={index} {...actions} indicator={indicator} label={displayIndicator(indicator.indicatorText)} />)}
      </div>}
      <details ref={editor} className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">Sửa nội dung và chỉ dấu</summary>
        <div className="pt-3"><ThreatForm key={alert.updatedAt} initial={{
          tacticSummary: alert.tacticSummary, preventionGuidance: alert.preventionGuidance, threatCategory: alert.threatCategory,
          indicators: alert.indicators, sourceExcerpt: alert.sourceExcerpt ?? undefined,
        }}
          busy={patch.isPending} submitLabel="Lưu thay đổi" onSave={(draft) => patch.mutate({
            ...draft, indicators: JSON.stringify(draft.indicators) === JSON.stringify(alert.indicators) ? undefined : draft.indicators,
          })} /></div>
      </details>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); test.mutate() }}>
        <label className="grid min-w-44 flex-1 gap-1 text-sm">Câu thử bổ sung
          <input value={probe} maxLength={2000} className={adminField} onChange={(event) => setProbe(event.target.value)} />
        </label>
        <Button type="submit" variant="outline" disabled={test.isPending}><FlaskConical size={15} aria-hidden="true" /> Kiểm thử 12 câu sạch</Button>
      </form>
      {test.data && <div className="space-y-1 text-sm" role="status">
        <p className={test.data.passed ? 'text-verdict-safe' : 'text-destructive'}>{test.data.hits.length}/{test.data.safeCases} câu sạch khớp chỉ dấu</p>
        {test.data.hits.map(({ text, indicators }) => <p key={text}>{text} — {indicators.join(', ')}</p>)}
        {test.data.custom && <p>Câu thử bổ sung {test.data.custom.indicators.length ? `khớp ${test.data.custom.indicators.join(', ')}` : 'không khớp chỉ dấu'}.</p>}
      </div>}
      {test.isError && <p role="alert" className="text-sm text-destructive">{requestError(test.error, 'Không chạy được kiểm thử.')}</p>}
      <div><Button type="button" variant={alert.verificationStatus === 'VERIFIED' ? 'outline' : 'default'}
        disabled={patch.isPending || (alert.verificationStatus !== 'VERIFIED' && alert.whitelistCollisions.length > 0)}
        onClick={() => patch.mutate({ verificationStatus: alert.verificationStatus === 'VERIFIED' ? 'UNVERIFIED' : 'VERIFIED' })}>
        {alert.verificationStatus === 'VERIFIED' ? 'Thu hồi' : 'Xác minh & Công bố'}
      </Button></div>
      {patch.isError && <p role="alert" className="text-sm text-destructive">{requestError(patch.error, mutationsError)}</p>}
    </CardContent>
  </Card>
}

function Critique({ alert, indicator, label, client, refresh, startEdit }: {
  alert: ThreatAlertReview; indicator: ThreatIndicatorInput; label: string; client: Client; refresh: () => void; startEdit: () => void
}) {
  const id = useId()
  const popover = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [fallbackOpen, setFallbackOpen] = useState(false)
  const [type, setType] = useState<'SAFE_IGNORE_IOC' | 'TEENCODE_ALIAS' | 'RND_PROPOSAL'>('SAFE_IGNORE_IOC')
  const [rndCategory, setRndCategory] = useState<NonNullable<ThreatFeedback['rndCategory']>>('EXTRACTION_FIX')
  const [note, setNote] = useState('')
  const close = (focus = true) => {
    if (popover.current?.matches(':popover-open')) popover.current.hidePopover()
    setFallbackOpen(false)
    if (focus) trigger.current?.focus()
  }
  const save = useMutation({ mutationFn: () => client.post('/feedback', {
    threatAlertId: alert.id, feedbackType: type,
    highlightedSpan: type === 'TEENCODE_ALIAS' ? label : indicator.indicatorText,
    sampleTextMasked: alert.sourceExcerpt || alert.tacticSummary, expectedVerdict: type === 'SAFE_IGNORE_IOC' ? 'SAFE' : 'CAUTION',
    adminNote: note.trim(), ...(type === 'RND_PROPOSAL' ? { rndCategory } : {}),
  } satisfies ThreatFeedback), onSuccess: () => { close(); setNote(''); refresh() } })
  return <>
    <button type="button" ref={trigger} popoverTarget={id}
      aria-expanded={fallbackOpen || undefined}
      className="inline rounded-sm border-b border-verdict-danger/50 bg-verdict-danger-bg/60 px-1 text-left text-foreground hover:bg-verdict-danger-bg focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`Góp ý chỉ dấu ${label}`} onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const width = Math.min(window.innerWidth - 24, 336)
        const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12)
        const below = window.innerHeight - rect.bottom
        const above = below < 300 && rect.top > below
        const top = above ? rect.top - 6 : rect.bottom + 6
        popover.current?.style.setProperty('--critique-left', `${left}px`)
        popover.current?.style.setProperty('--critique-top', `${top}px`)
        popover.current?.style.setProperty('--critique-available', `${(above ? rect.top : below) - 18}px`)
        popover.current?.style.setProperty('--critique-translate', above ? '-100%' : '0%')
        if (!popover.current?.showPopover) setFallbackOpen(!fallbackOpen)
      }}>{label}</button>
    <div id={id} ref={popover} popover="auto" role="dialog" aria-label="Góp ý chỉ dấu"
      data-fallback-open={fallbackOpen || undefined}
      className="threat-critique fixed m-0 w-[min(21rem,calc(100vw-1.5rem))] overflow-auto rounded-xl border border-border bg-card p-4 text-foreground shadow-lg"
      onKeyDown={(event) => { if (fallbackOpen && event.key === 'Escape') close() }}>
      <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); save.mutate() }}>
        <label className="grid gap-1 text-sm">Góp ý chỉ dấu
          <select className={adminField} value={type} onChange={(event) => {
            const next = event.target.value
            if (next === 'SAFE_IGNORE_IOC' || next === 'TEENCODE_ALIAS' || next === 'RND_PROPOSAL') setType(next)
          }}>
            <option value="SAFE_IGNORE_IOC">Nhặt sai / Dễ báo oan</option>
            <option value="TEENCODE_ALIAS">Thêm Teencode mới</option>
            <option value="RND_PROPOSAL">Đề xuất R&D</option>
          </select>
        </label>
        {type === 'RND_PROPOSAL' && <label className="grid gap-1 text-sm">Nhóm đề xuất
          <select className={adminField} value={rndCategory} onChange={(event) => {
            const next = event.target.value
            if (next === 'RULE_GAP' || next === 'TEENCODE' || next === 'FALSE_POSITIVE_FIX' || next === 'EXTRACTION_FIX') setRndCategory(next)
          }}>
            <option value="RULE_GAP">Bổ sung quy tắc</option>
            <option value="TEENCODE">Chuẩn hóa Teencode</option>
            <option value="FALSE_POSITIVE_FIX">Sửa báo oan</option>
            <option value="EXTRACTION_FIX">Sửa trích xuất</option>
          </select>
        </label>}
        <label className="grid gap-1 text-sm">{type === 'TEENCODE_ALIAS' ? 'Cách viết đầy đủ' : 'Ghi chú'}
          <textarea className={adminField} value={note} onChange={(event) => setNote(event.target.value)} rows={2} required={type === 'TEENCODE_ALIAS'} maxLength={type === 'TEENCODE_ALIAS' ? 120 : 2000} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={save.isPending}>Lưu góp ý</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => { close(false); startEdit() }}>Sửa nội dung</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => close()}>Đóng</Button>
        </div>
        {save.isError && <p role="alert" className="text-sm text-destructive">{requestError(save.error, mutationsError)}</p>}
      </form>
    </div>
  </>
}

function FeedbackDrawer({ credentials, client, refresh }: { credentials: AdminCredentials; client: Client; refresh: () => void }) {
  const [opened, setOpened] = useState(false)
  const stem = ['admin', credentials.revision] as const
  const options = { enabled: opened, gcTime: 0, retry: false } as const
  const audits = useQuery({ ...options, queryKey: [...stem, 'recent-audits'], queryFn: () => client.get('/audits/recent', z.array(ThreatRecentAuditSchema)) })
  const feedback = useQuery({ ...options, queryKey: [...stem, 'feedback'], queryFn: () => client.get('/feedback', z.array(ThreatFeedbackRecordSchema)) })
  const rnd = useQuery({ ...options, queryKey: [...stem, 'rnd'], queryFn: () => client.get('/rnd/summary', ThreatRndSummarySchema) })
  const evaluate = useMutation({ mutationFn: () => client.post('/rnd/run-eval', {}, ThreatRndEvalResultSchema) })
  const save = useMutation({ mutationFn: (value: ThreatFeedback) => client.post('/feedback', value), onSuccess: refresh })
  const toggle = useMutation({ mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => client.patch(`/feedback/${id}`, { isActive }), onSuccess: refresh })
  const download = useMutation({ mutationFn: () => client.get<unknown>('/rnd/export-cases'), onSuccess: (data) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'forensic-rnd-cases.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } })
  return <details className="rounded-xl border border-border bg-card p-4" onToggle={(event) => setOpened(event.currentTarget.open)}>
    <summary className="cursor-pointer font-medium">Phản hồi Giám định & Đề xuất R&D</summary>
    <div className="mt-4 grid gap-5">
      {(audits.isError || feedback.isError || rnd.isError || save.isError || toggle.isError || download.isError) &&
        <p role="alert" className="text-sm text-destructive">Không hoàn tất được yêu cầu phản hồi. Kiểm tra quyền và thử lại.</p>}
      {save.isSuccess && <p role="status" className="text-sm text-verdict-safe">Đã lưu phản hồi giám định.</p>}
      <section className="space-y-2">
        <h3 className="font-semibold">Giám định gần đây</h3>
        {audits.data?.length === 0 && <p className="text-sm text-muted-foreground">Chưa có lượt giám định.</p>}
        {audits.data?.map((audit) => <div key={audit.id} className="grid gap-2 border-b py-2 text-sm">
          <p className="text-muted-foreground">{formatVietnamTime(audit.createdAt)} · {audit.verdictLevel} · {audit.riskScore}/100</p>
          <p className="break-words">{audit.rawTextMasked || 'Phiên đính kèm không có văn bản đã che.'}</p>
          {audit.rawTextMasked && <div className="flex flex-wrap gap-2">
            {(['FALSE_POSITIVE', 'CONFIRMED_SCAM'] as const).map((feedbackType) => <Button key={feedbackType} variant="outline" size="sm" disabled={save.isPending}
              onClick={() => save.mutate({ feedbackType, auditId: audit.id, sampleTextMasked: audit.rawTextMasked, adminNote: '',
                expectedVerdict: feedbackType === 'FALSE_POSITIVE' ? 'SAFE' : 'HIGH_RISK' })}>
              {feedbackType === 'FALSE_POSITIVE' ? 'Báo oan' : 'Xác nhận lừa đảo'}
            </Button>)}
          </div>}
        </div>)}
      </section>
      <section className="min-w-0 space-y-2">
        <h3 className="font-semibold">Tổng hợp R&D</h3>
        {rnd.data && <><p className="text-sm text-muted-foreground">{rnd.data.active}/{rnd.data.total} phản hồi đang bật</p>
          <ul className="flex flex-wrap gap-2">{Object.entries(rnd.data.byCategory).map(([category, count]) => <li key={category}><Badge variant="secondary">{category} · {count}</Badge></li>)}</ul></>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={download.isPending} onClick={() => download.mutate()}><Download size={15} aria-hidden="true" /> Xuất JSON Test Case</Button>
          <Button type="button" size="sm" variant="outline" disabled={evaluate.isPending} onClick={() => evaluate.mutate()}>
            <FlaskConical size={15} aria-hidden="true" /> {evaluate.isPending ? 'Đang kiểm thử…' : 'Chạy kiểm thử R&D'}
          </Button>
        </div>
        {evaluate.isError && <p role="alert" className="text-sm text-destructive">{requestError(evaluate.error, 'Không chạy được kiểm thử R&D.')}</p>}
        {evaluate.data && <EvalResults result={evaluate.data} />}
      </section>
      <section className="grid gap-2">
        <h3 className="font-semibold">Mẫu phản hồi & quy tắc bỏ qua</h3>
        {feedback.data?.map((item) => <label key={item.id} className="flex items-start gap-2 border-b py-2 text-sm">
          <input className="mt-1 accent-primary" type="checkbox" checked={item.isActive} disabled={toggle.isPending} onChange={(event) => toggle.mutate({ id: item.id, isActive: event.target.checked })} />
          <span className="min-w-0 break-words"><span className="block font-medium">{item.feedbackType} · {item.expectedVerdict}</span>{item.sampleTextMasked}</span>
        </label>)}
      </section>
    </div>
  </details>
}

const evalKind = {
  CLEAN_BASELINE: 'Câu sạch', CONFIRMED_SCAM: 'Lừa đảo đã xác nhận', FALSE_POSITIVE: 'Báo oan', TEENCODE_ALIAS: 'Từ viết tắt',
}

function EvalResults({ result }: { result: ThreatRndEvalResult }) {
  const caption = useId()
  return <div className="min-w-0 space-y-2">
    <p role="status" className="text-sm font-medium">Đạt {result.cleanPassed}/{result.cleanTotal} câu sạch và {result.feedbackPassed}/{result.feedbackTotal} phản hồi</p>
    <div role="region" aria-labelledby={caption} tabIndex={0}
      className="max-h-80 max-w-full overflow-auto rounded-md border border-border focus-visible:outline-2 focus-visible:outline-ring">
      <table className="w-full min-w-[31rem] border-separate border-spacing-0 text-left text-xs">
        <caption id={caption} className="sr-only">Kết quả từng ca kiểm thử R&D</caption>
        <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
          <tr>{['Ca kiểm thử', 'Kỳ vọng', 'Thực tế', 'Kết quả', 'Chi tiết'].map((label) =>
            <th key={label} scope="col" className="px-2.5 py-2 font-semibold">{label}</th>)}</tr>
        </thead>
        <tbody>{result.cases.map((row) => <tr key={row.id} className="align-top">
          <th scope="row" className="sticky inset-s-0 border-t bg-card px-2.5 py-2 font-medium">{evalKind[row.kind]}</th>
          <td className="border-t px-2.5 py-2">{row.expected}</td>
          <td className="border-t px-2.5 py-2">{row.actual}</td>
          <td className={`whitespace-nowrap border-t px-2.5 py-2 font-medium ${row.passed ? 'text-verdict-safe' : 'text-destructive'}`}>{row.passed ? 'Đạt' : 'Chưa đạt'}</td>
          <td className="min-w-40 break-words border-t px-2.5 py-2 text-muted-foreground">{row.detail}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>
}
