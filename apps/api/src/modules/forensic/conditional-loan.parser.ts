import Decimal from 'decimal.js'
import type { LoanRatePhase, LoanScheduleSpec, RepaymentMethod } from './cashflow-loan.engine'
import { normalizeVietnamese } from './data/trusted-institutions'

const Precise = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP })
const rateText = String.raw`(\d{1,3}(?:[.,]\d{1,4})?)\s*%\s*(?:\/|mỗi|một|theo)\s*tháng`
const rate = new RegExp(rateText, 'iu')
const amountText = String.raw`(\d{1,16}(?:(?:[.,\u00a0 ]\d{3})+(?!\d))?(?:[.,]\d{1,2})?)\s*(triệu|nghìn|ngàn|VNĐ|VND|đồng|đ|₫|%)`
const amount = new RegExp(amountText, 'iu')
const principalQuote = new RegExp(String.raw`(?:khoản vay|số tiền vay|tiền gốc|gốc danh nghĩa)\s*(?:là\s*|[:=]\s*)?` + amountText, 'iu')
const termPattern = /(?:kỳ hạn|thời hạn|trong)\s*[:=]?\s*(\d{1,3})\s*tháng/iu
const recurring = /phí\s+(?:quản lý|dịch vụ|duy trì)/iu
const upfront = /phí\s+(?:(?:thu|trừ|khấu trừ)\s+)?(?:trước|giữ lại|ban đầu)/iu
const insurance = /(?:bảo hiểm[^.!?;\n]{0,100}(?:bắt buộc|trừ trước|khấu trừ)|(?:bắt buộc|phải mua|yêu cầu mua|ép mua)[^.!?;\n]{0,80}bảo hiểm)/iu
const floating = /thả nổi|đơn phương (?:thay đổi|điều chỉnh) lãi(?:\s+suất)?/iu
const capped = /(?:trần(?: lãi suất)?|lãi(?: suất)?\s+(?:tối đa|không vượt(?: quá)?))\s*[:=]?\s*\d+(?:[.,]\d+)?\s*%/iu
const variable = /(?:lãi(?: suất)?\s+)?thả nổi|(?:tăng|đổi|điều chỉnh)\s+(?:mức\s+)?lãi(?: suất)?|(?:các\s+)?tháng\s+còn lại/iu
const trigger = /(?:trễ|chậm|quá)\s+hạn[^.;!?\n]{0,100}?(?:mất|hủy|thu hồi)\s+(?:mức lãi\s+)?ưu đãi|hồi tố(?:\s+lãi(?:\s+suất)?)?/iu

export interface ConditionalLoanEvidence {
  spec: LoanScheduleSpec | null
  conditionalQuote?: string
  floatingQuote?: string
  insuranceQuote?: string
}

function phrases(text: string) {
  return text.split(/\n+|[;!?]|(?<=\.)\s+/u).map((phrase) => phrase.trim()).filter(Boolean)
}

function amountValue(match: RegExpMatchArray | null, principal?: Decimal) {
  if (!match) return null
  const [, digits, unit] = match
  const value = /^\d{1,3}(?:[.,\u00a0 ]\d{3})+$/u.test(digits)
    ? digits.replace(/[.,\s]/g, '') : digits.replace(/[ \u00a0]/g, '').replace(',', '.')
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(value)) return null
  const decimal = new Precise(value)
  if (unit === '%') return principal?.mul(decimal).div(100) ?? null
  return decimal.mul(/^triệu$/iu.test(unit) ? '1000000' : /^(?:nghìn|ngàn)$/iu.test(unit) ? '1000' : '1')
}

const rateValue = (quote: string) => quote.match(rate)?.[1].replace(',', '.')
function definesMethod(text: string): RepaymentMethod | null {
  const normalized = normalizeVietnamese(text)
  if (/\b(?:du no giam dan|du no con lai|du no thuc te)\b/.test(normalized)) {
    return /\b(?:tra gop deu|khoan tra deu|tra deu hang thang|niem kim)\b/.test(normalized)
      ? 'DECLINING_ANNUITY' : 'DECLINING_EQUAL_PRINCIPAL'
  }
  return /\b(?:lai phang|du no ban dau|goc ban dau)\b/.test(normalized) ? 'FLAT' : null
}

const phasesPattern = new RegExp(
  String.raw`(?:(\d{1,3})\s*tháng\s*(đầu|sau|tiếp(?: theo)?)|((?:các\s+)?tháng\s+còn lại)|tháng\s*(\d{1,3})\s*(?:[–—-]|đến)\s*(\d{1,3}))[^%.,;\n]{0,85}?` + rateText, 'giu',
)

function parsePhases(text: string, term: number | null, stressQuote?: string) {
  const phases: LoanRatePhase[] = []
  let next = 1
  for (const quote of phrases(text)) {
    if (quote === stressQuote) continue
    for (const match of quote.matchAll(phasesPattern)) {
      const [evidenceQuote, count, position, remaining, start, end, value] = match
      const fromMonth = start ? Number(start) : /^đầu$/iu.test(position ?? '') ? 1 : next
      const toMonth = end ? Number(end) : remaining ? term : fromMonth + Number(count) - 1
      if (toMonth === null) continue
      phases.push({ fromMonth, toMonth, monthlyRatePct: value.replace(',', '.'), evidenceQuote })
      next = toMonth + 1
    }
  }
  return phases
}

export function inspectConditionalLoan(text: string): ConditionalLoanEvidence {
  const clauses = phrases(text)
  const insuranceQuote = clauses.find((quote) => insurance.test(quote))
  const floatingQuote = capped.test(text) ? undefined : clauses.find((quote) => floating.test(quote))
  const stressQuote = clauses.find((quote) => trigger.test(quote))
  const explicitTerm = Number(text.match(termPattern)?.[1]) || null
  const ratePhases = parsePhases(text, explicitTerm, stressQuote)
  const variableQuote = clauses.find((quote) => variable.test(quote))
  const conditionalQuote = stressQuote ?? (ratePhases.length > 1 ? ratePhases[1].evidenceQuote : variableQuote)
  const feeQuote = clauses.find((quote) => recurring.test(quote) && /(?:\/|mỗi|hằng|hàng)\s*tháng/iu.test(quote))
  const repaymentMethod = definesMethod(text) ?? 'FLAT'
  const evidence = { conditionalQuote, floatingQuote, insuranceQuote, spec: null }
  if (!(conditionalQuote || floatingQuote || insuranceQuote || feeQuote || repaymentMethod !== 'FLAT')) return evidence
  const principal = amountValue(text.match(principalQuote))
  const termMonths = explicitTerm ?? (ratePhases.length > 1 ? ratePhases.at(-1)?.toMonth : null)
  if (!principal?.gt(0) || !termMonths) return evidence

  const initialFees = clauses.flatMap((quote) => {
    const insuranceMatch = quote === insuranceQuote && /(?:trừ trước|khấu trừ)/iu.test(quote)
    const marker = quote.match(insuranceMatch ? /bảo hiểm/iu : upfront)
    return marker?.index === undefined ? [] : [amountValue(quote.slice(marker.index + marker[0].length).match(amount), principal)]
  })
  const upfrontFee = initialFees.reduce<Decimal>((sum, fee) => sum.plus(fee ?? 0), new Precise(0))
  const recurringFee = feeQuote ? amountValue(feeQuote.slice(feeQuote.search(recurring)).match(amount), principal) : null
  if (initialFees.some((fee) => fee === null) || (feeQuote && !recurringFee)) return evidence

  if (!ratePhases.length && !floatingQuote && !variableQuote) {
    const fixedQuote = clauses.find((quote) => quote !== stressQuote && !recurring.test(quote)
      && /lãi/iu.test(quote) && rateValue(quote))
    const fixed = fixedQuote && rateValue(fixedQuote)
    if (fixed && fixedQuote) ratePhases.push({ fromMonth: 1, toMonth: termMonths, monthlyRatePct: fixed, evidenceQuote: fixedQuote })
  }
  const stressRate = stressQuote && [...stressQuote.matchAll(new RegExp(rateText, 'giu'))].at(-1)?.[1].replace(',', '.')
  const retroactive = stressQuote && /hồi tố|(?:cả|toàn bộ|suốt)\s+(?:kỳ hạn|\d{1,3}\s*tháng)/iu.test(stressQuote)
  const stressMonths = stressQuote?.match(/(?:cả|toàn bộ|suốt)\s+(\d{1,3})\s*tháng/iu)?.[1]
  return {
    ...evidence,
    spec: {
      principalNominalVnd: principal.toFixed(), upfrontFeeVnd: upfrontFee.toDecimalPlaces(2).toFixed(),
      termMonths, repaymentMethod, ratePhases, recurringFeeVnd: recurringFee?.toDecimalPlaces(2).toFixed(),
      hasUncappedFloatingClause: !!floatingQuote,
      stressScenario: stressRate && stressQuote && retroactive && (!stressMonths || Number(stressMonths) === termMonths) ? {
        monthlyRatePct: stressRate, triggerCondition: stressQuote.match(trigger)?.[0] ?? stressQuote, evidenceQuote: stressQuote,
      } : undefined,
    },
  }
}

export function findConditionalLoanSchedule(text: string) {
  return inspectConditionalLoan(text).spec
}
