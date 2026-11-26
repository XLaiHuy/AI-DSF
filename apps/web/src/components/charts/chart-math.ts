import type { SurveyLoanResponse } from '@fincopilot/shared-types'

export type ScheduleRow = SurveyLoanResponse['offers'][number]['schedule'][number]

export function validChartAmount(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && /^\d+(?:\.\d+)?$/.test(value)
}

// Align decimal places before summing, then round once to whole đồng.
function roundedSum(values: readonly string[], subtractLast = false) {
  const parts = values.map((value) => value.split('.'))
  const places = Math.max(0, ...parts.map(([, fraction]) => fraction?.length ?? 0))
  const unit = 10n ** BigInt(places)
  const total = parts.reduce((sum, [whole, fraction = ''], index) => {
    const amount = BigInt(whole + fraction.padEnd(places, '0'))
    return subtractLast && index === parts.length - 1 ? sum - amount : sum + amount
  }, 0n)
  return ((total > 0n ? total + unit / 2n : 0n) / unit).toString()
}

export function repaymentCostAbovePrincipal(total: string, principal: string) {
  return validChartAmount(total) && validChartAmount(principal) ? roundedSum([total, principal], true) : null
}

export function summarizeAmortizationForChart(schedule: readonly ScheduleRow[], stressSchedule?: readonly ScheduleRow[]) {
  const points: (ScheduleRow & { stressPaymentVnd?: string })[] = []
  if (schedule.some((row) => ![row.paymentVnd, row.interestVnd, row.principalVnd, row.remainingBalanceVnd, row.feeVnd ?? '0'].every(validChartAmount))) return points
  const stress = new Map(stressSchedule?.map((row) => [row.month, row.paymentVnd]))
  const step = schedule.length > 36 ? 12 : 1
  for (let start = 0; start < schedule.length; start += step) {
    const rows = schedule.slice(start, start + step)
    const closing = rows[rows.length - 1]
    const sum = (key: 'paymentVnd' | 'interestVnd' | 'principalVnd' | 'feeVnd') => roundedSum(rows.map((row) => row[key] ?? '0'))
    const payments = rows.map((row) => stress.get(row.month))
    points.push({ ...closing,
      ...(step > 1 ? { paymentVnd: sum('paymentVnd'), interestVnd: sum('interestVnd'), principalVnd: sum('principalVnd'), feeVnd: sum('feeVnd') } : {}),
      ...(payments.every(validChartAmount) ? { stressPaymentVnd: roundedSum(payments) } : {}),
    })
  }
  return points
}
