import { z } from 'zod'
import { CalcMethod } from './enums'
import { ThreatIndicatorSchema } from './dto/radar.dto'
import { decimalString, nonnegativeDecimal } from './dto/decimal'

const evidenceQuote = z.string().trim().min(1)
const textEvidence = z.strictObject({ value: z.string(), evidenceQuote })

export const AI_TASK_SCHEMAS = {
  RADAR_CLASSIFY_IMPACT: z.strictObject({
    topics: z.array(z.string()),
    extractedFacts: z.array(z.string()),
    aiAssessment: z.string(),
    suggestedRateDelta: decimalString.nullable(),
    isFraudAlert: z.boolean(),
    indicators: z.array(ThreatIndicatorSchema),
  }),
  SURVEY_WEB_LOOKUP: z.discriminatedUnion('found', [
    z.strictObject({
      found: z.literal(true),
      institutionName: z.string(),
      nominalRatePct: nonnegativeDecimal,
      calcMethod: CalcMethod,
      sourceUrl: z.url(),
      effectiveDate: z.iso.date(),
    }),
    z.strictObject({
      found: z.literal(false),
      institutionName: z.null(),
      nominalRatePct: z.null(),
      calcMethod: z.null(),
      sourceUrl: z.null(),
      effectiveDate: z.null(),
    }),
  ]),
  SURVEY_EXPLAIN: z.strictObject({
    summary: z.string(),
    tradeoffs: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
  FORENSIC_VISION_EXTRACT: z.strictObject({
    claimedEntityName: textEvidence.nullable(),
    visionBeneficiaryName: textEvidence.nullable(),
    nominalAmountVnd: nonnegativeDecimal.nullable(),
    upfrontFees: z.array(z.strictObject({
      amountVnd: nonnegativeDecimal,
      evidenceQuote,
    })),
    quotedRatePct: z.strictObject({ value: decimalString, evidenceQuote }).nullable(),
    rateMethod: CalcMethod.nullable(),
    redFlagPhrases: z.array(z.strictObject({ type: z.string(), evidenceQuote })),
  }),
  FORENSIC_VERDICT_NARRATIVE: z.strictObject({
    narrative: z.string(),
    immediateActions: z.array(z.string()),
  }),
} as const

export type AiTaskType = keyof typeof AI_TASK_SCHEMAS
export type AiTaskOutput<T extends AiTaskType> = z.output<(typeof AI_TASK_SCHEMAS)[T]>

export interface IAiGatewayService {
  generateStructured<T extends AiTaskType>(
    taskType: T,
    schema: (typeof AI_TASK_SCHEMAS)[T],
    payload: unknown,
  ): Promise<AiTaskOutput<T>>
}
