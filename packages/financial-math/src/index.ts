import Decimal from 'decimal.js'

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })
export type ScheduleRow = { month: number; paymentVnd: string; principalVnd: string; interestVnd: string; remainingBalanceVnd: string; feeVnd?: string }
const money = (value: Decimal.Value) => new Decimal(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0)
const pct = (value: Decimal.Value, places = 4) => new Decimal(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places)

export type LoanCalculation = { monthlyPaymentVnd: string; totalInterestVnd: string; totalPayableVnd: string; schedule: ScheduleRow[] }
export function reducingBalanceLoan(principal: Decimal.Value, annualRatePct: Decimal.Value, termMonths: number): LoanCalculation {
  return amortizeLoan(principal, annualRatePct, termMonths, 'REDUCING_BALANCE')
}

/** Equal-principal amortisation: principal is constant and interest declines monthly. */
export function decliningPrincipalLoan(principal: Decimal.Value, annualRatePct: Decimal.Value, termMonths: number): LoanCalculation {
  return amortizeLoan(principal, annualRatePct, termMonths, 'DECLINING_PRINCIPAL')
}

export function amortizeLoan(
  principal: Decimal.Value, annualRatePct: Decimal.Value, termMonths: number,
  method: 'REDUCING_BALANCE' | 'DECLINING_PRINCIPAL' | 'FLAT_RATE',
  options: { monthlyFeeVnd?: Decimal.Value; flatInterestBaseVnd?: Decimal.Value; laterRate?: { afterMonths: number; annualRatePct: Decimal.Value } } = {},
): LoanCalculation {
  const original = new Decimal(money(principal))
  const monthlyFee = new Decimal(money(options.monthlyFeeVnd ?? 0))
  const flatInterestBase = options.flatInterestBaseVnd == null ? original : new Decimal(money(options.flatInterestBaseVnd))
  const principalPart = new Decimal(money(original.div(termMonths)))
  let balance = original
  let monthlyRate = new Decimal(annualRatePct).div(1200)
  let regularPayment = scheduledPayment(balance, monthlyRate, termMonths)
  let totalInterest = new Decimal(0)
  let totalPayable = new Decimal(0)
  const schedule: ScheduleRow[] = []
  for (let month = 1; month <= termMonths; month += 1) {
    if (options.laterRate && month === options.laterRate.afterMonths + 1) {
      monthlyRate = new Decimal(options.laterRate.annualRatePct).div(1200)
      regularPayment = scheduledPayment(balance, monthlyRate, termMonths - month + 1)
    }
    const interestBase = method === 'FLAT_RATE' && balance.gt(0) ? flatInterestBase : balance
    const interest = new Decimal(money(interestBase.mul(monthlyRate)))
    const scheduledPrincipal = method === 'REDUCING_BALANCE' ? regularPayment.sub(interest) : principalPart
    const principalPaid = month === termMonths ? balance : Decimal.min(Decimal.max(scheduledPrincipal, 0), balance)
    const fee = balance.gt(0) ? monthlyFee : new Decimal(0)
    const payment = principalPaid.add(interest).add(fee)
    balance = balance.sub(principalPaid)
    totalInterest = totalInterest.add(interest)
    totalPayable = totalPayable.add(payment)
    schedule.push({ month, paymentVnd: money(payment), principalVnd: money(principalPaid), interestVnd: money(interest),
      remainingBalanceVnd: money(balance), ...(fee.gt(0) ? { feeVnd: money(fee) } : {}) })
  }
  return { monthlyPaymentVnd: schedule[0]?.paymentVnd ?? '0', totalInterestVnd: money(totalInterest), totalPayableVnd: money(totalPayable), schedule }
}

export type RefinanceInput = {
  remainingPrincipalVnd: Decimal.Value
  remainingTermMonths: number
  currentAnnualRatePct: Decimal.Value
  currentCalcMethod?: Parameters<typeof amortizeLoan>[3]
  currentMonthlyFeeVnd?: Decimal.Value
  currentFlatInterestBaseVnd?: Decimal.Value
  earlySettlementFeePct: Decimal.Value
  newAnnualRatePct: Decimal.Value
  newCalcMethod?: Exclude<Parameters<typeof amortizeLoan>[3], 'FLAT_RATE'>
  newUpfrontFeeRatePct?: Decimal.Value
  newMonthlyFeeVnd?: Decimal.Value
  newTermMonths?: number
  newLaterRate?: NonNullable<Parameters<typeof amortizeLoan>[4]>['laterRate']
}

export function simulateRefinanceBreakEven(input: RefinanceInput) {
  const { remainingTermMonths, earlySettlementFeePct, newUpfrontFeeRatePct = '0', newTermMonths = remainingTermMonths } = input
  const principal = new Decimal(money(input.remainingPrincipalVnd))
  const decimals = [input.currentAnnualRatePct, input.newAnnualRatePct, earlySettlementFeePct, newUpfrontFeeRatePct,
    input.currentMonthlyFeeVnd ?? '0', input.newMonthlyFeeVnd ?? '0', input.newLaterRate?.annualRatePct ?? '0'].map((value) => new Decimal(value))
  const flatBase = new Decimal(money(input.currentFlatInterestBaseVnd ?? principal))
  const horizon = Math.max(remainingTermMonths, newTermMonths)
  if (!principal.isFinite() || !principal.gt(0) || !flatBase.isFinite() || flatBase.lt(principal) || decimals.some((value) => !value.isFinite() || value.lt(0))
    || [remainingTermMonths, newTermMonths].some((term) => !Number.isInteger(term) || term < 1 || term > 600)) {
    throw new RangeError('Thông số khoản vay ngoài phạm vi tính toán.')
  }

  const current = amortizeLoan(principal, input.currentAnnualRatePct, remainingTermMonths, input.currentCalcMethod ?? 'REDUCING_BALANCE', {
    monthlyFeeVnd: input.currentMonthlyFeeVnd, flatInterestBaseVnd: flatBase,
  })
  const next = amortizeLoan(principal, input.newAnnualRatePct, newTermMonths, input.newCalcMethod ?? 'REDUCING_BALANCE', {
    monthlyFeeVnd: input.newMonthlyFeeVnd, laterRate: input.newLaterRate,
  })
  const earlyPenalty = new Decimal(money(principal.mul(earlySettlementFeePct).div(100)))
  const newUpfrontFee = new Decimal(money(principal.mul(newUpfrontFeeRatePct).div(100)))
  const switchCost = earlyPenalty.add(newUpfrontFee)
  const netSavings = new Decimal(current.totalPayableVnd).sub(next.totalPayableVnd).sub(switchCost)
  const interval = horizon <= 35 ? 1 : 12 * Math.ceil(horizon / (12 * 33))
  const comparisonPoints = [{ month: 0, currentCumulativeVnd: '0', refinanceCumulativeVnd: money(switchCost) }]
  let currentPaid = new Decimal(0)
  let refinancePaid = switchCost
  let breakEvenMonth: number | null = null
  for (let month = 1; month <= horizon; month += 1) {
    currentPaid = currentPaid.add(current.schedule[month - 1]?.paymentVnd ?? '0')
    refinancePaid = refinancePaid.add(next.schedule[month - 1]?.paymentVnd ?? '0')
    const crosses = netSavings.gt(0) && breakEvenMonth === null && currentPaid.gte(refinancePaid)
    if (crosses) breakEvenMonth = month
    if (month % interval === 0 || month === horizon || crosses) {
      comparisonPoints.push({ month, currentCumulativeVnd: money(currentPaid), refinanceCumulativeVnd: money(refinancePaid) })
    }
  }

  const recommendation = netSavings.lte(0) ? 'KEEP_CURRENT' : netSavings.lt(principal.div(100)) ? 'MARGINAL' : 'WORTH_REFINANCING'
  return {
    currentMonthlyPaymentVnd: current.monthlyPaymentVnd, currentTotalRemainingPayableVnd: current.totalPayableVnd,
    earlySettlementPenaltyVnd: money(earlyPenalty), newUpfrontFeeVnd: money(newUpfrontFee), totalSwitchCostVnd: money(switchCost),
    newMonthlyPaymentVnd: next.monthlyPaymentVnd, newTotalPayableVnd: next.totalPayableVnd,
    monthlySavingsVnd: money(new Decimal(current.monthlyPaymentVnd).sub(next.monthlyPaymentVnd)),
    breakEvenMonth, netSavingsVnd: money(netSavings), recommendation, comparisonPoints,
  } as const
}

function scheduledPayment(balance: Decimal, monthlyRate: Decimal, months: number) {
  if (monthlyRate.isZero()) return new Decimal(money(balance.div(months)))
  const factor = monthlyRate.add(1).pow(months)
  return new Decimal(money(balance.mul(monthlyRate).mul(factor).div(factor.sub(1))))
}

/** Nominal annualized IRR for one net disbursement followed by repayments. */
export function effectiveLoanApr(principalNet: Decimal.Value, schedule: readonly ScheduleRow[]): string {
  const net = new Decimal(principalNet)
  if (!net.gt(0)) throw new RangeError('Net disbursement must be positive')
  const payments = schedule.map(({ paymentVnd }) => new Decimal(paymentVnd))
  if (payments.reduce((total, payment) => total.add(payment), new Decimal(0)).lte(net)) return '0.0000'
  const presentValue = (monthlyRate: Decimal) => {
    const discount = monthlyRate.plus(1)
    let value = new Decimal(0)
    for (let index = payments.length - 1; index >= 0; index -= 1) value = value.add(payments[index]).div(discount)
    return value
  }
  let low = new Decimal(0)
  let high = Decimal.sum(...payments).div(net)
  for (let iteration = 0; iteration < 128 && high.sub(low).gt('0.00000000001'); iteration += 1) {
    const middle = low.add(high).div(2)
    if (presentValue(middle).gt(net)) low = middle
    else high = middle
  }
  return pct(low.add(high).mul(600))
}

/** Pays the scheduled installment first, then closes the outstanding balance that month. */
export function simulateEarlySettlement(
  principalNet: Decimal.Value, schedule: readonly ScheduleRow[], settleAtMonth: number, feePct: Decimal.Value,
) {
  if (!Number.isInteger(settleAtMonth) || settleAtMonth < 1 || settleAtMonth > schedule.length) {
    throw new RangeError('Settlement month must be within the loan term')
  }
  const feeRate = new Decimal(feePct)
  if (!feeRate.isFinite() || feeRate.lt(0)) throw new RangeError('Settlement fee must be nonnegative')
  const scheduled = schedule[settleAtMonth - 1]
  const remainingPrincipal = new Decimal(scheduled.remainingBalanceVnd)
  const penaltyFeeVnd = money(remainingPrincipal.mul(feeRate).div(100))
  const exitPayment = new Decimal(scheduled.paymentVnd).add(remainingPrincipal).add(penaltyFeeVnd)
  const shortened = [...schedule.slice(0, settleAtMonth - 1), { ...scheduled, paymentVnd: money(exitPayment) }]
  return {
    month: settleAtMonth,
    penaltyFeeVnd,
    remainingPrincipalVnd: money(remainingPrincipal),
    totalPaidUntilExitVnd: money(Decimal.sum(...shortened.map(({ paymentVnd }) => paymentVnd))),
    effectiveAprAtExitPct: effectiveLoanApr(principalNet, shortened),
  }
}

export function summarizeAmortizationForChart(schedule: readonly ScheduleRow[], stressSchedule?: readonly ScheduleRow[]) {
  const stressByMonth = new Map(stressSchedule?.map(({ month, paymentVnd }) => [month, paymentVnd]))
  const points: (ScheduleRow & { stressPaymentVnd?: string })[] = []
  const step = schedule.length <= 36 ? 1 : 12
  for (let start = 0; start < schedule.length; start += step) {
    const bucket = schedule.slice(start, start + step)
    const closing = bucket[bucket.length - 1]
    const sum = (key: 'paymentVnd' | 'principalVnd' | 'interestVnd' | 'feeVnd') =>
      money(Decimal.sum(...bucket.map((row) => row[key] ?? 0)))
    const stress = bucket.map(({ month }) => stressByMonth.get(month))
    points.push({
      ...closing,
      ...(step > 1 ? { paymentVnd: sum('paymentVnd'), principalVnd: sum('principalVnd'),
        interestVnd: sum('interestVnd'), feeVnd: sum('feeVnd') } : {}),
      ...(stress.every((value) => value !== undefined) ? { stressPaymentVnd: money(Decimal.sum(...stress)) } : {}),
    })
  }
  return points
}

export function repaymentCostAbovePrincipal(totalPayable: Decimal.Value, principal: Decimal.Value) {
  return money(Decimal.max(0, new Decimal(totalPayable).sub(principal)))
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

export type DtiAssessment = { dtiPct: string | null; disposableVnd: string; riskBand: 'SAFE' | 'MODERATE' | 'HIGH_PRESSURE' | 'CRITICAL_OVERLOAD' | 'UNAVAILABLE' }
export function assessDti(monthlyIncome: Decimal.Value, monthlyExpense: Decimal.Value, existingDebt: Decimal.Value, newPayment: Decimal.Value): DtiAssessment {
  const income = new Decimal(monthlyIncome)
  const debt = new Decimal(existingDebt).add(newPayment)
  const disposableVnd = money(income.sub(monthlyExpense).sub(debt))
  if (income.lte(0)) return { dtiPct: null, disposableVnd, riskBand: 'UNAVAILABLE' }
  const ratio = debt.div(income).mul(100)
  const riskBand = ratio.lte(35) ? 'SAFE' : ratio.lte(45) ? 'MODERATE' : ratio.lte(50) ? 'HIGH_PRESSURE' : 'CRITICAL_OVERLOAD'
  return { dtiPct: pct(ratio, 2), disposableVnd, riskBand }
}
export type FundCalculation = { totalContributedVnd: string; grossValueVnd: string; sellFeeVnd: string; taxVnd: string; netValueVnd: string; netProfitVnd: string }
export type RedemptionFeeTier = { throughMonths: number; ratePct: string }
export type FundOptions = { redemptionFeeTiers?: RedemptionFeeTier[]; effectiveAnnualYield?: boolean; taxFreeAfterMonths?: number }
export function compoundDca(initialVnd: Decimal.Value, monthlyContributionVnd: Decimal.Value, termMonths: number, annualReturnPct: Decimal.Value, sellFeePct: Decimal.Value, taxPct: Decimal.Value, options?: FundOptions): FundCalculation {
  const annualRate = new Decimal(annualReturnPct).div(100)
  const growth = options?.effectiveAnnualYield ? annualRate.add(1).pow(new Decimal(1).div(12)) : annualRate.div(12).add(1)
  let value = new Decimal(initialVnd)
  for (let month = 0; month < termMonths; month += 1) value = value.mul(growth).add(monthlyContributionVnd)
  const contributed = new Decimal(initialVnd).add(new Decimal(monthlyContributionVnd).mul(termMonths))
  const gross = new Decimal(money(value))
  let rawSellFee = gross.mul(sellFeePct).div(100)
  let taxableValue = gross
  if (options?.redemptionFeeTiers || options?.taxFreeAfterMonths !== undefined) {
    if (options.redemptionFeeTiers) rawSellFee = new Decimal(0)
    if (options.taxFreeAfterMonths !== undefined) taxableValue = new Decimal(0)
    let contribution = new Decimal(monthlyContributionVnd)
    for (let age = 0; age <= termMonths; age += 1) {
      const tier = options.redemptionFeeTiers?.find(({ throughMonths }) => age <= throughMonths)
      const lot = age === termMonths ? new Decimal(initialVnd).mul(growth.pow(age)) : contribution
      if (tier) rawSellFee = rawSellFee.add(lot.mul(tier.ratePct).div(100))
      if (options.taxFreeAfterMonths !== undefined && age < options.taxFreeAfterMonths) taxableValue = taxableValue.add(lot)
      contribution = contribution.mul(growth)
    }
  }
  const sellFee = new Decimal(money(rawSellFee))
  const tax = new Decimal(money(taxableValue.mul(taxPct).div(100)))
  const net = gross.sub(sellFee).sub(tax)
  return { totalContributedVnd: money(contributed), grossValueVnd: money(gross), sellFeeVnd: money(sellFee), taxVnd: money(tax), netValueVnd: money(net), netProfitVnd: money(net.sub(contributed)) }
}

export function openFundScenarioBands(
  initialVnd: Decimal.Value, monthlyContributionVnd: Decimal.Value, termMonths: number,
  baseRatePct: Decimal.Value, sellFeePct: Decimal.Value, taxPct: Decimal.Value, options?: FundOptions,
) {
  const base = new Decimal(baseRatePct)
  const calculate = (rate: Decimal) => ({
    annualReturnPct: rate.toFixed(),
    ...compoundDca(initialVnd, monthlyContributionVnd, termMonths, rate, sellFeePct, taxPct, options),
  })
  return {
    conservative: calculate(Decimal.max(1, base.sub('3.5'))),
    base: calculate(base),
    optimistic: calculate(base.add('3.5')),
  }
}
