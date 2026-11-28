import { ForensicGuidanceSchema } from '@fincopilot/shared-types'
import { z } from 'zod'

const key = 'fincopilot:conversation'
const ttl = 2 * 60 * 60 * 1_000
const cacheHeader = z.strictObject({ owner: z.string(), id: z.uuid(), expiresAt: z.number() })
const textTurn = z.strictObject({ question: z.string().max(800), answer: z.string().max(4000) })
const cachedConversation = cacheHeader.extend({
  turns: z.array(textTurn).max(3),
  activeAuditId: z.uuid().optional(),
  followUpTurns: z.array(textTurn).max(6).optional(),
})
const legacyConversation = cacheHeader.extend({
  turns: z.array(z.strictObject({ question: z.string().max(800), guidance: ForensicGuidanceSchema })).max(3),
})

type CachedConversation = z.infer<typeof cachedConversation>

const maskTurn = (turn: z.infer<typeof textTurn>) => ({
  question: safeCachedQuestion(turn.question),
  answer: safeCachedQuestion(turn.answer, 4000),
})

export function readConversationCache(owner: string): CachedConversation | undefined {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    const value = cachedConversation.safeParse(raw)
    if (value.success && value.data.owner === owner && value.data.expiresAt > Date.now()) {
      return { ...value.data, turns: value.data.turns.map(maskTurn), followUpTurns: value.data.followUpTurns?.map(maskTurn) }
    }
    const legacy = legacyConversation.safeParse(raw)
    if (legacy.success && legacy.data.owner === owner && legacy.data.expiresAt > Date.now()) {
      return { ...legacy.data, turns: legacy.data.turns.map(({ question, guidance }) => maskTurn({ question, answer: guidance.message })) }
    }
  } catch {
    // Browser storage is optional.
  }
}

export function clearConversationCache({ unlessOwner }: { unlessOwner?: string } = {}) {
  try {
    if (unlessOwner && readConversationCache(unlessOwner)) return
    sessionStorage.removeItem(key)
  } catch {
    // Browser storage is optional.
  }
}

export function writeConversationCache(value: CachedConversation) {
  try {
    sessionStorage.setItem(key, JSON.stringify({
      ...value, turns: value.turns.slice(-3).map(maskTurn), followUpTurns: value.followUpTurns?.slice(-6).map(maskTurn),
    }))
  } catch {
    // A blocked or full storage bucket does not prevent chatting.
  }
}

export function safeCachedQuestion(input: string, limit = 800) {
  return input
    .replace(/(?:https?:\/\/|www\.)[^\s<>"']+/gi, '[liên kết]')
    .replace(/\S+@\S+\.\S+/g, '[email]')
    .replace(/(?<!\d)(?:\+84|0[2-9])(?:[ .-]?\d){8,10}(?!\d)/g, '[số điện thoại]')
    .replace(/((?:CCCD|CMND|STK|số tài khoản|mã OTP)\s*[:#]?\s*)\d(?:[ .-]?\d){3,22}/giu, '$1[đã ẩn]')
    .replace(/(?<!\d)\d(?:[ .-]?\d){6,}(?!\d)/g, '[đã ẩn]')
    .slice(0, limit)
}

export const conversationCacheExpiry = () => Date.now() + ttl
