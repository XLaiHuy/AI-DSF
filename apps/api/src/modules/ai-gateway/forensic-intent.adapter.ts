import { ForensicIntentSignalsSchema } from '@fincopilot/shared-types'
import { z } from 'zod'

const answer = z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) })
const responseSchema = z.object({
  answers: z.object({
    recoveryScamProb: answer,
    biometricPhishingProb: answer,
    urgentCoercionProb: answer,
  }),
})

function question(instructions: string, criteria: { true: string; false: string }) {
  return { type: 'noul', instructions, criteria }
}

const questions = {
  recoveryScamProb: question('Does this contain a recovery scam pattern?', {
    true: 'Promises to recover previously lost funds in exchange for a new payment or credential.',
    false: 'No conditional lost-funds recovery offer.',
  }),
  biometricPhishingProb: question('Does this contain credential phishing disguised as verification?', {
    true: 'Requests OTP, identity scans, voice, or face verification through an unsolicited or unofficial channel.',
    false: 'No request for credentials or biometrics on an unverified channel.',
  }),
  urgentCoercionProb: question('Does this use impersonation to pressure an immediate transfer?', {
    true: 'Claims to be an authority or relative and uses urgency to coerce a payment or block independent checks.',
    false: 'No coercive transfer request via impersonation.',
  }),
}

export class DecisionApiError extends Error {
  constructor(readonly status: number) {
    super('OpenRouter Decisions request failed.')
  }
}

async function requestDecisions(model: string, key: string, state: object, questions: object, signal: AbortSignal) {
  // Jev is a typed decision model and uses the Decisions endpoint.
  const response = await fetch('https://openrouter.ai/api/alpha/decisions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, state, questions }),
    redirect: 'error',
    signal,
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new DecisionApiError(response.status)
  }
  return response.json() as Promise<unknown>
}

export async function requestForensicIntent(model: string, key: string, text: string, signal: AbortSignal) {
  const { answers } = responseSchema.parse(await requestDecisions(model, key, { evidence: text }, questions, signal))
  return ForensicIntentSignalsSchema.parse({
    provider: 'openrouter',
    recoveryScamProb: answers.recoveryScamProb.noul,
    biometricPhishingProb: answers.biometricPhishingProb.noul,
    urgentCoercionProb: answers.urgentCoercionProb.noul,
  })
}

const conversationQuestions = {
  isAuditableCaseProb: question('Lượt mới có vụ việc cụ thể cần kiểm tra không?', {
    true: 'Có lời chào mời, hợp đồng, giao dịch, bên thứ ba hoặc chỉ dấu đáng ngờ có thể đối chiếu.',
    false: 'Chỉ chào hỏi, hỏi kiến thức, nêu vốn cá nhân hoặc nêu tình huống giả định.',
  }),
  isEmergencyLossProb: question('Người dùng đã gặp sự cố và cần ứng cứu ngay không?', {
    true: 'Đã mất tiền, chuyển nhầm, nhập mã OTP hoặc cài ứng dụng lạ và cần xử lý.',
    false: 'Chỉ hỏi phòng tránh, trao đổi giả định hoặc chưa làm việc được mô tả.',
  }),
  isFinancialPlanningProb: question('Đây có phải trao đổi về kế hoạch tài chính cá nhân không?', {
    true: 'Hỏi cách vay, tiết kiệm, tích lũy hoặc nêu thu nhập, vốn, kỳ hạn và mục tiêu của mình.',
    false: 'Không trao đổi về kế hoạch hoặc ngân sách cá nhân.',
  }),
  isFinancialEducationProb: question('Người dùng muốn hiểu khái niệm tài chính hoặc quy định chung không?', {
    true: 'Hỏi về thuật ngữ, cách tính, quy định hoặc dấu hiệu nhận biết chung.',
    false: 'Không hỏi kiến thức tài chính chung.',
  }),
  isSocialGreetingOrAckProb: question('Đây chỉ là lời chào, giới thiệu, cảm ơn hoặc xác nhận đã hiểu không?', {
    true: 'Lượt này là lời chào, hỏi trợ lý là ai hoặc đáp lời ngắn.',
    false: 'Lượt này có câu hỏi hoặc thông tin mới cần xử lý.',
  }),
  isOffTopicProb: question('Lượt mới và ý nghĩa của nó trong cuộc trò chuyện có nằm ngoài tài chính không?', {
    true: 'Yêu cầu thuộc chủ đề khác và không nối tiếp kế hoạch hay tình huống tài chính.',
    false: 'Trao đổi tài chính, chào hỏi hoặc tiếp nối mạch trò chuyện.',
  }),
}

const probability = answer.transform(value => value.noul)
const conversationResponse = z.object({ answers: z.object({
  isAuditableCaseProb: probability,
  isEmergencyLossProb: probability,
  isFinancialPlanningProb: probability,
  isFinancialEducationProb: probability,
  isSocialGreetingOrAckProb: probability,
  isOffTopicProb: probability,
}) })

export async function requestConversationRoute(model: string, key: string, state: { current_turn: string; compressedContext: unknown }, signal: AbortSignal) {
  const result = await requestDecisions(model, key, state, conversationQuestions, signal)
  return conversationResponse.parse(result).answers
}
