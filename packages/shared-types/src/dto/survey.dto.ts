import { z } from 'zod'
import { CalcMethod, DataProvenance, DtiRiskBand, InvestmentCategory, LoanCategory, LoanUseCase, RateType } from '../enums'
import { decimalString, nonnegativeDecimal, positiveDecimal } from './decimal'
import { ProductFreshnessSchema, VerificationReceiptSchema } from './verification.dto'

const dtiOverrideSchema = z.strictObject({
  monthlyIncomeVnd: nonnegativeDecimal.max(64),
  monthlyExpenseVnd: nonnegativeDecimal.max(64),
  existingDebtPaymentVnd: nonnegativeDecimal.max(64),
})

const surveyOptions = {
  checkEntityName: z.string().trim().max(200).optional(),
  enableWebFallback: z.boolean().optional(),
}

export const SurveyTermMonthsSchema = z.number().int().min(1).max(600)
const savedMetadata = { savedToHistory: z.boolean().optional() }
const catalogStatus = z.enum(['AVAILABLE', 'EMPTY_CATALOG', 'NO_MATCH', 'CATALOG_UNAVAILABLE'])

export const SurveyLoanRequestSchema = z.strictObject({
  principalVnd: positiveDecimal.max(64),
  termMonths: SurveyTermMonthsSchema,
  productCategory: LoanCategory,
  loanUseCase: LoanUseCase.optional(),
  priority: z.enum(['LOWEST_APR', 'LOWEST_MONTHLY_PAYMENT', 'LOWEST_TOTAL_COST']),
  ...surveyOptions,
  dtiOverride: dtiOverrideSchema.optional(),
  rateShockDeltaPct: decimalString.max(64).optional(),
  sourceArticleId: z.uuid().optional(),
  sourceAuditId: z.uuid().optional(),
})
export type SurveyLoanRequest = z.infer<typeof SurveyLoanRequestSchema>

const dtiAssessmentSchema = z.strictObject({
  bestOfferDtiPct: nonnegativeDecimal.nullable(),
  riskBand: DtiRiskBand,
  disposableCashflowVnd: decimalString,
  disclaimer: z.string(),
})

const offerSource = {
  productId: z.string(),
  institutionName: z.string(),
  productName: z.string(),
  dataProvenance: DataProvenance,
  sourceUrl: z.url(),
  effectiveDate: z.iso.date(),
  freshnessTier: ProductFreshnessSchema.optional(),
  verificationReceipt: VerificationReceiptSchema.optional(),
}

const loanSchedule = z.array(z.strictObject({
  month: z.number().int().positive(),
  paymentVnd: nonnegativeDecimal,
  principalVnd: nonnegativeDecimal,
  interestVnd: nonnegativeDecimal,
  feeVnd: nonnegativeDecimal.optional(),
  remainingBalanceVnd: nonnegativeDecimal,
})).max(600)

export const SurveyLoanResponseSchema = z.strictObject({
  sessionId: z.guid(),
  trustFilterSummary: z.strictObject({
    totalLicensedFound: z.number().int().nonnegative(),
    blockedEntities: z.array(z.string()),
  }),
  dtiAssessment: dtiAssessmentSchema.nullable(),
  offers: z.array(z.strictObject({
    ...offerSource,
    trustScore: z.number().int().min(0).max(100),
    fitScore: z.number().int().min(0).max(100).optional(),
    sourceLabel: z.string(),
    rateType: RateType,
    calcMethod: CalcMethod,
    loanUseCase: LoanUseCase.nullable().optional(),
    nominalRatePct: decimalString.optional(),
    stressPaymentFirstVnd: nonnegativeDecimal.optional(),
    rateAssumption: z.string().optional(),
    upfrontFeeVnd: nonnegativeDecimal,
    monthlyFeeVnd: nonnegativeDecimal,
    principalNetVnd: nonnegativeDecimal,
    monthlyPaymentFirstVnd: nonnegativeDecimal,
    totalInterestAndFeesVnd: nonnegativeDecimal,
    totalPayableVnd: nonnegativeDecimal,
    effectiveAprPct: decimalString,
    dtiPct: nonnegativeDecimal.nullable(),
    dtiAssessment: dtiAssessmentSchema.nullable(),
    schedule: loanSchedule,
    stressSchedule: loanSchedule.optional(),
  })),
  aiExplanation: z.strictObject({
    summary: z.string(),
    tradeoffs: z.array(z.string()),
    warnings: z.array(z.string()).optional(),
  }).nullable(),
  meta: z.strictObject({
    degradedMode: z.boolean(),
    errorCode: z.literal('ERR_AI_DEGRADED_FALLBACK').optional(),
    catalogStatus: catalogStatus.optional(),
    ...savedMetadata,
  }).optional(),
})
export type SurveyLoanResponse = z.infer<typeof SurveyLoanResponseSchema>

export const SurveyInvestRequestSchema = z.strictObject({
  initialVnd: nonnegativeDecimal.max(64),
  monthlyContributionVnd: nonnegativeDecimal.max(64),
  termMonths: SurveyTermMonthsSchema,
  productCategory: InvestmentCategory.optional(),
  ...surveyOptions,
})
export type SurveyInvestRequest = z.infer<typeof SurveyInvestRequestSchema>

const investmentScenarioSchema = z.strictObject({
  annualReturnPct: decimalString,
  totalContributedVnd: nonnegativeDecimal,
  grossValueVnd: nonnegativeDecimal,
  sellFeeVnd: nonnegativeDecimal,
  taxVnd: nonnegativeDecimal,
  netValueVnd: nonnegativeDecimal,
  netProfitVnd: decimalString,
})
export const SurveyInvestResponseSchema = z.strictObject({
  sessionId: z.guid(),
  offers: z.array(z.strictObject({
    ...offerSource,
    productCategory: InvestmentCategory,
    rateType: RateType,
    sourceLabel: z.string(),
    scenario: investmentScenarioSchema,
    scenarios: z.strictObject({
      conservative: investmentScenarioSchema,
      base: investmentScenarioSchema,
      optimistic: investmentScenarioSchema,
    }).optional(),
    rateNote: z.string().max(800).optional(),
  projection: z.array(z.strictObject({
      month: z.number().int().nonnegative(),
      contributedVnd: nonnegativeDecimal,
      baseVnd: nonnegativeDecimal,
      conservativeVnd: nonnegativeDecimal.optional(),
      optimisticVnd: nonnegativeDecimal.optional(),
    })).optional(),
  })),
  meta: z.strictObject({ catalogStatus, ...savedMetadata }).optional(),
})
export type SurveyInvestResponse = z.infer<typeof SurveyInvestResponseSchema>

const loanCalcMethod = CalcMethod.exclude(['COMPOUND_DCA'])
const manualOffer = z.strictObject({
  label: z.string().trim().min(1).max(120),
  principalVnd: positiveDecimal.max(64),
  annualRatePct: nonnegativeDecimal.max(64),
  termMonths: SurveyTermMonthsSchema,
  upfrontFeeVnd: nonnegativeDecimal.max(64).optional(),
  calcMethod: loanCalcMethod.optional(),
  monthlyFeeVnd: nonnegativeDecimal.max(64).optional(),
  promoMonths: SurveyTermMonthsSchema.optional(),
  floatingRatePct: nonnegativeDecimal.max(64).optional(),
  earlySettlementMonth: SurveyTermMonthsSchema.optional(),
  earlySettlementFeePct: nonnegativeDecimal.max(64).optional(),
})
export const ManualCompareRequestSchema = z.strictObject({ offers: z.array(manualOffer).min(2).max(4) })
export type ManualCompareRequest = z.infer<typeof ManualCompareRequestSchema>

export const ManualCompareResponseSchema = z.strictObject({
  sessionId: z.guid(),
  offers: z.array(z.strictObject({
    label: z.string(),
    verificationReceipt: VerificationReceiptSchema.optional(),
    monthlyPaymentVnd: nonnegativeDecimal,
    totalInterestVnd: nonnegativeDecimal,
    totalPayableVnd: nonnegativeDecimal,
    effectiveAprPct: decimalString,
    upfrontFeeVnd: nonnegativeDecimal,
    principalNetVnd: nonnegativeDecimal,
    calcMethod: loanCalcMethod.default('REDUCING_BALANCE'),
    monthlyFeeVnd: nonnegativeDecimal.default('0'),
    schedule: loanSchedule.default([]),
    earlySettlement: z.strictObject({
      month: z.number().int().positive(),
      penaltyFeeVnd: nonnegativeDecimal,
      remainingPrincipalVnd: nonnegativeDecimal,
      totalPaidUntilExitVnd: nonnegativeDecimal,
      effectiveAprAtExitPct: decimalString,
    }).nullable().optional(),
  })),
  meta: z.strictObject(savedMetadata).optional(),
})
export type ManualCompareResponse = z.infer<typeof ManualCompareResponseSchema>

const refinanceTerms = {
  remainingPrincipalVnd: positiveDecimal.max(18).regex(/^\d+$/u),
  remainingTermMonths: SurveyTermMonthsSchema,
  currentAnnualRatePct: nonnegativeDecimal.max(16),
  currentCalcMethod: loanCalcMethod,
  currentFlatInterestBaseVnd: positiveDecimal.max(18).regex(/^\d+$/u).optional(),
  currentMonthlyFeeVnd: nonnegativeDecimal.max(18),
  earlySettlementFeePct: nonnegativeDecimal.max(16),
  productCategory: LoanCategory,
  newTermMonths: SurveyTermMonthsSchema.optional(),
}
export const SurveyRefinanceTermsSchema = z.strictObject(refinanceTerms)
export const SurveyRefinanceRequestSchema = SurveyRefinanceTermsSchema.partial()
  .extend({ sourceAuditId: z.uuid().optional() })
  .refine((value) => value.sourceAuditId || SurveyRefinanceTermsSchema.safeParse(value).success, {
    message: 'Nhập đủ thông tin khoản vay hoặc chọn một báo cáo giám định.',
  })
export type SurveyRefinanceRequest = z.infer<typeof SurveyRefinanceRequestSchema>

export const SurveyRefinanceContractSchema = SurveyRefinanceTermsSchema.extend({
  sourceAuditId: z.uuid().optional(),
  claimedEntityName: z.string().nullable(),
  referenceAprPct: nonnegativeDecimal.nullable(),
  rateIsEstimate: z.boolean(),
})
export type SurveyRefinanceContract = z.infer<typeof SurveyRefinanceContractSchema>

const refinanceResult = z.strictObject({
  currentMonthlyPaymentVnd: nonnegativeDecimal, currentTotalRemainingPayableVnd: nonnegativeDecimal,
  earlySettlementPenaltyVnd: nonnegativeDecimal, newUpfrontFeeVnd: nonnegativeDecimal, totalSwitchCostVnd: nonnegativeDecimal,
  newMonthlyPaymentVnd: nonnegativeDecimal, newTotalPayableVnd: nonnegativeDecimal, monthlySavingsVnd: decimalString,
  breakEvenMonth: SurveyTermMonthsSchema.nullable(), netSavingsVnd: decimalString,
  recommendation: z.enum(['WORTH_REFINANCING', 'MARGINAL', 'KEEP_CURRENT']),
  comparisonPoints: z.array(z.strictObject({
    month: z.number().int().min(0).max(600), currentCumulativeVnd: nonnegativeDecimal, refinanceCumulativeVnd: nonnegativeDecimal,
  })).max(36),
})
export const SurveyRefinanceResponseSchema = z.strictObject({
  sessionId: z.guid(),
  currentContract: SurveyRefinanceContractSchema,
  offers: z.array(z.strictObject({
    ...offerSource, sourceLabel: z.string(), rateType: RateType, calcMethod: loanCalcMethod.exclude(['FLAT_RATE']),
    newAnnualRatePct: nonnegativeDecimal, newTermMonths: SurveyTermMonthsSchema,
    newLaterRate: z.strictObject({ afterMonths: SurveyTermMonthsSchema, annualRatePct: nonnegativeDecimal }).optional(),
    result: refinanceResult,
  })).max(3),
  bestOptionSummary: z.string(),
  meta: z.strictObject({ catalogStatus, ...savedMetadata }),
})
export type SurveyRefinanceResponse = z.infer<typeof SurveyRefinanceResponseSchema>

const sessionIdentity = { id: z.guid(), createdAt: z.iso.datetime() }
export const SurveySessionDetailResponseSchema = z.discriminatedUnion('sessionMode', [
  z.strictObject({ ...sessionIdentity, sessionMode: z.literal('LOAN_SURVEY'),
    inputParams: SurveyLoanRequestSchema, result: SurveyLoanResponseSchema }),
  z.strictObject({ ...sessionIdentity, sessionMode: z.literal('INVESTMENT_SURVEY'),
    inputParams: SurveyInvestRequestSchema, result: SurveyInvestResponseSchema }),
  z.strictObject({ ...sessionIdentity, sessionMode: z.literal('REFINANCE_COMPARE'),
    inputParams: SurveyRefinanceRequestSchema, result: SurveyRefinanceResponseSchema }),
  z.strictObject({ ...sessionIdentity, sessionMode: z.literal('MANUAL_COMPARE'),
    inputParams: z.strictObject({ offers: z.array(manualOffer).min(2).max(10) }), result: ManualCompareResponseSchema }),
])
export type SurveySessionDetailResponse = z.infer<typeof SurveySessionDetailResponseSchema>

export const AdminProductSyncResultSchema = z.strictObject({
  sourcesChecked: z.number().int().nonnegative(),
  sourcesReachable: z.number().int().nonnegative(),
  productsUpserted: z.number().int().nonnegative(),
  productsActivated: z.number().int().nonnegative(),
  syncedAt: z.iso.datetime(),
})
export type AdminProductSyncResult = z.infer<typeof AdminProductSyncResultSchema>
