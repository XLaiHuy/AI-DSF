import { randomUUID } from 'node:crypto'
import type { SessionContext } from '@fincopilot/shared-types'
import { ConfigService } from '@nestjs/config'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RedisService } from '../../common/redis.service'
import type { PrismaService } from '../../common/prisma.service'
import type { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { compressConversationContext, preservesProtectedSpans, type PreAuditTurn } from './context-compressor'
import { ConversationSessionStore, type ConversationSessionState } from './conversation-session.store'
import { routeForensicConversation } from './forensic-conversation'
import { ForensicService } from './forensic.service'

const owner = { kind: 'guest', guestSessionId: randomUUID() } satisfies SessionContext
const other = { kind: 'user', userId: owner.guestSessionId } satisfies SessionContext
const signals = {
  isAuditableCaseProb: 0, isEmergencyLossProb: 0, isFinancialPlanningProb: 0,
  isFinancialEducationProb: 0, isSocialGreetingOrAckProb: 0, isOffTopicProb: 0,
}

function localStore() {
  const config = new ConfigService()
  vi.spyOn(config, 'get').mockReturnValue(undefined)
  const redis = new RedisService(config)
  return { redis, store: new ConversationSessionStore(redis) }
}

afterEach(() => vi.useRealTimers())

describe('pre-audit context and routing', () => {
  it('folds older turns and keeps protected evidence and negation unchanged', () => {
    const older = 'Không  quá  2,5 triệu đồng trong 36 tháng ở 8,5%, theo Điều 468 BLDS 2015. STK: 987654321, SĐT: 0901234567, QR: 000201123456789.'
    const turns: PreAuditTurn[] = [
      { role: 'user', content: older + '\n    Xem tiếp https://bank.example.test/a và bank.example.vn.' },
      { role: 'assistant', content: 'Mình luôn sẵn sàng nếu bạn có câu hỏi tài chính khác.' },
      ...Array.from({ length: 4 }, () => ({ role: 'user' as const, content: 'Chưa    quyết định.' })),
    ]
    const result = compressConversationContext(turns, '')
    expect(result.recentTurns).toHaveLength(4)
    expect(result.recentTurns[0].content).toBe('Chưa quyết định.')
    expect(result.summary).not.toContain('luôn sẵn sàng')
    expect(preservesProtectedSpans(turns[0].content, result.summary)).toBe(true)
    expect(preservesProtectedSpans('không quá 5%', '5%')).toBe(false)
    const contact = '  SĐT: 0901234567 '
    const [keptContact] = compressConversationContext([{ role: 'user', content: contact }], '').recentTurns
    expect(preservesProtectedSpans(contact, keptContact.content)).toBe(true)
    expect(result.compressedTokens).toBeLessThan(result.originalTokens)
    expect(compressConversationContext(turns, '', 6).recentTurns).toEqual([result.recentTurns[0]])
  })

  it('limits bytes, expires after two hours and isolates or closes sessions by owner', async () => {
    vi.useFakeTimers()
    const { redis, store } = localStore()
    const id = randomUUID()
    const state: ConversationSessionState = {
      domain: 'SAVINGS', slots: { amountVnd: '1000000' }, recentTurns: [], updatedAt: new Date().toISOString(),
      rollingSummary: 'ệ'.repeat(7000),
    }
    await expect(store.save(owner, id, null, state)).resolves.toBe(true)
    const first = await store.load(owner, id)
    expect(Buffer.byteLength(first.raw ?? '')).toBeLessThanOrEqual(4096)
    expect((await store.load(other, id)).state).toBeUndefined()
    vi.advanceTimersByTime(7_199_000)
    expect((await store.load(owner, id)).state?.slots.amountVnd).toBe('1000000')
    vi.advanceTimersByTime(1_000)
    expect((await store.load(owner, id)).state).toBeUndefined()
    await store.remove(owner, id)
    await expect(store.save(owner, id, null, state)).resolves.toBe(false)
    await expect(store.save(other, id, null, state)).resolves.toBe(true)
    redis.onModuleDestroy()
  })

  it('persists initial capital between requests and updates only asserted slots', async () => {
    const { redis, store } = localStore()
    const generateStructured = vi.fn().mockRejectedValue(new Error('offline'))
    const ai = { generateStructured } as unknown as AiGatewayService
    const service = new ForensicService({} as PrismaService, ai, new ConfigService(), undefined, undefined, store)
    const conversationId = randomUUID()
    const send = (rawText: string) => service.screenAudit({ conversationId, rawText }, [], owner)

    await expect(send('alo')).resolves.toMatchObject({ intent: 'ASSISTANT_INFO' })
    await expect(send('Số tiền ban đầu của tôi là 1 triệu đồng')).resolves.toMatchObject({
      intent: 'NEEDS_DETAILS', extractedSlots: { amountVnd: '1000000' },
    })
    await expect(send('Tôi muốn tích lũy')).resolves.toMatchObject({ extractedSlots: { amountVnd: '1000000', domain: 'SAVINGS' } })
    await expect(send('trong 12 tháng')).resolves.toMatchObject({ cta: { href: '/survey?mode=invest&amount=1000000&term=12' } })
    await expect(send('đổi lại 2 triệu trong 18 tháng')).resolves.toMatchObject({ extractedSlots: { amountVnd: '2000000', termMonths: 18 } })
    await expect(send('3 triệu trong 24 tháng được không?')).resolves.toMatchObject({ extractedSlots: { amountVnd: '2000000', termMonths: 18 } })
    expect((await store.load(owner, conversationId)).state?.recentTurns).toHaveLength(4)
    await service.deleteConversation(owner, conversationId)
    expect((await store.load(owner, conversationId)).state).toBeUndefined()
    expect(generateStructured).not.toHaveBeenCalled()
    redis.onModuleDestroy()
  })

  it('calibrates Jev and accepts a fast-model audit route for a specific unfamiliar case', async () => {
    const generateStructured = vi.fn().mockResolvedValue({ route: 'FULL_AUDIT', answer: 'Bạn có thể gửi thêm thông tin.', suggestedPrompts: [] })
    const classifyConversationRoute = vi.fn()
      .mockResolvedValueOnce({ ...signals, isAuditableCaseProb: 0.72 })
      .mockResolvedValueOnce({ ...signals, isEmergencyLossProb: 0.75 })
      .mockResolvedValueOnce({ ...signals, isOffTopicProb: 0.85, isSocialGreetingOrAckProb: 0.29 })
      .mockResolvedValue(null)
    const ai = { generateStructured, classifyConversationRoute }
    await expect(routeForensicConversation({ rawText: 'Họ nhắc mình phải làm bước xác nhận mới nhận được.' }, false, ai)).resolves.toBeNull()
    await expect(routeForensicConversation({ rawText: 'Mình làm xong rồi, giờ không vào được nữa.' }, false, ai)).resolves.toMatchObject({
      intent: 'EMERGENCY_SCAM_RECOVERY', checklist: Array(5).fill(expect.any(String)),
    })
    await expect(routeForensicConversation({ rawText: 'Nhạc nào để tập trung?' }, false, ai)).resolves.toMatchObject({ type: 'refusal' })
    expect(generateStructured).not.toHaveBeenCalled()
    await expect(routeForensicConversation({ rawText: 'Bên kia nói phải hoàn tất bước cuối để nhận phần thưởng.' }, false, ai)).resolves.toBeNull()
    expect(generateStructured).toHaveBeenCalledOnce()
  })

  it('guides savings and transfer recovery without treating salary as the initial capital', async () => {
    const generateStructured = vi.fn()
    const ai = { generateStructured }
    await expect(routeForensicConversation({ rawText: 'em mới ra trường lương 12tr muốn tích lũy' }, false, ai))
      .resolves.toMatchObject({ intent: 'NEEDS_DETAILS', extractedSlots: { domain: 'SAVINGS' } })
    const savings = await routeForensicConversation({ rawText: 'em mới ra trường lương 12tr muốn tích lũy' }, false, ai)
    expect(savings).not.toHaveProperty('extractedSlots.amountVnd')
    await expect(routeForensicConversation({ rawText: 'chuyển nhầm stk phải làm sao' }, false, ai))
      .resolves.toMatchObject({ intent: 'EMERGENCY_SCAM_RECOVERY', checklist: Array(5).fill(expect.any(String)) })
    expect(generateStructured).not.toHaveBeenCalled()
  })

  it('keeps a stated amount out of a formal audit even if a classifier asks for one', async () => {
    const ai = {
      classifyConversationRoute: vi.fn().mockResolvedValue({ ...signals, isAuditableCaseProb: 0.95 }),
      generateStructured: vi.fn().mockResolvedValue({ route: 'FULL_AUDIT', answer: 'Đã kiểm tra.', suggestedPrompts: [] }),
    }
    for (const rawText of ['1 triệu đồng', 'tôi có 1 triệu đồng', 'mình đang có 50 triệu']) {
      await expect(routeForensicConversation({ rawText }, false, ai)).resolves.toMatchObject({
        intent: 'NEEDS_DETAILS', extractedSlots: { amountVnd: expect.any(String) },
      })
    }
  })
})
