import Decimal from 'decimal.js'
import { SurveyTermMonthsSchema, type FinancialHealthRequest, type ForensicGuidance, type LoanUseCase, type SessionContext } from '@fincopilot/shared-types'
import { parseNaturalProfile } from '../profile-auth/profile-natural'
import { normalizeVietnamese } from './data/trusted-institutions'
import { parseVnd } from './hard-rules.engine'

export type ExtractedSlots = NonNullable<ForensicGuidance['extractedSlots']>
export type SurveyDomain = 'LOAN' | 'INVEST' | 'SAVINGS'
export type CopilotIntent = SurveyDomain | 'RADAR' | 'REFINANCE' | 'PROFILE'
export type CopilotInput = { rawText: string; session: SessionContext; slots: ExtractedSlots; domain?: SurveyDomain }

export const amountToken = /(?<![\p{L}\d.,-])(\d{1,16}(?:[.,]\d{1,3}| \d{3}(?!\d)){0,5})\s*(triệu|trieu|tr|tỷ|tỉ|ty|ti|nghìn|nghin|ngàn|ngan|k|đồng|dong|vnđ|vnd|đ|₫)(?![\p{L}\d])(?:\s*(?:đồng|dong|vnđ|vnd|đ|₫)(?![\p{L}\d]))?/giu
export const rateToken = /\d+(?:[.,]\d+)?\s*%(?:\s*\/\s*(?:tháng|năm|thang|nam))?/giu
export const termToken = /(?<![\p{L}\d.,-])(\d{1,3})\s*(tháng|thang|năm|nam)(?![\p{L}\d])/giu

const refinance = /\b(?:dao no|doi khoan vay|chuyen khoan vay|tai cap von|tai tai tro khoan vay)\b/
const loan = /\b(?:muon vay|can vay|du dinh vay|neu vay|nen vay|ke hoach vay|vay (?:mua\b|tin chap\b|the chap\b|\d))/
const invest = /\b(?:dau tu|quy mo)\b/
const savings = /\b(?:gui tiet kiem|tich luy)\b/
const profile = /\b(?:suc khoe tai chinh|danh gia tai chinh ca nhan)\b/
const alertTopic = /\b(?:canh bao|thu doan|lua dao|scam)\b/
const rateTopic = /\b(?:lai suat|mat bang lai)\b/
const recent = /\b(?:gan day|moi nhat|moi nao|hien nay|hien tai|hom nay|bay gio|dang chu y|moi khong)\b/
const cashInput = /\b(?:luong|thu nhap|chi|chi tieu|chi phi|tra no|tra gop|tiet kiem|de danh)(?: (?:hang|moi|thang|hien|tai|thuc|nhan|sinh|hoat|da|co|cua|toi|minh|la|khoang))*$/
const contributionPrefix = /\b(?:gop|tich luy)(?: (?:them|dinh|ky|hang|moi|thang|la))*$/
const monthlyPrefix = /\b(?:moi thang|hang thang|dinh ky)(?: (?:toi|minh|muon|gop|them|tich|luy|la))*$/

export function copilotIntent(raw: string, domain?: SurveyDomain): CopilotIntent | undefined {
  if (raw.length > 2000) return undefined
  const plain = normalizeVietnamese(raw)
  if (refinance.test(plain)) return 'REFINANCE'
  if (recent.test(plain) && (alertTopic.test(plain) || rateTopic.test(plain))) return 'RADAR'
  if (loan.test(plain)) return 'LOAN'
  if (profile.test(plain)) return 'PROFILE'
  if (invest.test(plain)) return 'INVEST'
  if (savings.test(plain)) return 'SAVINGS'
  if (domain) return domain
  const stated = copilotProfileAmounts(raw)
  if (stated.monthlyIncomeVnd != null || [stated.monthlyExpenseVnd, stated.existingDebtPaymentVnd, stated.liquidSavingsVnd].filter(value => value != null).length >= 2) {
    return 'PROFILE'
  }
}

export function copilotProfileAmounts(raw: string): FinancialHealthRequest {
  // Natural profile parsing uses clause boundaries to ignore unrelated amounts.
  return parseNaturalProfile(raw
    .replace(/\bchi(?=\s+\d)/giu, 'chi tiêu')
    .replace(/(?<!dư )\bnợ (?=(?:mỗi|hằng|hàng) tháng|\d)/giu, 'trả nợ ')
    .replace(/\s+((?:muốn|cần|định) vay|muốn đầu tư|góp thêm)\b/giu, ', $1'))
}

const single = <T,>(values: T[]) => values.length === 1 ? values[0] : undefined

export function copilotAmounts(raw: string, intent: CopilotIntent, slots: ExtractedSlots) {
  const amounts = [...raw.matchAll(amountToken)].flatMap(match => {
    const value = parseVnd(match)
    if (value == null) return []
    const prefix = normalizeVietnamese(raw.slice(Math.max(0, match.index - 100), match.index))
    const suffix = raw.slice(match.index + match[0].length, match.index + match[0].length + 24)
    const investment = intent === 'INVEST' || intent === 'SAVINGS'
    const contribution = investment && (monthlyPrefix.test(prefix) ||
      (/^\s*(?:\/\s*tháng\b|mỗi tháng\b|hàng tháng\b)/iu.test(suffix) && contributionPrefix.test(prefix)))
    const unclassifiedContribution = investment && !contribution && /\bgop(?: them)?$/.test(prefix)
    const primary = intent === 'LOAN' ? /\bvay(?: (?:them|tien|mua|nha|xe|von|khoang|la|tin|chap|the))*$/.test(prefix)
      : intent === 'REFINANCE' ? /\b(?:du no|goc|con no|no goc)(?: (?:con|lai|la|hien|tai|khoang))*$/.test(prefix)
        : /\b(?:dau tu|gui|von|ban dau|tich luy|tiet kiem)(?: (?:ban|dau|khoang|la))*$/.test(prefix)
    return [{ value, contribution, unclassifiedContribution, primary, isProfile: cashInput.test(prefix) && !primary }]
  })
  if (amounts.some(item => item.unclassifiedContribution) || amounts.filter(item => item.contribution).length > 1) {
    return { amount: undefined, contribution: undefined, term: undefined }
  }
  const candidates = amounts.filter(item => !item.isProfile && !item.contribution)
  const primary = candidates.filter(item => item.primary)
  const amount = single(primary.length ? primary : candidates)?.value ?? (candidates.length ? undefined : slots.amountVnd)
  const contribution = single(amounts.filter(item => item.contribution))?.value
  const terms = [...raw.matchAll(termToken)].map(match =>
    Number(match[1]) * (normalizeVietnamese(match[2]) === 'nam' ? 12 : 1))
  const term = SurveyTermMonthsSchema.safeParse(single(terms) ?? (terms.length ? undefined : slots.termMonths)).data
  return { amount, contribution, term }
}

export function copilotLoanUseCase(raw: string): LoanUseCase | undefined {
  const plain = normalizeVietnamese(raw)
  if (/\b(?:mua nha|mua can ho)\b/.test(plain)) return 'HOME_MORTGAGE'
  if (/\b(?:mua xe|mua o to)\b/.test(plain)) return 'AUTO_LOAN'
  if (/\b(?:vay von kinh doanh|bo sung von)\b/.test(plain)) return 'BUSINESS_WORKING_CAPITAL'
  if (/\b(?:tin chap|theo luong)\b/.test(plain)) return 'UNSECURED_SALARY'
}

export function copilotLoanGoal(raw: string) {
  const useCase = copilotLoanUseCase(raw)
  if (!useCase) return undefined
  const labels: Record<LoanUseCase, string> = {
    HOME_MORTGAGE: 'Vay mua nhà',
    AUTO_LOAN: 'Vay mua xe',
    BUSINESS_WORKING_CAPITAL: 'Vay vốn kinh doanh',
    UNSECURED_SALARY: 'Vay tín chấp theo lương',
    CONSUMER_FLAT_INSTALLMENT: 'Vay trả góp tiêu dùng',
  }
  return labels[useCase]
}

export function copilotRefinanceRates(raw: string) {
  const rates = [...raw.matchAll(rateToken)].map(match => {
    const prefix = normalizeVietnamese(raw.slice(Math.max(0, match.index - 70), match.index))
    const suffix = normalizeVietnamese(raw.slice(match.index + match[0].length, match.index + match[0].length + 20))
    const rate = new Decimal(match[0].replace(/\s*%.*/, '').replace(',', '.'))
    const isFee = /\b(?:phi tat toan|phi tra no truoc han)(?: la)?$/.test(prefix)
    const monthly = !isFee && (/thang$/.test(normalizeVietnamese(match[0])) || /^(?:moi )?thang\b/.test(suffix))
    return {
      rate: rate.times(monthly ? 12 : 1).toFixed(), isFee,
      current: /\b(?:lai(?: suat)? (?:hien tai|dang tra|cu)|dang tra)(?: la)?$/.test(prefix) || /^hien tai\b/.test(suffix),
    }
  })
  const nonFees = rates.filter(item => !item.isFee)
  const current = nonFees.filter(item => item.current)
  return {
    rate: single(current.length ? current : nonFees)?.rate,
    exitFee: single(rates.filter(item => item.isFee))?.rate ?? '0',
  }
}
