import Decimal from 'decimal.js'

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })
export type ScheduleRow = { month: number; paymentVnd: string; principalVnd: string; interestVnd: string; remainingBalanceVnd: string }
const money = (value: Decimal.Value) => new Decimal(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0)
const pct = (value: Decimal.Value, places = 4) => new Decimal(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places)

export type LoanCalculation = { monthlyPaymentVnd: string; totalInterestVnd: string; totalPayableVnd: string; schedule: ScheduleRow[] }
export function reducingBalanceLoan(principal: Decimal.Value, annualRatePct: Decimal.Value, termMonths: number): LoanCalculation {
  const p = new Decimal(principal); const monthlyRate = new Decimal(annualRatePct).div(100).div(12)
  const rawPayment = monthlyRate.isZero() ? p.div(termMonths) : p.mul(monthlyRate).mul(monthlyRate.add(1).pow(termMonths)).div(monthlyRate.add(1).pow(termMonths).sub(1))
  const regularPayment = new Decimal(money(rawPayment)); let balance = p; let totalInterest = new Decimal(0); const schedule: ScheduleRow[] = []
  for (let month = 1; month <= termMonths; month += 1) {
    const interest = balance.mul(monthlyRate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    const principalPaid = month === termMonths ? balance : Decimal.min(regularPayment.sub(interest), balance)
    const payment = month === termMonths ? principalPaid.add(interest) : regularPayment
    balance = balance.sub(principalPaid); totalInterest = totalInterest.add(interest)
    schedule.push({ month, paymentVnd: money(payment), principalVnd: money(principalPaid), interestVnd: money(interest), remainingBalanceVnd: money(balance) })
  }
  return { monthlyPaymentVnd: money(regularPayment), totalInterestVnd: money(totalInterest), totalPayableVnd: money(p.add(totalInterest)), schedule }
}

/** Equal-principal amortisation: principal is constant and interest declines monthly. */
export function decliningPrincipalLoan(principal: Decimal.Value, annualRatePct: Decimal.Value, termMonths: number): LoanCalculation {
  const p = new Decimal(principal); const monthlyRate = new Decimal(annualRatePct).div(100).div(12)
  const principalPart = p.div(termMonths); let balance = p; let totalInterest = new Decimal(0); const schedule: ScheduleRow[] = []
  for (let month = 1; month <= termMonths; month += 1) {
    const interest = balance.mul(monthlyRate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    const principalPaid = month === termMonths ? balance : principalPart.toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    const payment = principalPaid.add(interest); balance = balance.sub(principalPaid); totalInterest = totalInterest.add(interest)
    schedule.push({ month, paymentVnd: money(payment), principalVnd: money(principalPaid), interestVnd: money(interest), remainingBalanceVnd: money(balance) })
  }
  return { monthlyPaymentVnd: schedule[0]?.paymentVnd ?? '0', totalInterestVnd: money(totalInterest), totalPayableVnd: money(p.add(totalInterest)), schedule }
}

function irr(cashflows: Decimal[], guess = new Decimal('0.02')) {
  let rate = guess
  for (let i = 0; i < 100; i += 1) {
    let value = cashflows[0]; let derivative = new Decimal(0)
    for (let t = 1; t < cashflows.length; t += 1) { value = value.add(cashflows[t].div(rate.add(1).pow(t))); derivative = derivative.sub(new Decimal(t).mul(cashflows[t]).div(rate.add(1).pow(t + 1))) }
    const next = rate.sub(value.div(derivative)); if (next.sub(rate).abs().lt('1e-14')) return next; rate = next
  }
  return rate
}
export type FlatRateCalculation = { principalNetVnd: string; monthlyPaymentVnd: string; totalPayableVnd: string; monthlyIrr: string; effectiveAprPct: string; effectiveEarPct: string }
export function flatRateLoan(principalNominal: Decimal.Value, upfrontFee: Decimal.Value, flatMonthlyRatePct: Decimal.Value, termMonths: number): FlatRateCalculation {
  const nominal = new Decimal(principalNominal); const net = nominal.sub(upfrontFee); const payment = nominal.div(termMonths).add(nominal.mul(flatMonthlyRatePct).div(100)); const roundedPayment = new Decimal(money(payment)); const monthlyIrr = irr([net, ...Array.from({ length: termMonths }, () => roundedPayment.neg())])
  return { principalNetVnd: money(net), monthlyPaymentVnd: money(roundedPayment), totalPayableVnd: money(roundedPayment.mul(termMonths)), monthlyIrr: monthlyIrr.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8), effectiveAprPct: pct(monthlyIrr.mul(12).mul(100)), effectiveEarPct: pct(monthlyIrr.add(1).pow(12).sub(1).mul(100)) }
}

export type DtiAssessment = { dtiPct: string; disposableVnd: string; riskBand: 'SAFE' | 'MODERATE' | 'HIGH_PRESSURE' | 'CRITICAL_OVERLOAD' }
export function assessDti(monthlyIncome: Decimal.Value, monthlyExpense: Decimal.Value, existingDebt: Decimal.Value, newPayment: Decimal.Value): DtiAssessment {
  const income = new Decimal(monthlyIncome); const debt = new Decimal(existingDebt).add(newPayment); const ratio = income.isZero() ? new Decimal(100) : debt.div(income).mul(100); const riskBand = ratio.lte(35) ? 'SAFE' : ratio.lte(45) ? 'MODERATE' : ratio.lte(50) ? 'HIGH_PRESSURE' : 'CRITICAL_OVERLOAD'
  return { dtiPct: pct(ratio, 2), disposableVnd: money(income.sub(monthlyExpense).sub(debt)), riskBand }
}
export type FundCalculation = { totalContributedVnd: string; grossValueVnd: string; sellFeeVnd: string; taxVnd: string; netValueVnd: string; netProfitVnd: string }
export function compoundDca(initialVnd: Decimal.Value, monthlyContributionVnd: Decimal.Value, termMonths: number, annualReturnPct: Decimal.Value, sellFeePct: Decimal.Value, taxPct: Decimal.Value): FundCalculation {
  const monthlyRate = new Decimal(annualReturnPct).div(100).div(12); let value = new Decimal(initialVnd)
  for (let month = 0; month < termMonths; month += 1) value = value.mul(monthlyRate.add(1)).add(monthlyContributionVnd)
  const contributed = new Decimal(initialVnd).add(new Decimal(monthlyContributionVnd).mul(termMonths)); const gross = new Decimal(money(value)); const sellFee = gross.mul(sellFeePct).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP); const tax = gross.mul(taxPct).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP); const net = gross.sub(sellFee).sub(tax)
  return { totalContributedVnd: money(contributed), grossValueVnd: money(gross), sellFeeVnd: money(sellFee), taxVnd: money(tax), netValueVnd: money(net), netProfitVnd: money(net.sub(contributed)) }
}
