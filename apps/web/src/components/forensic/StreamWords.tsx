'use client'

export const wordInterval = 34
export function wordGroups(text: string) {
  return text.match(/(?:\S+\s*){1,2}/gu) ?? []
}

export function StreamWords({ chunks, count, active }: { chunks: string[]; count: number; active: boolean }) {
  const firstActive = active ? Math.max(0, count - 6) : count
  return <>
    {chunks.slice(0, firstActive).join('')}
    {chunks.slice(firstActive, count).map((chunk, index) => (
      <span key={firstActive + index} className="scr-word">{chunk}</span>
    ))}
  </>
}

export { LiveReplyText, RevealBlock, StreamingTextReveal } from './StreamingContentReveal'
