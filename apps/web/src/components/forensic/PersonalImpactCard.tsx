import { ROUTES, type ForensicPersonalImpact } from '@fincopilot/shared-types'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { Badge, buttonVariants, Card, TermInfo } from '@/components/ui'
import { formatSpacedAmount } from '@/components/ui/money-input'
import { cn } from '@/lib/utils'

const statusLabels = {
  WITHIN_BUDGET: { label: 'Trong khả năng', variant: 'safe' },
  STRETCHED: { label: 'Khá căng dòng tiền', variant: 'warning' },
  OVER_CAPACITY: { label: 'Vượt ngưỡng an toàn', variant: 'danger' },
} as const

const percent = (value: string | null) => value === null ? '—' : value.replace('.', ',') + '%'
const money = (value: string | null) => value === null ? '—' : formatSpacedAmount(value.replace(/\.00$/, '')) + ' đ'

export function PersonalImpactCard({ impact }: { impact: ForensicPersonalImpact | null }) {
  if (!impact) return (
    <Card className="report-print-card flex flex-wrap items-center justify-between gap-2 bg-muted/50 px-4 py-3">
      <p className="max-w-md text-sm text-muted-foreground">Bổ sung số liệu trong hồ sơ tài chính để xem khoản này ảnh hưởng thế nào đến ví tiền của bạn.</p>
      <Link href={ROUTES.profile} className={cn(buttonVariants({ variant: 'outline' }), 'print-hidden min-h-11')}>
        Mở hồ sơ tài chính <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </Card>
  )

  const status = statusLabels[impact.status]
  const isLoan = impact.kind === 'LOAN_MONTHLY'
  const metrics = isLoan ? [
    ['Trả góp mỗi tháng', money(impact.proposedMonthlyPaymentVnd)],
    ['Mức trả góp an toàn tối đa', money(impact.maxSafeEmiVnd)],
    ['Vượt mức an toàn', money(impact.emiExcessVnd)],
    ['Số dư mỗi tháng sau trả góp', money(impact.monthlySurplusAfterVnd)],
  ] : [
    ['Số tiền chuyển', money(impact.paymentAmountVnd)],
    ['Tỷ lệ so với quỹ dự phòng', percent(impact.shareOfSavingsPct)],
    ['Tỷ lệ so với thu nhập tháng', percent(impact.shareOfMonthlyIncomePct)],
  ]

  return (
    <Card className="report-print-card print-keep space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-balance text-lg font-semibold tracking-tight">Tác động lên ví tiền của bạn</h2>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
      <p className="text-sm leading-relaxed [overflow-wrap:anywhere]">{impact.plainSummary}</p>
      {isLoan && (
        <div className="space-y-2 rounded-lg bg-muted p-3">
          <p className="text-sm font-medium">Tỷ lệ trả nợ trên thu nhập (DTI) <TermInfo term="DTI" /></p>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            <div>
              <dt className="text-xs text-muted-foreground">Hiện tại</dt>
              <dd className="font-numeric font-bold [overflow-wrap:anywhere]">{percent(impact.currentDtiPct)}</dd>
            </div>
            <ArrowRight size={16} className="text-primary" aria-hidden="true" />
            <div>
              <dt className="text-xs text-muted-foreground">Sau khoản vay</dt>
              <dd className="font-numeric font-bold [overflow-wrap:anywhere]">{percent(impact.projectedDtiPct)}</dd>
            </div>
          </dl>
        </div>
      )}
      <dl className="scr-stagger-grid grid gap-3 sm:grid-cols-2">
        {metrics.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-lg border border-border px-3 py-2">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="font-numeric font-semibold [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}
