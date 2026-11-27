import { createHash } from 'node:crypto'
import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ForensicGuidanceSchema, PreAuditTurnSchema, type SessionContext } from '@fincopilot/shared-types'
import { z } from 'zod'
import { RedisService } from '../../common/redis.service'
import { compressConversationContext } from './context-compressor'

export const conversationTtlSeconds = 7_200
const maxSessionBytes = 4_096
const slotSchema = ForensicGuidanceSchema.shape.extractedSlots.unwrap()
const stateSchema = z.strictObject({
  domain: slotSchema.shape.domain,
  slots: slotSchema.omit({ domain: true }),
  rollingSummary: z.string(),
  recentTurns: z.array(PreAuditTurnSchema).max(4),
  lastIntent: ForensicGuidanceSchema.shape.intent.optional(),
  updatedAt: z.iso.datetime(),
})

export type ConversationSessionState = z.infer<typeof stateSchema>

function sessionKey(owner: SessionContext, id: string) {
  const identity = owner.kind === 'user' ? 'user:' + owner.userId : 'guest:' + owner.guestSessionId
  const ownerHash = createHash('sha256').update(identity).digest('hex')
  return `fincopilot:conv:{${ownerHash}}:${id.toLowerCase()}`
}

@Injectable()
export class ConversationSessionStore {
  constructor(private readonly redis: RedisService) {}

  async load(owner: SessionContext, id: string) {
    const raw = await this.redis.get(sessionKey(owner, id))
    if (!raw) return { raw, state: undefined }
    try {
      const parsed = stateSchema.safeParse(JSON.parse(raw))
      return { raw, state: parsed.success ? parsed.data : undefined }
    } catch {
      return { raw, state: undefined }
    }
  }

  async save(owner: SessionContext, id: string, expected: string | null, state: ConversationSessionState) {
    let budget = 500
    let raw: string
    do {
      const context = compressConversationContext(state.recentTurns, state.rollingSummary, budget)
      raw = JSON.stringify({ ...state, rollingSummary: context.summary, recentTurns: context.recentTurns })
      budget -= 50
    } while (Buffer.byteLength(raw) > maxSessionBytes && budget >= 0)
    if (Buffer.byteLength(raw) > maxSessionBytes) return false
    return this.redis.saveOpenSession(sessionKey(owner, id), expected, raw, conversationTtlSeconds)
  }

  async remove(owner: SessionContext, id: string) {
    await this.redis.closeSession(sessionKey(owner, id), conversationTtlSeconds).catch(() => {
      throw new ServiceUnavailableException()
    })
  }
}
