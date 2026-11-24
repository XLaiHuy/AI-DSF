'use client'

import { ROUTES } from '@fincopilot/shared-types'
import {
  Activity, Calculator, CircleUserRound, House, LayoutGrid, Lock,
  MoreHorizontal, ShieldAlert, ShieldCheck, SlidersHorizontal,
} from 'lucide-react'
import Link, { useLinkStatus } from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { useState } from 'react'
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

function NavigationLabel({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus()
  return <span className="app-nav-content" aria-busy={pending || undefined}>{children}</span>
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const isRadarLanding = pathname === ROUTES.radar
  const [moreOpen, setMoreOpen] = useState(false)
  const primaryHrefs: string[] = [ROUTES.home, ROUTES.radar, ROUTES.survey]
  const primaryLinks = links.filter(({ href }) => primaryHrefs.includes(href))
  const secondaryLinks = links.filter(({ href }) => !primaryHrefs.includes(href))
  const profileHref = pathname === ROUTES.profile ? ROUTES.profile : `${ROUTES.profile}?returnTo=${encodeURIComponent(pathname)}`
  const currentSection = links.find(({ href }) => href === ROUTES.home ? pathname === ROUTES.home : pathname === href || pathname.startsWith(`${href}/`))

  return (
    <div className={isRadarLanding ? 'app-shell app-shell--radar' : 'app-shell'}>
      <a className="skip-link" href="#main-content">Chuyển đến nội dung chính</a>
      <header className="topbar">
        <div className="app-navigation-progress" aria-hidden="true" />
        <Link className="inline-flex items-center gap-2.5 whitespace-nowrap font-bold tracking-tight text-foreground" href={ROUTES.home}>
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-xs"><LayoutGrid size={17} aria-hidden="true" /></span>
          <span className="text-base">FinCopilot AI</span>
        </Link>
        <div className="hidden items-center gap-2.5 border-l border-border pl-3 md:flex">
          <span className="text-sm font-medium text-muted-foreground">{currentSection?.label ?? 'Tổng quan'}</span>
          <Badge variant="info" className="font-mono text-[11px]">AI-DSF</Badge>
        </div>
        <Badge variant="outline" className="hidden gap-1.5 lg:inline-flex"><ShieldCheck size={13} className="text-primary" aria-hidden="true" /> Đối chiếu Luật VN · Xóa ảnh gốc</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Link href={ROUTES.forensic} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}>
            <ShieldAlert size={15} className="text-primary" aria-hidden="true" /><span className="hidden sm:inline">Giám định nhanh</span><span className="sm:hidden">Giám định</span>
          </Link>
          <Link href={profileHref} className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'hidden gap-1.5 text-accent-foreground sm:inline-flex')}>
            <CircleUserRound size={15} aria-hidden="true" /><span>Hồ sơ</span>
          </Link>
        </div>
      </header>
      <nav className={isRadarLanding ? 'app-nav app-nav--radar' : 'app-nav'} aria-label="Điều hướng chính" onKeyDown={(event) => { if (event.key === 'Escape') setMoreOpen(false) }}>
        <div className="app-nav-groups">
          <div>
            <p className="app-nav-heading hidden md:block">Không gian làm việc</p>
            <ul className="app-nav-list">
              {primaryLinks.map(({ href, label, icon: Icon }) => <li key={href}>
                <Link href={href === ROUTES.profile ? profileHref : href} prefetch className="app-nav-link" title={isRadarLanding ? label : undefined} aria-current={pathname === href ? 'page' : currentSection?.href === href ? 'location' : undefined}>
                  <NavigationLabel><Icon size={18} strokeWidth={1.85} className="shrink-0" aria-hidden="true" /><span>{label}</span></NavigationLabel>
                </Link>
              </li>)}
              <li className="app-nav-more md:hidden">
                <button type="button" className="app-nav-link" aria-expanded={moreOpen} aria-controls="secondary-navigation" aria-current={secondaryLinks.some(({ href }) => pathname === href || pathname.startsWith(`${href}/`)) ? 'location' : undefined} onClick={() => setMoreOpen((open) => !open)}>
                  <MoreHorizontal size={18} strokeWidth={1.85} aria-hidden="true" /><span>Thêm</span>
                </button>
              </li>
            </ul>
            {moreOpen && <ul id="secondary-navigation" className="app-nav-overflow md:hidden" aria-label="Điều hướng bổ sung">
              {secondaryLinks.map(({ href, label, icon: Icon }) => <li key={href}><Link href={href === ROUTES.profile ? profileHref : href} className="app-nav-overflow-link" aria-current={pathname === href || pathname.startsWith(`${href}/`) ? 'page' : undefined} onClick={() => setMoreOpen(false)}><Icon size={17} aria-hidden="true" /><span>{label}</span></Link></li>)}
            </ul>}
          </div>
          <div className="hidden md:block">
            <p className="app-nav-heading">Công cụ khác</p>
            <ul className="app-nav-list app-nav-secondary-list">
              {secondaryLinks.map(({ href, label, icon: Icon }) => <li key={href}><Link href={href === ROUTES.profile ? profileHref : href} className="app-nav-link" title={isRadarLanding ? label : undefined} aria-current={pathname === href || pathname.startsWith(`${href}/`) ? 'page' : undefined}><Icon size={18} strokeWidth={1.85} className="shrink-0" aria-hidden="true" /><span>{label}</span></Link></li>)}
            </ul>
          </div>
        </div>
        <Link href={profileHref} className="app-nav-privacy hidden rounded-xl border border-border bg-muted/60 p-3.5 transition-colors hover:border-primary/30 hover:bg-accent/50 md:block">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground"><Lock size={14} className="shrink-0 text-primary" aria-hidden="true" /><span>Hồ sơ và quyền riêng tư</span></div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Quản lý hồ sơ tài chính, tài khoản và lịch sử giám định.</p>
        </Link>
      </nav>
      <main id="main-content" tabIndex={-1} className="app-main">{children}</main>
    </div>
  )
}
