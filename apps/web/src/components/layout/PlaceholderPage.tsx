import type { ReactNode } from 'react'
import { Badge, Card, CardContent } from '@/components/ui'

export function PlaceholderPage({
  title,
  description,
  eyebrow,
  statusLabel,
  children,
}: {
  title: string
  description: string
  eyebrow?: string
  statusLabel?: string
  children?: ReactNode
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-3">
        {(eyebrow || statusLabel) && (
          <div className="flex flex-wrap items-center gap-2">
            {eyebrow && <Badge variant="info">{eyebrow}</Badge>}
            {statusLabel && <Badge variant="outline">{statusLabel}</Badge>}
          </div>
        )}
        <h1 className="text-balance text-2xl font-bold tracking-tight text-foreground sm:text-3xl lg:text-4xl">
          {title}
        </h1>
        <p className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground sm:text-base">
          {description}
        </p>
      </header>

      {children ? (
        <div className="space-y-4">{children}</div>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Khung màn hình đã sẵn sàng để triển khai giao diện và kết nối API ở Phase 2.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
