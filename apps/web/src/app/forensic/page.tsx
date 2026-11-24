import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ForensicRouteWorkbench } from '@/components/forensic/ForensicRouteWorkbench'

export const metadata: Metadata = { title: 'Giám định tài chính' }

function configuredLimit(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export default function ForensicPage() {
  return (
    <div className="forensic-workspace-shell mx-auto max-w-6xl">
      <Suspense fallback={<p className="text-sm text-muted-foreground" role="status">Đang mở giám định…</p>}>
        <ForensicRouteWorkbench uploadMaxMb={configuredLimit(process.env.UPLOAD_MAX_MB, 20)}
          pdfMaxPages={configuredLimit(process.env.PDF_MAX_PAGES, 5)} />
      </Suspense>
    </div>
  )
}
