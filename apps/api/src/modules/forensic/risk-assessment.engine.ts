import type {
  EvidenceConfidence, EvidenceGrade, ForensicAuditResponse, ForensicEvidenceChainItem, ForensicRiskAssessment, RiskTier,
} from '@fincopilot/shared-types'
import Decimal from 'decimal.js'
import { hasInternalIdentifierLeak } from '../../common/untrusted-text'
import { maskForensicText } from './qr-evidence'
import { classifyVnScamTaxonomy } from './vn-scam-taxonomy'

const gradeLabels: Record<EvidenceGrade, string> = {
  A: 'Giải mã, tính toán hoặc đối chiếu nguồn', B: 'Trích dẫn từ tài liệu bạn gửi', C: 'Dấu hiệu ban đầu',
}
const confidenceLabels: Record<EvidenceConfidence, string> = {
  A1: 'Có bằng chứng xác thực', B2: 'Có trích dẫn từ tài liệu',
  C3: 'Dấu hiệu nghi vấn ban đầu', D4: 'Chưa đủ bằng chứng để kết luận',
}
const tierLabels: Record<RiskTier, string> = {
  T0: 'Chưa thấy dấu hiệu bất thường', T1: 'Cần kiểm chứng thêm',
  T2: 'Rủi ro cao', T3: 'Dừng giao dịch ngay',
}
const standardsCited = [
  'NIST RMF / ISO 31000', 'NATO Admiralty / STIX 2.1', 'SIMO – Ngân hàng Nhà nước', '24 hình thức lừa đảo của Cục An toàn thông tin',
]
const money = (value: Decimal.Value) => {
  const [whole, fraction] = new Decimal(value).toDecimalPlaces(2).toFixed().split('.')
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (fraction ? ',' + fraction : '') + ' ₫'
}
const systemRules = new Set(['RULE_03_ENTITY_MISMATCH', 'RULE_05_NCSC_THREAT_MATCH', 'RULE_14_CHANNEL_REPUTATION'])
const contextRules = new Set(['RULE_15_CHANNEL_RISK', 'RULE_16_TRANSFER_AMOUNT_REVIEW', 'RULE_17_PROMPT_INJECTION_TAMPER'])

export function buildForensicRiskAssessment(audit: ForensicAuditResponse, options?: {
  sourceAlertVerified?: boolean; threatCategory?: string | null
}): ForensicRiskAssessment {
  const evidenceChain: ForensicEvidenceChainItem[] = []
  const add = (grade: EvidenceGrade, sourceType: string, quoteOrDecoded: string, ruleOrLawRef: string, financialImpact: string | null = null) => {
    evidenceChain.push({ grade, gradeLabel: gradeLabels[grade], sourceType, quoteOrDecoded, ruleOrLawRef, financialImpact })
  }
  const raw = audit.privacyProof.rawTextMasked ?? ''
  for (const qr of audit.qrPayloads) {
    const validTechnicalQr = qr.crcValid && (qr.qrScheme === 'VIETQR_NAPAS' || qr.qrScheme === 'EMVCO_INTL' ||
      (!qr.qrScheme && Boolean(qr.acqBin)))
    const crypto = qr.qrScheme === 'CRYPTO_WALLET' && Boolean(qr.walletNetwork)
    const flagged = qr.channelIntelligence?.reputationStatus === 'FLAGGED_SCAM'
    const amount = qr.qrAmountVnd && new Decimal(qr.qrAmountVnd)
    const message = flagged ? 'Kênh này trùng cảnh báo đã ghi nhận.'
      : validTechnicalQr ? 'Mã thanh toán đọc được và vượt qua kiểm tra toàn vẹn.'
        : crypto ? 'Đọc được mạng lưới của ví tiền mã hóa.' : 'Có mã QR cần đối chiếu thêm.'
    add(validTechnicalQr || crypto || flagged ? 'A' : 'C', 'Mã QR', message,
      flagged ? 'Đối chiếu cảnh báo và SIMO – Ngân hàng Nhà nước'
        : validTechnicalQr ? 'Chuẩn định dạng mã thanh toán' : 'Đối chiếu kênh giao dịch',
      amount ? money(amount) : null)
  }
  if (audit.entityLicense) {
    const licensed = audit.entityLicense.status === 'LICENSED'
    add('A', 'Danh mục tổ chức', licensed ? 'Có thông tin giấy phép phù hợp trong danh mục.'
      : 'Danh mục ghi nhận giới hạn hoạt động hoặc cảnh báo đối với tổ chức.',
    audit.entityLicense.issuer === 'NHNN' ? 'Ngân hàng Nhà nước' : 'Ủy ban Chứng khoán Nhà nước')
  }
  if (options?.sourceAlertVerified) add('A', 'Cảnh báo FinCopilot', 'Vụ việc được gửi từ một cảnh báo đã xác minh.', 'Hồ sơ cảnh báo đã công bố')
  const math = audit.mathBreakdown
  if (math && (math.effectiveAprPct !== null || math.effectiveEarPct !== null)) {
    const annual = math.effectiveAprPct === null ? null : new Decimal(math.effectiveAprPct)
    const effective = math.effectiveEarPct === null ? null : new Decimal(math.effectiveEarPct)
    const rate = annual ?? effective
    const displayed = rate?.toFixed(2).replace('.', ',') + '%/năm'
    add('A', 'Chi phí vay tính từ hợp đồng', 'Chi phí vay quy đổi ' + displayed,
      math.legalReference?.lawCitation ?? 'Tính dòng tiền và quy đổi chi phí vay theo năm',
      math.totalExtraCostVnd ? 'Chi phí vượt tiền nhận ' + money(math.totalExtraCostVnd) : null)
  }
  for (const finding of audit.findings) {
    const quote = finding.evidenceQuote.trim()
    const grade = systemRules.has(finding.ruleCode) && (finding.matchedIndicatorId || finding.ruleCode === 'RULE_03_ENTITY_MISMATCH')
      ? 'A' : quote && !contextRules.has(finding.ruleCode) ? 'B' : 'C'
    add(grade, grade === 'A' ? 'Đối chiếu từ hệ thống' : grade === 'B' ? 'Hợp đồng hoặc tin nhắn' : 'Dấu hiệu trong tình huống',
      quote || (hasInternalIdentifierLeak([finding.title]) ? 'Có dấu hiệu cần kiểm tra.' : finding.title),
      finding.matchedIndicatorId ? 'Đối chiếu chỉ dấu đã xác minh' : 'Quy tắc giám định của FinCopilot')
  }
  for (const item of audit.reasoningFindings ?? []) {
    const safe = maskForensicText(item.evidenceQuote)
    if (safe && !hasInternalIdentifierLeak([safe])) add('C', 'Nhận định hỗ trợ', safe, 'Đối chiếu với nội dung bạn gửi')
  }
  if (!evidenceChain.length && raw.trim().length >= 100) {
    add('C', 'Bối cảnh người dùng mô tả', 'Có mô tả tình huống. Cần tài liệu hoặc thông tin giao dịch để kiểm chứng.',
      'Rà soát nội dung bạn gửi')
  }

  const evidenceConfidence: EvidenceConfidence = evidenceChain.some(item => item.grade === 'A') ? 'A1'
    : evidenceChain.some(item => item.grade === 'B') ? 'B2' : evidenceChain.length ? 'C3' : 'D4'
  const abstention = evidenceConfidence === 'D4'
  const riskTier: RiskTier = abstention ? 'T1'
    : audit.deterministicOverride || audit.riskScore >= 75 || audit.findings.some(finding => finding.severity === 'CRITICAL') ? 'T3'
      : audit.verdictLevel === 'HIGH_RISK' || audit.riskScore >= 55 ? 'T2'
        : audit.verdictLevel === 'CAUTION' || audit.riskScore >= 25 || evidenceConfidence === 'C3' ? 'T1' : 'T0'
  return {
    standardVersion: 'FERS-v1', riskTier, evidenceConfidence, abstention,
    actionLabelVi: abstention ? 'Chưa đủ dữ kiện để kết luận' : tierLabels[riskTier],
    confidenceLabelVi: confidenceLabels[evidenceConfidence],
    abstentionPrompt: abstention ? 'Bạn có thể gửi ảnh hợp đồng đã che thông tin riêng, mã QR hoặc tên đơn vị để mình đối chiếu thêm.' : null,
    taxonomy: classifyVnScamTaxonomy({
      text: [raw, ...audit.findings.map(finding => finding.evidenceQuote)].join('\n'),
      ruleCodes: audit.findings.map(finding => finding.ruleCode), threatCategory: options?.threatCategory,
      qrSchemes: audit.qrPayloads.flatMap(qr => qr.qrScheme ? [qr.qrScheme] : []),
    }),
    evidenceChain: evidenceChain.sort((a, b) => a.grade.localeCompare(b.grade)), standardsCited,
  }
}
