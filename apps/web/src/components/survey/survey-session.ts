import type {
  LoanUseCase, ManualCompareRequest, ManualCompareResponse, SurveyInvestResponse,
  SurveyLoanRequest, SurveyLoanResponse, SurveyRefinanceContract, SurveyRefinanceResponse,
} from '@fincopilot/shared-types'
import { manualDraft } from './SurveyFields'

export const investmentLabels = { SAVING: 'Tiết kiệm', ACCUMULATION: 'Tích lũy', OPEN_FUND: 'Quỹ mở' }
export type InvestmentFilter = keyof typeof investmentLabels | 'ALL'
export type SurveyTab = 'loan' | 'invest' | 'manual' | 'refinance'
export type SurveyResult =
  | { tab: 'loan'; data: SurveyLoanResponse; amount: string; term: number }
  | { tab: 'invest'; data: SurveyInvestResponse; queriedFilter: InvestmentFilter; initial: string; term: number }
  | { tab: 'manual'; data: ManualCompareResponse; inputs: ManualCompareRequest['offers'] }

export function refinanceDraft(contract?: SurveyRefinanceContract) {
  return {
    principal: contract?.remainingPrincipalVnd ?? '', months: contract ? String(contract.remainingTermMonths) : '',
    rate: contract?.currentAnnualRatePct ?? '', method: contract?.currentCalcMethod ?? 'REDUCING_BALANCE' as const,
    flatBase: contract?.currentFlatInterestBaseVnd ?? '',
    monthlyFee: contract?.currentMonthlyFeeVnd ?? '0', exitFee: contract?.earlySettlementFeePct ?? '0',
    category: contract?.productCategory ?? 'UNSECURED_LOAN' as const,
    newMonths: contract?.newTermMonths == null ? '' : String(contract.newTermMonths),
  }
}

export type SurveySession = {
  tab: SurveyTab
  form: Record<'principal' | 'initial' | 'contribution' | 'loan' | 'invest' | 'entity' | 'shock', string>
  source: { sourceArticleId?: string; sourceAuditId?: string }
  touched: { amount: boolean; term: boolean }
  loanUseCase: LoanUseCase | ''
  category: SurveyLoanRequest['productCategory']
  priority: SurveyLoanRequest['priority']
  investmentFilter: InvestmentFilter
  manualOffers: ReturnType<typeof manualDraft>[]
  dtiEdits: Partial<Record<'income' | 'expense' | 'debt', string>>
  resultsByTab: { [K in SurveyResult['tab']]?: Extract<SurveyResult, { tab: K }> } & { refinance?: SurveyRefinanceResponse }
  refinanceForm: ReturnType<typeof refinanceDraft>
  refinanceSourceAuditId?: string
}

export function createSurveySession(): SurveySession {
  return {
    tab: 'loan', form: { principal: '50000000', initial: '20000000', contribution: '3000000', loan: '24', invest: '12', entity: '', shock: '0' },
    source: {}, touched: { amount: false, term: false }, loanUseCase: 'UNSECURED_SALARY', category: 'UNSECURED_LOAN',
    priority: 'LOWEST_APR', investmentFilter: 'ALL', manualOffers: [manualDraft(0), manualDraft(1)],
    dtiEdits: {}, resultsByTab: {}, refinanceForm: refinanceDraft(),
  }
}
