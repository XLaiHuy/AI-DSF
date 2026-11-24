import type { AiTaskOutput, ForensicAuditResponse } from '@fincopilot/shared-types'

type Finding = AiTaskOutput<'FORENSIC_DEEP_REASONING'>['findings'][number]
type Verdict = Pick<ForensicAuditResponse, 'verdictLevel' | 'riskScore'>

function normalizeQuote(text: string) {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function groundReasoningFindings(findings: readonly Finding[], maskedEvidence: readonly string[], redact: (text: string) => string) {
  const sources = maskedEvidence.map(normalizeQuote)
  return findings.flatMap(({ title, explanation, evidenceQuote, severity }) => {
    const quote = redact(evidenceQuote).trim()
    const finding = { title: redact(title).trim(), explanation: redact(explanation).trim(), evidenceQuote: quote, severity }
    if (!finding.title || !finding.explanation || !/[\p{L}\p{N}]/u.test(quote) ||
        !sources.some((source) => source.includes(normalizeQuote(quote)))) return []
    return [finding]
  })
}

export function elevateVerdict(baseline: Verdict, findings: readonly Finding[]): Verdict {
  if (findings.some(({ severity }) => severity === 'HIGH_RISK')) {
    return { verdictLevel: 'HIGH_RISK', riskScore: Math.max(baseline.riskScore, 80) }
  }
  if (baseline.verdictLevel === 'SAFE' && findings.some(({ severity }) => severity === 'CAUTION')) {
    return { verdictLevel: 'CAUTION', riskScore: Math.max(baseline.riskScore, 40) }
  }
  return baseline
}
