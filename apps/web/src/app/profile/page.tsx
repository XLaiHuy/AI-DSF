import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ProfileRouteCenter } from '@/components/profile/ProfileRouteCenter'

export const metadata: Metadata = { title: 'Hồ sơ tài chính' }

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <header className="space-y-2">
        <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">Hồ sơ tài chính</h1>
        <p className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground sm:text-base">
          Theo dõi thu nhập, nghĩa vụ trả nợ và lưu lại các báo cáo giám định của bạn.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground" role="status">Đang mở hồ sơ…</p>}>
        <ProfileRouteCenter />
      </Suspense>
    </div>
  )
}
