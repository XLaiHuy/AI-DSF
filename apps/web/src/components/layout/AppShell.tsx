'use client'

import { ROUTES } from '@fincopilot/shared-types'
import { Activity, Calculator, CircleUserRound, House, LayoutGrid, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

const links = [
  { href: ROUTES.home, label: 'Tổng quan', icon: House },
  { href: ROUTES.radar, label: 'Radar', icon: Activity },
  { href: ROUTES.survey, label: 'Khảo sát', icon: Calculator },
  { href: ROUTES.forensic, label: 'Giám định', icon: ShieldCheck },
  { href: ROUTES.profile, label: 'Hồ sơ', icon: CircleUserRound },
  { href: ROUTES.admin, label: 'Quản trị', icon: SlidersHorizontal },
]

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const currentSection = links.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`))

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Chuyển đến nội dung chính</a>
      <header className="topbar">
        <Link className="brand" href={ROUTES.home}>
          <span className="brand-mark"><LayoutGrid size={17} aria-hidden="true" /></span>
          FinCopilot AI
        </Link>
        <span className="topbar-section">{currentSection?.label}</span>
        <Link className="profile-link" href={ROUTES.profile}>
          <CircleUserRound size={18} aria-hidden="true" /> Hồ sơ
        </Link>
      </header>
      <nav className="app-nav" aria-label="Điều hướng chính">
        <ul>
          {links.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link href={href} aria-current={pathname === href ? 'page' : currentSection?.href === href ? 'location' : undefined}>
                <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main id="main-content" tabIndex={-1} className="app-main">{children}</main>
    </div>
  )
}
