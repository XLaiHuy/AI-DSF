import {
  ApiErrorCode, ApiErrorSchema, ForensicAuditResponseSchema, ForensicAuditStreamEventSchema,
  type ForensicAuditResponse, type ForensicAuditStage,
} from '@fincopilot/shared-types'
import { ApiError, apiClient } from '@/lib/api-client'

export async function streamAudit(
  payload: FormData, signal: AbortSignal, onStage: (stage: ForensicAuditStage) => void, onFallback: () => void,
) {
  let audit: ForensicAuditResponse | undefined
  try {
    const response = await fetch('/api/v1/forensic/audit/stream', {
      method: 'POST', credentials: 'include', headers: { Accept: 'text/event-stream' }, body: payload, signal,
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok && response.status !== 404 && response.status !== 501 && contentType.includes('json')) {
      const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null))
      if (parsed.success) throw new ApiError(response.status, parsed.data.errorCode, parsed.data.message, parsed.data.details)
    }
    if (!response.ok || !response.body || !contentType.includes('text/event-stream')) {
      if (!response.bodyUsed) await response.body?.cancel().catch(() => undefined)
      throw new Error('Audit stream unavailable')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const frames = buffer.split(/\r?\n\r?\n/)
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart()).join('\n')
          if (!data) continue
          const event = ForensicAuditStreamEventSchema.parse(JSON.parse(data))
          if (event.type === 'stage') onStage(event.stage)
          if (event.type === 'result') audit = event.audit
          if (event.type === 'error') {
            const code = ApiErrorCode.safeParse(event.errorCode)
            throw new ApiError(200, code.success ? code.data : 'ERR_INTERNAL_SERVER', event.message)
          }
          if (event.type === 'done' && audit) return audit
        }
        if (done) throw new Error('Audit stream ended before completion')
      }
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  } catch (error) {
    if (signal.aborted || error instanceof ApiError) throw error
    if (audit) return audit
    onFallback()
    return apiClient.post('/forensic/audit', payload, { signal, schema: ForensicAuditResponseSchema })
  }
}
