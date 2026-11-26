import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-0.5 text-xs font-semibold tracking-tight whitespace-nowrap transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-border bg-secondary text-secondary-foreground',
        outline: 'border-border bg-card text-foreground',
        safe: 'border-verdict-safe-border bg-verdict-safe-bg text-verdict-safe',
        warning: 'border-verdict-warning-border bg-verdict-warning-bg text-verdict-warning',
        danger: 'border-verdict-danger-border bg-verdict-danger-bg text-verdict-danger',
        info: 'border-primary/20 bg-accent text-accent-foreground',
      },
    },
    defaultVariants: {
      variant: 'secondary',
    },
  },
)

export type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
