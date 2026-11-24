'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { AuditHistory } from '@/components/forensic/AuditHistory'
import { Alert, Button, Card } from '@/components/ui'
import { profileQuery, sessionQuery } from '@/lib/workspace-data'
import { AccountPanel, AccountStatus } from './AccountPanel'
import { FinancialProfileForm } from './FinancialProfileForm'

export function ProfileCenter({ notice, noticeVariant, returnTo }: { notice: string; noticeVariant: 'safe' | 'danger'; returnTo: string }) {
  const session = useQuery(sessionQuery)
  const profile = useQuery(profileQuery)
  const [saved, setSaved] = useState(false)

  return (
    <div className="space-y-5">
      {notice && <Alert variant={noticeVariant} role={noticeVariant === 'safe' ? 'status' : 'alert'} className="font-medium">{notice}</Alert>}
      {session.isPending && <Card className="p-5 text-sm text-muted-foreground"><p role="status">Đang tải phiên của bạn…</p></Card>}
      {session.isError && (
        <Alert variant="danger" className="items-start">
          <p>Chưa tải được phiên của bạn.</p>
          <Button variant="outline" onClick={() => void session.refetch()}>Thử lại</Button>
        </Alert>
      )}
      {session.data && <AccountStatus session={session.data} />}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {profile.isPending && (
          <Card className="p-5 text-sm text-muted-foreground"><p role="status">Đang tải dữ liệu tài chính…</p></Card>
        )}
        {profile.isError && (
          <Alert variant="danger" className="items-start">
            <p>Chưa tải được hồ sơ tài chính.</p>
            <Button variant="outline" onClick={() => void profile.refetch()}>Thử lại</Button>
          </Alert>
        )}
        {profile.data && (
          <FinancialProfileForm key={profile.data.profile?.id ?? 'new'} initial={profile.data.profile}
            initialHealth={profile.data.health ?? null} saved={saved} setSaved={setSaved} />
        )}
        <aside className="min-w-0 space-y-5">
          {session.data?.kind === 'guest' && <AccountPanel session={session.data} returnTo={returnTo} />}
          <AuditHistory />
        </aside>
      </div>
    </div>
  )
}
