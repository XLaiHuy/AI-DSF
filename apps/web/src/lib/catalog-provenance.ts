import type { ProductFreshness } from '@fincopilot/shared-types'

export const freshnessLabels = {
  FRESH: 'Cập nhật trong 30 ngày',
  AGING: 'Đã 31–60 ngày · nên đối chiếu lại',
  STALE: 'Quá 60 ngày · cần kiểm tra lãi hiện hành',
} satisfies Record<ProductFreshness, string>

export function formatCatalogDate(value?: string) {
  if (!value) return ''
  const [year, month, day] = value.slice(0, 10).split('-')
  return day && month && year ? day + '/' + month + '/' + year : ''
}
