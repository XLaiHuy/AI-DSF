import Decimal from 'decimal.js'
import type { FinancialHealthRequest, ForensicAuditResponse, ForensicPersonalImpact } from '@fincopilot/shared-types'
import { calculateFinancialHealth } from '../profile-auth/financial-health.engine'

const Precise = Decimal.clone({ precision: 48 })
const amount = (value: string | null | undefined) => value == null ? null : new Precise(value)
const fixed = (value: Decimal | null) => value?.toFixed(2) ?? null
const percent = (value: Decimal) => value.toDecimalPlaces(2).toFixed()
  .replace(/\B(?=(\d{3})+(?:\.|$))/g, ' ').replace('.', ',') + '%'
const dong = (value: Decimal) => value.toFixed(2).replace(/\.00$/, '')
  .replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace('.', ',') + ' đ'

export function evaluatePersonalImpact(
  profile: FinancialHealthRequest | null,
  math: ForensicAuditResponse['mathBreakdown'],
  qrPayloads: ReadonlyArray<Pick<ForensicAuditResponse['qrPayloads'][number], 'qrAmountVnd'>>,
): ForensicPersonalImpact | null {
  if (!profile) return null
  const income = amount(profile.monthlyIncomeVnd)
  const positiveIncome = income?.gt(0) ? income : null
  const payment = amount(math?.maxMonthlyPaymentVnd ?? math?.monthlyPaymentVnd)

  if (payment && positiveIncome) {
    const debt = amount(profile.existingDebtPaymentVnd)
    // Without existing debt the projected DTI and affordability cannot be established.
    if (!debt) return null
    const expense = amount(profile.monthlyExpenseVnd)
    const currentDti = debt.div(positiveIncome).mul(100)
    const projectedDti = debt.plus(payment).div(positiveIncome).mul(100)
    const maxEmi = amount(calculateFinancialHealth(profile).maxSafeEmiVnd)
    const excess = maxEmi && Precise.max(0, payment.minus(maxEmi))
    const surplus = expense && positiveIncome.minus(expense).minus(debt).minus(payment)
    const status = surplus?.lt(0) || projectedDti.gt(40) || excess?.gt(0) ? 'OVER_CAPACITY'
      : projectedDti.gt(30) ? 'STRETCHED' : 'WITHIN_BUDGET'
    const limit = excess?.gt(0) && maxEmi ? ` vượt mức trả góp an toàn ${dong(maxEmi)}/tháng của bạn và` : ''
    const after = surplus?.lt(0) ? ` Ngân sách thiếu ${dong(surplus.abs())} mỗi tháng sau khi trả góp.` : ''
    return {
      kind: 'LOAN_MONTHLY', status, monthlyIncomeVnd: fixed(income),
      currentDtiPct: fixed(currentDti), projectedDtiPct: fixed(projectedDti),
      maxSafeEmiVnd: fixed(maxEmi), proposedMonthlyPaymentVnd: fixed(payment),
      emiExcessVnd: fixed(excess), monthlySurplusAfterVnd: fixed(surplus),
      paymentAmountVnd: null, shareOfSavingsPct: null, shareOfMonthlyIncomePct: null,
      plainSummary: `Khoản trả${math?.maxMonthlyPaymentVnd ? ' cao nhất' : ''} ${dong(payment)}/tháng${limit} đưa tỷ lệ trả nợ trên thu nhập từ ${percent(currentDti)} lên ${percent(projectedDti)}.${after}`,
    }
  }

  // qrAmountVnd is populated by extraction only when the amount is in VND.
  const qr = qrPayloads.find(({ qrAmountVnd }) => amount(qrAmountVnd)?.gt(0))
  const transfer = amount(qr?.qrAmountVnd)
  const savings = amount(profile.liquidSavingsVnd)
  const positiveSavings = savings?.gt(0) ? savings : null
  if (!transfer || (!positiveIncome && !positiveSavings)) return null
  const savingsShare = positiveSavings && transfer.div(positiveSavings).mul(100)
  const incomeShare = positiveIncome && transfer.div(positiveIncome).mul(100)
  const status = (savings && transfer.gt(savings)) || incomeShare?.gte(100) ? 'OVER_CAPACITY'
    : savingsShare?.gte(30) || incomeShare?.gte(50) ? 'STRETCHED' : 'WITHIN_BUDGET'
  const comparisons = [
    savingsShare ? `${percent(savingsShare)} quỹ dự phòng` : savings?.isZero() ? 'vượt quỹ dự phòng hiện có' : '',
    incomeShare ? `${percent(incomeShare)} thu nhập tháng` : '',
  ].filter(Boolean)
  const comparison = comparisons.map((item) => item.startsWith('vượt') ? item : `bằng ${item}`).join(' và ')
  return {
    kind: 'ONE_TIME_PAYMENT', status, monthlyIncomeVnd: fixed(income),
    currentDtiPct: null, projectedDtiPct: null, maxSafeEmiVnd: null,
    proposedMonthlyPaymentVnd: null, emiExcessVnd: null, monthlySurplusAfterVnd: null,
    paymentAmountVnd: fixed(transfer), shareOfSavingsPct: fixed(savingsShare),
    shareOfMonthlyIncomePct: fixed(incomeShare),
    plainSummary: `Khoản chuyển ${dong(transfer)} ${comparison} của bạn.`,
  }
}
