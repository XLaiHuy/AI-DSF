import Decimal from 'decimal.js'
import type { ForensicAuditResponse } from '@fincopilot/shared-types'
import { loanLegalReference, type EntityLicense } from './loan-legal-reference'

export { findConditionalLoanSchedule } from './conditional-loan.parser'

export type RepaymentMethod = 'FLAT' | 'DECLINING_EQUAL_PRINCIPAL' | 'DECLINING_ANNUITY'
export interface LoanRatePhase {
  fromMonth: number
  toMonth: number
  monthlyRatePct: string
  evidenceQuote: string
  recurringFeeVnd?: string
}
export interface LoanScheduleSpec {
  principalNominalVnd: string
  upfrontFeeVnd: string
  termMonths: number
  repaymentMethod: RepaymentMethod
  ratePhases: readonly LoanRatePhase[]
  recurringFeeVnd?: string
  stressScenario?: { monthlyRatePct: string; triggerCondition: string; evidenceQuote: string }
  hasUncappedFloatingClause?: boolean
}

type MathBreakdown = NonNullable<ForensicAuditResponse['mathBreakdown']>
const Precise = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP })
const moneyPattern = /^\d{1,16}(?:\.\d{1,2})?$/
const ratePattern = /^\d{1,3}(?:\.\d{1,4})?$/

export function solveCashFlowIrr(principalNet: Decimal, payments: readonly Decimal[]): Decimal | null {
  const net = new Precise(principalNet)
  const total = payments.reduce<Decimal>((sum, payment) => sum.plus(payment), new Precise(0))
  if (!net.isFinite() || !net.gt(0) || !payments.length ||
      payments.some((payment) => !payment.isFinite() || payment.lt(0)) || !total.gt(0)) return null
  const tolerance = new Precise('1e-25')
  const relativeAtZero = total.minus(net).div(net)
  if (relativeAtZero.abs().lte(tolerance)) return new Precise(0)
  let lower = relativeAtZero.gt(0) ? new Precise(0) : new Precise(-1)
  let upper = relativeAtZero.gt(0) ? total.div(net) : new Precise(0)
  let rate = lower.plus(upper).div(2)
  for (let iteration = 0; iteration < 180; iteration++) {
    const discount = rate.plus(1)
    let factor = new Precise(1)
    let residual = net.negated()
    let slope = new Precise(0)
    for (let month = 1; month <= payments.length; month++) {
      factor = factor.div(discount)
      const discounted = factor.mul(payments[month - 1])
      residual = residual.plus(discounted)
      slope = slope.minus(discounted.mul(month).div(discount))
    }
    if (residual.abs().div(net).lte(tolerance)) return rate
    if (residual.gt(0)) lower = rate
    else upper = rate
    const next = rate.minus(residual.div(slope))
    const candidate = next.gt(lower) && next.lt(upper) ? next : lower.plus(upper).div(2)
    if (candidate.eq(rate)) return rate
    rate = candidate
  }
  return null
}

function paymentSchedule(spec: LoanScheduleSpec, principal: Decimal, phases: readonly LoanRatePhase[], overrideRate?: string) {
  const principalInstallment = principal.div(spec.termMonths)
  let remaining = principal
  return phases.map((phase, index) => {
    const rate = new Precise(overrideRate ?? phase.monthlyRatePct).div(100)
    const fee = new Precise(phase.recurringFeeVnd ?? spec.recurringFeeVnd ?? '0')
    const periodsLeft = spec.termMonths - phase.fromMonth + 1
    const annuity = rate.isZero() ? remaining.div(periodsLeft) : remaining.mul(rate).div(
      new Precise(1).minus(rate.plus(1).pow(-periodsLeft)),
    )
    const payments: Decimal[] = []
    for (let month = phase.fromMonth; month <= phase.toMonth; month++) {
      const interest = (spec.repaymentMethod === 'FLAT' ? principal : remaining).mul(rate)
      const principalPart = month === spec.termMonths ? remaining
        : spec.repaymentMethod === 'DECLINING_ANNUITY' ? annuity.minus(interest) : principalInstallment
      payments.push(principalPart.plus(interest).plus(fee))
      remaining = remaining.minus(principalPart)
    }
    const summary = {
      label: phases.length === 1 ? 'Toàn kỳ' : index === 0 ? 'Giai đoạn đầu' : 'Giai đoạn ' + (index + 1),
      fromMonth: phase.fromMonth, toMonth: phase.toMonth,
      monthlyPaymentVnd: payments[0].toFixed(0),
      quotedRateLabel: new Precise(overrideRate ?? phase.monthlyRatePct).toFixed() + '%/tháng',
      recurringFeeVnd: fee.toFixed(),
    }
    return { payments, summary }
  })
}

function summarize(net: Decimal, payments: readonly Decimal[], license: EntityLicense) {
  const irr = solveCashFlowIrr(net, payments)
  if (irr === null) return null
  const apr = irr.mul(1200)
  const total = payments.reduce<Decimal>((sum, payment) => sum.plus(payment), new Precise(0)).toDecimalPlaces(0)
  return {
    effectiveAprPct: apr.toFixed(4),
    effectiveEarPct: irr.plus(1).pow(12).minus(1).mul(100).toFixed(4),
    legalReference: loanLegalReference(apr, license),
    minMonthlyPaymentVnd: Precise.min(...payments).toFixed(0),
    maxMonthlyPaymentVnd: Precise.max(...payments).toFixed(0),
    totalPayableVnd: total.toFixed(),
    totalExtraCostVnd: Precise.max(0, total.minus(net)).toFixed(),
  }
}

export function calculateLoanScheduleBreakdown(spec: LoanScheduleSpec, entityLicense?: EntityLicense): MathBreakdown | null {
  if (!Number.isInteger(spec.termMonths) || spec.termMonths < 1 || spec.termMonths > 600 ||
      !moneyPattern.test(spec.principalNominalVnd) || !moneyPattern.test(spec.upfrontFeeVnd) ||
      !moneyPattern.test(spec.recurringFeeVnd ?? '0')) return null
  const principal = new Precise(spec.principalNominalVnd)
  const net = principal.minus(spec.upfrontFeeVnd)
  if (!net.gt(0)) return null
  let nextMonth = 1
  for (const phase of spec.ratePhases) {
    if (phase.fromMonth !== nextMonth || !Number.isInteger(phase.toMonth) || phase.toMonth < phase.fromMonth ||
      phase.toMonth > spec.termMonths || !ratePattern.test(phase.monthlyRatePct) ||
      !moneyPattern.test(phase.recurringFeeVnd ?? '0') || !phase.evidenceQuote.trim()) return null
    nextMonth = phase.toMonth + 1
  }
  const scheduleType = spec.ratePhases.length > 1 ? 'MULTI_PHASE'
    : spec.repaymentMethod === 'FLAT' ? 'FIXED_FLAT' : 'DECLINING_WITH_FEES'
  const common = {
    principalNominalVnd: principal.toFixed(), principalNetVnd: net.toFixed(),
    upfrontFeeVnd: new Precise(spec.upfrontFeeVnd).toFixed(), termMonths: spec.termMonths, scheduleType,
  } as const
  const coverageComplete = nextMonth === spec.termMonths + 1
  const floatingNote = spec.hasUncappedFloatingClause
    ? coverageComplete
      ? 'Chi phí dưới đây dựa trên các mức lãi ghi trong tài liệu. Điều khoản thả nổi không nêu trần có thể làm mức trả thực tế tăng.'
      : 'Tài liệu không xác định đủ mức lãi cho toàn kỳ và không nêu trần điều chỉnh. Cần yêu cầu công thức, kỳ điều chỉnh và mức trần bằng văn bản.'
    : null
  const phases = paymentSchedule(spec, principal, spec.ratePhases)
  const phaseBreakdown = phases.map(({ summary }) => summary)
  if (!coverageComplete) return spec.hasUncappedFloatingClause ? {
    ...common, quotedRateLabel: 'Lãi thả nổi chưa đủ dữ kiện', phaseBreakdown,
    effectiveAprPct: null, effectiveEarPct: null, hasUncappedFloatingClause: true, uncappedFloatingNote: floatingNote,
  } : null

  const base = summarize(net, phases.flatMap(({ payments }) => payments), entityLicense)
  if (!base) return null
  const stress = spec.stressScenario
  const stressTotals = stress?.evidenceQuote.trim() && ratePattern.test(stress.monthlyRatePct)
    ? summarize(net, paymentSchedule(spec, principal, spec.ratePhases, stress.monthlyRatePct).flatMap(({ payments }) => payments), entityLicense)
    : null
  return {
    ...common, ...base, phaseBreakdown,
    quotedRateLabel: phaseBreakdown.length > 1 ? 'Lãi thay đổi theo giai đoạn' : phaseBreakdown[0].quotedRateLabel,
    monthlyPaymentVnd: phaseBreakdown[0].monthlyPaymentVnd,
    hasUncappedFloatingClause: spec.hasUncappedFloatingClause ?? false, uncappedFloatingNote: floatingNote,
    stressScenario: stress && stressTotals ? {
      ...stressTotals, triggerCondition: stress.triggerCondition, evidenceQuote: stress.evidenceQuote,
      extraDeltaOverBaseVnd: Precise.max(0, new Precise(stressTotals.totalPayableVnd).minus(base.totalPayableVnd)).toFixed(),
    } : null,
  }
}
