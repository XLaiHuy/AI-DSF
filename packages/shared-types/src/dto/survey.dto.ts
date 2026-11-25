import { z } from 'zod'
import { DataProvenance, DtiRiskBand, InvestmentCategory, LoanCategory, RateType } from '../enums'
import { decimalString, nonnegativeDecimal, positiveDecimal } from './decimal'

const dtiOverrideSchema = z.strictObject({
  monthlyIncomeVnd: nonnegativeDecimal,
  monthlyExpenseVnd: nonnegativeDecimal,
  existingDebtPaymentVnd: nonnegativeDecimal,
})

const surveyOptions = {
  checkEntityName: z.string().optional(),
  enableWebFallback: z.boolean().optional(),
}

export const SurveyLoanRequestSchema = z.strictObject({
  principalVnd: positiveDecimal,
  termMonths: z.number().int().positive(),
  productCategory: LoanCategory,
  priority: z.enum(['LOWEST_APR', 'LOWEST_MONTHLY_PAYMENT', 'LOWEST_TOTAL_COST']),
  ...surveyOptions,
  dtiOverride: dtiOverrideSchema.optional(),
  rateShockDeltaPct: decimalString.optional(),
})
export type SurveyLoanRequest = z.infer<typeof SurveyLoanRequestSchema>

const dtiAssessmentSchema = z.strictObject({
  bestOfferDtiPct: nonnegativeDecimal,
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
}

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
    principalNetVnd: nonnegativeDecimal,
    monthlyPaymentFirstVnd: nonnegativeDecimal,
    totalInterestAndFeesVnd: nonnegativeDecimal,
    totalPayableVnd: nonnegativeDecimal,
    effectiveAprPct: decimalString,
    dtiPct: nonnegativeDecimal.nullable(),
    schedule: z.array(z.strictObject({
      month: z.number().int().positive(),
      paymentVnd: nonnegativeDecimal,
      principalVnd: nonnegativeDecimal,
      interestVnd: nonnegativeDecimal,
      remainingBalanceVnd: nonnegativeDecimal,
    })),
  })),
  aiExplanation: z.strictObject({
    summary: z.string(),
    tradeoffs: z.array(z.string()),
  }).nullable(),
  meta: z.strictObject({
    degradedMode: z.boolean(),
    errorCode: z.literal('ERR_AI_DEGRADED_FALLBACK').optional(),
  }).optional(),
})
export type SurveyLoanResponse = z.infer<typeof SurveyLoanResponseSchema>

export const SurveyInvestRequestSchema = z.strictObject({
  initialVnd: nonnegativeDecimal,
  monthlyContributionVnd: nonnegativeDecimal,
  termMonths: z.number().int().positive(),
  productCategory: InvestmentCategory,
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
    scenario: investmentScenarioSchema,
  })),
})
export type SurveyInvestResponse = z.infer<typeof SurveyInvestResponseSchema>

export const ManualCompareRequestSchema = z.strictObject({
  offers: z.array(z.strictObject({
    label: z.string().trim().min(1).max(120),
    principalVnd: positiveDecimal,
    annualRatePct: nonnegativeDecimal,
    termMonths: z.number().int().positive(),
    upfrontFeeVnd: nonnegativeDecimal.optional(),
  })).min(2).max(10),
})
export type ManualCompareRequest = z.infer<typeof ManualCompareRequestSchema>

export const ManualCompareResponseSchema = z.strictObject({
  sessionId: z.guid(),
  offers: z.array(z.strictObject({
    label: z.string(),
    monthlyPaymentVnd: nonnegativeDecimal,
    totalInterestVnd: nonnegativeDecimal,
    totalPayableVnd: nonnegativeDecimal,
    effectiveAprPct: decimalString,
  })),
})
export type ManualCompareResponse = z.infer<typeof ManualCompareResponseSchema>
