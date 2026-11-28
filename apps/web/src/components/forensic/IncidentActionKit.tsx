'use client'

import type { ForensicAuditResponse, RiskTier } from '@fincopilot/shared-types'
import { Copy, Printer } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { Button, Card, Input, Label } from '@/components/ui'
import { formatVnd } from '@/lib/workspace-data'

const templates = [
  { key: 'police', label: 'Đơn trình báo A05', title: 'Đơn trình báo dấu hiệu lừa đảo / cho vay lãi nặng' },
  { key: 'bank', label: 'Yêu cầu tra soát ngân hàng', title: 'Đơn yêu cầu tra soát và hỗ trợ phong tỏa giao dịch' },
] as const

const fields = [
  { key: 'name', label: 'Họ tên người trình báo', type: 'text', limit: 100 },
  { key: 'phone', label: 'SĐT liên hệ', type: 'tel', limit: 30 },
  { key: 'time', label: 'Thời điểm chuyển tiền', type: 'datetime-local', limit: 30 },
  { key: 'amount', label: 'Số tiền đã chuyển (đồng)', type: 'text', limit: 24 },
  { key: 'reference', label: 'Mã giao dịch', type: 'text', limit: 80 },
] as const

const blank = '………………………………'
const officialPortal = 'https://canhbao.ncsc.gov.vn/'
const policeInstructions = 'https://www.bocongan.gov.vn/bai-viet/huong-dan-to-giac-bao-tin-ve-toi-pham-kien-nghi-khoi-to-d139-t35195'

function hostnames(evidence: string[]) {
  const mentions = evidence.flatMap(quote => quote.match(/(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?![\w-])/giu) ?? [])
  return [...new Set(mentions.map(mention => mention.toLowerCase().replace(/^https?:\/\//, '')))].slice(0, 12)
}

function reportContext(audit: ForensicAuditResponse, riskTier: RiskTier) {
  const qr = audit.qrPayloads.find(item => item.bankName || item.acqBin) ?? audit.qrPayloads[0]
  const evidence = [...new Set([
    ...audit.findings.map(item => item.evidenceQuote),
    ...audit.riskAssessment?.evidenceChain.map(item => item.quoteOrDecoded) ?? [],
  ].filter(Boolean))].slice(0, 6)
  const taxonomy = audit.riskAssessment?.taxonomy.map(item => item.vnAisCode + ' · ' + item.vnAisLabel) ?? []
  const domains = hostnames([...evidence, ...audit.qrPayloads.flatMap(item => item.targetUrl ?? []), audit.privacyProof.rawTextMasked ?? ''])
  const channel = qr?.bankName ?? qr?.providerLabel
  const qrLine = [channel, qr?.acqBin && 'BIN ' + qr.acqBin, qr?.accountNumberMasked && 'Tài khoản ' + qr.accountNumberMasked,
    qr?.qrAmountVnd && 'Số tiền trong mã ' + formatVnd(qr.qrAmountVnd)].filter(Boolean).join(' · ')
  const citations = audit.legalCitations?.map(item => item.title + ' (' + item.code + '), ' + item.articleRef + '\n' + item.sourceUrl) ?? []
  return { channel, qrLine, lines: [
    'Mã hồ sơ đối chiếu: ' + audit.auditId,
    'Mức rủi ro trong báo cáo: ' + riskTier + (audit.riskAssessment?.actionLabelVi ? ' · ' + audit.riskAssessment.actionLabelVi : ''),
    ...(taxonomy.length ? ['Dấu hiệu: ' + taxonomy.join(' · ')] : []),
    ...(qrLine ? ['Kênh nhận tiền đọc từ QR: ' + qrLine] : []),
    ...(domains.length ? ['Tên miền trích từ bằng chứng: ' + domains.join(', ')] : []),
    ...(evidence.length ? ['Trích đoạn đã che thông tin riêng:', ...evidence.map(quote => '• ' + quote)] : []),
    ...(citations.length ? ['Quy định để đối chiếu:', ...citations.map(citation => '• ' + citation)] : []),
  ] }
}

export function IncidentActionKit({ audit, riskTier }: { audit: ForensicAuditResponse; riskTier: RiskTier }) {
  const titleId = useId()
  const privacyId = useId()
  const [details, setDetails] = useState<Partial<Record<typeof fields[number]['key'], string>>>({})
  const [copyStatus, setCopyStatus] = useState('')
  const [printDocument, setPrintDocument] = useState<string | null>(null)
  const { channel, qrLine, lines } = reportContext(audit, riskTier)

  useEffect(() => {
    const clearPrint = () => setPrintDocument(null)
    window.addEventListener('afterprint', clearPrint)
    return () => window.removeEventListener('afterprint', clearPrint)
  }, [])

  function documentFor(template: typeof templates[number]) {
    const personal = fields.map(({ key, label }) => label + ': ' + (details[key]?.trim() || blank))
    const police = template.key === 'police'
    return [
      template.title.toLocaleUpperCase('vi-VN'),
      police ? 'Kính gửi: Cơ quan Công an địa phương / Cục An ninh mạng và phòng, chống tội phạm sử dụng công nghệ cao (A05).'
        : 'Kính gửi: Ngân hàng hoặc đơn vị trung gian thực hiện giao dịch.' + (channel ? ' Đơn vị nhận được đọc từ QR: ' + channel + '.' : ''),
      '', ...personal, '',
      police ? 'Tôi đề nghị xác minh các dấu hiệu nêu dưới đây và hướng dẫn bảo toàn, nộp chứng cứ.'
        : 'Tôi đề nghị tra soát giao dịch nêu trên, phối hợp với đơn vị nhận tiền và xem xét phong tỏa theo thẩm quyền nếu đủ căn cứ.',
      '', ...lines, '',
      police ? 'Kênh trình báo: Công an địa phương hoặc mục tố giác tội phạm trên VNeID. Gọi 113 trong tình huống khẩn cấp.\nPhản ánh tên miền nghi vấn: ' + officialPortal
        : 'Liên hệ ngay tổng đài chính thức của ngân hàng chuyển tiền. Dùng thông tin trên biên lai để xác nhận ngân hàng nhận tiền, số tiền và thời điểm giao dịch.',
      'Tài liệu đính kèm: Biên lai chuyển tiền, tin nhắn, hợp đồng hoặc bản gốc chứng cứ mà tôi đang giữ.',
      '', 'Ngày ' + blank, 'Người trình báo ký và ghi rõ họ tên',
    ].join('\n')
  }

  async function copy(template: typeof templates[number]) {
    try {
      await navigator.clipboard.writeText(documentFor(template))
      setCopyStatus('Đã sao chép ' + template.label + '.')
    } catch {
      setCopyStatus('Không sao chép được. Bạn có thể in hoặc lưu mẫu dưới dạng PDF.')
    }
  }

  function print(template: typeof templates[number]) {
    flushSync(() => setPrintDocument(documentFor(template)))
    window.print()
  }

  return <Card className="print-hidden min-w-0 space-y-4 p-4 sm:p-6" aria-labelledby={titleId}>
    <div className="space-y-1">
      <h2 id={titleId} className="text-lg font-semibold tracking-tight">Mẫu trình báo và tra soát</h2>
      <p className="text-sm text-muted-foreground">Nếu đã chuyển tiền, hãy gọi ngay ngân hàng chuyển tiền và giữ lại biên lai.</p>
      {qrLine && <p className="text-sm [overflow-wrap:anywhere]">Đọc từ mã QR: {qrLine}</p>}
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
      <a className="text-primary underline underline-offset-2" href={policeInstructions} target="_blank" rel="noreferrer">Cách trình báo với Công an</a>
      <a className="text-primary underline underline-offset-2" href={officialPortal} target="_blank" rel="noreferrer">Cổng cảnh báo an toàn thông tin</a>
    </div>
    <fieldset aria-describedby={privacyId} className="min-w-0 space-y-2">
      <legend className="text-sm font-semibold">Thông tin điền vào mẫu (không bắt buộc)</legend>
      <p id={privacyId} className="text-sm text-muted-foreground">Thông tin cá nhân chỉ xử lý trên trình duyệt, không gửi về máy chủ</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {fields.map(({ key, label, type, limit }) => <Label key={key} className="grid min-w-0 gap-1.5 text-sm">
          {label}
          <Input className="min-w-0" type={type} maxLength={limit} inputMode={key === 'amount' ? 'numeric' : undefined}
            autoComplete="off" value={details[key] ?? ''} onChange={event => {
              const value = event.target.value.slice(0, limit)
              setDetails(current => ({ ...current, [key]: value }))
            }} />
        </Label>)}
      </div>
    </fieldset>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      {templates.map(template => <section key={template.key} className="min-w-0 space-y-2 rounded-lg border border-border bg-muted/40 p-3">
        <h3 className="text-sm font-semibold">{template.label}</h3>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" aria-label={'Sao chép ' + template.label} onClick={() => void copy(template)}>
            <Copy size={15} aria-hidden="true" /> Sao chép
          </Button>
          <Button type="button" variant="outline" aria-label={'In / Lưu PDF ' + template.label} onClick={() => print(template)}>
            <Printer size={15} aria-hidden="true" /> In / Lưu PDF
          </Button>
        </div>
      </section>)}
    </div>
    <p role="status" className="text-sm text-muted-foreground empty:hidden">{copyStatus}</p>
    {printDocument && createPortal(<article className="incident-print">{printDocument}</article>, document.body)}
  </Card>
}
