'use client'

import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

export function DeskDialog({ title, close, children }: {title: string; close: () => void; children: ReactNode}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return <dialog ref={dialog} className="desk-dialog" aria-labelledby="desk-dialog-title" onCancel={close}>
    <header><h2 id="desk-dialog-title">{title}</h2><button onClick={close} aria-label="Đóng"><X size={20}/></button></header>
    {children}
  </dialog>
}
