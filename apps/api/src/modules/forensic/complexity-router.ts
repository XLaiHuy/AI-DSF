import type { ComplexityTierSchema, ForensicAuditResponse, ForensicIntentSignals } from '@fincopilot/shared-types'
import type { z } from 'zod'

interface ComplexityInput {
  riskScore: number
  findings: readonly Pick<ForensicAuditResponse['findings'][number], 'severity'>[]
  intentSignals?: ForensicIntentSignals | null
  licensedWithAnomaly: boolean
  fileCount: number
  hasPdf: boolean
  hasQr: boolean
  textLength: number
  hasConditionalLoanTerms?: boolean
  hasTier2ThreatMatch?: boolean
  hasSuspiciousContext?: boolean
}

const suspiciousContext = [
  /\.apk\b|\b(?:cai|tai)\b.{0,60}\bapk\b|\b(?:cai|tai)\s+(?:(?:dat|ve|xuong|ngay|tep)\s+)?(?:app|ung dung)\b/,
  /\b(?:bam|nhap|mo|truy cap|click)\b.{0,55}\b(?:link|lien ket|duong dan)\b.{0,80}\b(?:sinh trac hoc|vneid|cccd|dinh danh muc 2)\b/,
  /(?<!khong )(?<!khong duoc )(?<!dung )\b(?:gui|doc|cung cap|chia se|nhap|lay)\s+(?:(?:cho|giup|lai|ma)\s+){0,3}(?:otp|mat khau)\b/,
  /\b(?:chuyen|nop|dong|tra|gui|yeu cau)\b.{0,55}\b(?:tien coc|dat coc|phi giai ngan|phi mo khoa|phi xac minh|phi truoc)\b/,
  /\b(?:viec nhe luong cao|lam nhiem vu|nhan hoa hong)\b/,
  /\b(?:cong an|vien kiem sat|toa an|thue|dien luc|ngan hang)\b.{0,90}\b(?:khoa tai khoan|cat dien|bat giu)\b/,
]

export function hasSuspiciousContext(normalizedText: string) {
  return suspiciousContext.some((cue) => cue.test(normalizedText))
}

export function classifyAuditComplexity(input: ComplexityInput): z.infer<typeof ComplexityTierSchema> {
  const signals = input.intentSignals
  const probability = Math.max(signals?.recoveryScamProb ?? 0, signals?.biometricPhishingProb ?? 0, signals?.urgentCoercionProb ?? 0)
  const longText = input.textLength > 500
  const hasCritical = input.findings.some(({ severity }) => severity === 'CRITICAL')

  if ((probability >= 0.7 && !input.findings.length) || input.licensedWithAnomaly ||
      (input.fileCount >= 2 && (longText || input.hasQr))) return 'HARD'
  if (input.hasConditionalLoanTerms || input.hasTier2ThreatMatch || input.hasSuspiciousContext) return 'MEDIUM'
  if (hasCritical && input.riskScore >= 75) return 'EASY'
  if (!input.findings.length && input.riskScore === 0 && probability < 0.25 && !input.hasPdf && !longText) return 'EASY'
  return 'MEDIUM'
}
