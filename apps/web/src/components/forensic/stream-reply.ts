import { ForensicFollowUpResponseSchema, type ForensicFollowUpRequest, type ForensicFollowUpResponse } from '@fincopilot/shared-types'
import { z } from 'zod'

const eventSchema = z.union([
  z.strictObject({ delta: z.string() }),
  ForensicFollowUpResponseSchema.omit({ answer: true }).extend({ done: z.literal(true) }),
])

export async function streamReply(path: string, input: ForensicFollowUpRequest, signal: AbortSignal,
  onText: (text: string) => void): Promise<ForensicFollowUpResponse> {
  const response = await fetch(`/api/v1${path}/stream`, {
    method: 'POST', credentials: 'include', signal,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(input),
  })
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('Stream unavailable')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let answer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
        if (!data) continue
        const event = eventSchema.parse(JSON.parse(data))
        if ('done' in event) {
          if (!answer.trim()) throw new Error('Stream reply is empty')
          return { answer, meta: event.meta, richCard: event.richCard, toolTrace: event.toolTrace, cta: event.cta }
        }
        answer += event.delta
        if (answer.length > 64_000) throw new Error('Stream reply exceeds its limit')
        onText(answer)
      }
      if (done || buffer.length > 64_000) throw new Error('Stream ended before reply was complete')
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
