import { normalizeVietnamese } from './data/trusted-institutions'

const builtin = {
  ck: 'chuyen khoan', stk: 'so tai khoan', ls: 'lai suat', ko: 'khong', k: 'khong',
  dc: 'duoc', nh: 'ngan hang', 'vay nong': 'vay nong', 'l0i 102': 'loi 102',
  'phi giai ngan': 'phi giai ngan', m0m0: 'momo',
}

export type TeencodeAlias = { alias: string; expansion: string }
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function expandTeencode(raw: string, aliases: readonly TeencodeAlias[] = []) {
  let normalized = normalizeVietnamese(raw.normalize('NFKC'))
  const glossary = new Map<string, string>()
  const expansions = new Map(Object.entries(builtin))
  for (const { alias, expansion } of aliases) {
    const token = normalizeVietnamese(alias)
    const definition = normalizeVietnamese(expansion)
    if (token && definition && !expansions.has(token)) expansions.set(token, definition)
  }
  const alternatives = [...expansions.keys()].sort((a, b) => b.length - a.length).map(escapeRegex)
  normalized = normalized.replace(new RegExp(`\\b(?:${alternatives.join('|')})\\b|\\b\\d+(?:tr|k)\\b`, 'g'), (match) => {
    const replacement = expansions.get(match) ?? match.replace(/tr$/, ' trieu').replace(/k$/, ' nghin')
    if (replacement !== match) glossary.set(match, replacement)
    return replacement
  })
  return { normalized, glossary: [...glossary].slice(0, 20).map(([alias, expansion]) => `${alias} → ${expansion}`).join('; '),
    expandedCount: glossary.size }
}

const financialText = /\b(?:ngan hang|tai khoan|chuyen khoan|giao dich|ngan luong|tien|vay|lai suat|giai ngan|tin dung|vi dien tu|momo|vietqr|qr|otp|usdt|crypto|loi 102|lua dao|hop dong|sao ke|trieu|nghin|tai chinh|bao cao|giam dinh|hoa don|bien lai|apr|loan|bank|payment|transfer|finance|scam|wallet)\b/
const financialEvidence = /https?:\/\/|\b[a-z\d-]+(?:\.[a-z\d-]+)*\.[a-z]{2,}\b|(?<!\d)\d(?:[ .-]?\d){6,}|(?:[$€£₫]\s*\d|\d\s*(?:[đ₫]|(?:vnd|usd|eur|jpy|gbp|cny|dollars?|dong)\b))|\b(?:0x[\da-f]{40}|[13T][a-km-zA-HJ-NP-Z1-9]{25,39}|bc1[a-z0-9]{25,})\b/i
const offTopic = /\b(?:viet (?:bai )?tho|lam tho|doc tho|viet truyen|ke chuyen|phuong trinh|pt bac [0-9]|toan lop|giai (?:bai )?toan|bai tap toan|thoi tiet|du bao mua|thu do|cau do|dich (?:cau|tieng|sang|van ban|doan van)|lap trinh|viet (?:ma|doan ma|chuong trinh|code|ham|thuat toan)|thuat toan|cong thuc nau|nau an|phim hay|giai tri|bong da|lich thi dau|choi game|write (?:a |me a )?(?:poem|story|python|javascript|function|code)|solve (?:this |the )?(?:equation|math)|weather|forecast|trivia|capital of|translate)\b/
const injection = /\b(?:ignore (?:all |the )?(?:previous|prior|above|system) instructions|disregard (?:the |all )?(?:system|previous) (?:prompt|instructions)|you are now|pretend you are|act as (?:a |an )?(?:system|developer|unrestricted)|reveal (?:the |your )?system prompt|bo qua (?:moi |cac )?huong dan|dong vai (?:he thong|nha phat trien))\b/

export const forensicRefusal = {
  type: 'refusal',
  code: 'FORENSIC_OFF_TOPIC',
  message: 'Mình có thể giúp kiểm tra giao dịch, khoản vay, mã QR hoặc dấu hiệu lừa đảo. Bạn gửi thêm nội dung tài chính cần giám định nhé.',
} as const

export function shouldRefuseForensicPrompt(raw: string, aliases: readonly TeencodeAlias[] = []) {
  const plain = normalizeVietnamese(raw.trim().normalize('NFKC'))
  if (!offTopic.test(plain) && !injection.test(plain)) return false
  return !financialEvidence.test(raw) && !financialText.test(expandTeencode(raw, aliases).normalized)
}
