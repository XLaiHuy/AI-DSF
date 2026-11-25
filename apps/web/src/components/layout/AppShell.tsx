'use client'

import { ROUTES } from '@fincopilot/shared-types'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Calculator,
  CircleUserRound,
  House,
  LayoutGrid,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import Link, { useLinkStatus } from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { buttonVariants } from '@/components/ui'
import { cn } from '@/lib/utils'
import { sessionQuery } from '@/lib/workspace-data'

const links = [
  { href: ROUTES.home, label: 'Trang chủ', icon: House },
  { href: ROUTES.radar, label: 'Tin & Cảnh báo', icon: Activity },
  { href: ROUTES.survey, label: 'Khảo sát', icon: Calculator },
  { href: ROUTES.forensic, label: 'Giám định', icon: ShieldCheck },
]

function NavigationLabel({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus()
  return <span className="app-nav-content" aria-busy={pending || undefined}>{children}</span>
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const session = useQuery(sessionQuery)
  const isAdmin = session.data?.kind === 'user' && session.data.user.role === 'ADMIN'
  const operating = pathname === ROUTES.admin || pathname.startsWith(ROUTES.admin + '/')
  const profileHref = pathname === ROUTES.profile ? ROUTES.profile
    : `${ROUTES.profile}?returnTo=${encodeURIComponent(pathname)}`
  const currentSection = links.find(({ href }) =>
    href === ROUTES.home ? pathname === ROUTES.home : pathname === href || pathname.startsWith(`${href}/`),
  )

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Chuyển đến nội dung chính</a>

      <header className="topbar">
        <div className="app-navigation-progress" aria-hidden="true" />
        <Link className="inline-flex items-center gap-2.5 whitespace-nowrap font-bold tracking-tight text-foreground" href={ROUTES.home}>
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-xs">
            <LayoutGrid size={17} aria-hidden="true" />
          </span>
          <span className="text-base">FinCopilot AI</span>
        </Link>

        <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          <Link
            href={profileHref}
            aria-current={pathname === ROUTES.profile ? 'page' : undefined}
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'shrink-0 gap-1.5 px-2 sm:px-3')}
          >
            <CircleUserRound size={15} className="hidden sm:inline" aria-hidden="true" />
            <span>Hồ sơ</span>
          </Link>
          {isAdmin && <Link href={operating ? ROUTES.home : ROUTES.admin}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0 gap-1.5 px-2 sm:px-3')}>
            <SlidersHorizontal size={15} className="hidden sm:inline" aria-hidden="true" />
            {operating ? 'Người dùng' : 'Vận hành'}
          </Link>}
        </div>
      </header>

      <nav className="app-nav" aria-label="Điều hướng chính">
        <ul className="app-nav-list">
          {links.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                prefetch={true}
                className="app-nav-link"
                aria-current={pathname === href ? 'page' : currentSection?.href === href ? 'location' : undefined}
              >
                <NavigationLabel>
                  <Icon size={18} strokeWidth={1.85} className="shrink-0" aria-hidden="true" />
                  <span>{label}</span>
                </NavigationLabel>
              </Link>
            </li>
          ))}
        </ul>

      </nav>

      <main id="main-content" tabIndex={-1} className="app-main">
        {children}
      </main>
    </div>
  )
}
