import Decimal from 'decimal.js'
import type { FinancialHealth, FinancialHealthRequest } from '@fincopilot/shared-types'

const Precise = Decimal.clone({ precision: 48, rounding: Decimal.ROUND_HALF_UP })
const amount = (value: string | null) => value === null ? null : new Precise(value)
const fixed = (value: Decimal | null, digits = 2) => value?.toFixed(digits) ?? null

export function calculateFinancialHealth(input: FinancialHealthRequest): FinancialHealth {
  const income = amount(input.monthlyIncomeVnd)
  const expense = amount(input.monthlyExpenseVnd)
  const debt = amount(input.existingDebtPaymentVnd)
  const savings = amount(input.liquidSavingsVnd)
  const commitments = expense && debt ? expense.plus(debt) : null
  const surplus = income && commitments ? income.minus(commitments) : null
  const positiveIncome = income?.gt(0) ? income : null
  const emergency = savings && commitments?.gt(0) ? savings.div(commitments) : null
  const savingRate = surplus && positiveIncome ? surplus.div(positiveIncome) : null
  const dti = debt && positiveIncome ? debt.div(positiveIncome) : null
  const maxEmi = income && surplus && debt
    ? Precise.max(0, Precise.min(income.mul('0.30').minus(debt), surplus.minus(income.mul('0.20'))))
    : null

  // The score weights reserves, monthly saving capacity, and debt headroom.
  const score = commitments && savings && savingRate && dti
    ? Precise.min(1, emergency?.div(3) ?? 1).mul(40)
      .plus(Precise.min(1, Precise.max(0, savingRate.div('0.20'))).mul(35))
      .plus(Precise.max(0, new Precise(1).minus(dti.div('0.30'))).mul(25))
      .round().toNumber()
    : income?.isZero() && commitments && savings ? 0 : null

  return {
    score,
    emergencyMonths: fixed(emergency, 1),
    savingsRatePct: fixed(savingRate?.mul(100) ?? null),
    maxSafeEmiVnd: maxEmi?.toFixed(2, Decimal.ROUND_DOWN) ?? null,
    dtiPct: fixed(dti?.mul(100) ?? null),
    budget: income ? {
      needsVnd: income.mul('0.50').toFixed(2, Decimal.ROUND_DOWN),
      wantsVnd: income.mul('0.30').toFixed(2, Decimal.ROUND_DOWN),
      savingsAndDebtVnd: income.minus(income.mul('0.50').toDecimalPlaces(2, Decimal.ROUND_DOWN))
        .minus(income.mul('0.30').toDecimalPlaces(2, Decimal.ROUND_DOWN)).toFixed(2),
    } : null,
  }
}
