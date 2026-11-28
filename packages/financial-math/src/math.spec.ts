import { describe, expect, it } from 'vitest'
import { amortizeLoan, assessDti, compoundDca, decliningPrincipalLoan, effectiveLoanApr, effectiveLoanEarFromApr, flatRateLoan, openFundScenarioBands, reducingBalanceLoan, simulateEarlySettlement, simulateRefinanceBreakEven, summarizeAmortizationForChart } from './index'

describe('effective annual rate from monthly compounding', () => {
  it.each([
    ['0', '0.0000'],
    ['12', '12.6825'],
    ['14.5', '15.5035'],
    ['16', '17.2271'],
    ['0.00005', '0.0001'],
  ])('converts %s%% nominal APR to %s%% EAR', (apr, expected) => {
    expect(effectiveLoanEarFromApr(apr)).toBe(expected)
  })
})

describe('Refinance with Decimal cash flows', () => {
  const contract = {
    remainingPrincipalVnd: '12000000', remainingTermMonths: 12, currentAnnualRatePct: '24', currentCalcMethod: 'FLAT_RATE',
    earlySettlementFeePct: '0', newAnnualRatePct: '12', newCalcMethod: 'DECLINING_PRINCIPAL',
  } as const

  it('compares a flat loan with declining principal and counts the terminal cash flows', () => {
    const result = simulateRefinanceBreakEven({ ...contract, newMonthlyFeeVnd: '10000' })
    expect(result).toMatchObject({
      currentMonthlyPaymentVnd: '1240000', currentTotalRemainingPayableVnd: '14880000',
      earlySettlementPenaltyVnd: '0', newMonthlyPaymentVnd: '1130000', newTotalPayableVnd: '12900000',
      monthlySavingsVnd: '110000', netSavingsVnd: '1980000', breakEvenMonth: 1, recommendation: 'WORTH_REFINANCING',
    })
    expect(result.comparisonPoints.at(-1)).toEqual({ month: 12, currentCumulativeVnd: '14880000', refinanceCumulativeVnd: '12900000' })
  })

  it('keeps flat interest on the original principal after some principal has been repaid', () => {
    const result = simulateRefinanceBreakEven({ ...contract, remainingPrincipalVnd: '6000000',
      remainingTermMonths: 6, currentFlatInterestBaseVnd: '12000000' })
    expect(result).toMatchObject({ currentMonthlyPaymentVnd: '1240000', currentTotalRemainingPayableVnd: '7440000' })
  })

  it('keeps an expensive current exit even when the advertised new rate is lower', () => {
    expect(simulateRefinanceBreakEven({ ...contract, earlySettlementFeePct: '25', newUpfrontFeeRatePct: '0.2' })).toMatchObject({
      earlySettlementPenaltyVnd: '3000000', newUpfrontFeeVnd: '24000', totalSwitchCostVnd: '3024000',
      breakEvenMonth: null, netSavingsVnd: '-924000', recommendation: 'KEEP_CURRENT',
    })
  })

  it('finds the first improving month from actual variable payments and retains it when sampling', () => {
    const result = simulateRefinanceBreakEven({ ...contract, remainingTermMonths: 60, earlySettlementFeePct: '2', newUpfrontFeeRatePct: '1' })
    expect(result.breakEvenMonth).toBe(3)
    const crossing = result.comparisonPoints.find((point) => point.month === 3)
    expect(crossing).toEqual({ month: 3, currentCumulativeVnd: '1320000', refinanceCumulativeVnd: '1314000' })
    const long = simulateRefinanceBreakEven({ ...contract, remainingTermMonths: 600, newTermMonths: 480 })
    expect(long.comparisonPoints.length).toBeLessThanOrEqual(36)
    expect(long.comparisonPoints.at(-1)?.month).toBe(600)
  })

  it('handles exactly equal zero-rate contracts and changes in term length', () => {
    const zero = { ...contract, currentAnnualRatePct: '0', newAnnualRatePct: '0' }
    expect(simulateRefinanceBreakEven(zero)).toMatchObject({ breakEvenMonth: null, netSavingsVnd: '0', recommendation: 'KEEP_CURRENT' })
    expect(simulateRefinanceBreakEven({ ...zero, newTermMonths: 18 })).toMatchObject({ breakEvenMonth: null, netSavingsVnd: '0' })
  })
})

describe('Survey cash flows', () => {
  it('adds principal and penalty to the last payment of the shortened schedule', () => {
    const { schedule } = amortizeLoan('12000000', '12', 12, 'DECLINING_PRINCIPAL', { monthlyFeeVnd: '20000' })
    const exit = simulateEarlySettlement('11800000', schedule, 3, '2')
    expect(exit).toEqual({
      month: 3, remainingPrincipalVnd: '9000000', penaltyFeeVnd: '180000',
      totalPaidUntilExitVnd: '12570000',
      effectiveAprAtExitPct: effectiveLoanApr('11800000', [
        schedule[0], schedule[1], { ...schedule[2], paymentVnd: '10300000' },
      ]),
    })
  })

  it('reconciles a settlement at maturity and rejects an out-of-range month', () => {
    const loan = reducingBalanceLoan('12000000', '9', 12)
    expect(simulateEarlySettlement('12000000', loan.schedule, 12, '2')).toMatchObject({
      penaltyFeeVnd: '0', remainingPrincipalVnd: '0', totalPaidUntilExitVnd: loan.totalPayableVnd,
    })
    expect(() => simulateEarlySettlement('12000000', loan.schedule, 0, '2')).toThrow(RangeError)
    expect(() => simulateEarlySettlement('12000000', loan.schedule, 13, '2')).toThrow(RangeError)
    expect(() => simulateEarlySettlement('12000000', loan.schedule, 1, '-1')).toThrow(RangeError)
  })

  it('models three NAV bands with the same fees and cash contributions', () => {
    const options = { effectiveAnnualYield: true, redemptionFeeTiers: [{ throughMonths: 12, ratePct: '1' }] }
    const bands = openFundScenarioBands('20000000', '1000000', 12, '3', '0', '0.1', options)
    expect(bands.conservative.annualReturnPct).toBe('1')
    expect(bands.base).toEqual({ annualReturnPct: '3', ...compoundDca('20000000', '1000000', 12, '3', '0', '0.1', options) })
    expect(bands.optimistic.annualReturnPct).toBe('6.5')
    expect(BigInt(bands.optimistic.netValueVnd)).toBeGreaterThan(BigInt(bands.base.netValueVnd))
    expect(BigInt(bands.base.netValueVnd)).toBeGreaterThan(BigInt(bands.conservative.netValueVnd))
  })

  it('keeps 36 monthly points and aligns stress payments by month', () => {
    const loan = reducingBalanceLoan('36000000', '12', 36)
    const stress = reducingBalanceLoan('36000000', '14', 36)
    const summary = summarizeAmortizationForChart(loan.schedule, stress.schedule)
    expect(summary).toHaveLength(36)
    expect(summary[0]).toMatchObject({ ...loan.schedule[0], stressPaymentVnd: stress.schedule[0].paymentVnd })
    expect(summarizeAmortizationForChart([])).toEqual([])
  })

  it('sums yearly cash flows and takes the closing balance for a partial year', () => {
    const loan = amortizeLoan('37000000', '12', 37, 'DECLINING_PRINCIPAL', { monthlyFeeVnd: '10000' })
    const stress = decliningPrincipalLoan('37000000', '14', 37)
    const summary = summarizeAmortizationForChart(loan.schedule, stress.schedule)
    expect(summary.map(({ month }) => month)).toEqual([12, 24, 36, 37])
    expect(summary[0]).toMatchObject({ principalVnd: '12000000', feeVnd: '120000', remainingBalanceVnd: '25000000' })
    expect(summary[0].stressPaymentVnd).toBe(stress.schedule.slice(0, 12).reduce((sum, row) => sum + BigInt(row.paymentVnd), 0n).toString())
    expect(summary.reduce((sum, row) => sum + BigInt(row.paymentVnd), 0n).toString()).toBe(loan.totalPayableVnd)
    expect(summary.at(-1)).toMatchObject({ ...loan.schedule[36], stressPaymentVnd: stress.schedule[36].paymentVnd })
  })
})

it.each([reducingBalanceLoan, decliningPrincipalLoan])('reconciles a rounded 600-month schedule', (calculate) => {
  const result = calculate('100000', '0', 600)
  expect(result.schedule).toHaveLength(600)
  for (const row of result.schedule) {
    expect(BigInt(row.remainingBalanceVnd)).toBeGreaterThanOrEqual(0n)
    expect(BigInt(row.principalVnd)).toBeGreaterThanOrEqual(0n)
    expect(BigInt(row.paymentVnd)).toBe(BigInt(row.principalVnd) + BigInt(row.interestVnd))
  }
  expect(result.schedule.at(-1)?.remainingBalanceVnd).toBe('0')
  expect(result.schedule.reduce((sum, row) => sum + BigInt(row.principalVnd), 0n)).toBe(100000n)
  expect(result.schedule.reduce((sum, row) => sum + BigInt(row.paymentVnd), 0n).toString()).toBe(result.totalPayableVnd)
})

it('reports DTI as unavailable if there is no positive income', () => {
  expect(assessDti('0', '100', '0', '200')).toEqual({ dtiPct: null, disposableVnd: '-300', riskBand: 'UNAVAILABLE' })
})

describe('Financial math golden vectors', () => {
  it('V1 - reducing balance EMI', () => {
    const r = reducingBalanceLoan('50000000', '14.5', 24)
    expect(r.monthlyPaymentVnd).toBe('2412471'); expect(r.totalInterestVnd).toBe('7899316'); expect(r.totalPayableVnd).toBe('57899316')
    expect(r.schedule[0]).toEqual({ month: 1, paymentVnd: '2412471', principalVnd: '1808304', interestVnd: '604167', remainingBalanceVnd: '48191696' })
    expect(r.schedule[23]).toEqual({ month: 24, paymentVnd: '2412483', principalVnd: '2383680', interestVnd: '28803', remainingBalanceVnd: '0' })
  })
  it('V2 - flat rate APR and EAR', () => { const r = flatRateLoan('50000000', '5000000', '0.9', 24); expect(r).toMatchObject({ principalNetVnd: '45000000', monthlyPaymentVnd: '2533333', totalPayableVnd: '60799992' }); expect(Number(r.effectiveAprPct)).toBeCloseTo(30.7436, 3); expect(Number(r.effectiveEarPct)).toBeCloseTo(35.4678, 3) })
  it('equal principal amortisation has declining payments', () => {
    const r = decliningPrincipalLoan('12000000', '12', 12)
    expect(r.schedule[0]).toMatchObject({ paymentVnd: '1120000', principalVnd: '1000000', interestVnd: '120000' })
    expect(r.schedule[11]).toMatchObject({ paymentVnd: '1010000', principalVnd: '1000000', interestVnd: '10000', remainingBalanceVnd: '0' })
  })
  it('V3 - DTI thresholds', () => { expect(assessDti('18000000', '8000000', '2000000', '2412471')).toEqual({ dtiPct: '24.51', disposableVnd: '5587529', riskBand: 'SAFE' }); expect(assessDti('18000000', '8000000', '4600000', '2412471').riskBand).toBe('MODERATE'); expect(assessDti('18000000', '8000000', '6000000', '2412471').riskBand).toBe('HIGH_PRESSURE'); expect(assessDti('18000000', '8000000', '7000000', '2412471').riskBand).toBe('CRITICAL_OVERLOAD') })
  it('V4 - DCA, redemption fee and tax', () => { expect(compoundDca('20000000', '3000000', 24, '10.0', '0.5', '0.1')).toEqual({ totalContributedVnd: '92000000', grossValueVnd: '103748565', sellFeeVnd: '518743', taxVnd: '103749', netValueVnd: '103126073', netProfitVnd: '11126073' }) })
})
