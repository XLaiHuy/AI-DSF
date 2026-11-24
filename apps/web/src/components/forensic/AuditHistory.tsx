'use client'

import { useQuery } from '@tanstack/react-query'
import { ArrowRight, History } from 'lucide-react'
import Link from 'next/link'
import { useState, useSyncExternalStore } from 'react'
import { Badge, Button, Card } from '@/components/ui'
import { auditHref, auditListQuery, formatVietnamTime, sessionQuery } from '@/lib/workspace-data'
import { verdictLabels, verdictVariants } from './verdict'

const subscribePopoverSupport = () => () => {}
const supportsPopover = () => 'popover' in HTMLElement.prototype
const serverPopoverSupport = () => false

export function AuditHistory({ collapsible = false, dropdown = false }: { collapsible?: boolean; dropdown?: boolean }) {
  const [open, setOpen] = useState(!collapsible && !dropdown)
  const nativePopover = useSyncExternalStore(subscribePopoverSupport, supportsPopover, serverPopoverSupport)
  const session = useQuery({ ...sessionQuery, enabled: open })
  const history = useQuery({ ...auditListQuery, enabled: open })
  const historyTitle = 'Lịch sử giám định'
  const content = (
    <div className={dropdown ? 'px-4 pb-3' : 'px-5 pb-5 sm:px-6 sm:pb-6'}>
      {session.isError || history.isError ? (
        <div role="alert" className="space-y-2">
          <p className="text-sm text-destructive">Chưa tải được lịch sử giám định.</p>
          <Button variant="outline" className="min-h-11" onClick={() => void (session.isError ? session.refetch() : history.refetch())}>Thử lại</Button>
        </div>
      ) : history.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">Đang tải báo cáo…</p>
      ) : history.data.audits.length ? (
        <ul className="divide-y divide-border">
          {history.data.audits.map((audit) => (
            <li key={audit.auditId}>
              <Link href={auditHref(audit.auditId)} className="flex min-h-11 items-center gap-2.5 rounded-md py-3 hover:text-primary">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-semibold [overflow-wrap:anywhere]">{audit.claimedEntityName ?? 'Báo cáo giám định'}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={verdictVariants[audit.verdictLevel]}>{verdictLabels[audit.verdictLevel]}</Badge>
                    <span className="font-numeric text-xs text-muted-foreground">{audit.riskScore}/100</span>
                    <time dateTime={audit.createdAt} className="font-numeric text-xs text-muted-foreground">{formatVietnamTime(audit.createdAt)}</time>
                  </div>
                </div>
                <ArrowRight className="shrink-0 text-primary" size={16} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-relaxed text-muted-foreground">Chưa có báo cáo. Kết quả giám định của bạn sẽ xuất hiện tại đây.</p>
      )}
    </div>
  )

  if (dropdown && nativePopover) return (
    <>
      <Button popoverTarget="forensic-history" variant="outline" className="h-9 gap-1 whitespace-nowrap px-2 text-xs sm:text-sm">
        <History size={16} aria-hidden="true" className="hidden sm:inline-block" /> {historyTitle}
      </Button>
      <div id="forensic-history" popover="auto" onToggle={(event) => setOpen(event.newState === 'open')}
        className="forensic-history-popover rounded-xl border border-border bg-card text-card-foreground shadow-lg">
        <h2 className="px-4 pt-3 pb-2 text-base font-semibold">{historyTitle}</h2>
        {open && content}
      </div>
    </>
  )

  if (dropdown) return (
    <details className="forensic-history-fallback" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex h-9 cursor-pointer items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-medium sm:text-sm">
        <History size={16} aria-hidden="true" className="hidden sm:inline-block" /> {historyTitle}
      </summary>
      <div className="forensic-history-popover z-30 rounded-xl border border-border bg-card pt-3 text-card-foreground shadow-lg">
        {open && content}
      </div>
    </details>
  )

  return (
    <Card className="min-w-0">
      {collapsible ? (
        <details onToggle={(event) => setOpen(event.currentTarget.open)}>
          <summary className="min-h-11 cursor-pointer rounded-xl px-5 py-4 text-sm font-semibold marker:text-primary hover:bg-muted/40 sm:px-6">
            <span className="ms-2">{historyTitle}</span>
          </summary>
          {open && content}
        </details>
      ) : (
        <section aria-label={historyTitle}>
          <h2 className="flex items-center gap-2 px-5 pt-5 pb-3 text-lg font-semibold sm:px-6 sm:pt-6">
            <History className="shrink-0 text-primary" size={20} aria-hidden="true" /> {historyTitle}
          </h2>
          {content}
        </section>
      )}
    </Card>
  )
}
