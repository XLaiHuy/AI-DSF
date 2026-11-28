import { AI_TASK_SCHEMAS, handoffRoutes, type ForensicAuditFields, type ForensicGuidance } from '@fincopilot/shared-types'
import { hasInternalIdentifierLeak } from '../../common/untrusted-text'
import { amountToken, rateToken, termToken, copilotIntent, copilotLoanGoal, type CopilotInput, type CopilotIntent, type ExtractedSlots as Slots, type SurveyDomain } from './copilot-input'
import { compressConversationContext } from './context-compressor'
import type { ConversationSessionState } from './conversation-session.store'
import type { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { hasSuspiciousContext } from './complexity-router'
import { findInstitution, normalizeVietnamese } from './data/trusted-institutions'
import { screened } from './forensic-chat-stream'
import { assistantIntro, expandTeencode, forensicRefusal, hasConcreteFinancialEvidence, hasFinancialDomain, inspectForensicInput,
  isOffTopicPrompt, stripVietnameseParticles, type TeencodeAlias } from './forensic-prompt-guard'
import { parseVnd } from './hard-rules.engine'
import { formatCaseAmount } from './payment-qr-description'
import { maskForensicText } from './qr-evidence'

type Guidance = Omit<ForensicGuidance, 'type'>
type History = NonNullable<ForensicAuditFields['preAuditHistory']>
type ConversationAi = Pick<AiGatewayService, 'generateStructured'> & Partial<Pick<AiGatewayService, 'classifyConversationRoute'>>

const loanGoal = /^(?:(?:toi|minh|em|anh|chi) )?(?:(?:muon|can|tu van|hoi ve|tim hieu) )*vay(?: tien| von(?: kinh doanh)?| kinh doanh| mua nha| mua xe| tieu dung| tra gop| the chap| tin chap)?$/
const investmentGoal = /^(?:(?:toi|minh|em|anh|chi) )?(?:(?:muon|can|nen|tu van|tim hieu) )*(?:dau tu(?: gi| the nao)?|quy mo)$/
const savingsGoal = /^(?:(?:toi|minh|em|anh|chi) )?(?:(?:muon|can|nen|tu van|tim hieu) )*(?:gui tiet kiem|tiet kiem|tich luy)$/
const question = /[?？]/u
const interrogative = /\b(?:bao nhieu|the nao|duoc khong|co nen|nen dau tu gi|lai gi|an toan khong|thi sao)\b/
const profileQuestion = /^(?:(?:toi|minh|em|can|muon) )*(?:kiem tra suc khoe tai chinh|danh gia tai chinh ca nhan|suc khoe tai chinh)$|^(?:(?:toi|minh|em) )?luong\b.*\bchi\b.*\bvay duoc khong$/
const genericScam = /^(?:(?:nguoi la goi (?:keu|bao|yeu cau) chuyen tien|app vay(?: tien)? (?:online|truc tuyen)|loi moi dau tu|tin nhan la) )?(?:co phai lua dao khong|co lua dao khong|lua dao khong|co uy tin khong|co an toan khong)$/
const evidenceInvitation = /^toi muon gui (?:noi dung tin nhan dang ngo|anh sao ke da che thong tin rieng de lap ho so va luu pdf trinh bao)$/
const emergency = /\b(?:chuyen nham(?: (?:stk|so tai khoan|tien))?|vua bi lua(?: dao)?|lo (?:tay )?(?:chuyen tien|chuyen khoan|nhap (?:ma )?otp|bam link|cai app)|cai (?:dat )?app la roi|da (?:gui|nhap|doc) (?:ma )?otp)\b/
const requestHelp = /\b(?:phai lam sao|lam sao|lam gi|xu ly|cach nao|cuu minh|cuu toi|giup minh|giup toi|ung cuu)\b/
const loanComparison = /^(?:(?:toi|minh|em) )?(?:(?:muon|can|tu van) )*(?:so sanh lai suat(?: vay)?|so sanh (?:cac )?khoan vay)$/
const surveyLabels: Record<SurveyDomain, string> = { LOAN: 'vay', INVEST: 'đầu tư', SAVINGS: 'tích lũy' }

const educationTopics: readonly [RegExp, string][] = [
  [/\bapr\b/, 'APR là tỷ lệ chi phí khoản vay quy đổi theo năm. So sánh APR của các khoản vay có kỳ hạn tương đương và kiểm tra những loại phí được tính vào chỉ số.'],
  [/\bear\b/, 'EAR là lãi suất hiệu dụng theo năm. Chỉ số tính cả tác động cộng dồn của lãi theo từng kỳ.'],
  [/\bdti\b/, 'DTI là tỷ lệ tổng tiền trả nợ hằng tháng trên thu nhập hằng tháng. Bạn có thể xem chỉ số này và khoản chi cố định trong Hồ sơ tài chính.'],
  [/\b(?:lai phang|du no giam dan)\b/, 'Lãi phẳng tính trên số vốn ban đầu. Lãi theo dư nợ giảm dần tính trên số gốc còn lại ở mỗi kỳ. Hãy so sánh cả lịch trả nợ và tổng chi phí.'],
  [/\bquy du phong\b/, 'Quỹ dự phòng thường lấy 3–6 tháng chi phí thiết yếu làm mốc tham chiếu. Mức phù hợp còn tùy độ ổn định của thu nhập và các khoản phải trả.'],
  [/\b(?:tran lai suat|dieu 468|lai suat dan su)\b/, 'Điều 468 Bộ luật Dân sự 2015 dùng mức 20%/năm làm trần lãi suất thỏa thuận, trừ trường hợp luật khác có quy định. Cần xem loại bên cho vay và các điều khoản cụ thể.'],
  [/\b(?:tin dung den|vay nang lai)\b/, 'Cảnh giác với yêu cầu nộp phí để giải ngân, thông tin pháp nhân mập mờ và lãi hoặc phí không ghi rõ. Bạn có thể gửi điều khoản đã che thông tin riêng để giám định.'],
  [/\b(?:phishing|lua dao gia mao)\b/, 'Phishing là hành vi giả mạo để lấy thông tin đăng nhập hoặc khiến bạn thực hiện giao dịch. Đối chiếu qua kênh chính thức và giữ kín mật khẩu, mã OTP.'],
]

export function educationGuide(raw: string) {
  const plain = stripVietnameseParticles(raw)
  if (!question.test(raw) && !/\b(?:la gi|khac gi|khac nhau|phan biet|the nao|dau hieu|giai thich|tinh sao|bao nhieu)\b/.test(plain)) return null
  const matching = educationTopics.filter(([topic]) => topic.test(plain))
  return matching.length ? matching.map(([, answer]) => answer).join(' ') : null
}

const emergencyRecovery = {
  intent: 'EMERGENCY_SCAM_RECOVERY',
  message: 'Hãy liên hệ ngân hàng ngay bằng một thiết bị an toàn. Bạn có thể làm theo các bước sau.',
  checklist: [
    'Nếu đã cài ứng dụng lạ, ngắt mạng thiết bị đó và gỡ ứng dụng. Dùng một thiết bị an toàn để liên hệ ngân hàng.',
    'Gọi tổng đài trên thẻ hoặc kênh chính thức của ngân hàng. Yêu cầu khóa thẻ hoặc tài khoản và tra soát giao dịch.',
    'Giữ nguyên biên lai, tin nhắn và mã giao dịch để làm bằng chứng.',
    'Trình báo cơ quan Công an gần nhất hoặc gửi phản ánh qua VNeID chính thức.',
    'Cảnh giác với người hứa “thu hồi vốn”. Không đưa thêm tiền, mật khẩu hoặc mã OTP.',
  ],
  suggestedPrompts: ['Tôi muốn gửi ảnh sao kê đã che thông tin riêng để lập hồ sơ và lưu PDF trình báo'],
} satisfies Guidance

export function emergencyGuide(raw: string): Guidance | null {
  const plain = normalizeVietnamese(raw)
  const disclosure = /^(?:(?:toi|minh|em) )?(?:vua bi lua(?: dao)?|lo (?:chuyen tien|chuyen khoan|nhap (?:ma )?otp|bam link|cai app)|cai (?:dat )?app la roi)(?: roi)?$/
  if (!disclosure.test(plain) && !(emergency.test(plain) && requestHelp.test(plain))) return null
  return emergencyRecovery
}

export function surveyDomain(raw: string): SurveyDomain | undefined {
  const plain = stripVietnameseParticles(raw)
  const remainder = normalizeVietnamese(raw.replace(amountToken, ' ').replace(termToken, ' '))
  if (loanComparison.test(plain) || loanGoal.test(plain) || /^(?:(?:toi|minh|em) )?vay bao nhieu(?: thi an toan| thi phu hop)?$/.test(plain) ||
    loanGoal.test(remainder.replace(/(?: trong| ky han)? (?:co )?duoc khong$/, '')) ||
    loanGoal.test(remainder.replace(/ (?:trong|ky han)$/, ''))) return 'LOAN'
  if (investmentGoal.test(plain) || /^(?:(?:toi|minh|em) )?co .*\bnen dau tu gi$/.test(plain)) return 'INVEST'
  if (savingsGoal.test(plain) || savingsGoal.test(remainder.replace(/ (?:trong|ky han)$/, '')) ||
    /\b(?:muon|can|nen) (?:gui tiet kiem|tiet kiem|tich luy)\b/.test(plain)) return 'SAVINGS'
}

function isAssertion(raw: string) {
  const plain = normalizeVietnamese(raw)
  return !question.test(raw) && !interrogative.test(plain) && !/\b(?:neu|gia su|khong|chua|chang|toi da|toi thieu|it nhat|nhieu nhat)\b/.test(plain)
}

function explicitSlots(raw: string, suggestedAmount?: string): Pick<Slots, 'amountVnd' | 'termMonths'> {
  if (!isAssertion(raw)) return {}
  const amounts = [...raw.matchAll(amountToken)].map(match => ({
    value: parseVnd(match),
    prefix: normalizeVietnamese(raw.slice(0, match.index)),
  })).filter(({ prefix }) => !/\b(?:luong|thu nhap|chi tieu|chi phi|tra no|tien nha)(?: (?:thuc nhan|co dinh|hang|moi|thang|hien tai|khoang|cua|toi|minh|em|la|duoc))*$/.test(prefix))
  const terms = [...raw.matchAll(termToken)]
  const amountVnd = amounts.length === 1 ? amounts[0].value : amounts.find(({ value, prefix }) =>
    value === suggestedAmount && /\b(?:so tien ban dau|von|ngan sach)(?: (?:ban dau|hien co|cua|toi|minh|em|la|khoang))*$/.test(prefix))?.value
  const months = terms.length === 1 ? Number(terms[0][1]) * (normalizeVietnamese(terms[0][2]) === 'nam' ? 12 : 1) : 0
  return { ...(amountVnd && { amountVnd }), ...(months > 0 && months <= 600 && { termMonths: months }) }
}

function updatesSurveySlots(raw: string) {
  const remainder = normalizeVietnamese(raw.replace(amountToken, ' ').replace(termToken, ' '))
  const qualifiers = remainder.replace(/^(?:neu )?(?:vay )?/, '').replace(/(?:^| )(?:co )?(?:duoc khong|thi sao|co phu hop khong)$/, '')
  return /^(?:(?:toi|minh|em|doi|lai|sua|thanh|muon|can|khoang|so|tien|la|trong|voi|ky|han|them|luong|giu|nguyen|thoi|nhe|nha|a)\b\s*)*$/.test(qualifiers) &&
    Boolean(raw.match(amountToken) || raw.match(termToken))
}

function surveyContext(history: History) {
  let slots: Slots & { domain?: SurveyDomain } = {}
  for (const { role, content, intent } of history.slice(-6)) {
    // The first user turn can fall outside the six-turn window. Restore its summarized slots
    // only for survey navigation, after the current turn has passed evidence screening.
    if (!slots.domain && role === 'assistant' && intent === 'NEEDS_DETAILS') {
      const summary = content.match(/^Thông số (vay|đầu tư|tích lũy) bạn đã nhập là ([^.]+)\./u)
      const domain = (Object.keys(surveyLabels) as SurveyDomain[]).find(key => surveyLabels[key] === summary?.[1])
      if (domain && summary) slots = { domain, ...explicitSlots(summary[2]) }
    }
    if (role !== 'user' || !guidanceEligible(content)) continue
    const domain = surveyDomain(content)
    if (domain) {
      slots = { ...(slots.domain === domain ? slots : {}), domain, ...explicitSlots(content) }
    } else if ((slots.domain && updatesSurveySlots(content)) || personalCapital.test(stripVietnameseParticles(content))) {
      slots = { ...slots, ...explicitSlots(content) }
    }
  }
  return slots
}

export function compactPreAuditHistory(history: History) {
  // Preserve whole turns. A character-by-character cutoff can remove a number or its negation.
  return history.slice(-6).filter(({ content }) => !isOffTopicPrompt(content) && inspectForensicInput(content).strippedControlSpans === 0)
    .map(({ role, content, intent }) => ({ role, content: maskForensicText(content), intent }))
}

function surveyGuide(domain: SurveyDomain, slots: Slots): Guidance {
  const loan = domain === 'LOAN'
  const amountLabel = slots.amountVnd ? formatCaseAmount(slots.amountVnd) : null
  const termLabel = slots.termMonths ? slots.termMonths + ' tháng' : null
  const saved = [amountLabel, termLabel].filter(Boolean).join(' trong ')
  const nextQuestion = loan
    ? !amountLabel && !termLabel ? 'Bạn dự định vay bao nhiêu và trả trong bao lâu?' : !amountLabel ? 'Bạn dự định vay bao nhiêu?' : !termLabel ? 'Bạn muốn trả trong bao lâu?' : 'Bạn có thể dùng Khảo sát để ước tính khoản trả.'
    : domain === 'INVEST' ? 'Bạn định đầu tư bao lâu và chấp nhận biến động đến mức nào?' : 'Bạn dự định gửi ban đầu bao nhiêu và tích lũy thêm bao nhiêu mỗi tháng?'
  const href = slots.amountVnd && /[1-9]/.test(slots.amountVnd) && slots.termMonths
    ? loan ? handoffRoutes.quickSurvey({ amount: slots.amountVnd, term: slots.termMonths })
      : '/survey?' + new URLSearchParams({ mode: 'invest', amount: slots.amountVnd, term: String(slots.termMonths) })
    : loan ? '/survey?mode=loan' : '/survey?mode=invest'
  return {
    intent: 'NEEDS_DETAILS',
    message: [saved && 'Thông số ' + surveyLabels[domain] + ' bạn đã nhập là ' + saved + '.', nextQuestion,
      'Nếu đã có hợp đồng hoặc lời mời cụ thể, bạn có thể gửi để mình giám định.'].filter(Boolean).join(' '),
    suggestedPrompts: loan
      ? ['Tôi cần vay … đồng trong … tháng']
      : ['Số tiền ban đầu của tôi là … đồng'],
    cta: { label: loan ? 'Mở Khảo sát khoản vay' : 'Mở Khảo sát đầu tư và tích lũy', href },
    extractedSlots: { ...slots, domain },
  }
}

export function guidanceEligible(raw: string, aliases?: readonly TeencodeAlias[], copilot?: CopilotIntent) {
  if (isOffTopicPrompt(raw) || inspectForensicInput(raw, aliases).strippedControlSpans > 0) return false
  const isCivilLimit = /\b(?:tran lai suat|dieu 468|lai suat dan su)\b/.test(normalizeVietnamese(raw))
  const checked = isCivilLimit ? raw.replace(/(?<![\d.,])20\s*%\s*(?:\/\s*năm)?/giu, ' ') : raw
  const remainder = checked.replace(amountToken, ' ').replace(termToken, ' ').replace(rateToken, ' ')
  const plain = expandTeencode(raw, aliases).normalized
  const termsOffered = copilot !== 'REFINANCE' && Boolean(checked.match(rateToken)) &&
    Boolean(checked.match(amountToken) || checked.match(termToken)) && !informationSeeking.test(plain)
  const genericBankAllowed = copilot === 'RADAR' || copilot === 'REFINANCE'
  const evidenceContext = genericBankAllowed ? plain.replace(/\bngan hang\b/g, ' ') : plain
  return !hasConcreteFinancialEvidence(remainder, aliases) &&
    !(copilot && /\b(?:ben cho vay|nguoi la|loi moi|tin nhan|chao moi|bao giai ngan)\b/.test(plain)) &&
    !/\b(?:ngan hang|cong ty|to chuc|cong an|ke toan|shipper|dien luc|hai quan|sep|hop dong|hoa don|don hang|link la|duong dan|vneid|stk|so tai khoan|sdt|so dien thoai|phi giai ngan|loi 102|dong bang von|mao danh|gia mao|cam ket loi nhuan|yeu cau nop|chao lai|bao lai|bao phi|hen giai ngan|uy thac|bao loi|usdt|btc|eth|crypto)\b/.test(evidenceContext) &&
    !termsOffered && !hasSuspiciousContext(plain) &&
    !findInstitution(plain.replace(/^(?:ben|don vi|ten) /, ''), []) && !/\b(?:vay|gui tiet kiem|dau tu) (?:o|tai|tu|qua) \w/.test(plain) &&
    !/\b(?:vietcombank|vietinbank|techcombank|agribank|bidv|mbbank|vpbank|fe credit|home credit|mcredit)\b/.test(plain)
}

const recoveryCheck = {
  intent: 'SCAM_CHECK_INCOMPLETE',
  message: 'Tạm dừng giao dịch và xác minh qua kênh chính thức. Bạn có thể gửi tên đơn vị, đường dẫn, tin nhắn hoặc ảnh chụp đã che thông tin riêng để mình kiểm tra.',
  suggestedPrompts: ['Tôi muốn gửi nội dung tin nhắn đáng ngờ'],
} satisfies Guidance

const profileGuide = {
  intent: 'PROFILE_HEALTH_NAV',
  message: 'Tỷ lệ trả nợ (DTI) và số tháng quỹ dự phòng giúp ước tính khả năng chi trả. Mở Hồ sơ tài chính và nhập thu nhập, chi phí, khoản nợ hiện tại để xem các chỉ số.',
  cta: { label: 'Mở Hồ sơ tài chính', href: '/profile' },
  extractedSlots: { domain: 'PROFILE' },
} satisfies Guidance

const assistantGuide = {
  intent: 'ASSISTANT_INFO',
  message: 'Chào bạn, mình là FinCopilot. Mình giúp đọc điều khoản vay, kiểm tra mã QR và nhận diện dấu hiệu lừa đảo trong lời mời tài chính.',
  suggestedPrompts: ['Tôi muốn vay', 'Tôi muốn đầu tư'],
} satisfies Guidance

export function isSmalltalkAck(raw: string) {
  return /^(?:cam on(?: ban| nhieu| ban nhieu)?|ok(?: hieu roi)?|oke|okay|minh hieu roi|hieu roi|ro roi|tuyet voi|tot roi|tam biet(?: ban)?|thank you|thanks)$/
    .test(stripVietnameseParticles(raw)) && !question.test(raw)
}

const informationSeeking = /\b(?:la gi|khac nhau|giai thich|tim hieu|doc thong tin|khai niem|nghia la gi)\b/
const planningLanguage = /\b(?:ke hoach|ngan sach|quan ly chi tieu|dong tien|thu nhap|chi phi sinh hoat|de danh|tich luy|dau tu|tiet kiem)\b/
const ambiguousQuestion = /^(?:(?:toi|minh|em) )?(?:nen|co nen|tu van|huong dan|muon hieu|lam sao de|cach)\b/
const personalCapital = /\b(?:so tien ban dau|von (?:ban dau|hien co)|ngan sach|(?:toi|minh|em|anh|chi) (?:dang |hien )?co|(?:hien |dang )?co san)\b/
const guidance = (result: Guidance): ForensicGuidance => ({ type: 'guidance', ...result })

export async function routeForensicConversation(
  fields: ForensicAuditFields, hasFiles: boolean, ai: ConversationAi, aliases?: readonly TeencodeAlias[],
  loadSession?: () => Promise<ConversationSessionState | undefined>,
  runCopilot?: (input: Omit<CopilotInput, 'session'>) => Promise<Guidance | undefined>,
) {
  const { rawText, rawQrString, sourceAlertId, claimedEntityName, preAuditHistory = [] } = fields
  if (hasFiles || rawQrString || !rawText) return null

  const inspection = inspectForensicInput(rawText, aliases)
  if (inspection.refuseDirect) return forensicRefusal
  if (inspection.hasIndirectInjection || isOffTopicPrompt(rawText)) {
    const evidence = inspection.sanitizedText.replace(amountToken, ' ').replace(termToken, ' ').replace(rateToken, ' ')
    const describedCase = /\b(?:hop dong|giao dich|hoa don|yeu cau chuyen|bao phi|loi 102)\b/.test(expandTeencode(evidence, aliases).normalized)
    return hasConcreteFinancialEvidence(evidence, aliases) || describedCase ? null : forensicRefusal
  }
  if (claimedEntityName || sourceAlertId) return null
  const plain = stripVietnameseParticles(rawText)
  if (assistantIntro(rawText)) return guidance(assistantGuide)
  if (isSmalltalkAck(rawText)) return guidance({ intent: 'ACK_SMALLTALK', message: 'Mình luôn sẵn sàng nếu bạn có câu hỏi tài chính khác.' })

  const recovery = emergencyGuide(rawText)
  if (recovery && !hasConcreteFinancialEvidence(rawText.replace(amountToken, ' '), aliases) &&
    (/\bchuyen nham\b/.test(plain) || !/\b(?:so tai khoan|stk|bien lai|ma giao dich)\b/.test(plain))) return guidance(recovery)

  if (genericScam.test(plain) || evidenceInvitation.test(plain)) return guidance(recoveryCheck)
  const toolIntent = runCopilot && copilotIntent(rawText)
  if ((toolIntent === 'RADAR' || toolIntent === 'REFINANCE' || toolIntent === 'PROFILE') &&
    guidanceEligible(rawText, aliases, toolIntent)) {
    const result = await runCopilot?.({ rawText, slots: {} })
    if (result) return guidance(result)
  }
  const education = educationGuide(rawText)
  const lookingUp = informationSeeking.test(plain)
  const remainder = rawText.replace(amountToken, ' ').replace(termToken, ' ').replace(rateToken, ' ')
  const generalEducation = lookingUp && !hasConcreteFinancialEvidence(remainder, aliases) &&
    !hasSuspiciousContext(expandTeencode(rawText, aliases).normalized)
  const eligible = guidanceEligible(rawText, aliases) || generalEducation
  if (!eligible) return null
  if (toolIntent !== 'LOAN' && profileQuestion.test(plain)) return guidance(profileGuide)

  const session = await loadSession?.()
  const previous = session ? { ...session.slots, domain: session.domain } : surveyContext(preAuditHistory)
  const newDomain = surveyDomain(rawText) ?? (toolIntent === 'LOAN' || toolIntent === 'INVEST' || toolIntent === 'SAVINGS' ? toolIntent : undefined)
  const domain = newDomain ?? (updatesSurveySlots(rawText) ? previous.domain : undefined)
  const stated = explicitSlots(rawText)
  if (domain === 'LOAN' || domain === 'INVEST' || domain === 'SAVINGS') {
    const priorSlots = previous.domain === domain || (!previous.domain && domain !== 'LOAN') ? previous : {}
    const goalNote = runCopilot && domain === 'LOAN' ? copilotLoanGoal(rawText) : undefined
    const fallback = surveyGuide(domain, { ...priorSlots, ...stated, ...(goalNote && { goalNote }) })
    if (runCopilot && guidanceEligible(rawText, aliases, domain)) {
      const result = await runCopilot({ rawText, domain, slots: priorSlots })
      if (result) return guidance(newDomain ? result : { ...result, cta: fallback.cta })
    }
    return guidance(fallback)
  }

  if (!previous.domain && updatesSurveySlots(rawText) && rawText.match(amountToken) && rawText.match(termToken) &&
    !personalCapital.test(plain)) return null
  const hasCapital = Boolean(stated.amountVnd) && (personalCapital.test(plain) || updatesSurveySlots(rawText))
  const hasFinance = hasFinancialDomain(rawText, aliases)
  const fallback: Guidance | null = hasCapital ? {
    intent: 'NEEDS_DETAILS',
    message: 'Bạn muốn dùng khoản này để tiết kiệm, đầu tư hay lên kế hoạch cho một mục tiêu cụ thể?',
    suggestedPrompts: ['Tôi muốn tích lũy', 'Tôi muốn tìm hiểu cách đầu tư'],
    extractedSlots: { ...previous, ...stated },
  } : education ? { intent: 'FINANCIAL_EDUCATION', message: education }
    : (hasFinance && (lookingUp || ambiguousQuestion.test(plain))) || planningLanguage.test(plain) || previous.domain
      ? { intent: 'NEEDS_DETAILS', message: 'Bạn muốn tìm hiểu khái niệm nào hoặc đang cân nhắc quyết định tài chính gì?' }
      : null
  if (hasCapital && fallback && !ai.classifyConversationRoute) return guidance(fallback)
  if (!fallback && !ai.classifyConversationRoute) return hasFinance ? null : forensicRefusal
  const onUnavailable = () => fallback ? guidance(fallback) : forensicRefusal
  if (rawText.length > 8_000) return hasFinance ? null : onUnavailable()

  const history = session?.recentTurns ?? compactPreAuditHistory(preAuditHistory)
  const context = compressConversationContext(history, session?.rollingSummary ?? '')
  const payload = {
    current_turn: maskForensicText(rawText),
    compressedContext: {
      domain: previous.domain, slots: { amountVnd: previous.amountVnd, termMonths: previous.termMonths, goalNote: previous.goalNote },
      rollingSummary: context.summary, recentTurns: context.recentTurns,
    },
  }
  const canAudit = !hasCapital && !education && !generalEducation
  try {
    const signals = await ai.classifyConversationRoute?.(payload)
    if (signals) {
      if (canAudit && signals.isAuditableCaseProb >= 0.72) return null
      if (signals.isEmergencyLossProb >= 0.75 && !hasCapital) return guidance(emergencyRecovery)
      if (signals.isOffTopicProb >= 0.85 && signals.isSocialGreetingOrAckProb < 0.30 && !fallback) return forensicRefusal
    }

    const guide = await ai.generateStructured('FORENSIC_CONVERSATION_GUIDE', AI_TASK_SCHEMAS.FORENSIC_CONVERSATION_GUIDE,
      ai.classifyConversationRoute || session ? { ...payload, ...(signals && { classification: signals }) }
        : { current_turn: payload.current_turn, history })
    if (guide.route === 'OFF_TOPIC') return onUnavailable()
    if (guide.route === 'FULL_AUDIT') return canAudit ? null : onUnavailable()
    if (guide.route === 'EMERGENCY_SCAM_RECOVERY') return hasCapital || education ? onUnavailable() : guidance(emergencyRecovery)
    if ((education && guide.route !== 'FINANCIAL_EDUCATION') || (hasCapital && guide.route !== 'NEEDS_DETAILS')) return onUnavailable()

    const sanitize = (text: string) => hasInternalIdentifierLeak([text]) ? '' : screened(maskForensicText(text), true)
    const message = sanitize(guide.answer)
    if (!message || /\b(?:chac chan|dam bao|cam ket)\b.{0,40}\b(?:duyet|giai ngan)\b/.test(normalizeVietnamese(message))) {
      return onUnavailable()
    }
    const suggestedPrompts = guide.suggestedPrompts.map(sanitize).filter(Boolean)
    const planning = guide.route === 'NEEDS_DETAILS' && (guide.domain === 'LOAN' || guide.domain === 'INVEST' || guide.domain === 'SAVINGS') ? guide.domain : undefined
    const goalNote = guide.slots?.goalNote
    const affirmedGoal = goalNote && isAssertion(rawText) && payload.current_turn.includes(goalNote) && sanitize(goalNote)
    const template = planning ? surveyGuide(planning, {
      ...(previous.domain === planning || !previous.domain ? previous : {}),
      ...explicitSlots(rawText, guide.slots?.amountVnd),
      ...(affirmedGoal && { goalNote: affirmedGoal }),
    }) : guide.route === 'PROFILE_HEALTH_NAV' ? profileGuide : guide.route === 'SCAM_CHECK_INCOMPLETE' ? recoveryCheck : fallback
    return guidance({ ...template, intent: guide.route, message, suggestedPrompts })
  } catch {
    return onUnavailable()
  }
}
