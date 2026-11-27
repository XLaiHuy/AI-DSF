'use client'

import { ROUTES } from '@fincopilot/shared-types'
import { useQuery } from '@tanstack/react-query'
import { AudioLines, Calculator, ChevronDown, CircleUserRound, Bookmark, History, House, ListFilter, Menu, Radio, ScanLine, Settings2 } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRef, useState } from 'react'
import { sessionQuery } from '@/lib/workspace-data'

export type DeskPanel = 'brief' | 'topics' | 'sources' | 'quick' | 'history' | 'profile' | 'preferences'

export function DeskMark() {
  return <span aria-hidden="true" className="desk-logo"><AudioLines size={19} /></span>
}

export function DeskNavigation({ openPanel, selectView }: {
  openPanel?: (view: DeskPanel) => void
  selectView?: (view: 'articles' | 'personal') => void
}) {
  const session = useQuery(sessionQuery)
  const pathname = usePathname()
  const user = session.data?.kind === 'user' ? session.data.user : undefined
  const [expanded, setExpanded] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const profile = pathname === ROUTES.profile ? ROUTES.profile : ROUTES.profile + '?returnTo=' + encodeURIComponent(pathname)
  return <nav className="desk-nav" aria-label="Điều hướng chính">
    <div className="desk-nav-top"><Link href="/" className="desk-brand"><DeskMark />FinCopilot</Link>
      {process.env.NEXT_PUBLIC_UI_FIXTURE_MODE === 'true' && <span className="ui-fixture-label" aria-label="Chế độ dữ liệu minh họa, không phải dữ liệu thật">BẢN MẪU</span>}
      <button type="button" ref={menuButton} onKeyDown={event => { if (event.key === 'Escape') setExpanded(false) }} className="desk-menu" aria-label="Menu điều hướng" aria-expanded={expanded} aria-controls="desk-destinations" onClick={()=>setExpanded(!expanded)}><Menu /></button></div>
    <div id="desk-destinations" className="desk-destinations" data-open={expanded} onClick={()=>setExpanded(false)} onKeyDown={(event) => { if (event.key === 'Escape') { setExpanded(false); menuButton.current?.focus() } }}>
      <Link className="desk-profile" aria-current={pathname === ROUTES.profile ? 'page' : undefined} href={profile}><span className="desk-avatar">{user?.avatarUrl ? <Image unoptimized width={32} height={32} className="h-full w-full rounded-full object-cover" src={user.avatarUrl} alt="" /> : <CircleUserRound size={22}/>}</span><span>{user?.displayName || 'Hồ sơ tài chính'}<small>{user ? 'Tài khoản cá nhân' : session.data?.kind === 'guest' ? 'Phiên khách' : 'Mở hồ sơ'}</small></span><ChevronDown size={15}/></Link>
      <div className="desk-nav-group"><Link className="desk-nav-item desk-nav-priority" aria-current={pathname === ROUTES.forensic ? 'page' : undefined} href={ROUTES.forensic}><ScanLine/>Giám định lừa đảo & QR</Link>
        {selectView ? <button type="button" className="desk-nav-item" aria-current="page" onClick={()=>selectView('articles')}><House/>Bảng tin & Thị trường</button> : <Link className="desk-nav-item" href="/" aria-current={pathname.startsWith('/radar/') ? 'page' : undefined}><House/>Bảng tin & Thị trường</Link>}
        <Link className="desk-nav-item" aria-current={pathname === ROUTES.survey ? 'page' : undefined} href={ROUTES.survey}><Calculator/>Khảo sát & Tính toán</Link></div>
      <div className="desk-nav-group">{!selectView && <Link className="desk-nav-item" href="/?feed=saved"><Bookmark/>Tin đã lưu</Link>}<Link className="desk-nav-item" href="/?feed=history"><History/>Lịch sử đọc</Link>
        {openPanel && <button type="button" className="desk-nav-item" onClick={()=>openPanel('history')}><History/>Hoạt động gần đây</button>}</div>
      <div className="desk-nav-group">{openPanel && <><button type="button" className="desk-nav-item" onClick={()=>openPanel('topics')}><ListFilter/>Chủ đề & thời gian</button>
        <button type="button" className="desk-nav-item" onClick={()=>openPanel('sources')}><Radio/>Nguồn thu thập</button>
        <button type="button" className="desk-nav-item" onClick={()=>openPanel('quick')}><Calculator/>Khảo sát nhanh</button></>}
        {(user?.role === 'ADMIN' || pathname === ROUTES.admin) && <Link className="desk-nav-item" aria-current={pathname === ROUTES.admin ? 'page' : undefined} href={ROUTES.admin}><Settings2/>Vận hành</Link>}</div>
    </div>
  </nav>
}
