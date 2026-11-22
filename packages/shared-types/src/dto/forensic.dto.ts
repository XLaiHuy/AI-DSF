import { z } from 'zod'
import { FindingSeverity, QrServiceCode, RuleCode, VerdictLevel } from '../enums'
import { decimalString, nonnegativeDecimal } from './decimal'

export const ForensicAuditFieldsSchema = z.strictObject({
  rawText: z.string().trim().min(1).optional(),
  rawQrString: z.string().trim().min(1).optional(),
})
export type ForensicAuditFields = z.infer<typeof ForensicAuditFieldsSchema>

export const ForensicAuditResponseSchema = z.strictObject({
  auditId: z.guid(),
  verdictLevel: VerdictLevel,
  riskScore: z.number().int().min(0).max(100),
  deterministicOverride: z.boolean(),
  claimedEntityName: z.string().nullable(),
  mathBreakdown: z.strictObject({
    principalNominalVnd: nonnegativeDecimal,
    upfrontFeeVnd: nonnegativeDecimal,
    principalNetVnd: nonnegativeDecimal,
    quotedRateLabel: z.string(),
    effectiveAprPct: decimalString,
    effectiveEarPct: decimalString,
  }).nullable(),
  qrPayloads: z.array(z.strictObject({
    acqBin: z.string().nullable(),
    bankName: z.string().nullable(),
    accountNumberMasked: z.string().nullable(),
    serviceCode: QrServiceCode.nullable(),
    qrAmountVnd: nonnegativeDecimal.nullable(),
    purposeText: z.string().nullable(),
    crcValid: z.boolean(),
    visionBeneficiaryName: z.string().nullable(),
    entityMismatchFlag: z.boolean(),
  })),
  findings: z.array(z.strictObject({
    ruleCode: RuleCode,
    severity: FindingSeverity,
    scoreImpact: z.number().int(),
    title: z.string(),
    description: z.string(),
    evidenceQuote: z.string(),
    matchedIndicatorId: z.uuid().nullable(),
  })),
  privacyProof: z.strictObject({
    sourceFilesPurgedAt: z.iso.datetime(),
    rawTextMasked: z.string().nullable(),
  }),
  aiNarrative: z.string(),
  handoffPayload: z.strictObject({
    suggestedAmountVnd: nonnegativeDecimal,
    suggestedTermMonths: z.number().int().positive(),
  }).nullable(),
  meta: z.strictObject({
    llmProvider: z.string().nullable(),
    degradedMode: z.boolean(),
    errorCode: z.literal('ERR_AI_DEGRADED_FALLBACK').optional(),
  }),
})
export type ForensicAuditResponse = z.infer<typeof ForensicAuditResponseSchema>
