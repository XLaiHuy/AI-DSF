import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import {
  actual365Interest, civilLoanAnnualRateCapPct, compoundDca, criminalLoanAnnualRateScreenPct,
  effectiveLoanApr, effectiveLoanEarFromApr, exceedsOverdueInterestCap, reducingBalanceLoan,
  maxSafeLoanPrincipal, requiredMonthlyContribution, verifyInvestmentCalculation, verifyLoanCalculation,
} from './index'

const within = (actual: Decimal.Value, expected: Decimal.Value, tolerance: Decimal.Value) =>
  expect(new Decimal(actual).sub(expected).abs().lte(tolerance)).toBe(true)

describe('spreadsheet and Vietnam regulatory oracles', () => {
  it('matches Excel PMT, periodic IRR and EFFECT with a 36-month annuity', () => {
    // -PMT(12%/12,36,100000000) = 3321430.981285119.
    const loan = reducingBalanceLoan('100000000', '12', 36)
    within(loan.monthlyPaymentVnd, '3321430.981285119', 1)
    // IRR({-100000000,3321430.981285119,...})*1200 = 12.
    const apr = effectiveLoanApr('100000000', loan.schedule)
    within(apr, '12', '0.0001')
    // EFFECT(12%,12) = 12.6825030132%.
    const ear = effectiveLoanEarFromApr(apr)
    within(ear, '12.6825030132', '0.0001')
    expect(verifyLoanCalculation('100000000', '100000000', loan.schedule, apr, ear).verified).toBe(true)
    expect(verifyLoanCalculation('100000000', '100000000', loan.schedule, '20', ear).verified).toBe(false)
    // PV(12%/12,36,-4000000) = 120430020.149096410.
    within(maxSafeLoanPrincipal('4000000', '12', 36), '120430020.149096410', 1)
  })

  it('matches end-of-month Excel FV and checks the net-value identity', () => {
    // FV(6%/12,36,-3000000,-50000000,0) = 177842341.135222565.
    const result = compoundDca('50000000', '3000000', 36, '6', '0', '0')
    within(result.netValueVnd, '177842341.135222565', 1)
    expect(verifyInvestmentCalculation(result).verified).toBe(true)
    within(requiredMonthlyContribution('177842341', '50000000', 36, '6'), '3000000', 1)
    expect(verifyInvestmentCalculation({ ...result, taxVnd: '1' }).verified).toBe(false)
  })

  it('distinguishes monthly modeling from Actual/365 under TT 14/2017', () => {
    expect(reducingBalanceLoan('100000000', '12', 1).schedule[0].interestVnd).toBe('1000000')
    expect(actual365Interest('100000000', '12', 31)).toBe('1019178')
  })

  it('uses the exact TT 39/2016 cap and civil and criminal reference thresholds', () => {
    expect(exceedsOverdueInterestCap('12', '18')).toBe(false)
    expect(exceedsOverdueInterestCap('12', '18.0001')).toBe(true)
    expect(civilLoanAnnualRateCapPct).toBe('20')
    expect(criminalLoanAnnualRateScreenPct).toBe('100')
  })

  it('taxes only units younger than 24 months at 0.1% in an eligible open fund', () => {
    const options = { taxFreeAfterMonths: 24 }
    expect(compoundDca('10000000', '1000000', 23, 0, 0, '0.1', options).taxVnd).toBe('33000')
    expect(compoundDca('10000000', '1000000', 24, 0, 0, '0.1', options).taxVnd).toBe('24000')
    expect(compoundDca('10000000', 0, 24, 0, 0, '0.1', options).taxVnd).toBe('0')
    expect(compoundDca('10000000', 0, 12, 4, 0, 0).taxVnd).toBe('0')
  })
})
