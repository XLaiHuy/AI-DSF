'use client'

import {
  ForensicAuditFieldsSchema, ForensicFollowUpRequestSchema, ForensicFollowUpResponseSchema, ROUTES,
  type ForensicAuditFields, type ForensicAuditStage, type ForensicHandoff,
} from '@fincopilot/shared-types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Bot, ChartNoAxesCombined, Check, FileText, LoaderCircle, Plus, QrCode, RotateCcw, ShieldAlert, ShieldCheck, Wallet, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from 'react'
import { useWorkspaceField, useWorkspaceSession, type ForensicReply as Reply } from '@/components/layout/WorkspaceSessionContext'
import { Alert, Button, Label } from '@/components/ui'
import { ApiError, apiClient } from '@/lib/api-client'
import { auditListQuery, auditQuery, formatVnd, requestError, sessionQuery } from '@/lib/workspace-data'
import { cn } from '@/lib/utils'
import { addAttachments, AttachmentStrip } from './AttachmentStrip'
import { CopilotRichCard } from './CopilotRichCard'
import { AuditHistory } from './AuditHistory'
import { clearConversationCache, conversationCacheExpiry, readConversationCache, writeConversationCache } from './conversation-cache'
import { ForensicReport } from './ForensicReport'
import { plainAuditText } from './report-copy'
import { streamAudit } from './stream-audit'
import { streamReply } from './stream-reply'
import { LiveReplyText } from './StreamingContentReveal'

const copilotPrompts = [
  'Lương 18 triệu, chi 8 triệu, muốn vay 100 triệu trong 36 tháng có ổn không?',
  'Đầu tư 20 triệu, góp thêm 3 triệu/tháng trong 24 tháng được bao nhiêu?',
  'Gần đây có thủ đoạn lừa đảo và lãi suất ngân hàng nào đáng chú ý?',
]

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

function AgentBubble({ answer, streamed, complete = true, degraded, status, stages, reaudit, busy, children,
  label = 'Câu trả lời của FinCopilot' }: {
  answer?: string; streamed?: boolean; complete?: boolean; degraded?: boolean; status?: string; stages?: ForensicAuditStage[]
  label?: string; reaudit?: () => void; busy?: boolean; children?: ReactNode
}) {
  const latest = stages?.at(-1)
  return (
    <article aria-label={label} className={cn("forensic-agent grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 sm:gap-3",
      children && "max-[359px]:grid-cols-[minmax(0,1fr)]")}>
      <span className={cn("grid size-9 place-items-center rounded-xl bg-accent text-primary sm:size-10", children && "max-[359px]:hidden")}>
        <Bot size={21} strokeWidth={1.7} aria-hidden="true" />
      </span>
      <div className={cn('max-w-full space-y-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm leading-relaxed shadow-xs sm:px-4 sm:py-3',
        stages ? 'w-full sm:max-w-[34rem]' : children ? 'w-full sm:max-w-[44rem]' : 'w-fit sm:max-w-[90%]')}>
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
        {children}
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
  const [entity, setEntity] = useWorkspaceField('forensic', 'entity')
  const [sourceAlertId, setSourceAlertId] = useWorkspaceField('forensic', 'sourceAlertId')
  const [draft, setDraft] = useWorkspaceField('forensic', 'draft')
  const [preAuditTurns, setPreAuditTurns] = useWorkspaceField('forensic', 'preAuditTurns')
  const [demo, setDemo] = useState<typeof examples[number]>()
  const [loadingDemo, setLoadingDemo] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [conversation, setConversation] = useWorkspaceField('forensic', 'conversation')
  const submittedFiles = useRef<{ auditId: string; files: File[] }>(null)
  const reportFiles = submittedFiles.current?.auditId === conversation?.audit.auditId ? submittedFiles.current?.files ?? [] : []
  const [pending, setPending] = useState<Pending>()
  const [error, setError] = useState('')
  const [resetting, setResetting] = useState(false)
  const [conversationSession, setConversationSession] = useWorkspaceField('forensic', 'conversationSession')
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
  const queryClient = useQueryClient()
  const session = useQuery(sessionQuery)
  const { viewerKey: viewer, clearForensicSession, update, sessions } = useWorkspaceSession()
  const savedScrollTop = sessions.forensic.scrollTop
  const scrollerRestored = useRef<HTMLDivElement | null>(null)
  const [restore, setRestore] = useState<ReturnType<typeof readConversationCache>>()
  const restoreId = restore?.owner === viewer && !conversation ? restore?.activeAuditId : undefined
  const report = useQuery({ ...auditQuery(restoreId ?? ''), enabled: Boolean(restoreId), retry: false })
  const restoringReport = Boolean(restoreId && report.isPending)
  const handoffKey = JSON.stringify(handoff)
  const [previousHandoff, setPreviousHandoff] = useWorkspaceField('forensic', 'handoffKey')
  const appliedHandoff = useRef<string>(null)
  const followingUp = Boolean(conversation && !files.length && !entity && !demo)
  const promptLabel = followingUp ? 'Câu hỏi tiếp theo' : 'Nội dung cần giám định'
  const submitLabel = followingUp ? 'Gửi câu hỏi' : 'Gửi giám định'
  const attachmentLabel = 'Đính kèm ảnh/PDF · kéo thả hoặc dán Ctrl+V · tối đa 6 tệp, ' + uploadMaxMb + ' MB/tệp, PDF ' + pdfMaxPages + ' trang'
  const contextName = entity ? 'Đơn vị từ Bộ lọc Tin cậy: ' + entity : demo ? 'Mẫu: ' + demo.label : ''

  useEffect(() => {
    if (!viewer) return
    const cached = conversationSession ? undefined : readConversationCache(viewer)
    if (!conversationSession) {
      setConversationSession({ owner: viewer, id: cached?.id ?? crypto.randomUUID(), expiresAt: cached?.expiresAt ?? conversationCacheExpiry() })
    }
    if (appliedHandoff.current === handoffKey) return
    appliedHandoff.current = handoffKey
    const next = JSON.parse(handoffKey) as ForensicHandoff
    if (!next.from && !next.prefillText && !next.claimedEntity) {
      if (cached) {
        setRestore(cached)
        setPreAuditTurns(cached.turns)
      }
      return
    }
    if (previousHandoff === handoffKey) return
    setPreviousHandoff(handoffKey)
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (cached?.activeAuditId && navigation?.type === 'reload' && navigation.name === window.location.href.split('#')[0]) {
      setRestore(cached)
      return
    }
    activeRequest.current?.abort()
    demoRequest.current?.abort()
    submittedFiles.current = null
    clearConversationCache()
    setConversationSession({ owner: viewer, id: crypto.randomUUID(), expiresAt: conversationCacheExpiry() })
    setRestore(undefined)
    setConversation(undefined)
    update('forensic', previous => ({ ...previous, scrollTop: 0 }))
    setPreAuditTurns([])
    setEntity(next.claimedEntity ?? '')
    setSourceAlertId(next.from === 'radar' ? next.alertId : undefined)
    setFiles([])
    setDemo(undefined)
    setPending(undefined)
    setLoadingDemo(false)
    setError('')
    if (next.from === 'radar') setDraft([next.summary, next.indicator].filter(Boolean).join('\n'))
    else if (next.from === 'survey-apr' && next.amount && next.term && next.annualRatePct) {
      setDraft(`${next.label ? next.label + '\n' : ''}Kiểm tra khoản vay ${formatVnd(next.amount)}, kỳ hạn ${next.term} tháng, APR ${next.annualRatePct}%/năm.`)
    } else setDraft(next.prefillText ?? '')
  }, [viewer, conversationSession, handoffKey, previousHandoff, setConversationSession,
    setConversation, setDraft, setEntity, setPreAuditTurns, setPreviousHandoff, setSourceAlertId, update])

  useEffect(() => {
    if (!restoreId || !restore) return
    if (report.isSuccess) {
      setConversation({
        audit: report.data, reportRevealed: true,
        submission: { text: report.data.privacyProof.rawTextMasked ?? '', context: '' },
        replies: (restore.followUpTurns ?? []).map(turn => ({ ...turn, streamed: false })),
      })
      setRestore(undefined)
    } else if (report.isError) {
      if (report.error instanceof ApiError && [403, 404].includes(report.error.status)) setRestore(undefined)
      else setError('Chưa mở lại được báo cáo. Tải lại trang để thử lại.')
    }
  }, [restoreId, restore, report.data, report.error, report.isSuccess, report.isError, setConversation])

  useEffect(() => {
    if (!conversationSession || conversationSession.owner !== viewer || restoreId) return
    if (!conversation && !preAuditTurns.length) return
    writeConversationCache({
      ...conversationSession,
      turns: preAuditTurns.slice(-3).map(({ question, answer }) => ({ question, answer })),
      activeAuditId: conversation?.audit.auditId,
      followUpTurns: conversation?.replies.slice(-6).map(({ question, answer }) => ({ question, answer })),
    })
  }, [conversationSession, conversation, preAuditTurns, viewer, restoreId])

  useLayoutEffect(() => {
    if (!scrollRoot || scrollerRestored.current === scrollRoot) return
    scrollerRestored.current = scrollRoot
    scrollRoot.scrollTop = savedScrollTop ?? 0
    lastScrollTop.current = scrollRoot.scrollTop
    followScroll.current = false
  }, [scrollRoot, savedScrollTop])

  useEffect(() => () => {
    activeRequest.current?.abort()
    demoRequest.current?.abort()
    update('forensic', previous => {
      const current = previous.conversation
      return {
        ...previous, scrollTop: lastScrollTop.current,
        conversation: current && { ...current, reportRevealed: true,
          replies: current.replies.map(reply => reply.meta && reply.streamed ? { ...reply, streamed: false } : reply) },
      }
    })
  }, [update])

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

  async function resetConversation() {
    if (!conversationSession || resetting || activeRequest.current) return
    setResetting(true)
    setError('')
    try {
      await apiClient.delete('/forensic/conversations/' + conversationSession.id)
    } catch (cause) {
      setError(requestError(cause, 'Chưa bắt đầu được phiên mới. Vui lòng thử lại.'))
      return
    } finally {
      setResetting(false)
    }
    clearForensicSession()
    clearConversationCache()
    setRestore(undefined)
    submittedFiles.current = null
    followScroll.current = false
    if (scrollRoot) scrollRoot.scrollTop = 0
    lastScrollTop.current = 0
    setEntity('')
    setSourceAlertId(undefined)
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
    const qrSummary = !rawQrString && !reportFiles.length ? audit.qrPayloads.map((qr) =>
      [qr.providerLabel ?? qr.bankName, qr.accountNumberMasked, qr.qrAmountVnd ? qr.qrAmountVnd + ' đ' : null, qr.purposeText]
        .filter(Boolean).join(' · ')).filter(Boolean).join('\n') : ''
    const base = [rawQrString === original ? '' : original, qrSummary].filter(Boolean).join('\n\n')
    const addition = 'Thông tin bổ sung\n' + append
    const text = [base.slice(0, 50_000 - addition.length - 2).trim(), addition].filter(Boolean).join('\n\n')
    void send({ ...submission, text, files: reportFiles, fields: {
      rawText: text, rawQrString, claimedEntityName: submission.fields?.claimedEntityName ?? audit.claimedEntityName ?? undefined,
      sourceAlertId: submission.fields?.sourceAlertId,
    } })
  }

  async function send(resubmission?: Submission, quickQuestion?: string) {
    if (restoringReport || activeRequest.current || demoRequest.current || !conversationSession || conversationSession.owner !== viewer || resetting) return
    const text = (quickQuestion ?? draft).trim()
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
        const reply = await streamReply(chatPath, followUp.data, controller.signal,
          (answer) => setPending({ kind: 'chat', question: text, text: answer })).catch((cause: unknown) => {
          if (controller.signal.aborted) throw cause
          setPending({ kind: 'chat', question: text })
          return apiClient.post(chatPath, followUp.data, { ...options, schema: ForensicFollowUpResponseSchema })
        })
        setConversationSession({ ...conversationSession, expiresAt: conversationCacheExpiry() })
        setConversation(current => current?.audit.auditId === conversation.audit.auditId ? {
          ...current, reportRevealed: true, replies: [
            ...current.replies.map(turn => turn.meta && turn.streamed ? { ...turn, streamed: false } : turn),
            { question: text, ...reply, streamed: false },
          ],
        } : current)
      } else {
        const sameSession = conversationSession.expiresAt > Date.now()
        const id = sameSession ? conversationSession.id : crypto.randomUUID()
        if (!sameSession) setPreAuditTurns([])
        const history = sameSession ? preAuditTurns.slice(-3).flatMap(({ question, answer, guidance }) => [
          { role: 'user' as const, content: question.trim() },
          { role: 'assistant' as const, content: answer.trim(), intent: guidance?.intent },
        ]).filter(turn => turn.content.length > 0 && turn.content.length <= 800) : []
        const parsed = ForensicAuditFieldsSchema.safeParse({
          conversationId: id,
          ...(resubmission?.fields ?? {
            preAuditHistory: history.length ? history : undefined,
            rawText: text || undefined,
            claimedEntityName: entity || demo?.entity || undefined,
            sourceAlertId: demo ? undefined : sourceAlertId,
          }),
        })
        const attachments = resubmission?.files ?? files
        if (!parsed.success || (!attachments.length && !parsed.data.rawText && !parsed.data.claimedEntityName && !parsed.data.rawQrString)) {
          setError('Nhập nội dung hoặc đính kèm tệp để bắt đầu.')
          return
        }

        const payload = new FormData()
        for (const [name, value] of Object.entries(parsed.data)) if (value) payload.append(name, typeof value === 'string' ? value : JSON.stringify(value))
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
          if (audit.type === 'guidance' || !sameSession) setConversationSession({
            owner: conversationSession.owner, id, expiresAt: conversationCacheExpiry(),
          })
          setPreAuditTurns((previous) => [...previous, { question: submission.text, answer: audit.message, guidance: audit.type === 'guidance' ? audit : undefined }])
          if (!resubmission) setDraft('')
          return
        }
        followScroll.current = false
        if (scrollRoot) scrollRoot.scrollTop = 0
        lastScrollTop.current = 0
        update('forensic', previous => ({ ...previous, scrollTop: 0 }))
        setPreAuditTurns([])
        setConversationSession({ owner: conversationSession.owner, id, expiresAt: conversationCacheExpiry() })
        submittedFiles.current = { auditId: audit.auditId, files: attachments }
        setConversation({ audit, submission: { text: submission.text, context: submission.context, fields: submission.fields }, replies: [] })
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
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 pe-2">
          <AuditHistory dropdown />
          <Button variant="ghost" type="button" className="min-h-11 gap-1 px-2 text-xs sm:text-sm" disabled={Boolean(pending) || loadingDemo || resetting || !conversationSession} onClick={() => void resetConversation()}>
            <RotateCcw size={16} aria-hidden="true" className="hidden sm:inline-block" /> Phiên mới
          </Button>
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
          if (scrollTop === lastScrollTop.current) return
          const movingUp = scrollTop < lastScrollTop.current - 1
          followScroll.current = !movingUp && scrollHeight - scrollTop - clientHeight < 120
          lastScrollTop.current = scrollTop
          update('forensic', previous => ({ ...previous, scrollTop }))
        }}>
        <div ref={transcript} className="grid min-w-0 gap-4 py-3 sm:py-4">
      {preAuditTurns.map(({ question, answer, guidance }, index) => <div key={index} className="grid gap-3">
        <p className="ml-auto max-w-[85%] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-xl bg-accent p-3 text-sm">{question}</p>
        <div className="min-w-0" aria-live="polite"><AgentBubble answer={answer} complete>
          {(guidance?.richCard || Boolean(guidance?.toolTrace?.length)) && <CopilotRichCard card={guidance?.richCard} trace={guidance?.toolTrace}
            surveyActionLabel={guidance?.richCard && 'openSurveyHref' in guidance.richCard &&
              guidance.cta?.href === guidance.richCard.openSurveyHref ? guidance.cta.label : undefined} />}
        </AgentBubble>
          {!!guidance?.checklist?.length && <ol aria-label="Các bước ứng cứu" className="mt-3 list-decimal space-y-2 rounded-lg border border-verdict-warning-border bg-verdict-warning-bg py-3 pe-3 ps-9 text-sm leading-relaxed text-verdict-warning">
            {guidance.checklist.map(step => <li key={step}>{step}</li>)}
          </ol>}
          {guidance && <div className="mt-2 flex flex-wrap gap-2">
            {guidance.suggestedPrompts?.map(prompt => <button type="button" key={prompt} className="rounded-full border px-3 py-2 text-sm" onClick={() => { setDraft(prompt); textarea.current?.focus() }}>{prompt}</button>)}
            {guidance.cta && (!guidance.richCard || ('openSurveyHref' in guidance.richCard && guidance.cta.href !== guidance.richCard.openSurveyHref)) && <Link className="rounded-lg bg-primary px-3 py-2 text-primary-foreground" href={guidance.cta.href}>{guidance.cta.label}</Link>}
          </div>}</div>
      </div>)}
      {restoringReport && <p role="status" className="text-sm text-muted-foreground">Đang mở lại báo cáo…</p>}
      {!restoringReport && !conversation && !pending && !preAuditTurns.length && (
        <div className="grid gap-4 rounded-xl border border-primary/15 bg-card p-4 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-primary">
              <ShieldCheck size={25} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold tracking-tight">Trợ lý & Giám định FinCopilot</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">Hỏi về khoản vay, tích lũy và cảnh báo mới. Gửi mã QR hoặc hợp đồng để giám định một trường hợp cụ thể.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Câu hỏi thử Copilot">
            {copilotPrompts.map(prompt => <Button key={prompt} type="button" variant="outline" size="sm"
              className="h-auto min-h-10 max-w-full justify-start whitespace-normal rounded-full text-left"
              disabled={!conversationSession || Boolean(entity || sourceAlertId || files.length || loadingDemo || restoringReport)}
              onClick={() => { setDraft(prompt); void send(undefined, prompt) }}>{prompt}</Button>)}
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2" aria-label="Mẫu giám định">
            {examples.map((example) => {
              const Icon = example.icon
              return (
                <button key={example.label} type="button" className="case-card flex min-h-11 min-w-0 items-start gap-3 rounded-lg border border-border bg-background p-3 text-start"
                  aria-label={example.label} aria-pressed={demo === example} disabled={!conversationSession} onClick={() => void selectDemo(example)}>
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
          <UserBubble submission={{ ...conversation.submission, files: reportFiles }} />
          <ForensicReport key={conversation.audit.auditId} audit={conversation.audit} inline animate={!conversation.reportRevealed}
            onRevealComplete={() => setConversation(current => current?.audit.auditId === conversation.audit.auditId && !current.reportRevealed
              ? { ...current, reportRevealed: true } : current)}
            opening={<AgentBubble label="Kết quả từ FinCopilot" answer="Mình đã xem nội dung bạn gửi. Đây là kết quả và những việc bạn có thể làm tiếp." />} />
          {visibleReplies.map((reply, index) => {
            const additions = visibleReplies.slice(0, index + 1)
              .flatMap((item) => item.meta?.suggestReaudit && item.meta.reAuditAppendText ? [item.meta.reAuditAppendText] : [])
            return <div key={index} className="grid min-w-0 gap-3">
              <UserBubble submission={{ text: reply.question, files: [], context: '' }} />
              <AgentBubble answer={reply.answer} streamed={reply.streamed} complete={Boolean(reply.meta)} degraded={reply.meta?.degradedMode}
                status={reply.meta || reply.answer ? undefined : 'FinCopilot đang trả lời…'} busy={Boolean(pending) || loadingDemo}
                reaudit={reply.meta?.suggestReaudit && additions.length ? () => reaudit([...new Set(additions)].join('\n')) : undefined}>
                {(reply.richCard || Boolean(reply.toolTrace?.length)) && <CopilotRichCard card={reply.richCard} trace={reply.toolTrace}
                  surveyActionLabel={reply.richCard && 'openSurveyHref' in reply.richCard && reply.cta?.href === reply.richCard.openSurveyHref
                    ? reply.cta.label : undefined} />}
                {reply.cta && !reply.richCard && <Link className="inline-block rounded-lg border px-3 py-2 text-sm font-semibold text-primary"
                  href={reply.cta.href}>{reply.cta.label}</Link>}
              </AgentBubble>
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
            disabled={Boolean(pending) || loadingDemo || !conversationSession} aria-label={attachmentLabel} title={attachmentLabel} onClick={() => input.current?.click()}>
            <Plus size={18} aria-hidden="true" />
          </Button>
          <Label htmlFor="forensic-text" className="sr-only">{promptLabel}</Label>
          <div className="forensic-input-mirror min-w-0 flex-1 self-center text-sm leading-6 sm:text-base" data-value={pending ? '' : draft}>
            <textarea id="forensic-text" ref={textarea} value={pending ? '' : draft} rows={1}
              maxLength={followingUp ? 2000 : 50000} disabled={Boolean(pending) || loadingDemo || restoringReport || !conversationSession || !session.isSuccess}
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
            disabled={Boolean(pending) || loadingDemo || restoringReport || !conversationSession || !session.isSuccess || !(draft.trim() || files.length || entity)}>
            <ArrowUp size={18} aria-hidden="true" />
          </Button>
        </div>

        <div role="alert" className={cn(!error && 'sr-only')}>
          {error && <p className="rounded-xl bg-verdict-danger-bg px-2 py-1.5 text-sm text-verdict-danger">{error}</p>}
        </div>
        {!followingUp && (
          <p className="px-2 text-xs text-muted-foreground">
            Ảnh/PDF được thu nhỏ để phân tích và xóa khỏi bộ nhớ sau xử lý; bạn nên che CCCD, SĐT trước khi tải lên.
          </p>
        )}
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
