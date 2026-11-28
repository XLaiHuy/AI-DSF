import Decimal from 'decimal.js'

const rate = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })
const signedReturn = new Intl.NumberFormat('vi-VN', {
  minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero',
})

export const formatRate = (value: string | number) => rate.format(value as number | `${number}`) + '%'

export function formatInvestmentReturn(profitVnd: string, contributedVnd: string) {
  const contributed = new Decimal(contributedVnd)
  if (contributed.isZero()) return '—'
  const pct = new Decimal(profitVnd).times(100).div(contributed).toFixed(1, Decimal.ROUND_HALF_UP)
  return signedReturn.format(pct as `${number}`) + '%'
}
