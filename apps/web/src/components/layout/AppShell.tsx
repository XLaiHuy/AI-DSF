'use client'

import { ROUTES } from '@fincopilot/shared-types'
import {
  Activity,
  Calculator,
  CircleUserRound,
  House,
  LayoutGrid,
  Lock,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { Badge, buttonVariants } from '@/components/ui'
import { cn } from '@/lib/utils'

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
  const currentSection = links.find(({ href }) =>
    href === ROUTES.home ? pathname === ROUTES.home : pathname === href || pathname.startsWith(`${href}/`),
  )

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Chuyển đến nội dung chính</a>

      <header className="topbar">
        <Link className="inline-flex items-center gap-2.5 whitespace-nowrap font-bold tracking-tight text-foreground" href={ROUTES.home}>
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-xs">
            <LayoutGrid size={17} aria-hidden="true" />
          </span>
          <span className="text-base">FinCopilot AI</span>
        </Link>

        <div className="hidden items-center gap-2.5 border-l border-border pl-3 md:flex">
          <span className="text-sm font-medium text-muted-foreground">
            {currentSection?.label ?? 'Tổng quan'}
          </span>
          <Badge variant="info" className="font-mono text-[11px]">AI-DSF</Badge>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href={ROUTES.forensic}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
          >
            <ShieldAlert size={15} className="text-primary" aria-hidden="true" />
            <span className="hidden sm:inline">Giám định nhanh</span>
            <span className="sm:hidden">Giám định</span>
          </Link>

          <Link
            href={ROUTES.profile}
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'hidden gap-1.5 text-accent-foreground sm:inline-flex')}
          >
            <CircleUserRound size={15} aria-hidden="true" />
            <span>Hồ sơ</span>
          </Link>
        </div>
      </header>

      <nav className="app-nav" aria-label="Điều hướng chính">
        <ul className="app-nav-list">
          {links.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="app-nav-link"
                aria-current={pathname === href ? 'page' : currentSection?.href === href ? 'location' : undefined}
              >
                <Icon size={18} strokeWidth={1.85} className="shrink-0" aria-hidden="true" />
                <span>{label}</span>
              </Link>
            </li>
          ))}
        </ul>

        <Link
          href={ROUTES.profile}
          className="hidden rounded-xl border border-border bg-muted/60 p-3.5 transition-colors hover:border-primary/30 hover:bg-accent/50 md:block"
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Lock size={14} className="shrink-0 text-primary" aria-hidden="true" />
            <span>Phiên khách ẩn danh</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Bảo mật PII · Tùy chỉnh ngữ cảnh hồ sơ tài chính tại đây.
          </p>
        </Link>
      </nav>

      <main id="main-content" tabIndex={-1} className="app-main">
        {children}
      </main>
    </div>
  )
}
