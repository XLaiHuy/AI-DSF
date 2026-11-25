import { describe, expect, it, vi } from 'vitest'
import { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../../common/prisma.service'
import type { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { classifyAuditComplexity } from './complexity-router'
import { embeddingCosine, ThreatMemoryService } from './threat-memory.service'
import { evaluateHardRules } from './hard-rules.engine'

function fixture() {
  const indicators = [{ id: 'ioc', indicatorType: 'KEYWORD', indicatorText: 'phí mở khóa khoản vay' }]
  const examples = [
    { feedbackType: 'CONFIRMED_SCAM', expectedVerdict: 'HIGH_RISK', sampleTextMasked: 'Nộp phí mở khóa khoản vay.' },
    { feedbackType: 'FALSE_POSITIVE', expectedVerdict: 'SAFE', sampleTextMasked: 'Ngân hàng xác nhận không thu phí mở khóa khoản vay.' },
  ]
  const findAlerts = vi.fn(async () => [{ tacticSummary: 'Đóng phí mở khóa để nhận khoản vay.', indicators }])
  const findFeedback = vi.fn(async () => examples)
  let row: { id: string; verificationStatus: string; originSource: string; distinctSessionHashes: string[] } | null = null
  const create = vi.fn(async (call: { data: { distinctSessionHashes: string[] } }) => {
    row = { id: 'proposal', verificationStatus: 'UNVERIFIED', originSource: 'FORENSIC_COMMUNITY', distinctSessionHashes: call.data.distinctSessionHashes }
  })
  const update = vi.fn(async (call: { data: { distinctSessionHashes: string[] } }) => {
    if (row) row.distinctSessionHashes = call.data.distinctSessionHashes
  })
  const tx = { threatAlert: { findFirst: async () => row, count: async () => 0, create, update } }
  const prisma = {
    threatAlert: { findMany: findAlerts }, threatFeedbackExample: { findMany: findFeedback },
    financialInstitution: { findMany: async () => [] },
    $transaction: (run: (client: typeof tx) => unknown) => run(tx),
  } as unknown as PrismaService
  return { memory: new ThreatMemoryService(prisma, new ConfigService({ THREAT_FINGERPRINT_SECRET: 'synthetic-key' })), findAlerts, findFeedback, create, update }
}

describe('threat memory', () => {
  it('matches 256-dimensional vectors, expands aliases first, and fuses rankings with balanced labels', async () => {
    const unit = (index: number) => Array.from({ length: 256 }, (_, i) => i === index ? 1 : 0)
    const query = unit(0)
    const fusedVector = [0.8, 0.6, ...query.slice(2)]
    const model = 'text-embedding-3-small'
    expect(embeddingCosine(query, fusedVector)).toBeCloseTo(0.8)
    expect(embeddingCosine(query, unit(9))).toBe(0)
    const fused = 'Dịch vụ công gửi liên kết giả để yêu cầu đóng tiền qua cổng.'
    const lexical = 'Dịch vụ công cập nhật giấy tờ qua ứng dụng.'
    const semantic = 'Mạo danh cơ quan chức năng thu tiền qua kênh giả.'
    const differentModel = 'Chiêu trò dùng tên đơn vị vận tải giao bưu kiện.'
    const alerts = [lexical, semantic, fused, differentModel].map((tacticSummary, i) => ({
      tacticSummary, embeddingJson: [unit(9), query, fusedVector, query][i], indicators: [],
      embeddingModel: i === 3 ? 'gemini-embedding-001' : model,
    }))
    const examples = [
      { feedbackType: 'TEENCODE_ALIAS', highlightedSpan: 'dvc', adminNote: 'dịch vụ công' },
      ...['CONFIRMED_SCAM', 'FALSE_POSITIVE'].flatMap((feedbackType) => [0, 1, 2].map((i) => ({
        id: `${feedbackType}-${i}`, feedbackType, embeddingJson: query, embeddingModel: model,
        sampleTextMasked: `Dịch vụ công cập nhật giấy tờ trên ứng dụng mã mẫu ${i}`,
        expectedVerdict: feedbackType === 'FALSE_POSITIVE' ? 'SAFE' : 'HIGH_RISK',
      }))),
    ]
    const prisma = { threatAlert: { findMany: async () => alerts }, threatFeedbackExample: { findMany: async () => examples },
      financialInstitution: { findMany: async () => [] } } as unknown as PrismaService
    const embed = vi.fn(async (_text: string, selected?: string) => selected === model ? { vector: query, model } : null)
    const memory = new ThreatMemoryService(prisma, new ConfigService(), { embedTextWithModel: embed } as unknown as AiGatewayService)
    const wording = 'dvc cập nhật giấy tờ qua ứng dụng'
    const result = await memory.retrieve(wording, [], { shouldEmbed: true })
    expect(embed).toHaveBeenCalledWith('dich vu cong cap nhat giay to qua ung dung', model)
    expect(result.tactics).toEqual([fused, lexical, semantic])
    expect(result.learningTrace).toMatchObject({
      retrievalMode: 'hybrid_rrf', expandedTeencodeCount: 1, matchedTacticsCount: 3, fewShotScamCount: 2, fewShotSafeCount: 2,
    })
    embed.mockResolvedValue(null)
    const degraded = await memory.retrieve(wording, [], { shouldEmbed: true })
    expect(degraded.learningTrace.retrievalMode).toBe('lexical')
    expect(degraded.tactics[0]).toBe(lexical)
  })

  it('reserves the 95-point match for verified hard IOCs', () => {
    const base = { evidence: ['Tôi đọc thông tin tư vấn hạn mức trên example.com.'],
      claimedEntityName: null, qrPayloads: [], institutions: [] }
    const keyword = { id: 'keyword', indicatorType: 'KEYWORD', indicatorText: 'tư vấn hạn mức' }
    const domain = { id: 'domain', indicatorType: 'DOMAIN', indicatorText: 'example.com' }
    expect(evaluateHardRules({ ...base, indicators: [keyword] }).findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: 'RULE_05_NCSC_THREAT_MATCH' }),
    ]))
    expect(evaluateHardRules({ ...base, indicators: [keyword, domain] })).toMatchObject({
      verdictLevel: 'HIGH_RISK', riskScore: 95, findings: [expect.objectContaining({ matchedIndicatorId: 'domain' })],
    })
  })

  it('retrieves positive and negative examples and promotes an otherwise EASY audit', async () => {
    const { memory } = fixture()
    const result = await memory.retrieve('Bên kia đòi phí mở khóa rồi mới giải ngân khoản vay.', [])
    expect(result.tactics).toHaveLength(1)
    expect(result.examples.map(({ expectedVerdict }) => expectedVerdict)).toEqual(expect.arrayContaining(['HIGH_RISK', 'SAFE']))
    const input = { riskScore: 0, findings: [], licensedWithAnomaly: false, fileCount: 0, hasPdf: false, hasQr: false, textLength: 38 }
    expect(classifyAuditComplexity(input)).toBe('EASY')
    expect(classifyAuditComplexity({ ...input, hasTier2ThreatMatch: result.topSimilarityScore > 0 })).toBe('MEDIUM')
  })

  it('coalesces cold loads and refreshes after invalidation', async () => {
    const { memory, findAlerts } = fixture()
    await Promise.all([memory.get(), memory.get()])
    expect(findAlerts).toHaveBeenCalledTimes(1)
    memory.invalidate()
    await memory.get()
    expect(findAlerts).toHaveBeenCalledTimes(2)
  })

  it('stores a fingerprint and counts each actor once per community proposal', async () => {
    const { memory, create, update } = fixture()
    const iocs = [{ indicatorType: 'PHONE', indicatorText: '0901234567' }] as const
    const user = { kind: 'user', userId: 'user-one' } as const
    await memory.propose(user, iocs, 'Gọi cho 0901234567')
    await memory.propose(user, iocs, 'Gọi cho 0901234567')
    await memory.propose({ kind: 'guest', guestSessionId: 'guest-two' }, iocs, 'Gọi cho 0901234567')
    expect(create).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(create.mock.calls)).not.toContain('0901234567')
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ hitCount: { increment: 1 }, distinctSessionHashes: [expect.stringMatching(/^[a-f\d]{64}$/), expect.stringMatching(/^[a-f\d]{64}$/)] }),
    }))
  })
})
