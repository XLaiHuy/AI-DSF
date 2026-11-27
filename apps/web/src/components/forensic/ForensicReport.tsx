'use client'

import { handoffRoutes, ROUTES, type ForensicAuditResponse } from '@fincopilot/shared-types'
import { AlertTriangle, ArrowRight, Download, Printer, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Badge, Button, buttonVariants, Card, TermInfo } from '@/components/ui'
import { formatVietnamTime } from '@/lib/workspace-data'
import { formatSpacedAmount } from '@/components/ui/money-input'
import { cn } from '@/lib/utils'
import { AuditFeedback } from './AuditFeedback'
import { LoanCost } from './LoanCost'
import { LegalReferencesCard } from './LegalReferencesCard'
import { PersonalImpactCard } from './PersonalImpactCard'
import { plainAuditText } from './report-copy'
import { RevealBlock, StreamingTextReveal, useReducedMotion } from './StreamingContentReveal'
import { FersEvidenceLedger, FersRiskScale, reportRisk } from './FersAssessment'
import { verdictLabels } from './verdict'

const verdictTone = {
  SAFE: 'border-verdict-safe-border bg-verdict-safe-bg text-verdict-safe',
  CAUTION: 'border-verdict-warning-border bg-verdict-warning-bg text-verdict-warning',
  HIGH_RISK: 'border-verdict-danger-border bg-verdict-danger-bg text-verdict-danger',
}
const severityLabel = { CRITICAL: 'Nghiêm trọng', HIGH: 'Cao', MEDIUM: 'Trung bình', LOW: 'Thấp' }
const licenseStatus = { LICENSED: 'Có giấy phép', SUSPENDED: 'Đang bị đình chỉ', BLACKLISTED: 'Trong danh sách cảnh báo' }
function VerdictHero({ audit, inline }: { audit: ForensicAuditResponse; inline: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!inline) heading.current?.focus({ preventScroll: true })
  }, [inline])

  const risk = reportRisk(audit)
  const tone = risk.riskTier === 'T0' ? 'SAFE' : risk.riskTier === 'T1' ? 'CAUTION' : 'HIGH_RISK'
  const Icon = tone === 'SAFE' ? ShieldCheck : AlertTriangle
  const Heading = inline ? 'h2' : 'h1'

  return (
    <header className={cn('report-print-card grid min-w-0 gap-4 rounded-xl border p-5 sm:p-7', verdictTone[tone])}>
      <div className="flex min-w-0 items-start gap-3">
        <Icon size={28} className="mt-1 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0">
          <Heading ref={heading} data-verdict-heading tabIndex={-1} className="scroll-mt-24 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            {risk.actionLabelVi}
          </Heading>
          <p className="mt-1 text-sm font-medium">{risk.confidenceLabelVi}</p>
        </div>
      </div>
      <FersRiskScale tier={risk.riskTier} />
      {risk.abstention && <p className="rounded-lg border border-current/25 bg-card p-3 text-sm font-medium text-foreground">{risk.abstentionPrompt}</p>}
      {audit.mathBreakdown?.termMonths && audit.mathBreakdown.effectiveAprPct != null && (
        <div className="print-hidden">
          <Link className={cn(buttonVariants(), 'h-auto min-h-11 max-w-full whitespace-normal text-left')}
            href={handoffRoutes.forensicToRefinance({ auditId: audit.auditId })}>
            So sánh hợp đồng này với ngân hàng <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </div>
      )}
      {(audit.deterministicOverride || audit.meta.degradedMode) && (
        <div className="flex flex-wrap gap-2 lg:col-start-1">
          {audit.deterministicOverride && <Badge variant="danger" className="whitespace-normal">Có dấu hiệu nghiêm trọng</Badge>}
          {audit.meta.degradedMode && <Badge variant="outline" className="whitespace-normal">Kết quả dựa trên dữ liệu đã kiểm tra</Badge>}
        </div>
      )}
    </header>
  )
}

const qrSchemes = {
  VIETQR_NAPAS: 'VietQR NAPAS',
  EWALLET_VN: 'Ví điện tử Việt Nam',
  EMVCO_INTL: 'EMVCo quốc tế',
  URL_LINK: 'Đường dẫn QR',
  CRYPTO_WALLET: 'Ví tiền mã hóa',
  UNKNOWN: 'Chưa rõ định dạng',
}
const reputationBadges = {
  FLAGGED_SCAM: { tone: 'danger', label: 'Cảnh báo rủi ro cao' },
  HIGH_RISK_ANONYMOUS: { tone: 'warning', label: 'Cần xác minh thêm' },
  CLEAN_PUBLIC: { tone: 'info', label: 'Chưa có cảnh báo công khai' },
  UNVERIFIABLE_PRIVATE_BANK: { tone: 'outline', label: 'Bảo mật ngân hàng' },
} as const

function QrTable({ qr, index, suspiciousLink }: {
  qr: ForensicAuditResponse['qrPayloads'][number]
  index: number
  suspiciousLink: boolean
}) {
  const scheme = qr.qrScheme ?? 'VIETQR_NAPAS'
  const values: [string, ReactNode, 'CRC'?][] = [
    ['Định dạng', <Badge variant={suspiciousLink || scheme === 'CRYPTO_WALLET' ? 'warning' : 'info'} className="whitespace-normal">{qrSchemes[scheme]}</Badge>],
  ]
  if (qr.providerLabel) values.push(['Nhà cung cấp', qr.providerLabel])
  if (qr.merchantCategoryCode) values.push(['Mã ngành (MCC)', qr.merchantCategoryCode])
  if (qr.bankName || qr.acqBin) values.push(['Ngân hàng / BIN', <>{qr.bankName} {qr.acqBin && <span className="font-numeric whitespace-nowrap text-muted-foreground">({qr.acqBin})</span>}</>])
  if (qr.accountNumberMasked) values.push([scheme === 'CRYPTO_WALLET' ? 'Địa chỉ ví đã che' : 'Tài khoản nhận', <span className="font-numeric">{qr.accountNumberMasked}</span>])
  if (qr.serviceCode) values.push(
    ['Loại mã', qr.serviceCode === 'QRIBFTTA'
      ? <><Badge variant={qr.entityMismatchFlag ? 'warning' : 'info'} className="whitespace-normal">QRIBFTTA · Chuyển theo số tài khoản</Badge> <TermInfo term="QRIBFTTA" /></>
      : qr.serviceCode],
  )
  if (qr.amount != null || qr.qrAmountVnd != null) {
    const amount = qr.qrAmountVnd ?? qr.amount ?? ''
    const currency = qr.qrAmountVnd != null || qr.currencyCode === 'VND' ? 'đ' : qr.currencyCode
    values.push(['Số tiền', <span className="font-numeric">{[formatSpacedAmount(amount.replace(/\.00$/, '')), currency].filter(Boolean).join(' ')}</span>])
  }
  if (qr.currencyCode || qr.countryCode) values.push(['Tiền tệ / Quốc gia', [qr.currencyCode, qr.countryCode].filter(Boolean).join(' · ')])
  if (qr.merchantName) values.push(['Tên đơn vị nhận tiền', qr.merchantName])
  if (qr.visionBeneficiaryName) values.push(['Chủ tài khoản đọc được', qr.visionBeneficiaryName])
  if (qr.purposeText) values.push(['Nội dung', qr.purposeText])
  if (qr.walletNetwork) values.push(['Mạng ví', qr.walletNetwork])
  if (qr.targetUrl) values.push(['Địa chỉ trong mã', <div className="space-y-1.5">
    <p dir="ltr" className="text-start text-foreground [overflow-wrap:anywhere]">{qr.targetUrl}</p>
    {suspiciousLink && <p className="font-semibold text-verdict-danger">Đường dẫn có dấu hiệu rủi ro. Không mở hoặc nhập thông tin.</p>}
  </div>])
  if (scheme === 'VIETQR_NAPAS' || scheme === 'EMVCO_INTL') {
    values.push(['Kiểm tra mã (CRC)', <Badge variant={qr.crcValid ? 'safe' : 'danger'}>{qr.crcValid ? 'Hợp lệ' : 'Không hợp lệ'}</Badge>, 'CRC'])
  }
  if (qr.entityMismatchFlag) values.push(['Đối chiếu người nhận', <Badge variant="danger" className="whitespace-normal">Có dấu hiệu lệch pháp nhân</Badge>])

  const channel = qr.channelIntelligence
  const reputation = channel && reputationBadges[channel.reputationStatus]
  const reputationLabel = channel?.reputationStatus === 'HIGH_RISK_ANONYMOUS' && scheme === 'CRYPTO_WALLET'
    ? 'Ví nặc danh · Cần đặc biệt cẩn trọng'
    : channel?.reputationStatus === 'CLEAN_PUBLIC' && scheme === 'EMVCO_INTL' ? 'Đối chiếu dữ liệu trong mã' : reputation?.label
  const checkLabel = channel?.checkedLive
    ? channel.channelGroup === 'CRYPTO_WALLET' ? 'Kiểm tra trực tiếp on-chain' : 'Kiểm tra trực tiếp OpenPhish'
    : channel?.channelGroup === 'VIETQR_BANK' || channel?.channelGroup === 'EWALLET_VN' ? 'Đối chiếu chuẩn SIMO · NCSC' : null

  return <div className="space-y-3">
    <table className="print-keep w-full table-fixed border-collapse text-sm">
      <caption className="pb-2 text-start font-semibold">Mã QR {index + 1}</caption>
      <thead className="sr-only">
        <tr><th scope="col">Thông tin</th><th scope="col">Kết quả</th></tr>
      </thead>
      <tbody className="scr-table-rows divide-y divide-border border-y border-border">
        {values.map(([label, value, term], row) => (
          <tr key={label} style={{ '--scr-i': row } as CSSProperties}>
            <th scope="row" className="w-[42%] py-2.5 pe-3 text-start align-top text-sm leading-snug font-medium text-muted-foreground">{label}{term && <> <TermInfo term={term} /></>}</th>
            <td className="py-2.5 align-top leading-snug [overflow-wrap:anywhere]">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {channel && reputation && (
      <section style={{ '--scr-i': values.length - 1 } as CSSProperties} className="scr-table-follow rounded-lg border border-border bg-muted/45 p-3.5 text-sm sm:p-4">
        <h3 className="font-semibold">Hoạt động &amp; danh tiếng theo kênh</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {checkLabel && <Badge variant="outline" className="whitespace-normal">{checkLabel}</Badge>}
          <Badge variant={reputation.tone} className="whitespace-normal">{reputationLabel}</Badge>
        </div>
        <p className="mt-2 text-xs font-medium text-muted-foreground">{channel.sourceName}</p>
        <p className="mt-1 leading-relaxed">{channel.activitySummary}</p>
        {channel.riskFlags.length > 0 && <ul className="mt-2 list-disc space-y-1 ps-5 leading-relaxed">
          {channel.riskFlags.map((flag) => <li key={flag}>{flag}</li>)}
        </ul>}
        {channel.legalNotice && <p className="mt-3 rounded-md border border-verdict-warning-border bg-verdict-warning-bg p-3 leading-relaxed text-verdict-warning">
          {channel.legalNotice}
        </p>}
      </section>
    )}
  </div>
}

function EntityAndQr({ audit }: { audit: ForensicAuditResponse }) {
  const license = audit.entityLicense

  return (
    <section aria-labelledby="entity-check-heading" className="min-w-0 space-y-4">
      <h2 id="entity-check-heading" className="text-lg font-semibold tracking-tight">Đối chiếu người nhận và mã QR</h2>
      {audit.claimedEntityName && <dl className="grid gap-3 rounded-lg bg-muted p-4">
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
      </dl>}
      {audit.qrPayloads.length ? (
        <div className="space-y-5">{audit.qrPayloads.map((qr, index) => (
          <QrTable key={index} qr={qr} index={index} suspiciousLink={Boolean(qr.targetUrl && (
            /\.apk(?:$|[?#])/i.test(qr.targetUrl) || audit.findings.some(({ ruleCode, evidenceQuote }) =>
              (ruleCode.startsWith('RULE_09') || ruleCode.startsWith('RULE_05')) && Boolean(qr.targetUrl && evidenceQuote.includes(qr.targetUrl)),
            )
          ))} />
        ))}</div>
      ) : <p className="text-sm text-muted-foreground">Chưa đọc được mã QR từ nội dung bạn gửi.</p>}
    </section>
  )
}

function subscribePrint(listener: () => void) {
  const media = window.matchMedia('print')
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

function Explanation({ audit }: { audit: ForensicAuditResponse }) {
  const reasons = [
    ...audit.findings.map((finding) => ({ key: finding.ruleCode, title: finding.title, description: finding.description,
      quote: finding.evidenceQuote, severity: severityLabel[finding.severity],
      tone: finding.severity === 'CRITICAL' || finding.severity === 'HIGH' ? 'danger' : finding.severity === 'LOW' ? 'info' : 'warning',
      source: finding.matchedIndicatorId ? 'Trùng chỉ dấu đã xác minh' : null } as const)),
    ...(audit.reasoningFindings ?? []).map((finding, index) => ({ key: `reason-${index}`, title: finding.title,
      description: finding.explanation, quote: finding.evidenceQuote, severity: verdictLabels[finding.severity],
      tone: finding.severity === 'HIGH_RISK' ? 'danger' : 'warning', source: 'Phân tích suy luận chuyên sâu' } as const)),
  ]
  const groups = new Map<string, { quote: string; reasons: typeof reasons }>()
  for (const reason of reasons) {
    const quote = plainAuditText(reason.quote)
    const key = quote ? quote.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi') : reason.key
    const group = groups.get(key)
    if (group) group.reasons.push(reason)
    else groups.set(key, { quote, reasons: [reason] })
  }

  return (
    <section aria-labelledby="audit-explanation-heading" className="space-y-4">
      <h2 id="audit-explanation-heading" className="text-balance text-lg font-semibold tracking-tight">Vì sao FinCopilot đưa ra đánh giá này?</h2>
      {groups.size > 0 ? (
        <ul role="list" className="scr-stagger-list space-y-3">
          {[...groups].map(([key, group], index) => (
            <li key={key} style={{ '--scr-i': index } as CSSProperties} className="print-keep space-y-3 rounded-lg border border-border p-4 text-sm leading-relaxed [overflow-wrap:anywhere]">
              {group.reasons.map((reason, index) => (
                <div key={reason.key + '-' + index} className="space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="font-semibold">{plainAuditText(reason.title)}</h3>
                    <Badge variant={reason.tone}>{reason.severity}</Badge>
                  </div>
                  <p>{plainAuditText(reason.description)}</p>
                  {reason.source && <p className="text-xs font-medium text-muted-foreground">{reason.source}</p>}
                </div>
              ))}
              {group.quote && <blockquote className="rounded-md bg-muted px-3 py-2 whitespace-pre-line">{group.quote}</blockquote>}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">Không có dấu hiệu bổ sung từ nội dung đã kiểm tra.</p>}
    </section>
  )
}

function LearningTrace({ trace }: { trace: NonNullable<ForensicAuditResponse['meta']['learningTrace']> }) {
  const signals = [
    trace.tier1ExactMatches > 0 && `Tier 1 · ${trace.tier1ExactMatches} chỉ dấu`,
    trace.matchedTacticsCount > 0 && `Tier 2 · ${trace.matchedTacticsCount} thủ đoạn · ${trace.retrievalMode === 'hybrid_rrf' ? 'Hybrid RRF' : 'Từ khóa'}`,
    trace.fewShotScamCount + trace.fewShotSafeCount > 0 && `Few-shot · ${trace.fewShotScamCount} lừa đảo, ${trace.fewShotSafeCount} an toàn`,
    trace.expandedTeencodeCount > 0 && `Teencode · ${trace.expandedTeencodeCount} từ viết tắt`,
    trace.zeroShotEscalated && 'Tier 3 · Phân tích zero-shot',
  ].filter(Boolean)
  if (!signals.length) return null
  return <details className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
    <summary className="cursor-pointer text-muted-foreground">
      <span className="font-semibold text-foreground">Trí nhớ chống lừa đảo</span>
      <span className="mt-2 flex flex-wrap gap-2">
        {signals.map(signal => <Badge key={String(signal)} variant="outline" className="whitespace-normal">{signal}</Badge>)}
      </span>
    </summary>
    {trace.matchedTacticSummaries.length > 0 && <ul className="mt-2 list-disc space-y-1 ps-5 text-muted-foreground">
      {trace.matchedTacticSummaries.map((summary, index) => <li key={index}>{summary}</li>)}
    </ul>}
    {!trace.matchedTacticSummaries.length && <p className="mt-2 text-muted-foreground">
      {trace.zeroShotEscalated ? 'Tình huống có dấu hiệu đáng ngờ và được chuyển sang phân tích sâu.' : 'Các tín hiệu trên đã được đối chiếu trong lượt giám định.'}
    </p>}
  </details>
}

export function ForensicReport({ audit, inline = false, animate = false, opening }: {
  audit: ForensicAuditResponse; inline?: boolean; animate?: boolean; opening?: ReactNode
}) {
  const report = useRef<HTMLElement>(null)
  const skip = useRef<HTMLButtonElement>(null)
  const [stage, setStage] = useState(0)
  const [skipped, setSkipped] = useState(false)
  const printing = useSyncExternalStore(subscribePrint, () => window.matchMedia('print').matches, () => false)
  const reduced = useReducedMotion()
  const narrative = plainAuditText(audit.aiNarrative)
  const actions = audit.immediateActions.map(plainAuditText).filter(Boolean)
  const hasImpactInput = audit.mathBreakdown
    || audit.qrPayloads.some((qr) => /[1-9]/.test(qr.qrAmountVnd ?? ''))
    || audit.findings.some(({ ruleCode }) => ruleCode === 'RULE_16_TRANSFER_AMOUNT_REVIEW')
  const handoff = audit.handoffPayload
  const surveyHref = handoff && /[1-9]/.test(handoff.suggestedAmountVnd) ? handoffRoutes.forensicToSurvey({
    amount: handoff.suggestedAmountVnd, term: handoff.suggestedTermMonths, auditId: audit.auditId,
  }) : ROUTES.survey

  const sections = [
    { key: 'actions' as const, kind: 'list' as const, count: actions.length, active: actions.length > 0, body: (
      <Card className="report-print-card space-y-3 p-5 sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight">Việc nên làm ngay</h2>
        <ol role="list" className="scr-stagger-list grid gap-2">
          {actions.map((action, index) => (
            <li key={index} style={{ '--scr-i': index } as CSSProperties} className={cn('print-keep flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm font-semibold leading-relaxed [overflow-wrap:anywhere]', verdictTone[audit.verdictLevel])}>
              <span className="font-numeric grid size-6 shrink-0 place-items-center rounded-md bg-card text-xs" aria-hidden="true">{index + 1}</span>
              <span>{action}</span>
            </li>
          ))}
        </ol>
      </Card>
    ) },
    { key: 'impact' as const, kind: 'grid' as const, count: 5, active: Boolean(audit.personalImpact || hasImpactInput), body: <PersonalImpactCard impact={audit.personalImpact ?? null} /> },
    { key: 'loan' as const, kind: 'grid' as const, count: audit.mathBreakdown?.phaseBreakdown?.length ?? 3, active: Boolean(audit.mathBreakdown), body: audit.mathBreakdown && (
      <Card className="report-print-card p-5 sm:p-6"><LoanCost math={audit.mathBreakdown} handoff={handoff} /></Card>
    ) },
    { key: 'law' as const, kind: 'list' as const, count: audit.legalCitations?.length ?? 0, active: Boolean(audit.legalCitations?.length), body: audit.legalCitations && <LegalReferencesCard citations={audit.legalCitations} /> },
    { key: 'reason' as const, kind: 'list' as const, count: audit.findings.length + (audit.reasoningFindings?.length ?? 0), active: true, body: <Card className="report-print-card p-5 sm:p-6"><Explanation audit={audit} /></Card> },
    { key: 'qr' as const, kind: 'table' as const, count: audit.qrPayloads.length * 7, active: Boolean(audit.qrPayloads.length || audit.claimedEntityName), body: (
      <Card className="report-print-card p-5 sm:p-6"><EntityAndQr audit={audit} /></Card>
    ) },
    { key: 'privacy' as const, kind: 'card' as const, count: 0, active: true, body: (
      <Card className="report-print-card space-y-4 p-5 sm:p-6">
        <section aria-labelledby="privacy-proof-heading" className="space-y-2">
          <h2 id="privacy-proof-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <ShieldCheck size={20} className="shrink-0 text-primary" aria-hidden="true" /> Quyền riêng tư &amp; Xuất hồ sơ
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Hoàn tất xóa tệp gốc lúc{' '}
            <time dateTime={audit.privacyProof.sourceFilesPurgedAt} className="font-numeric font-medium text-foreground">
              {formatVietnamTime(audit.privacyProof.sourceFilesPurgedAt)}
            </time>
            {' '}(giờ Việt Nam). Báo cáo đã che thông tin định danh nhạy cảm.
          </p>
        </section>
        <FersEvidenceLedger audit={audit} />
        <div className="print-hidden flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="outline" className="min-h-11" onClick={() => window.print()}>
            <Printer size={17} aria-hidden="true" /> In / Lưu PDF trình báo
          </Button>
          <a href={'/api/v1/forensic/audits/' + encodeURIComponent(audit.auditId) + '/export'} download
            className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}>
            <Download size={17} aria-hidden="true" /> Xuất báo cáo JSON
          </a>
          <Link href={surveyHref} className={cn(buttonVariants(), 'min-h-11 whitespace-normal text-center')}>
            Khảo sát phương án vay <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </Card>
    ) },
  ].filter(({ active }) => active)

  const animated = animate && !skipped && !reduced && !printing
  const finished = !animated || stage >= sections.length + 1
  const previousCount = sections[stage - 2]?.count ?? 0
  const finishNarrative = useCallback(() => setStage((current) => Math.max(current, 2)), [])

  useEffect(() => {
    if (!animated || finished || stage === 1 && narrative) return
    const delay = stage === 0 ? 180 : stage === 1 ? 0 : Math.min(320, 220 + 15 * previousCount)
    const timer = window.setTimeout(() => {
      if (stage === sections.length && document.activeElement === skip.current) {
        report.current?.querySelector<HTMLElement>('[data-verdict-heading]')?.focus({ preventScroll: true })
      }
      setStage((current) => current + 1)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [animated, finished, narrative, previousCount, sections.length, stage])

  useEffect(() => {
    const details = new Map<HTMLDetailsElement, boolean>()
    const openDetails = () => {
      if (animate) flushSync(() => setSkipped(true))
      report.current?.querySelectorAll<HTMLDetailsElement>('details[data-print-open]').forEach((item) => {
        if (!details.has(item)) details.set(item, item.open)
        item.open = true
      })
    }
    const restoreDetails = () => {
      for (const [item, wasOpen] of details) item.open = wasOpen
      details.clear()
    }
    window.addEventListener('beforeprint', openDetails)
    window.addEventListener('afterprint', restoreDetails)
    return () => {
      window.removeEventListener('beforeprint', openDetails)
      window.removeEventListener('afterprint', restoreDetails)
      restoreDetails()
    }
  }, [animate])

  const auditTime = audit.createdAt ?? audit.privacyProof.sourceFilesPurgedAt

  return (
    <article ref={report} className="forensic-report min-w-0 space-y-5">
      <header className="print-only print-keep">
        <h1>HỒ SƠ ĐỐI CHIẾU &amp; TRÌNH BÁO RỦI RO TÀI CHÍNH — FinCopilot AI</h1>
        <p>Mã hồ sơ <strong>{audit.auditId}</strong></p>
        <p>Giám định lúc <time dateTime={auditTime}>{formatVietnamTime(auditTime)}</time> (giờ Việt Nam).</p>
        <p>Tệp gốc đã được xóa lúc <time dateTime={audit.privacyProof.sourceFilesPurgedAt}>{formatVietnamTime(audit.privacyProof.sourceFilesPurgedAt)}</time> (giờ Việt Nam). Báo cáo đã che thông tin định danh nhạy cảm.</p>
      </header>
      {opening && <RevealBlock animate={animated} className="print-hidden">{opening}</RevealBlock>}
      <RevealBlock animate={animated} className="print-keep"><VerdictHero audit={audit} inline={inline} /></RevealBlock>
      {audit.meta.learningTrace && <LearningTrace trace={audit.meta.learningTrace} />}
      <AuditFeedback key={audit.auditId} audit={audit} />
      {!finished && (
        <div className="pointer-events-none sticky top-1 z-10 !-mb-9 flex justify-end pe-2 print-hidden">
          <Button ref={skip} variant="outline" className="pointer-events-auto h-8 rounded-full px-3 text-xs shadow-sm"
            onClick={() => {
              report.current?.querySelector<HTMLElement>('[data-verdict-heading]')?.focus({ preventScroll: true })
              setSkipped(true)
            }}>
            Hiện nhanh
          </Button>
        </div>
      )}
      {narrative && (!animated || stage >= 1) && (
        <RevealBlock animate={animated}>
          <Card data-report-narrative className="report-print-card space-y-2 border-primary/15 bg-card p-5 sm:p-6">
            <h2 className="pe-16 text-lg font-semibold tracking-tight">Nhận định của FinCopilot</h2>
            <p className="max-w-[75ch] whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
              <StreamingTextReveal animate={animated} text={narrative} onComplete={finishNarrative} />
            </p>
          </Card>
        </RevealBlock>
      )}
      {sections.slice(0, animated ? Math.max(0, stage - 1) : sections.length).map(({ key, kind, body }) => (
        <RevealBlock key={key} section={key} kind={kind} animate={animated} className={key === 'privacy' ? 'print-hidden' : undefined}>
          {body}
        </RevealBlock>
      ))}
      <section className="print-only print-keep print-report-support">
        <h2>Kênh tiếp nhận hỗ trợ &amp; trình báo</h2>
        <ul>
          <li>Tổng đài chính thức của ngân hàng</li>
          <li>Cơ quan Công an địa phương</li>
          <li>Cổng cảnh báo an toàn thông tin <a href="https://canhbao.ncsc.gov.vn/">canhbao.ncsc.gov.vn</a></li>
        </ul>
      </section>
    </article>
  )
}
