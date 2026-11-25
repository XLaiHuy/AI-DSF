'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function ChartCard({
  title,
  subtitle,
  kicker,
  unit,
  legend,
  summaryText,
  className,
  children,
}: {
  title: string
  subtitle?: string
  kicker?: string
  unit?: string
  legend?: Array<{ label: string; color: string }>
  summaryText?: string
  className?: string
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        'border-t border-b border-border/80 bg-card py-5 sm:rounded-lg sm:border sm:px-5',
        className,
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 border-b border-border/70 pb-3">
        <div className="min-w-0 space-y-0.5">
          {kicker && (
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {kicker}
            </p>
          )}
          <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
          {subtitle && <p className="text-xs leading-relaxed text-muted-foreground">{subtitle}</p>}
        </div>
        {unit && (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{unit}</span>
        )}
      </header>

      {legend && legend.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Chú giải biểu đồ">
          {legend.map((item) => (
            <li key={item.label} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block size-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: item.color }}
              />
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 w-full">{children}</div>

      {summaryText && <p className="sr-only">{summaryText}</p>}
    </section>
  )
}
