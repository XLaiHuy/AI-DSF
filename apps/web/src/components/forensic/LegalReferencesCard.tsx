import { ExternalLink, Landmark } from 'lucide-react'
import type { LegalCitationItem } from '@fincopilot/shared-types'
import { Badge, Card } from '@/components/ui'

const status = {
  IN_FORCE: { label: 'Đang còn hiệu lực', variant: 'safe' },
  AMENDING: { label: 'Sửa đổi, bổ sung', variant: 'info' },
  SUPPLEMENTARY: { label: 'Hướng dẫn bổ trợ', variant: 'secondary' },
} as const
const officialHosts = new Set(['vanban.chinhphu.vn', 'chinhphu.vn', 'vbpl.vn'])

export function LegalReferencesCard({ citations }: { citations: readonly LegalCitationItem[] }) {
  return (
    <Card className="report-print-card space-y-4 p-5 sm:p-6">
      <h2 className="flex items-start gap-2 text-lg font-semibold tracking-tight">
        <Landmark size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        Đối chiếu pháp luật Việt Nam
      </h2>
      <ul role="list" className="scr-stagger-list divide-y divide-border">
        {citations.map((item) => {
          const url = new URL(item.sourceUrl)
          const official = url.protocol === 'https:' && officialHosts.has(url.hostname)
          return (
            <li key={item.code} className="print-keep space-y-2 py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="min-w-0 text-sm font-semibold">{item.title} · {item.code}</h3>
                <Badge variant={status[item.status].variant}>{status[item.status].label}</Badge>
              </div>
              <p className="text-xs font-medium text-muted-foreground">{item.articleRef} · Hiệu lực từ {item.effectiveDate}</p>
              {item.caseRelevance && (
                <div className="rounded-lg border-s-2 border-primary bg-accent/40 px-3 py-2 text-sm leading-relaxed [overflow-wrap:anywhere]">
                  <p className="font-semibold">Liên hệ với hồ sơ của bạn</p>
                  <p>{item.caseRelevance}</p>
                </div>
              )}
              <p className="text-sm leading-relaxed">{item.plainMeaning}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{item.replacesOrSupplements}</p>
              {official && <>
                <a className="inline-flex min-h-11 max-w-full items-center gap-1.5 text-sm font-semibold text-primary underline underline-offset-4"
                  href={url.href} target="_blank" rel="noopener noreferrer">
                  {item.sourceLabel} <ExternalLink size={14} aria-hidden="true" className="shrink-0" />
                </a>
                <p className="print-source-url print-only [overflow-wrap:anywhere]">{item.sourceUrl}</p>
              </>}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
