'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Button, Card } from '@/components/ui'
import { formatVietnamTime, surveyHistoryQuery, surveySessionHref, surveySessionLabel } from '@/lib/workspace-data'

export function SurveyHistory() {
  const history = useQuery(surveyHistoryQuery)
  return <Card className="gap-3 p-5 sm:p-6">
    <h2 className="text-base font-semibold">Lịch sử khảo sát</h2>
    {history.isPending && <p role="status" className="text-sm text-muted-foreground">Đang tải lịch sử khảo sát…</p>}
    {history.isError && <div role="alert" className="space-y-2 text-sm">
      <p className="text-destructive">Chưa tải được lịch sử khảo sát.</p>
      <Button variant="outline" size="sm" onClick={() => void history.refetch()}>Thử lại</Button>
    </div>}
    {history.data?.sessions.length === 0 && <p className="text-sm text-muted-foreground">Các lần khảo sát đã lưu sẽ xuất hiện ở đây.</p>}
    {history.data && history.data.sessions.length > 0 && <ul className="divide-y">
      {history.data.sessions.map((entry) => <li key={entry.id} className="py-2 text-sm">
        <Link href={surveySessionHref(entry.sessionMode)} className="inline-block py-1 font-medium hover:text-primary">{surveySessionLabel(entry.sessionMode)}</Link>
        <p className="text-xs text-muted-foreground"><time dateTime={entry.createdAt}>{formatVietnamTime(entry.createdAt)}</time>
          {entry.dtiRatioPct && <span> · DTI {entry.dtiRatioPct}%</span>}
        </p>
      </li>)}
    </ul>}
  </Card>
}
