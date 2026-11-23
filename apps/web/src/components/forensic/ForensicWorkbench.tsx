'use client'

import { ForensicAuditFieldsSchema, ForensicAuditResponseSchema } from '@fincopilot/shared-types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ScanLine, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Badge, Button, Card, Input, Label } from '@/components/ui'
import { ApiError, apiClient } from '@/lib/api-client'
import { auditHref, auditListQuery, auditQuery, requestError, sessionQuery } from '@/lib/workspace-data'
import { FileDropzone } from './FileDropzone'

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
    label: 'Hợp đồng vay ngân hàng',
    entity: 'ACB',
    text: 'Hợp đồng vay ACB: số tiền vay 50.000.000 VNĐ, kỳ hạn 24 tháng, lãi suất 14.5%/năm trên dư nợ giảm dần.',
    qr: '',
  },
]
const textareaClass = 'w-full resize-y rounded-lg border border-input bg-card p-3 text-sm leading-relaxed placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

type Stage = 'idle' | 'auditing' | 'opening'
const stageLabels = ['Chuẩn bị dữ liệu', 'Trích xuất và đối chiếu', 'Mở báo cáo']

export function ForensicWorkbench({
  claimedEntity, uploadMaxMb, pdfMaxPages,
}: {
  claimedEntity?: string
  uploadMaxMb: number
  pdfMaxPages: number
}) {
  const [entity, setEntity] = useState(claimedEntity ?? '')
  const [rawText, setRawText] = useState('')
  const [rawQrString, setRawQrString] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState('')
  const session = useQuery(sessionQuery)
  const router = useRouter()
  const queryClient = useQueryClient()
  const busy = stage !== 'idle'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !session.isSuccess) return
    setError('')
    const input = ForensicAuditFieldsSchema.safeParse({
      claimedEntityName: entity.trim() || undefined,
      rawText: rawText.trim() || undefined,
      rawQrString: rawQrString.trim() || undefined,
    })
    if (!input.success) {
      setError('Kiểm tra độ dài tên đơn vị, nội dung hoặc mã VietQR rồi thử lại.')
      return
    }
    if (!files.length && !Object.values(input.data).some(Boolean)) {
      setError('Chọn tệp, dán nội dung hoặc mã VietQR, hoặc nhập tên đơn vị cần đối chiếu.')
      return
    }

    let payload: typeof input.data | FormData = input.data
    if (files.length) {
      const form = new FormData()
      for (const [key, value] of Object.entries(input.data)) if (value) form.append(key, value)
      for (const file of files) form.append('files', file)
      payload = form
    }

    setStage('auditing')
    try {
      const audit = await apiClient.post('/forensic/audit', payload, { schema: ForensicAuditResponseSchema })
      setFiles([])
      setStage('opening')
      queryClient.setQueryData(auditQuery(audit.auditId).queryKey, audit)
      void queryClient.invalidateQueries({ queryKey: auditListQuery.queryKey })
      router.push(auditHref(audit.auditId))
    } catch (cause) {
      const fileErrors = {
        ERR_INVALID_FILE_MAGIC: 'Tệp bị lỗi hoặc không đúng định dạng. Hãy chọn lại tệp JPEG, PNG, WebP hoặc PDF.',
        ERR_FILE_TOO_LARGE: 'Tệp vượt quá giới hạn ' + uploadMaxMb + ' MB. Hãy giảm dung lượng hoặc bỏ tệp.',
        ERR_PDF_PAGE_LIMIT: 'Tệp PDF vượt quá ' + pdfMaxPages + ' trang. Hãy chọn các trang cần kiểm tra.',
      }
      const fileError = cause instanceof ApiError && cause.errorCode in fileErrors
        ? fileErrors[cause.errorCode as keyof typeof fileErrors] : null
      setError(fileError ?? requestError(cause, 'Chưa thể giám định. Kiểm tra kết nối và thử lại.'))
      setStage('idle')
    }
  }

  return (
    <div className="space-y-5">
      <aside className="flex flex-wrap items-start gap-3 rounded-xl border border-primary/20 bg-accent/60 p-4 sm:p-5" aria-label="Quyền riêng tư khi giám định">
        <Badge variant="safe" className="min-h-7">
          <ShieldCheck size={15} aria-hidden="true" /> Bảo vệ dữ liệu
        </Badge>
        <p className="max-w-[75ch] text-sm leading-relaxed text-accent-foreground">
          FinCopilot xóa tệp gốc khỏi bộ nhớ sau khi trích xuất. Ảnh và nội dung tài liệu có thể được gửi đến nhà cung cấp AI để đọc nội dung. Báo cáo lưu lại đã che thông tin định danh nhạy cảm.
        </p>
      </aside>

      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight">Dữ liệu cần kiểm tra</h2>
        <form className="space-y-5" onSubmit={submit}>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <FileDropzone files={files} update={setFiles} uploadMaxMb={uploadMaxMb} pdfMaxPages={pdfMaxPages} disabled={busy} />
            <fieldset className="grid min-w-0 gap-4" disabled={busy}>
              <legend className="mb-2 text-sm font-semibold">Đơn vị, văn bản hoặc VietQR</legend>
              <div className="grid gap-2">
                <Label htmlFor="claimed-entity">Tên đơn vị tự xưng</Label>
                <Input id="claimed-entity" type="text" value={entity} maxLength={200} className="h-11"
                  placeholder="Tên công ty trên hợp đồng hoặc tin nhắn" onChange={(event) => setEntity(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="forensic-text">Nội dung cần giám định</Label>
                <textarea id="forensic-text" value={rawText} rows={5} maxLength={50_000}
                  placeholder="Dán tin nhắn yêu cầu chuyển tiền hoặc điều khoản bạn muốn kiểm tra"
                  onChange={(event) => setRawText(event.target.value)} className={textareaClass} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="forensic-qr">Chuỗi VietQR</Label>
                <textarea id="forensic-qr" value={rawQrString} rows={2} maxLength={4096} spellCheck={false}
                  placeholder="Dán mã dạng văn bản, ví dụ 000201…"
                  onChange={(event) => setRawQrString(event.target.value)} className={textareaClass + ' font-mono text-xs'} />
              </div>
            </fieldset>
          </div>

          {busy && (
            <div className="space-y-2 rounded-lg bg-muted p-4" aria-label="Tiến độ giám định">
              <ol className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                {stageLabels.map((label, index) => (
                  <li key={label} aria-current={index === (stage === 'auditing' ? 1 : 2) ? 'step' : undefined}
                    className="text-muted-foreground aria-[current=step]:font-semibold aria-[current=step]:text-primary">
                    {index + 1}. {label}
                  </li>
                ))}
              </ol>
              <progress aria-label={stage === 'auditing' ? stageLabels[1] : stageLabels[2]} max={3}
                value={stage === 'opening' ? 3 : undefined} className="block w-full accent-primary" />
            </div>
          )}
          <p role="alert" className={error ? 'text-sm text-destructive' : 'sr-only'}>{error}</p>
          {session.isError ? (
            <div role="alert" className="space-y-2">
              <p className="text-sm text-destructive">Chưa thể mở phiên giám định.</p>
              <Button onClick={() => void session.refetch()} variant="outline" className="min-h-11">Thử kết nối lại</Button>
            </div>
          ) : (
            <Button type="submit" disabled={busy || session.isPending} className="min-h-11 w-full sm:w-fit">
              <ScanLine size={19} aria-hidden="true" /> {busy ? 'Đang giám định…' : 'Bắt đầu giám định'}
            </Button>
          )}
        </form>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <p className="me-1 text-sm font-semibold">Thử dữ liệu mẫu</p>
        {examples.map((example) => (
          <Button key={example.label} variant="outline" className="min-h-11" disabled={busy || files.length > 0}
            onClick={() => {
              setEntity(example.entity)
              setRawText(example.text)
              setRawQrString(example.qr)
              setError('')
              document.getElementById('claimed-entity')?.focus()
            }}>
            {example.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
