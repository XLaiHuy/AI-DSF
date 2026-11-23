import type { Metadata } from 'next'
import { ProfileCenter } from '@/components/profile/ProfileCenter'

export const metadata: Metadata = { title: 'Hồ sơ tài chính' }

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ login?: string; logout?: string }> }) {
  const { login, logout } = await searchParams
  const notice = login === 'success' ? 'Đã đăng nhập.'
    : login === 'error' ? 'Đăng nhập chưa hoàn tất. Vui lòng thử lại.'
      : logout === 'success' ? 'Đã đăng xuất.' : ''

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <header className="space-y-2">
        <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">Hồ sơ tài chính</h1>
        <p className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground sm:text-base">
          Theo dõi thu nhập, nghĩa vụ trả nợ và lưu lại các báo cáo giám định của bạn.
        </p>
      </header>
      <ProfileCenter notice={notice} />
    </div>
  )
}
