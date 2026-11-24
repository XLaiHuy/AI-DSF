'use client'

import { CircleHelp } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

const terms = {
  APR: ['Chi phí vay quy ra một năm', 'APR tính theo tiền bạn thực nhận và tiền bạn phải trả, gồm những khoản phí đã biết. Hai khoản vay ghi cùng lãi suất vẫn có thể có APR khác nhau nếu một khoản trừ phí trước.'],
  EAR: ['Lãi cả năm khi tính cả lãi trên lãi', 'Nếu mức lãi mỗi tháng là 1% và gộp lãi lại để tính tháng sau, sau một năm tỷ lệ là khoảng 12,68%.'],
  DTI: ['Phần thu nhập dùng để trả nợ', 'Ví dụ, mỗi tháng bạn nhận 10 triệu đồng và trả nợ 2 triệu đồng thì DTI là 20%.'],
  '50/30/20': ['Cách chia tiền theo ba nhóm', 'Với 10 triệu đồng thực nhận, bạn có thể dành 5 triệu cho nhu cầu thiết yếu, 3 triệu cho chi tiêu linh hoạt và 2 triệu để tiết kiệm hoặc trả nợ.'],
  CRC: ['Kiểm tra lỗi kỹ thuật của mã QR', 'Giống như dấu niêm phong kỹ thuật: giúp ứng dụng biết mã QR này có bị mờ, hỏng hay cắt ghép sai chuẩn không. Lưu ý quan trọng: CRC “Hợp lệ” chỉ có nghĩa mã quét được bình thường — KHÔNG đồng nghĩa người nhận tiền là uy tín hay an toàn.'],
  QRIBFTTA: ['Chuyển nhanh đến số tài khoản', 'Ứng dụng chuyển qua số tài khoản ngân hàng. Sau khi quét mã, hãy kiểm tra tên và số tài khoản người nhận trước khi xác nhận.'],
} as const

export function TermInfo({ term }: { term: keyof typeof terms }) {
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pinned = useRef(false)
  const [expanded, setExpanded] = useState(false)
  const [native, setNative] = useState(true)
  const [title, explanation] = terms[term]

  function clearClose() {
    if (timer.current) clearTimeout(timer.current)
  }

  function position() {
    if (!button.current || !panel.current) return
    const anchor = button.current.getBoundingClientRect()
    const width = panel.current.offsetWidth
    const height = panel.current.offsetHeight
    const left = Math.max(12, Math.min(innerWidth - width - 12, anchor.left + (anchor.width - width) / 2))
    const top = anchor.bottom + height + 20 <= innerHeight ? anchor.bottom + 8 : Math.max(12, anchor.top - height - 8)
    Object.assign(panel.current.style, { left: `${left}px`, top: `${top}px` })
  }

  function show() {
    clearClose()
    if (!panel.current) return
    if (typeof panel.current.showPopover === 'function') {
      if (!panel.current.matches(':popover-open')) panel.current.showPopover()
      position()
    } else setExpanded(true)
  }

  function hide() {
    if (typeof panel.current?.hidePopover === 'function') panel.current.hidePopover()
    else setExpanded(false)
    pinned.current = false
  }

  function scheduleClose() {
    clearClose()
    if (!pinned.current) timer.current = setTimeout(hide, 160)
  }

  useEffect(() => {
    setNative(typeof HTMLElement.prototype.showPopover === 'function')
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [])

  useEffect(() => {
    if (!expanded) return
    position()
    window.addEventListener('scroll', position, true)
    window.addEventListener('resize', position)
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      if ('key' in event ? event.key === 'Escape' : event.target instanceof Node &&
          !button.current?.contains(event.target) && !panel.current?.contains(event.target)) hide()
    }
    if (!native) {
      window.addEventListener('pointerdown', dismiss)
      window.addEventListener('keydown', dismiss)
    }
    return () => {
      window.removeEventListener('scroll', position, true)
      window.removeEventListener('resize', position)
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', dismiss)
    }
  }, [expanded, native])

  return (
    <span className="inline-flex items-center align-middle">
      <button ref={button} type="button" aria-label={`Giải thích ${term}`} aria-controls={id} aria-expanded={expanded}
        popoverTarget={native ? id : undefined}
        aria-describedby={expanded ? id : undefined}
        className="ms-0.5 inline-grid size-7 shrink-0 place-items-center rounded-md text-primary hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-10"
        onPointerEnter={(event) => { if (event.pointerType === 'mouse') show() }}
        onPointerLeave={(event) => { if (event.pointerType === 'mouse' && !event.currentTarget.matches(':focus-visible')) scheduleClose() }}
        onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) show() }}
        onBlur={() => { if (!pinned.current) scheduleClose() }}
        onClick={(event) => { event.preventDefault(); if (pinned.current) hide(); else { pinned.current = true; show() } }}>
        <CircleHelp size={16} aria-hidden="true" />
      </button>
      <span id={id} ref={panel} popover={native ? 'auto' : undefined} hidden={!native && !expanded}
        onToggle={(event) => {
          const open = event.currentTarget.matches(':popover-open')
          setExpanded(open)
          if (!open) pinned.current = false
        }}
        onPointerEnter={clearClose} onPointerLeave={(event) => { if (event.pointerType === 'mouse') scheduleClose() }}
        className="fixed z-50 m-0 max-h-[calc(100dvh-24px)] w-[min(19rem,calc(100vw-24px))] overflow-auto rounded-xl border border-border bg-card p-3.5 text-left text-sm font-normal leading-relaxed text-foreground shadow-lg">
        <strong className="mb-1 block text-primary">{title}</strong>
        <span className="block">{explanation}</span>
      </span>
    </span>
  )
}
