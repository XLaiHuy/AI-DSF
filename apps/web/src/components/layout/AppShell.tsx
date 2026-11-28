'use client'

import { ROUTES } from '@fincopilot/shared-types'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { DeskNavigation } from '@/components/radar/DeskNavigation'
import { WorkspaceSessionProvider } from './WorkspaceSessionContext'
import { RadarDeskProvider, useRadarDesk } from './RadarDeskContext'

export function AppShell({ children }: { children: ReactNode }) {
  return <WorkspaceSessionProvider><RadarDeskProvider><DeskFrame>{children}</DeskFrame></RadarDeskProvider></WorkspaceSessionProvider>
}

function DeskFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { controls } = useRadarDesk()
  const radar = pathname === ROUTES.home || pathname === ROUTES.radar
  const className = radar ? controls?.isAlertsTab ? 'desk-shell desk-shell--alerts' : 'desk-shell' : 'desk-shell desk-shell--workspace'
  return <div className={className}>
    <a className="skip-link" href="#main-content">Chuyển đến nội dung chính</a>
    <DeskNavigation />
    <div id="main-content" tabIndex={-1} className={radar ? 'desk-route-content' : 'desk-workspace-content'}>{children}</div>
  </div>
}
