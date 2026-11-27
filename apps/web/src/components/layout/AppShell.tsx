'use client'

import { ROUTES } from '@fincopilot/shared-types'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { DeskNavigation } from '@/components/radar/DeskNavigation'

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  if (pathname === ROUTES.home || pathname === ROUTES.radar) return <>{children}</>
  return <div className="desk-shell desk-shell--workspace">
    <a className="skip-link" href="#main-content">Chuyển đến nội dung chính</a>
    <DeskNavigation key={pathname} />
    <div id="main-content" tabIndex={-1} className="desk-workspace-content">{children}</div>
  </div>
}
