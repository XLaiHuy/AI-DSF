import type { BadgeProps } from '@/components/ui'
import type { VerdictLevel } from '@fincopilot/shared-types'

export const verdictLabels: Record<VerdictLevel, string> = {
  SAFE: 'An toàn', CAUTION: 'Cần thận trọng', HIGH_RISK: 'Nguy hiểm cao',
}
export const verdictVariants: Record<VerdictLevel, BadgeProps['variant']> = {
  SAFE: 'safe', CAUTION: 'warning', HIGH_RISK: 'danger',
}
