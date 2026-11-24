'use client'

import { safeReturnTo } from '@fincopilot/shared-types'
import { useSearchParams } from 'next/navigation'
import { ProfileCenter } from './ProfileCenter'

export function ProfileRouteCenter() {
  const params = useSearchParams()
  const login = params.getAll('login')
  const logout = params.getAll('logout')
  const returnTo = params.getAll('returnTo')
  const loginStatus = login.length === 1 ? login[0] : undefined
  const notice = loginStatus === 'success' ? 'Đã đăng nhập.'
    : loginStatus === 'conflict' ? 'Email này đã được đăng ký bằng phương thức khác. Hãy đăng nhập bằng phương thức đã sử dụng.'
      : loginStatus === 'error' ? 'Đăng nhập chưa hoàn tất. Vui lòng thử lại.'
        : logout.length === 1 && logout[0] === 'success' ? 'Đã đăng xuất.' : ''
  return <ProfileCenter notice={notice} noticeVariant={loginStatus === 'conflict' || loginStatus === 'error' ? 'danger' : 'safe'}
    returnTo={safeReturnTo(returnTo.length > 1 ? returnTo : returnTo[0])} />
}
