'use client'

import {
  ForensicAuditFieldsSchema, ForensicAuditResponseSchema, ForensicFollowUpRequestSchema, ForensicFollowUpResponseSchema,
  type ForensicAuditResponse,
} from '@fincopilot/shared-types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, FileUp, Plus, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react'
import { Alert, Button, Label } from '@/components/ui'
import { ApiError, apiClient } from '@/lib/api-client'
import { auditListQuery, auditQuery, requestError, sessionQuery } from '@/lib/workspace-data'
import { cn } from '@/lib/utils'
import { addAttachments, AttachmentStrip } from './AttachmentStrip'
import { ForensicReport } from './ForensicReport'

const examples = [
  {
    label: 'Bẫy lỗi 102',
    entity: 'Công ty Tài chính ABC',
    text: 'Khoản vay bị lỗi 102, đóng băng vốn. Vui lòng chuyển 2.500.000đ phí giải ngân qua mã VietQR để mở khóa. Tài khoản cá nhân, chủ tài khoản: NGUYEN VAN HUNG.',
    qr: '00020101021238540010A00000072701240006970422011009876543210208QRIBFTTA5303704540725000005802VN62250821PHI GIAI NGAN LOI 1026304CA92',
  },
  {
    label: 'Lãi phẳng và phí giữ lại',
    entity: 'Công ty Tài chính ABC',
    text: 'Khoản vay 50.000.000 VNĐ trong 24 tháng. Lãi phẳng 0.9%/tháng. Phí thu trước 5.000.000 VNĐ, khấu trừ vào khoản thực nhận.',
    qr: '',
  },
  {
    label: 'Chuyển khoản cá nhân',
    entity: '',
    text: 'Mình trả tiền mua đồ của bạn này. Có thông tin gì mình nên xác nhận trước khi chuyển không?',
    qr: '00020101021138540010A00000072701240006970436011010123456780208QRIBFTTA53037045802VN6304497A',
  },
]

type Submission = { text: string; files: File[]; context: string }
type Conversation = { audit: ForensicAuditResponse; submission: Submission; replies: { question: string; answer: string; degradedMode: boolean }[] }
type Pending = { kind: 'audit'; submission: Submission } | { kind: 'chat'; question: string }

function UserBubble({ submission }: { submission: Submission }) {
  return (
    <article aria-label="Tin nhắn của bạn" className="ms-auto w-fit max-w-full space-y-2.5 rounded-xl bg-accent px-4 py-3 text-sm leading-relaxed text-accent-foreground sm:max-w-[85%]">
      {submission.context && <p className="text-xs font-semibold [overflow-wrap:anywhere]">{submission.context}</p>}
      {submission.text && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{submission.text}</p>}
      <AttachmentStrip files={submission.files} />
    </article>
  )
}

export function ForensicWorkbench({ claimedEntity, uploadMaxMb, pdfMaxPages }: {
  claimedEntity?: string
  uploadMaxMb: number
  pdfMaxPages: number
}) {
  const [entity, setEntity] = useState(claimedEntity ?? '')
  const [draft, setDraft] = useState('')
  const [demo, setDemo] = useState<typeof examples[number]>()
  const [files, setFiles] = useState<File[]>([])
  const [conversation, setConversation] = useState<Conversation>()
  const [pending, setPending] = useState<Pending>()
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const attach = useRef<HTMLButtonElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const activeRequest = useRef<AbortController>(null)
  const session = useQuery(sessionQuery)
  const queryClient = useQueryClient()
  const followingUp = Boolean(conversation && !files.length && !entity && !demo)
  const promptLabel = followingUp ? 'Câu hỏi tiếp theo' : 'Nội dung cần giám định'
  const submitLabel = followingUp ? 'Gửi câu hỏi' : 'Gửi giám định'
  const contextName = entity ? 'Đơn vị từ Bộ lọc Tin cậy: ' + entity : demo ? 'Mẫu: ' + demo.label : ''

  useEffect(() => () => activeRequest.current?.abort(), [])

  function addFiles(incoming: Iterable<File>) {
    if (activeRequest.current) return
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
    setConversation(undefined)
    setDraft('')
    setEntity('')
    setDemo(undefined)
    setFiles([])
    setError('')
    textarea.current?.focus()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (activeRequest.current || !session.isSuccess) return
    const text = draft.trim()
    const controller = new AbortController()
    const options = { signal: controller.signal }
    setError('')

    try {
      if (followingUp && conversation) {
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
        setPending({ kind: 'chat', question: text })
        const reply = await apiClient.post('/forensic/audits/' + encodeURIComponent(conversation.audit.auditId) + '/chat',
          followUp.data, { ...options, schema: ForensicFollowUpResponseSchema })
        setConversation({ ...conversation, replies: [...conversation.replies, { question: text, answer: reply.answer, degradedMode: reply.meta.degradedMode }] })
      } else {
        const parsed = ForensicAuditFieldsSchema.safeParse({
          rawText: text || undefined,
          rawQrString: demo?.qr || undefined,
          claimedEntityName: entity || demo?.entity || undefined,
        })
        if (!parsed.success || (!files.length && !Object.values(parsed.data).some(Boolean))) {
          setError('Nhập nội dung hoặc đính kèm tệp để bắt đầu.')
          return
        }

        const payload = new FormData()
        for (const [name, value] of Object.entries(parsed.data)) if (value) payload.append(name, value)
        for (const file of files) payload.append('files', file)
        const submission = { text, files, context: contextName }
        activeRequest.current = controller
        setPending({ kind: 'audit', submission })
        const audit = await apiClient.post('/forensic/audit', payload, { ...options, schema: ForensicAuditResponseSchema })
        setConversation({ audit, submission, replies: [] })
        setFiles([])
        setEntity('')
        setDemo(undefined)
        queryClient.setQueryData(auditQuery(audit.auditId).queryKey, audit)
        void queryClient.invalidateQueries({ queryKey: auditListQuery.queryKey })
      }
      setDraft('')
    } catch (cause) {
      if (controller.signal.aborted) return
      const fileErrors = {
        ERR_INVALID_FILE_MAGIC: 'Tệp bị lỗi hoặc sai định dạng. Hãy thử lại với JPEG, PNG, WebP hoặc PDF.',
        ERR_PDF_PAGE_LIMIT: 'PDF vượt giới hạn ' + pdfMaxPages + ' trang. Hãy chọn các trang cần kiểm tra.',
        ERR_FILE_TOO_LARGE: 'Tệp vượt giới hạn ' + uploadMaxMb + ' MB. Hãy chọn tệp nhỏ hơn.',
      }
      const fileError = cause instanceof ApiError && cause.errorCode in fileErrors
        ? fileErrors[cause.errorCode as keyof typeof fileErrors] : null
      setError(fileError ?? requestError(cause, followingUp ? 'Chưa trả lời được. Bạn có thể gửi lại câu hỏi.'
        : 'Chưa thể giám định. Dữ liệu vẫn ở ô nhập để bạn gửi lại.'))
    } finally {
      activeRequest.current = null
      if (!controller.signal.aborted) setPending(undefined)
    }
  }

  return (
    <section className="grid min-w-0 gap-4" aria-label="Hội thoại giám định">
      {!conversation && !pending && (
        <div className="flex min-h-40 flex-col justify-end gap-4 sm:min-h-52">
          <p className="max-w-lg text-base leading-relaxed text-muted-foreground">Gửi ảnh mã QR, hợp đồng PDF hoặc tin nhắn bạn muốn kiểm tra.</p>
          <div className="flex flex-wrap gap-2" aria-label="Mẫu giám định">
            {examples.map((example) => (
              <Button key={example.label} variant="outline" className="min-h-11 rounded-full"
                aria-pressed={demo === example}
                onClick={() => {
                  setDemo(example)
                  setDraft(example.text)
                  setFiles([])
                  setEntity('')
                  setError('')
                  textarea.current?.focus()
                }}>
                {example.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {conversation && pending?.kind !== 'audit' && (
        <div className="grid min-w-0 gap-4">
          <UserBubble submission={conversation.submission} />
          <ForensicReport audit={conversation.audit} inline />
          {conversation.replies.map((reply, index) => (
            <div key={index} className="grid min-w-0 gap-3">
              <UserBubble submission={{ text: reply.question, files: [], context: '' }} />
              <article aria-label="Câu trả lời của FinCopilot" className="w-fit max-w-full space-y-1.5 rounded-xl border border-border bg-card px-4 py-3 text-sm leading-relaxed sm:max-w-[85%]">
                <p className="text-xs font-semibold text-primary">FinCopilot{reply.degradedMode ? ' · Dựa trên báo cáo' : ''}</p>
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{reply.answer}</p>
              </article>
            </div>
          ))}
        </div>
      )}

      {pending && (
        <div className="grid min-w-0 gap-3">
          <UserBubble submission={pending.kind === 'audit' ? pending.submission : { text: pending.question, files: [], context: '' }} />
          <div role="status" className="w-fit max-w-full space-y-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            <p>{pending.kind === 'audit' ? 'Đang phân tích dữ liệu…' : 'Đang xem lại báo cáo…'}</p>
            <progress className="block h-1.5 w-full accent-primary" aria-label={pending.kind === 'audit' ? 'Đang giám định' : 'Đang trả lời'} />
          </div>
        </div>
      )}

      <form onSubmit={submit} className={cn(
        'grid min-w-0 gap-2 rounded-xl border border-border bg-card p-3 sm:p-4',
        followingUp && 'bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 focus-within:sticky md:bottom-4',
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

        {!pending && <AttachmentStrip files={files} onRemove={(file) => {
          setFiles(files.filter((item) => item !== file))
          setError('')
          attach.current?.focus()
        }} />}

        <Label htmlFor="forensic-text" className="sr-only">{promptLabel}</Label>
        <textarea id="forensic-text" ref={textarea} value={pending ? '' : draft} rows={2}
          maxLength={followingUp ? 2000 : 50000} disabled={Boolean(pending)} aria-describedby="forensic-attachment-hint"
          placeholder={followingUp ? 'Hỏi về kết quả hoặc bước tiếp theo…' : 'Bạn muốn kiểm tra điều gì?'}
          className="min-h-14 max-h-40 w-full resize-none rounded-md px-2 py-2 text-base leading-relaxed caret-primary outline-none [field-sizing:content] placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onPaste={handlePaste}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }}
        />

        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <input ref={input} aria-label="Chọn tệp giám định" type="file" multiple hidden
            accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" disabled={Boolean(pending)}
            onChange={(event) => {
              if (event.currentTarget.files) addFiles(event.currentTarget.files)
              event.currentTarget.value = ''
            }} />
          <Button ref={attach} variant="outline" size="icon" className="size-11 shrink-0 rounded-full"
            disabled={Boolean(pending)} aria-label="Đính kèm tệp" onClick={() => input.current?.click()}>
            <Plus size={20} aria-hidden="true" />
          </Button>
          {conversation && (
            <Button variant="ghost" className="min-h-11 px-2" disabled={Boolean(pending)} onClick={resetConversation}>
              <RotateCcw size={16} aria-hidden="true" /> Phiên giám định mới
            </Button>
          )}
          <Button type="submit" className="ms-auto size-11 shrink-0 rounded-full p-0" aria-label={submitLabel}
            disabled={Boolean(pending) || !session.isSuccess || !(draft.trim() || files.length || entity || demo?.qr)}>
            <ArrowUp size={21} aria-hidden="true" />
          </Button>
        </div>

        <p id="forensic-attachment-hint" className="flex items-start gap-1.5 px-1 text-xs leading-relaxed text-muted-foreground">
          <FileUp size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          Dán hoặc kéo thả tối đa 6 ảnh/PDF. Mỗi tệp đến {uploadMaxMb} MB, PDF đến {pdfMaxPages} trang.
        </p>
        <p className="flex items-start gap-1.5 px-1 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
          <span>Tự động xóa tệp gốc trên máy chủ sau khi phân tích · Che CCCD/SĐT trong báo cáo.
            {' '}Ảnh có thể được gửi đến nhà cung cấp AI để phân tích.</span>
        </p>
        <div role="alert">
          {error && <p className="rounded-md bg-verdict-danger-bg px-2 py-1.5 text-sm text-verdict-danger">{error}</p>}
        </div>
        {session.isError && (
          <Alert variant="danger" className="flex flex-wrap items-center gap-2">
            <p>Chưa kết nối được phiên giám định.</p>
            <Button variant="outline" onClick={() => void session.refetch()}>Thử lại</Button>
          </Alert>
        )}
      </form>

      <span className="sr-only" role="status">{!pending && conversation?.replies.at(-1)?.answer}</span>
    </section>
  )
}
