import { z } from 'zod'
import { CalcMethod } from './enums'
import { ThreatIndicatorSchema } from './dto/radar.dto'
import { ThreatIndicatorInputSchema } from './dto/threat-ops.dto'
import { ReasoningFindingSchema } from './dto/forensic.dto'
import { FinancialHealthRequestSchema, ProfileCoachAdviceSchema } from './dto/profile.dto'
import { decimalString, nonnegativeDecimal } from './dto/decimal'

const evidenceQuote = z.string().trim().min(1)
const textEvidence = z.strictObject({ value: z.string(), evidenceQuote })

export const AI_TASK_SCHEMAS = {
  RADAR_CLASSIFY_IMPACT: z.strictObject({
    topics: z.array(z.string()),
    extractedFacts: z.array(z.string()),
    aiAssessment: z.string(),
    // Only return a delta when a source explicitly states the before/after rate values.
    suggestedRateDelta: decimalString.nullable(),
    isFraudAlert: z.boolean(),
    indicators: z.array(ThreatIndicatorSchema),
  }),
  THREAT_ARTICLE_EXTRACT: z.strictObject({
    isScamAlert: z.boolean(),
    threatCategory: z.enum(['IMPERSONATION', 'PHISHING', 'LOAN_SHARK', 'CRYPTO_SCAM', 'QR_FRAUD', 'INVESTMENT_SCAM', 'OTHER']),
    tacticSummary: z.string().trim().min(1).max(800),
    preventionGuidance: z.string().trim().min(1).max(2000),
    indicators: z.array(ThreatIndicatorInputSchema).max(40),
  }),
  RADAR_DAILY_BRIEF: z.strictObject({
    items: z.array(z.strictObject({
      referenceId: z.uuid(),
      sourceTitle: z.string().min(1),
      summary: z.string().trim().min(1).max(240),
      interpretation: z.string().trim().max(280).nullable(),
    })).max(10),
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
    nominalAmountEvidenceQuote: evidenceQuote.nullable(),
    termMonths: z.strictObject({ value: z.number().int().min(1).max(600), evidenceQuote }).nullable(),
    upfrontFees: z.array(z.strictObject({
      amountVnd: nonnegativeDecimal,
      evidenceQuote,
    })),
    quotedRatePct: z.strictObject({ value: decimalString, evidenceQuote }).nullable(),
    rateMethod: CalcMethod.nullable(),
    documentTranscript: z.string().max(16_000).nullable(),
    repaymentMethod: z.enum(['FLAT', 'DECLINING_EQUAL_PRINCIPAL', 'DECLINING_ANNUITY']).nullable(),
    repaymentMethodEvidenceQuote: evidenceQuote.nullable(),
    ratePhases: z.array(z.strictObject({
      fromMonth: z.number().int().min(1).max(600), toMonth: z.number().int().min(1).max(600),
      monthlyRatePct: nonnegativeDecimal, evidenceQuote,
    })).nullable(),
    recurringMonthlyFeeVnd: nonnegativeDecimal.nullable(),
    recurringFeeEvidenceQuote: evidenceQuote.nullable(),
    stressTriggerCondition: z.string().max(300).nullable(),
    stressMonthlyRatePct: nonnegativeDecimal.nullable(),
    stressEvidenceQuote: evidenceQuote.nullable(),
    hasUncappedFloatingClause: z.boolean(),
    uncappedFloatingQuote: evidenceQuote.nullable(),
    redFlagPhrases: z.array(z.strictObject({ type: z.string(), evidenceQuote })),
  }),
  FORENSIC_VERDICT_NARRATIVE: z.strictObject({
    narrative: z.string().trim().min(1).max(1500),
    immediateActions: z.array(z.string().trim().min(1).max(250)).max(5),
  }),
  FORENSIC_DEEP_REASONING: z.strictObject({ findings: z.array(ReasoningFindingSchema).max(3), summary: z.string() }),
  FORENSIC_CONVERSATION_GUIDE: z.strictObject({
    route: z.enum(['FINANCIAL_EDUCATION', 'NEEDS_DETAILS', 'SCAM_CHECK_INCOMPLETE', 'ASSISTANT_INFO', 'EMERGENCY_SCAM_RECOVERY', 'PROFILE_HEALTH_NAV', 'OFF_TOPIC', 'FULL_AUDIT']),
    answer: z.string().trim().min(1).max(900), suggestedPrompts: z.array(z.string().trim().min(1).max(140)).max(3),
    domain: z.enum(['LOAN', 'INVEST', 'SAVINGS', 'PROFILE', 'SCAM']).optional(),
  }),
  PROFILE_PARSE_NATURAL: FinancialHealthRequestSchema,
  PROFILE_HEALTH_COACH: ProfileCoachAdviceSchema,
} as const

export type AiTaskType = keyof typeof AI_TASK_SCHEMAS
export type AiTaskOutput<T extends AiTaskType> = z.output<(typeof AI_TASK_SCHEMAS)[T]>

export interface IAiGatewayService {
  generateStructured<T extends AiTaskType>(
    taskType: T,
    schema: z.ZodType<AiTaskOutput<T>>,
    payload: unknown,
  ): Promise<AiTaskOutput<T>>
}
