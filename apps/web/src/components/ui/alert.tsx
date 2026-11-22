import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

const alertVariants = cva(
  'relative flex flex-col gap-1 rounded-xl border p-4 text-sm',
  {
    variants: {
      variant: {
        default: 'border-border bg-card text-foreground',
        safe: 'border-verdict-safe-border bg-verdict-safe-bg text-verdict-safe',
        warning: 'border-verdict-warning-border bg-verdict-warning-bg text-verdict-warning',
        danger: 'border-verdict-danger-border bg-verdict-danger-bg text-verdict-danger',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type AlertProps = ComponentProps<'div'> & VariantProps<typeof alertVariants>

export function Alert({ className, variant, ...props }: AlertProps) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
}

export function AlertTitle({ className, ...props }: ComponentProps<'h4'>) {
  return <h4 className={cn('font-semibold leading-snug tracking-tight', className)} {...props} />
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('text-sm leading-relaxed opacity-90', className)} {...props} />
}
