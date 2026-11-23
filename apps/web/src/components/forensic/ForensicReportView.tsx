'use client'

import { ROUTES } from '@fincopilot/shared-types'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Alert, Button, buttonVariants, Card } from '@/components/ui'
import { ApiError } from '@/lib/api-client'
import { auditQuery, sessionQuery } from '@/lib/workspace-data'
import { cn } from '@/lib/utils'
import { AuditHistory } from './AuditHistory'
import { ForensicReport } from './ForensicReport'

export function ForensicReportView({ id }: { id: string }) {
  const session = useQuery(sessionQuery)
  const audit = useQuery({ ...auditQuery(id), enabled: session.isSuccess })
  const missing = audit.error instanceof ApiError && audit.error.status === 404

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href={ROUTES.forensic} className={cn(buttonVariants({ variant: 'ghost' }), 'min-h-11 ps-0 text-primary hover:ps-2')}>
        <ArrowLeft size={18} aria-hidden="true" /> Giám định khác
      </Link>
      {session.isError || audit.isError ? (
        <Alert variant="danger" className="items-start">
          <h1 className="text-lg font-semibold">Báo cáo giám định</h1>
          <p>{missing ? 'Không tìm thấy báo cáo trong phiên của bạn.' : 'Chưa tải được báo cáo. Vui lòng thử lại.'}</p>
          {!missing && <Button variant="outline" className="mt-2 min-h-11" onClick={() => void (session.isError ? session.refetch() : audit.refetch())}>Thử lại</Button>}
        </Alert>
      ) : audit.isPending ? (
        <Card className="space-y-2 p-5 sm:p-6">
          <h1 className="text-lg font-semibold">Báo cáo giám định</h1>
          <p role="status" className="text-sm text-muted-foreground">Đang tải báo cáo…</p>
        </Card>
      ) : (
        <>
          <ForensicReport audit={audit.data} />
          <AuditHistory collapsible />
        </>
      )}
    </div>
  )
}
