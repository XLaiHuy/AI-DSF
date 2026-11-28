import { hasInternalIdentifierLeak } from '../../common/untrusted-text'
import { financialNumericGrounding } from '../forensic/forensic-narrative'

export function isGroundedSurveyExplanation(
  explanation: { summary: string; tradeoffs: string[]; warnings?: string[] },
  allowedNumbers: readonly unknown[],
) {
  const paragraphs = [explanation.summary, ...explanation.tradeoffs, ...(explanation.warnings ?? [])]
  return !hasInternalIdentifierLeak(paragraphs) && paragraphs.every(financialNumericGrounding(allowedNumbers))
}
