import { ForensicGuidanceSchema } from '@fincopilot/shared-types'
import { z } from 'zod'

const key = 'fincopilot:conversation'
const ttl = 2 * 60 * 60 * 1_000
const cachedConversation = z.strictObject({
  owner: z.string(),
  id: z.uuid(),
  expiresAt: z.number(),
  turns: z.array(z.strictObject({
    question: z.string().max(800), guidance: ForensicGuidanceSchema,
  })).max(3),
})

type CachedConversation = z.infer<typeof cachedConversation>

export function readConversationCache(owner: string) {
  try {
    const value = cachedConversation.safeParse(JSON.parse(sessionStorage.getItem(key) ?? 'null'))
    if (value.success && value.data.owner === owner && value.data.expiresAt > Date.now()) return value.data
  } catch {
    // Browser storage is optional.
  }
}

export function writeConversationCache(owner: string, id: string, turns: CachedConversation['turns'], expiresAt: number) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ owner, id, expiresAt, turns }))
  } catch {
    // A blocked or full storage bucket does not prevent chatting.
  }
}

export function safeCachedQuestion(input: string) {
  return input.length > 800 ? 'Tin nhắn dài'
    : input.replace(/https?:\/\/[^\s<>"']+/gi, '[liên kết]')
      .replace(/\S+@\S+\.\S+/g, '[email]')
      .replace(/(?<!\d)(?:\+84|0[35789])(?:[ .-]?\d){8,9}(?!\d)/g, '[số điện thoại]')
      .replace(/((?:CCCD|CMND|STK|số tài khoản|mã OTP)\s*[:#]?\s*)\d(?:[ .-]?\d){3,22}/giu, '$1[đã ẩn]')
      .replace(/\b\d{7,}\b(?!\s*(?:đồng|vnđ|đ|₫))/giu, '[đã ẩn]')
}

export const conversationCacheExpiry = () => Date.now() + ttl
