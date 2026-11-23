import { parseForensicHandoff, type RouteSearchParams } from '@fincopilot/shared-types'
import type { Metadata } from 'next'
import { AuditHistory } from '@/components/forensic/AuditHistory'
import { ForensicWorkbench } from '@/components/forensic/ForensicWorkbench'

export const metadata: Metadata = { title: 'Giám định tài chính' }

function configuredLimit(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export default async function ForensicPage({ searchParams }: { searchParams: Promise<RouteSearchParams> }) {
  const { claimedEntity } = parseForensicHandoff(await searchParams)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">Giám định tài chính</h1>
        <p className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground sm:text-base">
          Kiểm tra mã QR, hợp đồng và tin nhắn trước khi giao dịch.
        </p>
      </header>
      <ForensicWorkbench
        key={claimedEntity}
        claimedEntity={claimedEntity}
        uploadMaxMb={configuredLimit(process.env.UPLOAD_MAX_MB, 20)}
        pdfMaxPages={configuredLimit(process.env.PDF_MAX_PAGES, 5)}
      />
      <AuditHistory collapsible />
    </div>
  )
}
