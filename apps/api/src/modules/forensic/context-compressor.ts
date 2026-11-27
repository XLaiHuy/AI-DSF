import type { ForensicAuditFields } from '@fincopilot/shared-types'

export type PreAuditTurn = NonNullable<ForensicAuditFields['preAuditHistory']>[number]
export type ProtectedSpan = { text: string; start: number; end: number }

const protectedPattern = /https?:\/\/[^\s<>"']+|\b[\w-]+(?:\.[\w-]+)+\.[a-z]{2,}\b|\b[a-z][a-z\d-]+\.[a-z]{2,}(?:\/[^\s<>"']*)?|\b(?:STK|SĐT|số tài khoản|số điện thoại|CCCD|CMND|QR|VietQR)\s*(?:[:=#]\s*)?[\p{L}\d*+-]*(?:\d[ .-]?){3,}|(?<!\d)(?:\+84|0)\d(?:[ .-]?\d){7,9}|\b\d{7,}\b|(?<![\p{L}\d])\d+(?:(?:[.,]|\s(?=\d{3}\b))\d+)*\s*(?:(?:triệu|trieu|tr|nghìn|nghin|ngàn|ngan|tỷ|tỉ|ty|ti|k)(?:\s*(?:đồng|dong|VNĐ|VND|đ|₫))?|đồng|dong|VNĐ|VND|đ|₫|%|tháng|thang|năm|nam)(?![\p{L}\d])|(?<!\p{L})(?:Điều|Dieu|Khoản|Khoan)\s+\d+[\p{L}]?|\bBLDS(?:\s+\d{4})?|(?<!\p{L})(?:không\s+(?:nhiều hơn|ít hơn|quá|phải)|không|chưa|chẳng|đừng|khong|chua|chang)(?!\p{L})/giu

export function protectedSpans(text: string): ProtectedSpan[] {
  return Array.from(text.matchAll(protectedPattern), match => ({
    text: match[0], start: match.index, end: match.index + match[0].length,
  }))
}

export function preservesProtectedSpans(original: string, compressed: string) {
  let after = 0
  for (const span of protectedSpans(original)) {
    const index = compressed.indexOf(span.text, after)
    if (index < 0) return false
    after = index + span.text.length
  }
  return true
}

const estimateTokens = (value: string) => Math.ceil(value.length / 3)
const boilerplate = /^(?:Mình luôn sẵn sàng nếu bạn có câu hỏi tài chính khác\.|Nếu đã có hợp đồng hoặc lời mời cụ thể, bạn có thể gửi để mình giám định\.)$/u

function compressText(text: string) {
  let start = 0
  let compressed = ''
  for (const span of protectedSpans(text)) {
    compressed += text.slice(start, span.start).replace(/\s+/gu, ' ') + span.text
    start = span.end
  }
  compressed += text.slice(start).replace(/\s+/gu, ' ')
  const trimmed = compressed.trim()
  return preservesProtectedSpans(text, trimmed) ? trimmed : text
}

export function compressConversationContext(turns: readonly PreAuditTurn[], rollingSummary: string, tokenBudget = 500) {
  const originalTokens = estimateTokens([rollingSummary, ...turns.map(turn => turn.content)].join('\n'))
  const budget = Math.max(0, Math.floor(tokenBudget))
  const recent = turns.slice(-4)
  const summaryLines = rollingSummary.split('\n• ').filter(Boolean)
  for (const turn of turns.slice(0, -4)) {
    const text = compressText(turn.content)
    // Retain old customer statements and dated or numeric advice. Drop repeated assistant prompts.
    if (turn.role === 'assistant' && (boilerplate.test(text) || protectedSpans(text).length === 0)) continue
    if (!summaryLines.includes(text)) summaryLines.push(text)
  }

  const recentTurns = recent.map(turn => ({ ...turn, content: compressText(turn.content) }))
  const count = () => estimateTokens([...summaryLines, ...recentTurns.map(turn => turn.content)].join('\n'))
  // Shrink the context window by dropping entire entries, never cutting an amount or its negation.
  while (count() > budget && summaryLines.length) summaryLines.shift()
  while (count() > budget && recentTurns.length) recentTurns.shift()
  const compressedTokens = count()
  return {
    summary: summaryLines.join('\n• '),
    recentTurns,
    originalTokens,
    compressedTokens,
    savingsPct: originalTokens ? (originalTokens - compressedTokens) / originalTokens * 100 : 0,
  }
}
