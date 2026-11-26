import { stripZeroWidthAndBidi } from '../../common/untrusted-text'
import { normalizeVietnamese } from './data/trusted-institutions'

export { stripZeroWidthAndBidi }

const builtin = {
  ck: 'chuyen khoan', stk: 'so tai khoan', ls: 'lai suat', ko: 'khong', k: 'khong',
  dc: 'duoc', nh: 'ngan hang', 'vay nong': 'vay nong', 'l0i 102': 'loi 102',
  'phi giai ngan': 'phi giai ngan', m0m0: 'momo',
}

export type TeencodeAlias = { alias: string; expansion: string }
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function expandTeencode(raw: string, aliases: readonly TeencodeAlias[] = []) {
  let normalized = normalizeVietnamese(stripZeroWidthAndBidi(raw).normalize('NFKC'))
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

const financialText = /\b(?:ngan hang|tai khoan|chuyen khoan|giao dich|ngan luong|tien|vay|lai suat|giai ngan|tin dung|vi dien tu|momo|vietqr|qr|otp|usdt|crypto|loi 102|lua dao|hop dong|sao ke|trieu|nghin|tai chinh|hoa don|bien lai|apr|loan|bank|payment|transfer|finance|scam|wallet)\b/
const scamOrDomainContext = /\b(?:lai co dinh|loi nhuan|dau tu|bao loi|sinh trac hoc|quet khuon mat|tam ung|chuyen gap|thanh toan|phi|tien coc|tiet kiem|cccd|vneid|dinh danh|nhiem vu|chot don|hoa hong|tuyen dung|cong tac vien|trung thuong|qua tang|cong an|canh sat|vien kiem sat|toa an|cuc thue|dien luc|shipper|giao hang|don hang|hai quan|ke toan|sep|bao hiem|link la|lien ket la|duong link|duong dan|tai app|cai app|cai ung dung|khoa tai khoan|dong bang|trai phieu|co phieu|quy mo|deposit|invoice|insurance|phishing)\b/
const transactionalToken = /https?:\/\/[a-z\d]|(?<!\d)\d(?:[ .-]?\d){6,}|[$€£₫]\s*\d|\d\s*(?:[đ₫](?!\p{L})|(?:vnd|usd|eur|jpy|gbp|cny|usdt|btc|eth)\b)|\b(?:0x[\da-f]{40}|[13T][a-km-zA-HJ-NP-Z1-9]{25,39}|bc1[a-z0-9]{25,})\b/iu
// Bare domains are useful evidence, but code filenames and DOM members are not destinations.
const bareDomain = /\b(?!(?:document|window|console|math|array|object)\.)[a-z\d-]{1,63}\.(?!(?:html?|css|[cm]?[jt]sx?|py|sql|php|java|cpp|vue|json)\b)[a-z]{2,63}\b/iu
const amountWithUnit = /\b\d+\s?(?:trieu|nghin|ngan|dong|ty|ti|dollars?)\b/
const concreteTerm = /\b(?:vay|loan|ky han|lai suat|lai vay|annual rate|hop dong)\b.{0,45}\b\d+(?:[.,]\d+)?\s*(?:%|thang\b|nam\b|months?\b|years?\b)/
const filler = '(?:(?:cho|giup|ho|dum|toi|minh|em|anh|chi|mot|1|nghe|vai|bai|doan|cau) ){0,4}'
const offTopic = new RegExp(
  `\\b(?:viet ${filler}(?:tho|truyen|ma|chuong trinh|code|ham|thuat toan)|lam ${filler}tho|doc ${filler}tho|ke ${filler}chuyen|giai ${filler}(?:toan|phuong trinh|pt)|dich ${filler}(?:cau|tieng|sang|van ban|doan)|phuong trinh|pt bac [0-9]|toan lop|bai tap toan|thoi tiet|du bao mua|thu do|cau do|lap trinh|thuat toan|cong thuc nau|nau an|phim hay|giai tri|bong da|lich thi dau|html|css|js|javascript|typescript|react|vue|nextjs|python|sql|java|php|script|source code|game|tro choi|ran san moi|snake|caro|tetris|flappy|trang web|website|landing page|thuc don|giam can|tap gym|kich ban|bai van|viet cv|soan email xin nghi|choi game|write (?:a |me a )?(?:poem|story|python|javascript|function|code)|solve (?:this |the )?(?:equation|math)|weather|forecast|trivia|capital of|translate)\\b`,
)
const command = /\b(?:(?:ignore|disregard|override)\s+(?:(?:all|the|earlier|previous|prior|above|system|developer|safety|your|any|existing|original)\s+)*(?:instructions?|rules?|prompts?)|you are now|pretend you are|act as (?:a |an |the )?(?:system|developer|unrestricted)|(?:reveal|show|print|repeat|return|display|extract)\s+(?:(?:the|your|original|full|hidden)\s+)*(?:system|developer)\s+prompt|bo qua (?:moi |tat ca |cac )?(?:chi dan|huong dan|quy tac)|dong vai (?:he thong|nha phat trien)|(?:tiet lo|in|hien thi|cho xem|lap lai|trich xuat) (?:loi nhac|chi dan|prompt) (?:cua )?he thong|(?:ai\s+(?:hay\s+)?)?(?:ket luan|danh gia|bao|xac nhan|gan)\s+(?:(?:giao dich|ho so|khoan vay)(?:\s+nay)?\s+)?(?:la\s+)?an toan|(?:output|return|mark|declare|classify as)\s*[:=]?\s*["']?safe\b|(?:risk[_\s-]*score|diem rui ro)\s*[:=]\s*0)\b/
const spoofedRole = /<\s*\/?\s*(?:system|developer)(?=[\s>])|<\s*\/?\s*untrusted_data\b|<\s*\/?\s*untrusted_data_|\[\s*(?:system|developer)\s*\]|#{3,}[ \t]*(?:system|developer)\b/
export const isolatedControlText = '[đoạn nghi thao túng đã bị cô lập]'

function normalizePrompt(raw: string) {
  return stripZeroWidthAndBidi(raw).normalize('NFKC').normalize('NFD')
    .replace(/\p{M}/gu, '').toLowerCase().replaceAll('đ', 'd')
}

function controlIndex(plain: string) {
  return Math.min(command.exec(plain)?.index ?? Infinity, spoofedRole.exec(plain)?.index ?? Infinity)
}

export function hasPromptInjection(raw: string) {
  return Number.isFinite(controlIndex(normalizePrompt(raw)))
}

export function isOffTopicPrompt(raw: string) {
  return /\bc\+\+(?!\w)/i.test(raw) || offTopic.test(normalizeVietnamese(normalizePrompt(raw)))
}

export function hasFinancialDomain(raw: string, aliases: readonly TeencodeAlias[] = []) {
  const { normalized } = expandTeencode(raw, aliases)
  return financialText.test(normalized) || scamOrDomainContext.test(normalized)
}

export function hasConcreteFinancialEvidence(raw: string, aliases: readonly TeencodeAlias[] = []) {
  const clean = stripZeroWidthAndBidi(raw).normalize('NFKC')
  const plain = normalizePrompt(clean)
  const { normalized } = expandTeencode(clean, aliases)
  return /\bphi giai ngan\b/.test(normalized) || transactionalToken.test(clean) || bareDomain.test(clean) || amountWithUnit.test(normalized) ||
    concreteTerm.test(plain) || /\b(?:vietqr|qribftt[ac])\b.{0,10}[=:]\s*\S+/i.test(clean)
}

function matchingPrefix(raw: string, offset: number) {
  // Map the normalized match back to the source so the evidence before it stays verbatim.
  let length = 0
  for (const match of raw.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) {
    length += normalizePrompt(match[0]).length
    if (length > offset) return raw.slice(0, match.index)
  }
  return ''
}

export function inspectForensicInput(raw: string, aliases: readonly TeencodeAlias[] = []) {
  const hasInjection = hasPromptInjection(raw)
  if (!hasInjection && !isOffTopicPrompt(raw)) {
    return { refuseDirect: false, hasIndirectInjection: false, strippedControlSpans: 0, sanitizedText: raw }
  }
  let strippedControlSpans = 0
  const segments = raw.split(/(\r\n|\n|\r|;|(?<=[.!?。！？])[ \t]+)/u)
  const preserved = segments.map((segment) => {
    const offset = controlIndex(normalizePrompt(segment))
    if (!Number.isFinite(offset)) return segment
    strippedControlSpans += 1
    return matchingPrefix(segment, offset)
  })
  // Treat a directive split over lines as one clause if neither line matched on its own.
  if (hasInjection && strippedControlSpans === 0) {
    const prefix = matchingPrefix(raw, controlIndex(normalizePrompt(raw)))
    const hasEvidence = hasConcreteFinancialEvidence(prefix, aliases)
    return { refuseDirect: !hasEvidence, hasIndirectInjection: hasEvidence, strippedControlSpans: 1,
      sanitizedText: prefix + isolatedControlText }
  }
  const preservedText = preserved.join('')
  const hasEvidence = hasConcreteFinancialEvidence(preservedText, aliases)
  return {
    refuseDirect: !hasEvidence,
    hasIndirectInjection: strippedControlSpans > 0 && hasEvidence,
    strippedControlSpans,
    sanitizedText: strippedControlSpans
      ? segments.map((segment, index) => segment === preserved[index] ? segment : preserved[index] + isolatedControlText).join('')
      : raw,
  }
}

export const forensicRefusal = {
  type: 'refusal',
  code: 'FORENSIC_OFF_TOPIC',
  message: 'Mình có thể giúp kiểm tra giao dịch, khoản vay, mã QR hoặc dấu hiệu lừa đảo. Bạn gửi thêm nội dung tài chính cần giám định nhé.',
} as const

export function shouldRefuseForensicPrompt(raw: string, aliases: readonly TeencodeAlias[] = []) {
  return inspectForensicInput(raw, aliases).refuseDirect
}
