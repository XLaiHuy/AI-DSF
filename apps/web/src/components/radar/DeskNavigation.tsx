'use client'

import { ROUTES } from '@fincopilot/shared-types'
import { useQuery } from '@tanstack/react-query'
import { AudioLines, Calculator, ChevronDown, CircleUserRound, History, House, ListFilter, Menu, Radio, ScanLine, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRef, useState } from 'react'
import { sessionQuery } from '@/lib/workspace-data'

export type DeskPanel = 'brief' | 'topics' | 'sources' | 'quick' | 'history' | 'profile' | 'preferences'

export function DeskMark() {
  return <span aria-hidden="true" className="desk-logo"><AudioLines size={19} /></span>
}

export function DeskNavigation({ openPanel, selectView }: {
  openPanel: (view: DeskPanel) => void
  selectView: (view: 'articles' | 'personal') => void
}) {
  const session = useQuery(sessionQuery)
  const pathname = usePathname()
  const user = session.data?.kind === 'user' ? session.data.user : undefined
  const [expanded, setExpanded] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const profile = ROUTES.profile + '?returnTo=' + encodeURIComponent(pathname)
  return <nav className="desk-nav" aria-label="Điều hướng chính">
    <div className="desk-nav-top"><Link href="/" className="desk-brand"><DeskMark />FinCopilot</Link>
      {process.env.NEXT_PUBLIC_UI_FIXTURE_MODE === 'true' && <span className="ui-fixture-label" aria-label="Chế độ dữ liệu minh họa, không phải dữ liệu thật">BẢN MẪU</span>}
      <button ref={menuButton} className="desk-menu" aria-label="Menu điều hướng" aria-expanded={expanded} aria-controls="desk-destinations" onClick={()=>setExpanded(!expanded)}><Menu /></button></div>
    <div id="desk-destinations" className="desk-destinations" data-open={expanded} onClick={()=>setExpanded(false)} onKeyDown={(event) => { if (event.key === 'Escape') { setExpanded(false); menuButton.current?.focus() } }}>
      <Link className="desk-profile" href={profile}><span className="desk-avatar"><CircleUserRound size={22}/></span><span>{user?.displayName || 'Hồ sơ tài chính'}<small>{user ? 'Tài khoản cá nhân' : session.data?.kind === 'guest' ? 'Phiên khách' : 'Mở hồ sơ'}</small></span><ChevronDown size={15}/></Link>
      <div className="desk-nav-group"><Link className="desk-nav-item desk-nav-priority" href={ROUTES.forensic}><ScanLine/>Giám định lừa đảo & QR</Link>
        <button className="desk-nav-item" aria-current="page" onClick={()=>selectView('articles')}><House/>Bảng tin & Thị trường</button>
        <Link className="desk-nav-item" href={ROUTES.survey}><Calculator/>Khảo sát & Tính toán</Link></div>
      <div className="desk-nav-group"><Link className="desk-nav-item" href="/?feed=history"><History/>Lịch sử đọc</Link>
        <button className="desk-nav-item" onClick={()=>openPanel('history')}><History/>Hoạt động gần đây</button></div>
      <div className="desk-nav-group"><button className="desk-nav-item" onClick={()=>openPanel('topics')}><ListFilter/>Chủ đề & thời gian</button>
        <button className="desk-nav-item" onClick={()=>openPanel('sources')}><Radio/>Nguồn thu thập</button>
        <button className="desk-nav-item" onClick={()=>openPanel('quick')}><Calculator/>Khảo sát nhanh</button>
        {user?.role === 'ADMIN' && <Link className="desk-nav-item" href={ROUTES.admin}><Settings2/>Vận hành</Link>}</div>
    </div>
  </nav>
}
