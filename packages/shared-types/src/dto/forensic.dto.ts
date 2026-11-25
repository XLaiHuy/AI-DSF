import { z } from 'zod'
import { FindingSeverity, QrScheme, QrServiceCode, RuleCode, VerdictLevel } from '../enums'
import { decimalString, nonnegativeDecimal } from './decimal'

export const LearningTraceSchema = z.strictObject({
  retrievalMode: z.enum(['hybrid_rrf', 'lexical', 'exact_only']),
  tier1ExactMatches: z.number().int().nonnegative(),
  matchedTacticsCount: z.number().int().nonnegative(),
  matchedTacticSummaries: z.array(z.string().max(140)).max(3),
  fewShotScamCount: z.number().int().nonnegative(),
  fewShotSafeCount: z.number().int().nonnegative(),
  expandedTeencodeCount: z.number().int().nonnegative(),
  zeroShotEscalated: z.boolean(),
})

export const ForensicAuditFieldsSchema = z.strictObject({
  rawText: z.string().trim().min(1).max(50_000).optional(),
  rawQrString: z.string().trim().min(1).max(4096).optional(),
  claimedEntityName: z.string().trim().min(1).max(200).optional(),
  sourceAlertId: z.uuid().optional(),
})
export type ForensicAuditFields = z.infer<typeof ForensicAuditFieldsSchema>

export const ForensicIntentSignalsSchema = z.strictObject({
  provider: z.string(),
  recoveryScamProb: z.number().min(0).max(1),
  biometricPhishingProb: z.number().min(0).max(1),
  urgentCoercionProb: z.number().min(0).max(1),
})
export type ForensicIntentSignals = z.infer<typeof ForensicIntentSignalsSchema>

export const ChannelIntelligenceSchema = z.strictObject({
  channelGroup: z.enum(['VIETQR_BANK', 'EWALLET_VN', 'EMVCO_CARD', 'CRYPTO_WALLET', 'URL_LINK', 'UNKNOWN']),
  reputationStatus: z.enum(['CLEAN_PUBLIC', 'FLAGGED_SCAM', 'HIGH_RISK_ANONYMOUS', 'UNVERIFIABLE_PRIVATE_BANK']),
  sourceName: z.string(),
  checkedLive: z.boolean(),
  activitySummary: z.string(),
  riskFlags: z.array(z.string()),
  legalNotice: z.string().nullable().optional(),
})
export type ChannelIntelligence = z.infer<typeof ChannelIntelligenceSchema>

export const ForensicQrMetadataSchema = z.strictObject({
  qrScheme: QrScheme.optional(),
  providerLabel: z.string().nullable().optional(),
  currencyCode: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
  targetUrl: z.string().nullable().optional(),
  walletNetwork: z.string().nullable().optional(),
  merchantName: z.string().nullable().optional(),
  merchantCategoryCode: z.string().nullable().optional(),
  channelIntelligence: ChannelIntelligenceSchema.nullable().optional(),
  amount: nonnegativeDecimal.nullable().optional(),
})

export const ComplexityTierSchema = z.enum(['EASY', 'MEDIUM', 'HARD'])

export const LegalReferenceSchema = z.strictObject({
  status: z.enum(['WITHIN_CIVIL_LIMIT', 'EXCEEDS_CIVIL_CEILING', 'POTENTIAL_USURY_CRIME', 'REGULATED_INSTITUTION_EXEMPT']),
  lawCitation: z.string(),
  legalCeilingPct: decimalString.nullable(),
  excessOverCeilingPct: decimalString.nullable(),
  multipleOfCeiling: decimalString.nullable(),
  plainSummary: z.string(),
})

export const ReasoningFindingSchema = z.strictObject({
  title: z.string(), explanation: z.string(), evidenceQuote: z.string(), severity: z.enum(['CAUTION', 'HIGH_RISK']),
})

export const LegalCitationItemSchema = z.strictObject({
  code: z.string(), title: z.string(), articleRef: z.string(),
  status: z.enum(['IN_FORCE', 'AMENDING', 'SUPPLEMENTARY']),
  effectiveDate: z.string(), replacesOrSupplements: z.string(), plainMeaning: z.string(),
  sourceUrl: z.url(), sourceLabel: z.string(),
  caseRelevance: z.string().optional(),
})
export type LegalCitationItem = z.infer<typeof LegalCitationItemSchema>

export const ForensicPersonalImpactSchema = z.strictObject({
  kind: z.enum(['LOAN_MONTHLY', 'ONE_TIME_PAYMENT']),
  status: z.enum(['WITHIN_BUDGET', 'STRETCHED', 'OVER_CAPACITY']),
  monthlyIncomeVnd: nonnegativeDecimal.nullable(),
  currentDtiPct: nonnegativeDecimal.nullable(),
  projectedDtiPct: nonnegativeDecimal.nullable(),
  maxSafeEmiVnd: nonnegativeDecimal.nullable(),
  proposedMonthlyPaymentVnd: nonnegativeDecimal.nullable(),
  emiExcessVnd: nonnegativeDecimal.nullable(),
  monthlySurplusAfterVnd: decimalString.nullable(),
  paymentAmountVnd: nonnegativeDecimal.nullable(),
  shareOfSavingsPct: nonnegativeDecimal.nullable(),
  shareOfMonthlyIncomePct: nonnegativeDecimal.nullable(),
  plainSummary: z.string(),
})
export type ForensicPersonalImpact = z.infer<typeof ForensicPersonalImpactSchema>

export const ForensicAuditResponseSchema = z.strictObject({
  auditId: z.guid(),
  createdAt: z.iso.datetime().optional(),
  verdictLevel: VerdictLevel,
  riskScore: z.number().int().min(0).max(100),
  deterministicOverride: z.boolean(),
  claimedEntityName: z.string().nullable(),
  mathBreakdown: z.strictObject({
    principalNominalVnd: nonnegativeDecimal,
    upfrontFeeVnd: nonnegativeDecimal,
    principalNetVnd: nonnegativeDecimal,
    quotedRateLabel: z.string(),
    effectiveAprPct: decimalString.nullable(),
    effectiveEarPct: decimalString.nullable(),
    termMonths: z.number().int().positive().optional(),
    monthlyPaymentVnd: nonnegativeDecimal.optional(),
    periodicRepayment: z.strictObject({
      unit: z.enum(['DAY', 'WEEK']),
      count: z.number().int().positive(),
      paymentVnd: nonnegativeDecimal,
    }).optional(),
    totalPayableVnd: nonnegativeDecimal.optional(),
    totalExtraCostVnd: nonnegativeDecimal.optional(),
    flatRateExplainer: z.string().optional(),
    legalReference: LegalReferenceSchema.nullable().optional(),
    scheduleType: z.enum(['FIXED_FLAT', 'MULTI_PHASE', 'DECLINING_WITH_FEES']).optional(),
    minMonthlyPaymentVnd: nonnegativeDecimal.optional(),
    maxMonthlyPaymentVnd: nonnegativeDecimal.optional(),
    phaseBreakdown: z.array(z.strictObject({
      label: z.string(), fromMonth: z.number().int().positive(), toMonth: z.number().int().positive(),
      monthlyPaymentVnd: nonnegativeDecimal, quotedRateLabel: z.string(), recurringFeeVnd: nonnegativeDecimal,
    })).optional(),
    stressScenario: z.strictObject({
      triggerCondition: z.string(), evidenceQuote: z.string(),
      minMonthlyPaymentVnd: nonnegativeDecimal, maxMonthlyPaymentVnd: nonnegativeDecimal,
      totalPayableVnd: nonnegativeDecimal, totalExtraCostVnd: nonnegativeDecimal, extraDeltaOverBaseVnd: nonnegativeDecimal,
      effectiveAprPct: decimalString, effectiveEarPct: decimalString, legalReference: LegalReferenceSchema.nullable().optional(),
    }).nullable().optional(),
    hasUncappedFloatingClause: z.boolean().optional(),
    uncappedFloatingNote: z.string().nullable().optional(),
  }).nullable(),
  legalCitations: z.array(LegalCitationItemSchema).optional(),
  personalImpact: ForensicPersonalImpactSchema.nullable().optional(),
  complexityTier: ComplexityTierSchema.optional(),
  reasoningFindings: z.array(ReasoningFindingSchema).optional(),
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
    ...ForensicQrMetadataSchema.shape,
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
  immediateActions: z.array(z.string()),
  intentSignals: ForensicIntentSignalsSchema.nullable().optional(),
  entityLicense: z.strictObject({
    issuer: z.enum(['NHNN', 'UBCKNN']),
    status: z.enum(['LICENSED', 'SUSPENDED', 'BLACKLISTED']),
  }).nullable().optional(),
  handoffPayload: z.strictObject({
    suggestedAmountVnd: nonnegativeDecimal,
    suggestedTermMonths: z.number().int().positive(),
  }).nullable(),
  meta: z.strictObject({
    learningTrace: LearningTraceSchema.optional(),
    llmProvider: z.string().nullable(),
    degradedMode: z.boolean(),
    errorCode: z.literal('ERR_AI_DEGRADED_FALLBACK').optional(),
  }),
})
export type ForensicAuditResponse = z.infer<typeof ForensicAuditResponseSchema>

export const ForensicAuditStageSchema = z.strictObject({
  step: z.enum(['EXTRACT', 'RULES', 'REASONING', 'NARRATIVE']),
  status: z.enum(['running', 'done']),
  label: z.string(),
  detail: z.string().optional(),
})
export type ForensicAuditStage = z.infer<typeof ForensicAuditStageSchema>

export const ForensicRefusalSchema = z.strictObject({
  type: z.literal('refusal'),
  code: z.literal('FORENSIC_OFF_TOPIC'),
  message: z.string(),
})
export const ForensicAuditResultSchema = z.union([ForensicAuditResponseSchema, ForensicRefusalSchema])

export const ForensicAuditStreamEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('stage'), stage: ForensicAuditStageSchema }),
  z.strictObject({ type: z.literal('result'), audit: ForensicAuditResponseSchema }),
  ForensicRefusalSchema,
  z.strictObject({ type: z.literal('error'), errorCode: z.string().optional(), message: z.string() }),
  z.strictObject({ type: z.literal('done') }),
])
export type ForensicAuditStreamEvent = z.infer<typeof ForensicAuditStreamEventSchema>

export const ForensicAuditSummarySchema = ForensicAuditResponseSchema.pick({
  auditId: true, verdictLevel: true, riskScore: true, claimedEntityName: true,
}).extend({ createdAt: z.iso.datetime() })
export const ForensicAuditListResponseSchema = z.strictObject({
  audits: z.array(ForensicAuditSummarySchema),
})
export type ForensicAuditListResponse = z.infer<typeof ForensicAuditListResponseSchema>

export const ForensicChatTurnSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(4000),
})
export const ForensicFollowUpRequestSchema = z.strictObject({
  question: z.string().trim().min(1).max(2000),
  history: z.array(ForensicChatTurnSchema).max(6).optional(),
})
export const ForensicFollowUpResponseSchema = z.strictObject({
  answer: z.string(),
  meta: z.strictObject({
    llmProvider: z.string().nullable(),
    degradedMode: z.boolean(),
    intent: z.enum(['FINANCIAL_QA', 'NEW_CONTEXT', 'ACK', 'OFF_TOPIC']).optional(),
    suggestReaudit: z.boolean().optional(),
    reAuditAppendText: z.string().max(2000).optional(),
  }),
})
export type ForensicChatTurn = z.infer<typeof ForensicChatTurnSchema>
export type ForensicFollowUpRequest = z.infer<typeof ForensicFollowUpRequestSchema>
export type ForensicFollowUpResponse = z.infer<typeof ForensicFollowUpResponseSchema>
