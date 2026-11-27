import Decimal from 'decimal.js'
import type { FinancialHealthRequest, ForensicAuditResponse, ForensicFollowUpRequest, ForensicFollowUpResponse } from '@fincopilot/shared-types'
import { normalizeVietnamese } from './data/trusted-institutions'
import { educationGuide, emergencyGuide, guidanceEligible, isSmalltalkAck, surveyDomain } from './forensic-conversation'
import { buildForensicDossier, followUpAnchor } from './forensic-narrative'
import { evaluateHardRules, parseVnd } from './hard-rules.engine'
import { formatCaseAmount } from './payment-qr-description'
import { evaluatePersonalImpact } from './personal-impact.engine'
import { maskForensicText } from './qr-evidence'
import { assistantIntro, isOffTopicPrompt, shouldRefuseForensicPrompt, type TeencodeAlias } from './forensic-prompt-guard'

type Intent = NonNullable<ForensicFollowUpResponse['meta']['intent']>
const vnd = /(?<![\p{L}\d.,])(\d+(?:[., ]\d+){0,5})\s*(triệu|tr|tỷ|tỉ|nghìn|ngàn|k|đồng|vnd|vnđ|đ|₫)(?![\p{L}\d])/giu
const foreignAmount = /(?:\$\s*\d|\b\d+(?:[., ]\d+)*\s*(?:usd|usdt|eur|jpy|btc|eth)\b)/iu
const newTerms = /\b(?:lai(?: suat)?|ky han|phi)\b.{0,28}\b\d|\b(?:loi 102|dong bang von)\b/
const newDemand = /\b(?:doi|bat|yeu cau|bao minh|bao toi|bieu minh|bieu toi)\b.{0,70}\b(?:them|tra|gui|chuyen|nop|nap|dong|otp|link|phi)\b/
const explicitSignal = /\b(?:ben kia|ben cho vay|nguoi nhan|ho|san)\b.{0,28}\b(?:gui|dua|hoi|doi|can|bao)\b.{0,40}\b(?:otp|link|duong dan|phi|mat khau|bao hiem|tai app)\b/
const newCue = /\b(?:bo sung|quen noi|thong tin moi|vua bao|moi bao|thuc ra)\b/
const purpose = /(?:^|[,;\s])(?:nội dung|ghi chú)\s*(?:là\s+|[:=]\s*)?([^,;.!?\n]{1,160})/iu
const ack = /^(?:ok|oke|okay|u|uh|vang|da|cam on|thank you|thanks|hieu roi|ro roi|minh hieu roi|tot roi)(?: (?:nhe|nha|a|ban|roi|nhieu|lam|cam on)){0,2}$/

const facts = (question: string) => {
  const text = question.normalize('NFKC')
  const amounts = [...text.matchAll(vnd)].flatMap((match) => {
    const amount = parseVnd(match)
    return amount && new Decimal(amount).gt(0) ? [amount] : []
  })
  return { amountVnd: amounts.reduce<string | null>((max, amount) => max === null || new Decimal(amount).gt(max) ? amount : max, null),
    purposeText: text.match(purpose)?.[1]?.trim() ?? null, foreign: foreignAmount.test(text) }
}

export function statedTransferAmount(text: string) {
  const transfer = /\b(?:chuyen khoan|chuyen tien|gui tien|thanh toan|nap tien|tra tien|chuyen ho|chuyen gium|chuyen giup|nho chuyen)\b/
  const amounts = text.split(/[\n;!?]+|(?<=\.)\s+/u)
    .filter((line) => transfer.test(normalizeVietnamese(line)))
    .flatMap((line) => facts(line).amountVnd ?? [])
  return amounts.reduce<string | null>((max, amount) => max === null || new Decimal(amount).gt(max) ? amount : max, null)
}

export function classifyFollowUpIntent(question: string, audit: ForensicAuditResponse, aliases?: readonly TeencodeAlias[]): Intent {
  const plain = normalizeVietnamese(question)
  if (isSmalltalkAck(question) || !/[?？]/u.test(question) && plain.split(' ').length <= 4 && ack.test(plain)) return 'ACK'
  if (isOffTopicPrompt(question) || shouldRefuseForensicPrompt(question, aliases)) return 'OFF_TOPIC'
  if (assistantIntro(question)) return 'ASSISTANT_INFO'
  const emergency = emergencyGuide(question)
  if (emergency) return 'EMERGENCY_SCAM_RECOVERY'
  if (guidanceEligible(question, aliases)) {
    if (educationGuide(question)) return 'FINANCIAL_EDUCATION'
    if (surveyDomain(question) && !facts(question).amountVnd) return 'NEEDS_DETAILS'
  }
  const { amountVnd, purposeText, foreign } = facts(question)
  const sameAmount = amountVnd && audit.qrPayloads.some((qr) => qr.qrAmountVnd && new Decimal(qr.qrAmountVnd).eq(amountVnd))
  const samePurpose = purposeText && audit.qrPayloads.some((qr) => normalizeVietnamese(qr.purposeText ?? '') === normalizeVietnamese(purposeText))
  const isQuestion = /^(?:(?:cho|theo) (?:minh|ban|toi) )?(?:tai sao|vi sao|co phai|(?:minh|toi) co nen|co nen|giai thich|the nao|bao nhieu)\b/.test(plain)
  if (newCue.test(plain) || newDemand.test(plain) || explicitSignal.test(plain) || (amountVnd && !sameAmount) ||
    (!isQuestion && (purposeText && !samePurpose || foreign || newTerms.test(plain) || /\d\s*%/u.test(question)))) return 'NEW_CONTEXT'
  return 'FINANCIAL_QA'
}

export function recheckFollowUpContext(question: string, audit: ForensicAuditResponse, profile: FinancialHealthRequest | null) {
  const { amountVnd, purposeText, foreign } = facts(question)
  const personalImpact = evaluatePersonalImpact(profile, null, [{ qrAmountVnd: amountVnd }])
  const rules = evaluateHardRules({ evidence: [question], claimedEntityName: null, qrPayloads: [], indicators: [], institutions: [] })
  const plain = normalizeVietnamese(question)
  const additionalSignal = /\b(?:phi giai ngan|loi 102|otp|bao hiem|lai phang|lai bac thang|crypto|usdt|nap vi|doi tien|duong dan|link)\b/.test(plain)
    || /https?:\/\//iu.test(question)
  const known = new Set(audit.findings.map(({ ruleCode }) => ruleCode))
  const riskFindings = rules.findings.filter(({ ruleCode }) => !known.has(ruleCode))
    .map(({ ruleCode, title }) => ({ ruleCode, title: maskForensicText(title) }))
  const largeTransfer = amountVnd !== null && new Decimal(amountVnd).gte(10_000_000)
  return {
    amountVnd, purposeText: purposeText ? maskForensicText(purposeText) : null, personalImpact, riskFindings, largeTransfer,
    hasNewMaterialRisk: largeTransfer || foreign || additionalSignal || riskFindings.length > 0 ||
      (personalImpact !== null && personalImpact.status !== 'WITHIN_BUDGET'),
  }
}

const directAnswers = {
  ASSISTANT_INFO: 'Mình là FinCopilot. Mình giúp đọc hợp đồng, kiểm tra giao dịch và mã QR. Bạn muốn mình giải thích phần nào của hồ sơ vừa rồi?',
  ACK: 'Rất vui được hỗ trợ bạn. Nếu có thêm ảnh chụp, số tiền cụ thể hoặc điều khoản mới từ bên kia, bạn cứ gửi vào đây để mình kiểm tra giúp nhé.',
  OFF_TOPIC: 'Mình là trợ lý giám định rủi ro và tài chính cá nhân FinCopilot, nên mình chỉ hỗ trợ phân tích giao dịch, mã QR, hợp đồng và các bước bảo vệ tiền của bạn. Bạn muốn hỏi thêm chi tiết nào trong báo cáo vừa rồi không?',
  NEEDS_DETAILS: 'Bạn muốn vay, đầu tư hay tích lũy trong bao lâu? Bạn có thể mở Khảo sát để mô phỏng theo số tiền và kỳ hạn hoặc gửi điều khoản mới để mình đối chiếu.',
}

export function prepareFollowUp(audit: ForensicAuditResponse, input: ForensicFollowUpRequest, profile: FinancialHealthRequest | null, aliases?: readonly TeencodeAlias[]) {
  const intent = classifyFollowUpIntent(input.question, audit, aliases)
  const recovery = intent === 'EMERGENCY_SCAM_RECOVERY' ? emergencyGuide(input.question) : null
  const directAnswer = recovery ? [recovery.message, ...(recovery.checklist ?? [])].join('\n\n')
    : intent === 'FINANCIAL_EDUCATION' ? educationGuide(input.question)
    : intent === 'ACK' || intent === 'ASSISTANT_INFO' || intent === 'OFF_TOPIC' || intent === 'NEEDS_DETAILS' ? directAnswers[intent] : null
  const question = maskForensicText(input.question)
  const newContext = intent === 'NEW_CONTEXT' ? recheckFollowUpContext(input.question, audit, profile) : null
  const highRisk = audit.verdictLevel === 'HIGH_RISK'
  const guard = highRisk || newContext?.hasNewMaterialRisk === true
  const contextGuidance = newContext && [
    newContext.hasNewMaterialRisk ? 'Thông tin bạn vừa bổ sung chưa nằm trong lần giám định ban đầu, nên mức đánh giá cũ chưa phản ánh tình tiết này.' : '',
    newContext.personalImpact?.plainSummary ?? (newContext.amountVnd ? 'Số tiền bổ sung là ' + formatCaseAmount(newContext.amountVnd) + '.' : ''),
    newContext.purposeText ? 'Hãy đối chiếu nội dung “' + newContext.purposeText + '” với hợp đồng hoặc chứng từ và xác minh người nhận qua kênh chính thức.' : '',
    newContext.largeTransfer ? 'Với khoản tiền lớn này, hãy kiểm tra yêu cầu xác thực sinh trắc học và hạn mức trong ứng dụng ngân hàng chính thức.' : '',
    ...newContext.riskFindings.map(({ title }) => title + '.'),
  ].filter(Boolean).join(' ')
  const prefix = [contextGuidance, highRisk ? followUpAnchor(audit) : ''].filter(Boolean).join('\n\n')
  const fallback = guard
    ? 'Nếu đã chuyển tiền, hãy gọi tổng đài chính thức của ngân hàng và giữ lại biên lai. Nếu chưa chuyển, hãy dừng lại để xác minh.'
    : 'Bạn có thể đối chiếu thông tin trên báo cáo với ứng dụng hoặc hỏi lại người nhận qua kênh chính thức.'
  return {
    directAnswer, prefix, guard, fallback,
    meta: { intent, ...(newContext ? { suggestReaudit: true, reAuditAppendText: question.slice(0, 2000) } : {}) },
    modelInput: {
      text: JSON.stringify({
        task: newContext
          ? 'Trả lời trực tiếp câu hỏi về hồ sơ. Không lặp lại nguyên văn các con số tỷ lệ đã nêu ở đoạn đầu; tập trung hướng dẫn xác minh người nhận, chứng từ và bước xử lý an toàn.'
          : 'Trả lời trực tiếp câu hỏi về hồ sơ. Dùng phần đối chiếu mới nếu có và chỉ dẫn cách xác minh.',
        dossier: buildForensicDossier(audit), question, newContext, hasNewMaterialRisk: newContext?.hasNewMaterialRisk ?? false,
        history: input.history?.map(({ role, content }) => ({ role, content: maskForensicText(content) })),
      }),
    },
  }
}
