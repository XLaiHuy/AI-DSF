'use client'

import { handoffRoutes, ROUTES, type ForensicAuditResponse } from '@fincopilot/shared-types'
import { AlertTriangle, ArrowRight, Download, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, type ReactNode } from 'react'
import { Badge, buttonVariants, Card } from '@/components/ui'
import { formatVietnamTime, formatVnd } from '@/lib/workspace-data'
import { cn } from '@/lib/utils'
import { verdictLabels } from './verdict'

const verdictTone = {
  SAFE: 'border-verdict-safe-border bg-verdict-safe-bg text-verdict-safe',
  CAUTION: 'border-verdict-warning-border bg-verdict-warning-bg text-verdict-warning',
  HIGH_RISK: 'border-verdict-danger-border bg-verdict-danger-bg text-verdict-danger',
}
const severityLabel = { CRITICAL: 'Nghiêm trọng', HIGH: 'Cao', MEDIUM: 'Trung bình', LOW: 'Thấp' }
const licenseStatus = { LICENSED: 'Có giấy phép', SUSPENDED: 'Đang bị đình chỉ', BLACKLISTED: 'Trong danh sách cảnh báo' }
function VerdictHero({ audit }: { audit: ForensicAuditResponse }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])

  const Icon = audit.verdictLevel === 'SAFE' ? ShieldCheck : AlertTriangle
  const [summary, ...explanationParagraphs] = audit.aiNarrative.split('\n\n')
  const explanation = explanationParagraphs.join('\n\n').trim()

  return (
    <header className={cn('grid items-start gap-5 rounded-xl border p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_12rem]', verdictTone[audit.verdictLevel])}>
      <div className="flex items-start gap-3">
        <Icon size={28} className="mt-1 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <h1 ref={heading} tabIndex={-1} className="scroll-mt-24 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          {verdictLabels[audit.verdictLevel]}
        </h1>
      </div>
      <div className="space-y-2 lg:row-span-2 lg:border-s lg:border-current/20 lg:ps-5">
        <p id="risk-score-label" className="text-sm font-medium">Điểm rủi ro</p>
        <p aria-hidden="true" className="font-numeric text-3xl font-bold tracking-tight">
          {audit.riskScore}<span className="text-base font-medium"> / 100</span>
        </p>
        <meter min={0} max={100} value={audit.riskScore} aria-labelledby="risk-score-label" className="sr-only" />
        <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-current/20">
          <div className="h-full rounded-full bg-current" style={{ width: audit.riskScore + '%' }} />
        </div>
      </div>
      <div className="min-w-0 space-y-3 lg:col-start-1">
        <p className="max-w-[65ch] whitespace-pre-line text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">{summary}</p>
        {(audit.deterministicOverride || audit.meta.degradedMode) && (
          <div className="flex flex-wrap gap-2">
            {audit.deterministicOverride && <Badge variant="danger" className="whitespace-normal">Mức rủi ro được khóa bởi quy tắc</Badge>}
            {audit.meta.degradedMode && <Badge variant="outline" className="whitespace-normal">Phân tích giới hạn · Dựa trên quy tắc</Badge>}
          </div>
        )}
        {explanation && (
          <details className="max-w-[65ch]">
            <summary className="min-h-11 cursor-pointer rounded-md py-3 text-sm font-semibold">Xem giải thích</summary>
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">{explanation}</p>
          </details>
        )}
      </div>
    </header>
  )
}

function QrTable({ qr, index }: { qr: ForensicAuditResponse['qrPayloads'][number]; index: number }) {
  const values: [string, ReactNode][] = [
    ['Ngân hàng / BIN', <>{qr.bankName ?? 'Chưa xác định'} {qr.acqBin && <span className="font-numeric whitespace-nowrap text-muted-foreground">({qr.acqBin})</span>}</>],
    ['Tài khoản nhận', <span className="font-numeric">{qr.accountNumberMasked ?? '—'}</span>],
    ['Loại mã', qr.serviceCode === 'QRIBFTTA'
      ? <Badge variant={qr.entityMismatchFlag ? 'warning' : 'info'} className="whitespace-normal">QRIBFTTA · Chuyển theo số tài khoản</Badge>
      : qr.serviceCode ?? '—'],
    ['Số tiền', <span className="font-numeric">{formatVnd(qr.qrAmountVnd)}</span>],
    ['Nội dung', qr.purposeText ?? '—'],
    ['Chủ tài khoản đọc được', qr.visionBeneficiaryName ?? 'Chưa xác định'],
    ['Kiểm tra mã (CRC)', <Badge variant={qr.crcValid ? 'safe' : 'danger'}>{qr.crcValid ? 'Hợp lệ' : 'Không hợp lệ'}</Badge>],
    ['Đối chiếu người nhận', qr.entityMismatchFlag
      ? <Badge variant="danger" className="whitespace-normal">Có dấu hiệu lệch pháp nhân</Badge>
      : 'Chưa phát hiện lệch pháp nhân'],
  ]

  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <caption className="pb-2 text-start font-semibold">Mã VietQR {index + 1}</caption>
      <thead className="sr-only">
        <tr><th scope="col">Thông tin</th><th scope="col">Kết quả</th></tr>
      </thead>
      <tbody className="divide-y divide-border border-y border-border">
        {values.map(([label, value]) => (
          <tr key={label}>
            <th scope="row" className="w-[42%] py-2.5 pe-3 text-start align-top text-sm leading-snug font-medium text-muted-foreground">{label}</th>
            <td className="py-2.5 align-top leading-snug [overflow-wrap:anywhere]">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function EntityAndQr({ audit }: { audit: ForensicAuditResponse }) {
  const license = audit.entityLicense

  return (
    <section aria-labelledby="entity-check-heading" className="min-w-0 space-y-4">
      <h2 id="entity-check-heading" className="text-lg font-semibold tracking-tight">Đối chiếu pháp nhân và VietQR</h2>
      <dl className="grid gap-3 rounded-lg bg-muted p-4">
        <div>
          <dt className="text-sm text-muted-foreground">Đơn vị tự xưng</dt>
          <dd className="text-sm font-semibold [overflow-wrap:anywhere]">{audit.claimedEntityName ?? 'Chưa xác định'}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Giấy phép NHNN / UBCKNN</dt>
          <dd className="text-sm font-medium">
            {license ? license.issuer + ' · ' + licenseStatus[license.status] : 'Chưa tìm thấy bản ghi để đối chiếu'}
          </dd>
        </div>
      </dl>
      {audit.qrPayloads.length ? (
        <div className="space-y-5">{audit.qrPayloads.map((qr, index) => <QrTable key={index} qr={qr} index={index} />)}</div>
      ) : <p className="text-sm text-muted-foreground">Chưa có mã VietQR được giải mã từ dữ liệu này.</p>}
    </section>
  )
}

function LoanMath({ math }: { math: ForensicAuditResponse['mathBreakdown'] }) {
  const entries = math ? [
    ['Khoản vay danh nghĩa', formatVnd(math.principalNominalVnd)],
    ['Phí thu trước', formatVnd(math.upfrontFeeVnd)],
    ['Số tiền thực nhận', formatVnd(math.principalNetVnd)],
    ['Lãi niêm yết', math.quotedRateLabel],
  ] : []

  return (
    <section aria-labelledby="loan-math-heading" className="min-w-0 space-y-4">
      <h2 id="loan-math-heading" className="text-lg font-semibold tracking-tight">Chi phí vay thực tế</h2>
      {math ? (
        <>
          <dl className="grid gap-3 rounded-lg bg-accent/65 p-4 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-sm font-medium text-accent-foreground">APR · Lãi suất quy năm</dt>
              <dd className="font-numeric text-2xl font-bold text-primary [overflow-wrap:anywhere]">{math.effectiveAprPct.replace('.', ',')}%</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-sm font-medium text-accent-foreground">EAR · Lãi suất sau ghép lãi</dt>
              <dd className="font-numeric text-2xl font-bold text-primary [overflow-wrap:anywhere]">{math.effectiveEarPct.replace('.', ',')}%</dd>
            </div>
          </dl>
          <dl className="divide-y divide-border">
            {entries.map(([label, value]) => (
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 py-2.5 text-sm" key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-numeric text-end font-medium [overflow-wrap:anywhere]">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : <p className="text-sm leading-relaxed text-muted-foreground">Cần đủ số tiền vay, chi phí, lãi suất và kỳ hạn để tính APR và EAR.</p>}
    </section>
  )
}

function Findings({ findings }: { findings: ForensicAuditResponse['findings'] }) {
  return (
    <section aria-labelledby="rules-heading" className="space-y-3">
      <h2 id="rules-heading" className="text-lg font-semibold tracking-tight">Dấu hiệu từ 11 quy tắc</h2>
      {findings.length ? (
        <div className="divide-y divide-border rounded-lg border border-border">
          {findings.map((finding) => (
            <details key={finding.ruleCode} className="min-w-0">
              <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm marker:text-primary hover:bg-muted/40">
                <span className="ms-1 font-mono text-xs font-semibold text-muted-foreground">{finding.ruleCode.slice(0, 7)}</span>
                <span className="mx-2 font-semibold [overflow-wrap:anywhere]">{finding.title}</span>
                <Badge variant={finding.severity === 'CRITICAL' ? 'danger' : finding.severity === 'LOW' ? 'info' : 'warning'}>
                  {severityLabel[finding.severity]}
                </Badge>
              </summary>
              <div className="space-y-2 px-4 pb-4 text-sm leading-relaxed">
                <p>{finding.description}</p>
                {finding.evidenceQuote && (
                  <blockquote className="rounded-lg bg-verdict-warning-bg px-3 py-2 text-verdict-warning [overflow-wrap:anywhere]">
                    <p className="whitespace-pre-line">{finding.evidenceQuote}</p>
                  </blockquote>
                )}
                {finding.matchedIndicatorId && <p className="text-xs text-muted-foreground">Trùng chỉ dấu đã xác minh.</p>}
              </div>
            </details>
          ))}
        </div>
      ) : <p className="text-sm text-muted-foreground">Chưa phát hiện dấu hiệu từ nội dung đã cung cấp.</p>}
    </section>
  )
}

export function ForensicReport({ audit }: { audit: ForensicAuditResponse }) {
  const handoff = audit.handoffPayload
  const surveyHref = handoff && /[1-9]/.test(handoff.suggestedAmountVnd) ? handoffRoutes.forensicToSurvey({
    amount: handoff.suggestedAmountVnd, term: handoff.suggestedTermMonths, auditId: audit.auditId,
  }) : ROUTES.survey

  return (
    <article className="space-y-5">
      <VerdictHero audit={audit} />
      {audit.immediateActions.length > 0 && (
        <Card className="p-5 sm:p-6">
          <fieldset className="min-w-0">
            <legend className="mb-2 text-lg font-semibold tracking-tight">Việc nên làm ngay</legend>
            <ul className="divide-y divide-border">
              {audit.immediateActions.map((action, index) => (
                <li key={index}>
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere]">
                    <input type="checkbox" className="mt-0.5 size-5 shrink-0 rounded accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
                    <span>{action}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        </Card>
      )}
      <Card className="grid items-start gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <EntityAndQr audit={audit} />
        <LoanMath math={audit.mathBreakdown} />
      </Card>
      <Card className="p-5 sm:p-6">
        <Findings findings={audit.findings} />
      </Card>
      <Card className="space-y-4 p-5 sm:p-6">
        <section aria-labelledby="privacy-proof-heading" className="space-y-2">
          <h2 id="privacy-proof-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <ShieldCheck size={20} className="shrink-0 text-primary" aria-hidden="true" /> Quyền riêng tư của báo cáo
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Hoàn tất xóa tệp gốc lúc{' '}
            <time dateTime={audit.privacyProof.sourceFilesPurgedAt} title={audit.privacyProof.sourceFilesPurgedAt} className="font-numeric font-medium text-foreground">
              {formatVietnamTime(audit.privacyProof.sourceFilesPurgedAt)}
            </time>
            {' '}(giờ Việt Nam). Báo cáo đã che thông tin định danh nhạy cảm.
          </p>
        </section>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <a href={'/api/v1/forensic/audits/' + encodeURIComponent(audit.auditId) + '/export'} download
            className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}>
            <Download size={17} aria-hidden="true" /> Xuất báo cáo JSON
          </a>
          <Link href={surveyHref} className={cn(buttonVariants(), 'min-h-11 whitespace-normal text-center')}>
            Khảo sát phương án vay <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </Card>
    </article>
  )
}
