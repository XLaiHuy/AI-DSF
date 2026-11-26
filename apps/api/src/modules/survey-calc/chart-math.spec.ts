import { describe, expect, it } from 'vitest'
import * as reference from '@fincopilot/financial-math'
import { SurveyLoanRequestSchema } from '@fincopilot/shared-types'
import * as chart from '../../../../web/src/components/charts/chart-math'

describe('browser chart math', () => {
  it('rejects oversized financial input before calculation', () => {
    expect(SurveyLoanRequestSchema.safeParse({ principalVnd: '9'.repeat(65), termMonths: 12,
      productCategory: 'UNSECURED_LOAN', priority: 'LOWEST_APR' }).success).toBe(false)
  })

  it.each([['100.51', '100'], ['100.49', '100'], ['2', '5'], ['9007199254740994', '9007199254740993']])(
    'matches rounded cost above principal for %s less %s', (total, principal) => {
      expect(chart.repaymentCostAbovePrincipal(total, principal)).toBe(reference.repaymentCostAbovePrincipal(total, principal))
    })

  it.each([12, 36, 37, 360])('matches every chart bucket for %i months', (term) => {
    const rows = reference.amortizeLoan('2500000000', '9.75', term, 'REDUCING_BALANCE').schedule
    const stress = reference.amortizeLoan('2500000000', '11.75', term, 'REDUCING_BALANCE').schedule
    expect(chart.summarizeAmortizationForChart(rows, stress)).toEqual(reference.summarizeAmortizationForChart(rows, stress))
  })
  it.each([['9007199254740999.75', '9007199254740993.25'], ['1', '2'], ['22.6', '20.2']])('rounds the exact cost difference', (total, principal) => {
    expect(chart.repaymentCostAbovePrincipal(total, principal)).toBe(reference.repaymentCostAbovePrincipal(total, principal))
  })
  it.each(['', 'NaN', '1e400', '9'.repeat(65), '12.0.1'])('handles malformed or oversized chart amounts', (amount) => {
    expect(chart.repaymentCostAbovePrincipal(amount, '0')).toBeNull()
  })
})
