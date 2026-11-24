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
}

export function classifyAuditComplexity(input: ComplexityInput): z.infer<typeof ComplexityTierSchema> {
  const signals = input.intentSignals
  const probability = Math.max(signals?.recoveryScamProb ?? 0, signals?.biometricPhishingProb ?? 0, signals?.urgentCoercionProb ?? 0)
  const longText = input.textLength > 500
  const hasCritical = input.findings.some(({ severity }) => severity === 'CRITICAL')

  if ((probability >= 0.7 && !input.findings.length) || input.licensedWithAnomaly ||
      (input.fileCount >= 2 && (longText || input.hasQr))) return 'HARD'
  if (input.hasConditionalLoanTerms) return 'MEDIUM'
  if (hasCritical && input.riskScore >= 75) return 'EASY'
  if (!input.findings.length && input.riskScore === 0 && probability < 0.25 && !input.hasPdf && !longText) return 'EASY'
  return 'MEDIUM'
}
