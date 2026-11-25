'use client'

import {
  ForensicAuditFieldsSchema, ForensicFollowUpRequestSchema, ForensicFollowUpResponseSchema, ROUTES,
  type ForensicAuditFields, type ForensicAuditResponse, type ForensicAuditStage, type ForensicFollowUpResponse, type ForensicHandoff,
} from '@fincopilot/shared-types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Bot, ChartNoAxesCombined, Check, FileText, LoaderCircle, Plus, QrCode, RotateCcw, ShieldAlert, ShieldCheck, Wallet, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react'
import { Alert, Button, Label } from '@/components/ui'
import { ApiError, apiClient } from '@/lib/api-client'
import { auditListQuery, auditQuery, formatVnd, requestError, sessionQuery } from '@/lib/workspace-data'
import { cn } from '@/lib/utils'
import { addAttachments, AttachmentStrip } from './AttachmentStrip'
import { AuditHistory } from './AuditHistory'
import { ForensicReport } from './ForensicReport'
import { plainAuditText } from './report-copy'
import { streamAudit } from './stream-audit'
import { streamReply } from './stream-reply'
import { LiveReplyText } from './StreamingContentReveal'

const examples = [
  {
    label: 'Bẫy lỗi 102',
    description: 'Yêu cầu chuyển phí giải ngân qua VietQR',
    icon: ShieldAlert,
    tone: 'bg-verdict-danger-bg text-verdict-danger',
    entity: 'Công ty Tài chính ABC',
    text: 'Bên cho vay báo lỗi 102 và bảo mình chuyển phí giải ngân để mở khóa khoản vay. Bạn kiểm tra giúp ảnh này nhé.',
    image: 'demo-loi-102-vietqr.png',
  },
  {
    label: 'Lãi phẳng và phí giữ lại',
    description: 'Hợp đồng 12 tháng có phí trừ khi nhận tiền',
    icon: FileText,
    tone: 'bg-verdict-warning-bg text-verdict-warning',
    entity: 'Công ty Tài chính ABC',
    text: 'Bạn kiểm tra lãi suất thực của hợp đồng này nhé.\n\nThông tin trên ảnh mẫu\nKhoản vay 50 000 000 đồng\nKỳ hạn 12 tháng\nLãi phẳng 0,9%/tháng\nPhí thu trước 5 000 000 đồng',
    image: 'demo-lai-phang-hopdong.png',
  },
  {
    label: 'Chuyển khoản cá nhân',
    description: 'Kiểm tra mã nhận tiền qua MoMo',
    icon: QrCode,
    tone: 'bg-accent text-primary',
    entity: '',
    text: 'Mình trả tiền ăn cho bạn này qua MoMo, xem giúp mã QR này có ổn không?',
    image: 'demo-momo-canhan.png',
  },
  {
    label: 'Lãi ưu đãi gài điều kiện',
    description: 'So sánh đóng đúng hạn và mất ưu đãi',
    icon: ChartNoAxesCombined,
    tone: 'bg-verdict-warning-bg text-verdict-warning',
    entity: '',
    text: [
      'Bạn so sánh giúp khoản vay này khi đóng đúng hạn và khi mất ưu đãi.',
      'Khoản vay 50 000 000 đồng. Kỳ hạn 12 tháng. Lãi phẳng trên dư nợ ban đầu.',
      '3 tháng đầu 0,8%/tháng, 9 tháng sau 2,2%/tháng.',
      'Phí quản lý 200 000 đồng/tháng.',
      'Nếu trễ hạn dù 1 ngày sẽ mất ưu đãi, áp dụng 2,2%/tháng cho cả 12 tháng.',
    ].join('\n'),
    image: 'demo-lai-bacthang-dieukien.png',
  },
  {
    label: 'Ví tiền mã hóa · USDT TRC-20',
    description: 'Kiểm tra ví nhận tiền để mở khóa rút lãi',
    icon: Wallet,
    tone: 'bg-verdict-warning-bg text-verdict-warning',
    entity: '',
    text: 'Bên sàn đầu tư gửi mã ví USDT TRC-20 này bảo mình nạp 1 500 USDT để mở khóa rút lãi, kiểm tra giúp mình ví này nhé.',
    image: 'demo-crypto-usdt-trc20.png',
  },
]

type Submission = { text: string; files: File[]; context: string; fields?: ForensicAuditFields }
type Reply = ForensicFollowUpResponse & { question: string; streamed: boolean }
type Conversation = { audit: ForensicAuditResponse; submission: Submission; replies: Reply[] }
type Pending = { kind: 'audit'; submission: Submission; stages: ForensicAuditStage[] }
  | { kind: 'chat'; question: string; text?: string }

function UserBubble({ submission }: { submission: Submission }) {
  return (
    <article aria-label="Tin nhắn của bạn" className="ms-auto w-fit max-w-full space-y-2.5 rounded-xl bg-accent px-4 py-3 text-sm leading-relaxed text-accent-foreground sm:max-w-[85%]">
      {submission.context && <p className="text-xs font-semibold [overflow-wrap:anywhere]">{submission.context}</p>}
      {submission.text && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{submission.text}</p>}
      <AttachmentStrip files={submission.files} />
    </article>
  )
}

function AgentBubble({ answer, streamed, complete = true, degraded, status, stages, reaudit, busy,
  label = 'Câu trả lời của FinCopilot' }: {
  answer?: string; streamed?: boolean; complete?: boolean; degraded?: boolean; status?: string; stages?: ForensicAuditStage[]
  label?: string; reaudit?: () => void; busy?: boolean
}) {
  const latest = stages?.at(-1)
  return (
    <article aria-label={label} className="forensic-agent grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 sm:gap-3">
      <span className="grid size-9 place-items-center rounded-xl bg-accent text-primary sm:size-10">
        <Bot size={21} strokeWidth={1.7} aria-hidden="true" />
      </span>
      <div className={cn('max-w-full space-y-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm leading-relaxed shadow-xs sm:px-4 sm:py-3',
        stages ? 'w-full sm:max-w-[34rem]' : 'w-fit sm:max-w-[90%]')}>
        <p className="text-xs font-semibold text-primary">FinCopilot{degraded ? ' · Dựa trên báo cáo' : ''}</p>
        {status && <div role="status" className="flex items-start gap-2 text-muted-foreground">
          <span aria-hidden="true" className="forensic-thinking-dots mt-2 flex shrink-0 items-center gap-1 text-primary"><i /><i /><i /></span>
          <span>{status}</span>
        </div>}
        {stages && stages.length > 0 && (
          <div className="space-y-2">
            <p className="font-semibold">Tiến độ giám định</p>
            <span className="sr-only" role="status">
              {latest && (latest.status === 'running' ? 'Đang ' + latest.label.toLowerCase() : latest.label + ' đã hoàn tất. ' + (latest.detail ?? ''))}
            </span>
            <ol className="audit-timeline grid gap-3" aria-label="Các bước giám định" role="list">
              {stages.map((stage) => (
                <li key={stage.step} data-audit-step={stage.step} data-audit-status={stage.status} className="relative flex items-start gap-3">
                  <span className="relative z-[1] grid size-7 shrink-0 place-items-center rounded-full bg-accent text-primary">
                    {stage.status === 'done'
                      ? <Check size={15} className="text-verdict-safe" aria-hidden="true" />
                      : <LoaderCircle size={15} className="audit-stage-spinner" aria-hidden="true" />}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium"><span className="sr-only">{stage.status === 'done' ? 'Đã hoàn tất: ' : 'Đang thực hiện: '}</span>{stage.label}</p>
                    {stage.detail && <p className="text-xs text-muted-foreground">{stage.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
        {streamed && answer ? <LiveReplyText text={plainAuditText(answer) || answer} complete={complete} />
          : answer && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{plainAuditText(answer)}</p>}
        {reaudit && (
          <Button variant="outline" className="mt-2 min-h-11 whitespace-normal text-start" disabled={busy} onClick={reaudit}>
            <RotateCcw size={16} aria-hidden="true" /> Giám định lại kèm thông tin vừa bổ sung
          </Button>
        )}
      </div>
    </article>
  )
}

export function ForensicWorkbench({ handoff, uploadMaxMb, pdfMaxPages }: {
  handoff: ForensicHandoff
  uploadMaxMb: number
  pdfMaxPages: number
}) {
  const [entity, setEntity] = useState(handoff.claimedEntity ?? '')
  const [sourceAlertId, setSourceAlertId] = useState(handoff.from === 'radar' ? handoff.alertId : undefined)
  const [draft, setDraft] = useState(() => {
    if (handoff.from === 'radar') return [handoff.summary, handoff.indicator].filter(Boolean).join('\n')
    if (handoff.from === 'survey-apr' && handoff.amount && handoff.term && handoff.annualRatePct) {
      return `${handoff.label ? handoff.label + '\n' : ''}Kiểm tra khoản vay ${formatVnd(handoff.amount)}, kỳ hạn ${handoff.term} tháng, APR ${handoff.annualRatePct}%/năm.`
    }
    if (handoff.from === 'home-quick-check' && handoff.prefillText) return handoff.prefillText
    return handoff.prefillText ?? ''
  })
  const [refusals, setRefusals] = useState<{ question: string; answer: string }[]>([])
  const [demo, setDemo] = useState<typeof examples[number]>()
  const [loadingDemo, setLoadingDemo] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [conversation, setConversation] = useState<Conversation>()
  const [pending, setPending] = useState<Pending>()
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const attach = useRef<HTMLButtonElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const followScroll = useRef(false)
  const lastScrollTop = useRef(0)
  const activeRequest = useRef<AbortController>(null)
  const demoRequest = useRef<AbortController>(null)
  const session = useQuery(sessionQuery)
  const queryClient = useQueryClient()
  const followingUp = Boolean(conversation && !files.length && !entity && !demo)
  const promptLabel = followingUp ? 'Câu hỏi tiếp theo' : 'Nội dung cần giám định'
  const submitLabel = followingUp ? 'Gửi câu hỏi' : 'Gửi giám định'
  const attachmentLabel = 'Đính kèm ảnh/PDF · kéo thả hoặc dán Ctrl+V · tối đa 6 tệp, ' + uploadMaxMb + ' MB/tệp, PDF ' + pdfMaxPages + ' trang'
  const contextName = entity ? 'Đơn vị từ Bộ lọc Tin cậy: ' + entity : demo ? 'Mẫu: ' + demo.label : ''

  useEffect(() => () => {
    activeRequest.current?.abort()
    demoRequest.current?.abort()
  }, [])

  useEffect(() => {
    if (!scrollRoot || !transcript.current) return
    const content = transcript.current
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (followScroll.current) scrollRoot.scrollTop = scrollRoot.scrollHeight
      })
    })
    observer.observe(content)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [scrollRoot])

  async function selectDemo(example: typeof examples[number]) {
    demoRequest.current?.abort()
    const controller = new AbortController()
    demoRequest.current = controller
    setLoadingDemo(true)
    setError('')
    try {
      const response = await fetch('/demo-qr/' + example.image, { signal: controller.signal })
      if (!response.ok) throw new Error('Sample image unavailable')
      const image = await response.blob()
      if (controller.signal.aborted) return
      const result = addAttachments([], [new File([image], example.image, { type: 'image/png' })], uploadMaxMb)
      if (result.error) {
        setError(result.error)
        return
      }
      setDemo(example)
      setDraft(example.text)
      setFiles(result.files)
      setEntity('')
    } catch {
      if (!controller.signal.aborted) setError('Chưa tải được ảnh mẫu. Hãy bấm lại để thử tiếp.')
    } finally {
      if (!controller.signal.aborted) {
        demoRequest.current = null
        setLoadingDemo(false)
      }
    }
  }

  function addFiles(incoming: Iterable<File>) {
    if (activeRequest.current || demoRequest.current) return
    const result = addAttachments(files, incoming, uploadMaxMb)
    if (result.files.length > files.length) {
      setFiles(result.files)
      setDemo(undefined)
    }
    setError(result.error)
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const clipboard = event.clipboardData
    const pasted = clipboard.files.length ? Array.from(clipboard.files) : Array.from(clipboard.items)
      .map((item) => item.kind === 'file' ? item.getAsFile() : null).filter((file): file is File => file !== null)
    if (!pasted.length) return
    event.preventDefault()
    addFiles(pasted)
  }

  function resetConversation() {
    followScroll.current = false
    if (scrollRoot) scrollRoot.scrollTop = 0
    setConversation(undefined)
    setDraft('')
    setEntity('')
    setSourceAlertId(undefined)
    setRefusals([])
    setDemo(undefined)
    setFiles([])
    setError('')
    textarea.current?.focus()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void send()
  }

  function reaudit(append: string) {
    if (!conversation) return
    const { submission, audit } = conversation
    const original = submission.text || audit.privacyProof.rawTextMasked || ''
    const rawQrString = submission.fields?.rawQrString ??
      (/^(?:000201\S+6304[0-9a-f]{4}|(?:(?:https?|bitcoin|ethereum|tron|usdt|momo|zalopay):)\S+|2\|99\|\S+|(?:0x[a-f0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|[13][1-9A-HJ-NP-Za-km-z]{25,34}|bc1[ac-hj-np-z02-9]{11,71}))$/i.test(original) ? original : undefined)
    const qrSummary = !rawQrString && !submission.files.length ? audit.qrPayloads.map((qr) =>
      [qr.providerLabel ?? qr.bankName, qr.accountNumberMasked, qr.qrAmountVnd ? qr.qrAmountVnd + ' đ' : null, qr.purposeText]
        .filter(Boolean).join(' · ')).filter(Boolean).join('\n') : ''
    const base = [rawQrString === original ? '' : original, qrSummary].filter(Boolean).join('\n\n')
    const addition = 'Thông tin bổ sung\n' + append
    const text = [base.slice(0, 50_000 - addition.length - 2).trim(), addition].filter(Boolean).join('\n\n')
    void send({ ...submission, text, fields: {
      rawText: text, rawQrString, claimedEntityName: submission.fields?.claimedEntityName ?? audit.claimedEntityName ?? undefined,
      sourceAlertId: submission.fields?.sourceAlertId,
    } })
  }

  async function send(resubmission?: Submission) {
    if (activeRequest.current || demoRequest.current || !session.isSuccess) return
    const text = draft.trim()
    const controller = new AbortController()
    const options = { signal: controller.signal }
    const isChat = !resubmission && followingUp && conversation
    setError('')

    try {
      if (isChat) {
        const conversation = isChat
        const history = conversation.replies.flatMap(({ question, answer }) => [
          { role: 'user' as const, content: question },
          { role: 'assistant' as const, content: answer.slice(0, 4000) },
        ]).slice(-6)
        const followUp = ForensicFollowUpRequestSchema.safeParse({ question: text, history })
        if (!followUp.success) {
          setError('Nhập câu hỏi tối đa 2.000 ký tự.')
          return
        }

        activeRequest.current = controller
        followScroll.current = true
        setPending({ kind: 'chat', question: text })
        const chatPath = '/forensic/audits/' + encodeURIComponent(conversation.audit.auditId) + '/chat'
        let streamed = true
        const reply = await streamReply(chatPath, followUp.data, controller.signal,
          (answer) => setPending({ kind: 'chat', question: text, text: answer })).catch((cause: unknown) => {
          if (controller.signal.aborted) throw cause
          streamed = false
          setPending({ kind: 'chat', question: text })
          return apiClient.post(chatPath, followUp.data, { ...options, schema: ForensicFollowUpResponseSchema })
        })
        setConversation({ ...conversation, replies: [...conversation.replies, { question: text, ...reply, streamed }] })
      } else {
        const parsed = ForensicAuditFieldsSchema.safeParse(resubmission?.fields ?? {
          rawText: text || undefined,
          claimedEntityName: entity || demo?.entity || undefined,
          sourceAlertId: demo ? undefined : sourceAlertId,
        })
        const attachments = resubmission?.files ?? files
        if (!parsed.success || (!attachments.length && !parsed.data.rawText && !parsed.data.claimedEntityName && !parsed.data.rawQrString)) {
          setError('Nhập nội dung hoặc đính kèm tệp để bắt đầu.')
          return
        }

        const payload = new FormData()
        for (const [name, value] of Object.entries(parsed.data)) if (value) payload.append(name, value)
        for (const file of attachments) payload.append('files', file)
        const submission = resubmission ?? { text, files, context: contextName, fields: parsed.data }
        activeRequest.current = controller
        followScroll.current = true
        setPending({ kind: 'audit', submission, stages: [] })
        const audit = await streamAudit(payload, controller.signal, (stage) => {
          setPending((current) => {
            if (current?.kind !== 'audit') return current
            const otherStages = current.stages.filter((item) => item.step !== stage.step)
            return { ...current, stages: [...otherStages, stage] }
          })
        }, () => setPending({ kind: 'audit', submission, stages: [] }))
        if ('type' in audit) {
          setRefusals((previous) => [...previous, { question: submission.text, answer: audit.message }])
          if (!resubmission) setDraft('')
          return
        }
        followScroll.current = false
        if (scrollRoot) scrollRoot.scrollTop = 0
        setConversation({ audit, submission, replies: [] })
        setFiles([])
        setEntity('')
        setSourceAlertId(undefined)
        setDemo(undefined)
        queryClient.setQueryData(auditQuery(audit.auditId).queryKey, audit)
        void queryClient.invalidateQueries({ queryKey: auditListQuery.queryKey })
      }
      if (!resubmission) setDraft('')
    } catch (cause) {
      if (controller.signal.aborted) return
      const fileErrors = {
        ERR_INVALID_FILE_MAGIC: 'Tệp bị lỗi hoặc sai định dạng. Hãy thử lại với JPEG, PNG, WebP hoặc PDF.',
        ERR_PDF_PAGE_LIMIT: 'PDF vượt giới hạn ' + pdfMaxPages + ' trang. Hãy chọn các trang cần kiểm tra.',
        ERR_FILE_TOO_LARGE: 'Tệp vượt giới hạn ' + uploadMaxMb + ' MB. Hãy chọn tệp nhỏ hơn.',
      }
      const fileError = cause instanceof ApiError && cause.errorCode in fileErrors
        ? fileErrors[cause.errorCode as keyof typeof fileErrors] : null
      setError(fileError ?? requestError(cause, isChat ? 'Chưa trả lời được. Bạn có thể gửi lại câu hỏi.'
        : resubmission ? 'Chưa giám định lại được. Bạn có thể bấm thử lại trong câu trả lời.'
          : 'Chưa thể giám định. Dữ liệu vẫn ở ô nhập để bạn gửi lại.'))
    } finally {
      activeRequest.current = null
      if (!controller.signal.aborted) setPending(undefined)
    }
  }

  const replies: Reply[] = conversation?.replies ?? []
  const visibleReplies = pending?.kind === 'chat'
    ? [...replies, { ...pending, answer: pending.text ?? '', streamed: true, meta: undefined }]
    : replies

  return (
    <section className="forensic-workspace flex min-w-0 flex-col" aria-label="Hội thoại giám định">
      <header className="print-hidden flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-border py-1.5">
        <h1 className="min-w-0 text-base font-semibold tracking-tight sm:text-lg">Giám định tài chính</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          <AuditHistory dropdown />
          {conversation && (
            <Button variant="ghost" className="h-9 gap-1 px-2 text-xs sm:text-sm" disabled={Boolean(pending) || loadingDemo} onClick={resetConversation}>
              <RotateCcw size={16} aria-hidden="true" className="hidden sm:inline-block" /> Phiên mới
            </Button>
          )}
        </div>
      </header>
      {handoff.from && <aside className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
        <span>{handoff.from === 'radar' ? 'Cảnh báo từ Radar' : handoff.from === 'trust-filter' ? 'Đơn vị từ Bộ lọc Tin cậy' : 'Khoản vay APR cao từ Khảo sát'}
          {handoff.from === 'trust-filter' && handoff.claimedEntity ? ` · ${handoff.claimedEntity}` : ''}</span>
        <Link className="font-medium text-primary underline underline-offset-4" href={handoff.from === 'radar'
          ? handoff.alertId ? ROUTES.radarArticle(handoff.alertId) + '?kind=alert' : ROUTES.radar : ROUTES.survey}>
          {handoff.from === 'radar' ? 'Về cảnh báo' : 'Về Khảo sát'}
        </Link>
      </aside>}
      <div ref={setScrollRoot} tabIndex={0} role="region" aria-label="Nội dung hội thoại"
        className="forensic-transcript min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] px-0.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onWheel={(event) => { if (event.deltaY < 0) followScroll.current = false }}
        onScroll={(event) => {
          const { scrollHeight, scrollTop, clientHeight } = event.currentTarget
          const movingUp = scrollTop < lastScrollTop.current - 1
          followScroll.current = !movingUp && scrollHeight - scrollTop - clientHeight < 120
          lastScrollTop.current = scrollTop
        }}>
        <div ref={transcript} className="grid min-w-0 gap-4 py-3 sm:py-4">
      {refusals.map(({ question, answer }, index) => <div key={index} className="grid gap-3">
        <p className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-xl bg-accent p-3 text-sm">{question}</p>
        <div aria-live="polite"><AgentBubble answer={answer} complete /></div>
      </div>)}
      {!conversation && !pending && !refusals.length && (
        <div className="grid gap-4 rounded-xl border border-primary/15 bg-card p-4 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-primary">
              <ShieldCheck size={25} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold tracking-tight">Giám định với FinCopilot</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">Đọc mã QR · Bóc tách lãi thực · Đối chiếu Luật VN · Xóa ảnh gốc</p>
            </div>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2" aria-label="Mẫu giám định">
            {examples.map((example) => {
              const Icon = example.icon
              return (
                <button key={example.label} type="button" className="case-card flex min-h-11 min-w-0 items-start gap-3 rounded-lg border border-border bg-background p-3 text-start"
                  aria-label={example.label} aria-pressed={demo === example} onClick={() => void selectDemo(example)}>
                  <span className={cn('grid size-9 shrink-0 place-items-center rounded-md', example.tone)}><Icon size={19} aria-hidden="true" /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{example.label}</span>
                    <span className="block text-xs leading-relaxed text-muted-foreground">{example.description}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <span className="sr-only" role="status">{loadingDemo ? 'Đang tải ảnh mẫu…' : demo ? 'Đã đính kèm ảnh mẫu.' : ''}</span>
        </div>
      )}

      {conversation && pending?.kind !== 'audit' && (
        <div className="grid min-w-0 gap-4">
          <UserBubble submission={conversation.submission} />
          <ForensicReport key={conversation.audit.auditId} audit={conversation.audit} inline animate
            opening={<AgentBubble label="Kết quả từ FinCopilot" answer="Mình đã xem nội dung bạn gửi. Đây là kết quả và những việc bạn có thể làm tiếp." />} />
          {visibleReplies.map((reply, index) => {
            const additions = visibleReplies.slice(0, index + 1)
              .flatMap((item) => item.meta?.suggestReaudit && item.meta.reAuditAppendText ? [item.meta.reAuditAppendText] : [])
            return <div key={index} className="grid min-w-0 gap-3">
              <UserBubble submission={{ text: reply.question, files: [], context: '' }} />
              <AgentBubble answer={reply.answer} streamed={reply.streamed} complete={Boolean(reply.meta)} degraded={reply.meta?.degradedMode}
                status={reply.meta || reply.answer ? undefined : 'FinCopilot đang trả lời…'} busy={Boolean(pending) || loadingDemo}
                reaudit={reply.meta?.suggestReaudit && additions.length ? () => reaudit([...new Set(additions)].join('\n')) : undefined} />
            </div>
          })}
        </div>
      )}

      {pending?.kind === 'audit' && (
        <div className="grid min-w-0 gap-3">
          <UserBubble submission={pending.submission} />
          <AgentBubble stages={pending.stages} status={pending.stages.length ? undefined : 'FinCopilot đang chuẩn bị giám định…'} />
        </div>
      )}
        </div>
      </div>

      <form onSubmit={submit} className={cn(
        'forensic-composer print-hidden grid min-w-0 shrink-0 gap-1.5 rounded-[26px] border border-border bg-card px-2 py-1.5 shadow-sm',
        dragging && 'border-primary ring-2 ring-primary/25',
      )}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          if (!pending) setDragging(true)
        }}
        onDragLeave={(event) => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false)
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          setDragging(false)
          addFiles(event.dataTransfer.files)
        }}>
        {contextName && (
          <div className="flex w-fit max-w-full items-center gap-2 rounded-lg bg-accent ps-3 text-sm text-accent-foreground">
            <span className="min-w-0 [overflow-wrap:anywhere]">{contextName}</span>
            <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label="Bỏ ngữ cảnh" disabled={Boolean(pending)}
              onClick={() => {
                setEntity('')
                setDemo(undefined)
                textarea.current?.focus()
              }}>
              <X size={17} aria-hidden="true" />
            </Button>
          </div>
        )}

        {!pending && <AttachmentStrip files={files} disabled={loadingDemo} onRemove={(file) => {
          setFiles(files.filter((item) => item !== file))
          if (file.name === demo?.image) setDemo(undefined)
          setError('')
          attach.current?.focus()
        }} />}

        <div className="flex min-w-0 items-end gap-2">
          <input ref={input} aria-label="Chọn tệp giám định" type="file" multiple hidden
            accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" disabled={Boolean(pending)}
            onChange={(event) => {
              if (event.currentTarget.files) addFiles(event.currentTarget.files)
              event.currentTarget.value = ''
            }} />
          <Button ref={attach} variant="outline" size="icon" className="size-9 shrink-0 rounded-full"
            disabled={Boolean(pending) || loadingDemo} aria-label={attachmentLabel} title={attachmentLabel} onClick={() => input.current?.click()}>
            <Plus size={18} aria-hidden="true" />
          </Button>
          <Label htmlFor="forensic-text" className="sr-only">{promptLabel}</Label>
          <div className="forensic-input-mirror min-w-0 flex-1 self-center text-sm leading-6 sm:text-base" data-value={pending ? '' : draft}>
            <textarea id="forensic-text" ref={textarea} value={pending ? '' : draft} rows={1}
              maxLength={followingUp ? 2000 : 50000} disabled={Boolean(pending) || loadingDemo}
              placeholder={followingUp ? 'Hỏi về báo cáo…' : 'Bạn muốn kiểm tra điều gì?'}
              className="block h-auto min-h-9 max-h-36 w-full resize-none rounded-xl px-2 py-1.5 caret-primary outline-none [field-sizing:content] placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onPaste={handlePaste}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }}
            />
          </div>
          <Button type="submit" className="size-9 shrink-0 rounded-full p-0 shadow-sm" aria-label={submitLabel}
            disabled={Boolean(pending) || loadingDemo || !session.isSuccess || !(draft.trim() || files.length || entity)}>
            <ArrowUp size={18} aria-hidden="true" />
          </Button>
        </div>

        <div role="alert" className={cn(!error && 'sr-only')}>
          {error && <p className="rounded-xl bg-verdict-danger-bg px-2 py-1.5 text-sm text-verdict-danger">{error}</p>}
        </div>
        {session.isError && (
          <Alert variant="danger" className="flex flex-wrap items-center gap-2">
            <p>Chưa kết nối được phiên giám định.</p>
            <Button variant="outline" onClick={() => void session.refetch()}>Thử lại</Button>
          </Alert>
        )}
      </form>

      <span className="sr-only" role="status">{!pending && plainAuditText(conversation?.replies.at(-1)?.answer ?? '')}</span>
    </section>
  )
}
