import { ROUTES, type FinancialHealth, type ProfileCoachResponse } from '@fincopilot/shared-types'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { Badge, Button, buttonVariants, TermInfo } from '@/components/ui'
import { cn } from '@/lib/utils'
import { formatVnd } from '@/lib/workspace-data'

const decimalText = (value: string | null, suffix: string) => value === null ? '—' : value.replace('.', ',') + suffix

export function FinancialHealthPanel({ health, coach, coachRevision, goalLabel, riskLabel, busy, coaching, onCoach }: {
  health: FinancialHealth | null
  coach: ProfileCoachResponse | null
  coachRevision: number
  goalLabel: string
  riskLabel: string
  busy: boolean
  coaching: boolean
  onCoach: () => void
}) {
  const metrics = health ? [
    ['Điểm sức khỏe tài chính', health.score === null ? '—' : `${health.score}/100`],
    ['Quỹ dự phòng', decimalText(health.emergencyMonths, ' tháng')],
    ['Tỷ lệ tiết kiệm ước tính', decimalText(health.savingsRatePct, '%')],
    ['Trả nợ / thu nhập thực nhận (DTI)', decimalText(health.dtiPct, '%')],
    ['Mức trả góp thêm an toàn', formatVnd(health.maxSafeEmiVnd)],
  ] : []

  return (
    <section aria-labelledby="financial-health-heading" className="space-y-4 border-t border-border pt-5">
      <div className="space-y-1">
        <h2 id="financial-health-heading" className="text-lg font-semibold tracking-tight">Sức khỏe tài chính</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Xem sức trả nợ và các bước tiếp theo dựa trên số liệu bạn đang nhập.
        </p>
      </div>
      {health && (
        <div className="space-y-4 rounded-lg bg-muted p-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            {metrics.map(([label, value]) => (
              <div className="min-w-0" key={label}>
                <dt className="text-sm text-muted-foreground">{label}{label.includes('(DTI)') && <> <TermInfo term="DTI" /></>}</dt>
                <dd className="font-numeric mt-0.5 break-words text-lg font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Quỹ dự phòng tính theo chi tiêu cố định và khoản trả nợ. Mức trả góp ước tính giữ lại 20% thu nhập và giới hạn tổng trả nợ ở 30% thu nhập thực nhận.
          </p>
          {health.budget && (
            <div className="space-y-2 border-t border-border pt-3">
              <h3 className="text-sm font-semibold">Phân bổ tham khảo 50/30/20 mỗi tháng <TermInfo term="50/30/20" /></h3>
              <dl className="grid gap-2 sm:grid-cols-3">
                {[
                  ['50% Thiết yếu', health.budget.needsVnd],
                  ['30% Linh hoạt', health.budget.wantsVnd],
                  ['20% Tiết kiệm và trả nợ', health.budget.savingsAndDebtVnd],
                ].map(([label, value]) => (
                  <div className="min-w-0" key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="font-numeric break-words text-sm font-semibold">{formatVnd(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}
      <Button variant="outline" className="min-h-11" disabled={busy} onClick={onCoach}>
        {coaching ? 'Đang phân tích…' : 'Xem gợi ý từ Copilot'}
      </Button>
      <span className="sr-only" role="status">{coaching ? 'Đang phân tích sức khỏe tài chính.' : coach ? 'Đã có gợi ý tài chính.' : ''}</span>
      {coach && (
        <section key={coachRevision} className="min-w-0 space-y-4 rounded-xl border border-border bg-accent/40 p-4 text-sm leading-relaxed sm:p-5" aria-labelledby="financial-coach-heading">
          <div className="space-y-2">
            <h3 id="financial-coach-heading" className="text-base font-semibold">Việc bạn có thể làm tiếp</h3>
            <div className="flex flex-wrap gap-2">
              <Badge variant="safe" className="whitespace-normal">{goalLabel}</Badge>
              <Badge variant="outline" className="whitespace-normal">{riskLabel}</Badge>
            </div>
          </div>
          <p className="curtain-unveil text-foreground [overflow-wrap:anywhere]">{coach.summary}</p>
          <ol className="coach-reveal space-y-2" role="list">
            {coach.actions.map((action, index) => (
              <li key={action} className="curtain-unveil flex min-w-0 items-start gap-3 rounded-lg border border-border bg-card p-3">
                <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-md bg-accent text-xs font-semibold text-primary">{index + 1}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{action}</span>
              </li>
            ))}
          </ol>
          <Link className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11 max-w-full justify-start whitespace-normal')} href={ROUTES.survey}>
            Tính thử khoản vay &amp; tích lũy <ArrowRight size={16} aria-hidden="true" className="shrink-0" />
          </Link>
        </section>
      )}
    </section>
  )
}
