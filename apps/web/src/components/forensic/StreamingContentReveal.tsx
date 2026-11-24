'use client'

import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

const motionQuery = '(prefers-reduced-motion: reduce)'
function subscribeMotion(listener: () => void) {
  const media = window.matchMedia(motionQuery)
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia(motionQuery).matches, () => false)
}

export function StreamingTextReveal({ text, complete = true, animate = true, onComplete }: {
  text: string; complete?: boolean; animate?: boolean; onComplete?: () => void
}) {
  const reduced = useReducedMotion()
  const words = text.match(/\S+\s*/gu) ?? []
  const leading = text.match(/^\s*/u)?.[0] ?? ''
  const enabled = animate && !reduced
  const [visible, setVisible] = useState(0)
  const [settled, setSettled] = useState(false)
  const state = useRef({ count: 0, total: 0, complete: false, onComplete, notified: false })

  useEffect(() => {
    Object.assign(state.current, { total: words.length, complete, onComplete })
  }, [words.length, complete, onComplete])

  useEffect(() => {
    const progress = state.current
    const finish = () => {
      if (progress.notified) return
      progress.notified = true
      progress.onComplete?.()
    }
    if (!enabled) {
      if (progress.complete) finish()
      return
    }

    let frame = 0
    let nextWordAt = 0
    let settleAt = 0
    function tick(now: number) {
      const interval = progress.total > 140 ? 14 : 26
      if (progress.count < progress.total) {
        if (!nextWordAt) nextWordAt = now
        if (now >= nextWordAt) {
          const added = Math.min(3, 1 + Math.floor((now - nextWordAt) / interval), progress.total - progress.count)
          progress.count += added
          nextWordAt += added * interval
          setVisible(progress.count)
        }
      } else {
        nextWordAt = 0
        if (progress.complete) {
          if (!settleAt) settleAt = now + 155
          if (now >= settleAt) {
            setSettled(true)
            finish()
            return
          }
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [enabled, complete])

  if (!enabled || settled) return text
  const count = Math.min(visible, words.length)
  const stillRevealing = !complete || count < words.length
  const firstActive = Math.max(0, count - 6)
  return (
    <span data-scr-streaming={stillRevealing || undefined}>
      <span className="sr-only">{complete ? text : ''}</span>
      <span aria-hidden="true">
        {leading + words.slice(0, firstActive).join('')}
        {words.slice(firstActive, count).map((word, offset) => (
          <Fragment key={firstActive + offset}>
            <span className="scr-word">{word.trimEnd()}</span>{word.slice(word.trimEnd().length)}
          </Fragment>
        ))}
      </span>
    </span>
  )
}

export function LiveReplyText({ text, complete }: { text: string; complete: boolean }) {
  return <p className="whitespace-pre-wrap [overflow-wrap:anywhere]"><StreamingTextReveal text={text} complete={complete} /></p>
}

export function RevealBlock({ kind = 'card', section, animate, className, children }: {
  kind?: 'card' | 'list' | 'table' | 'grid'; section?: string; animate: boolean; className?: string; children: ReactNode
}) {
  return <div data-report-section={section} className={cn(animate && 'scr-block', animate && 'scr-kind-' + kind, className)}>{children}</div>
}
