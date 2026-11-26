import { ConfigService } from '@nestjs/config'
import type { ForensicIntentSignals, SessionContext } from '@fincopilot/shared-types'
import type { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { PrismaService } from '../../common/prisma.service'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { classifyAuditComplexity } from './complexity-router'
import { elevateVerdict } from './deep-reasoning'
import { ForensicService } from './forensic.service'

const signal = (probability: number): ForensicIntentSignals => ({
  provider: 'fixture', recoveryScamProb: probability, biometricPhishingProb: 0, urgentCoercionProb: 0,
})
const base = { riskScore: 0, findings: [], fileCount: 0, textLength: 50, hasPdf: false, hasQr: false, licensedWithAnomaly: false }
const high = { title: 'Kiểm tra phụ phí', explanation: 'Điều khoản yêu cầu thêm phí ngoài khoản vay.',
  evidenceQuote: 'Phụ phí xử lý 300 nghìn đồng', severity: 'HIGH_RISK' as const }

describe('audit complexity', () => {
  it('keeps clean personal evidence and an uncontested critical lock on the fast path', () => {
    expect(classifyAuditComplexity(base)).toBe('EASY')
    expect(classifyAuditComplexity({ ...base, riskScore: 95, findings: [{ severity: 'CRITICAL' }], textLength: 1000 })).toBe('EASY')
  })

  it.each([{ riskScore: 45 }, { intentSignals: signal(0.25) }, { hasPdf: true }, { textLength: 501 }])(
    'routes ambiguous risk, intent, PDFs and long text to MEDIUM (%j)', (fields) => {
      expect(classifyAuditComplexity({ ...base, ...fields })).toBe('MEDIUM')
    },
  )

  it.each([{ intentSignals: signal(0.70) }, { licensedWithAnomaly: true }, { fileCount: 2, hasQr: true }, { fileCount: 2, textLength: 501 }])(
    'routes contradictions and multi-source cross-checks to HARD (%j)', (fields) => {
      expect(classifyAuditComplexity({ ...base, ...fields })).toBe('HARD')
    },
  )
})

describe('grounded second-pass reasoning', () => {
  const session: SessionContext = { kind: 'guest', guestSessionId: '6efaf59b-554d-4bd8-80e9-c864ad513ceb' }

  function setup(probability: number, findings: readonly typeof high[]) {
    const prisma = new PrismaService()
    vi.spyOn(prisma.financialInstitution, 'findMany').mockResolvedValue([])
    vi.spyOn(prisma.threatIndicator, 'findMany').mockResolvedValue([])
    vi.spyOn(prisma.financialProfile, 'findFirst').mockResolvedValue(null)
    const create = vi.spyOn(prisma.forensicAudit, 'create').mockResolvedValue({} as Awaited<ReturnType<typeof prisma.forensicAudit.create>>)
    const config = new ConfigService()
    const ai = new AiGatewayService(config)
    vi.spyOn(ai, 'classifyForensicIntent').mockResolvedValue(signal(probability))
    const generate = vi.spyOn(ai, 'generateWithProvider').mockImplementation(async (task, schema) => {
      if (task === 'FORENSIC_DEEP_REASONING') return { provider: 'fixture', output: schema.parse({ findings, summary: 'Unverified summary' }) }
      throw new Error('offline')
    })
    return { service: new ForensicService(prisma, ai, config), create, prisma, generate }
  }

  it('elevates on a matching quote, drops invented evidence, redacts and restores JSON fields', async () => {
    const { service, create, prisma, generate } = setup(0.72, [
      { ...high, explanation: 'Hỏi tổng đài, SĐT 0901234567.' },
      { ...high, evidenceQuote: 'Phí bảo lãnh 400 nghìn đồng' },
      { ...high, evidenceQuote: ' ' },
    ])
    const audit = await service.audit(session, { rawText: 'Phụ phí xử lý 300 nghìn đồng. SĐT 0901234567.' }, [])
    expect(audit).toMatchObject({ complexityTier: 'HARD', riskScore: 80, verdictLevel: 'HIGH_RISK' })
    expect(audit.reasoningFindings).toHaveLength(1)
    expect(audit.reasoningFindings?.[0]?.explanation).not.toContain('0901234567')
    expect(generate.mock.calls.find(([task]) => task === 'FORENSIC_DEEP_REASONING')?.[2].text).not.toContain('0901234567')
    expect(audit.aiNarrative).not.toContain('Unverified summary')

    const data = create.mock.calls[0]?.[0].data
    expect(data?.extractedClaimsJson).toMatchObject({ complexityTier: 'HARD', reasoningFindings: audit.reasoningFindings })
    const persisted: Prisma.ForensicAuditGetPayload<{ include: { qrPayloads: true; findings: true } }> = {
      id: audit.auditId, userId: null, guestSessionId: session.guestSessionId, profileId: null, sourceAlertId: null, claimedEntityName: null, inputChannels: ['TEXT'],
      principalNominalVnd: null, principalNetVnd: null, quotedRatePct: null, effectiveAprPct: null,
      rawTextMasked: audit.privacyProof.rawTextMasked, verdictLevel: audit.verdictLevel, riskScore: audit.riskScore,
      deterministicOverride: audit.deterministicOverride, aiExplanationText: audit.aiNarrative, llmProvider: 'deterministic',
      extractedClaimsJson: JSON.parse(JSON.stringify(data?.extractedClaimsJson)) as Prisma.JsonValue,
      sourceFilesPurgedAt: new Date(audit.privacyProof.sourceFilesPurgedAt), createdAt: new Date(),
      qrPayloads: [], findings: [],
    }
    vi.spyOn(prisma.forensicAudit, 'findFirst').mockResolvedValue(persisted)
    await expect(service.read(session, audit.auditId)).resolves.toMatchObject({
      complexityTier: audit.complexityTier, reasoningFindings: audit.reasoningFindings,
    })
  })

  it('skips the deep call for EASY and leaves the baseline unchanged when no quotes match', async () => {
    const easy = setup(0, [high])
    await expect(easy.service.audit(session, { rawText: 'Mình đang xem lại hóa đơn tiền ăn.' }, []))
      .resolves.toMatchObject({ complexityTier: 'EASY', reasoningFindings: [] })
    expect(easy.generate.mock.calls.some(([task]) => task === 'FORENSIC_DEEP_REASONING')).toBe(false)
    await expect(setup(0.72, [high]).service.audit(session, { rawText: 'Mình đang xem lại hóa đơn tiền ăn.' }, []))
      .resolves.toMatchObject({ complexityTier: 'HARD', reasoningFindings: [], verdictLevel: 'SAFE', riskScore: 0 })
  })

  it.each([
    ['Công an gọi yêu cầu cài app VNeID để xác minh', 'RULE_09_BIOMETRIC_OTP_PHISHING'],
    ['Viện kiểm sát gọi bảo tải ứng dụng định danh từ file APK', 'RULE_09_BIOMETRIC_OTP_PHISHING'],
    ['Cục thuế nhắn yêu cầu nhấp đường dẫn để xác minh CCCD', 'RULE_09_BIOMETRIC_OTP_PHISHING'],
    ['Điện lực gọi yêu cầu chuyển tiền để xác minh', 'RULE_11_DEEPFAKE_URGENT_COERCION'],
    ['Điện lực nhắn yêu cầu chuyển tiền', 'RULE_11_DEEPFAKE_URGENT_COERCION'],
    ['Công an gọi yêu cầu xác minh thông tin định danh', 'RULE_11_DEEPFAKE_URGENT_COERCION'],
    ['Có người yêu cầu cài app VNeID từ file APK vì không có trên CH Play', 'RULE_09_BIOMETRIC_OTP_PHISHING'],
    ['Shipper gọi bảo bấm link nhận đơn', 'RULE_15_CHANNEL_RISK'],
    ['Bên giao hàng nhắn bảo nhấp vào đường dẫn nhận đơn', 'RULE_15_CHANNEL_RISK'],
    ['Hải quan yêu cầu mở đường link nhận kiện hàng', 'RULE_15_CHANNEL_RISK'],
    ['Ngân hàng nhắn yêu cầu cài app để kiểm tra giao dịch', 'RULE_15_CHANNEL_RISK'],
  ])('keeps a deterministic warning with empty and unavailable reasoning (%s)', async (rawText, ruleCode) => {
    const { service, generate } = setup(0, [])
    expect(await service.screenAudit({ rawText }, [])).toBeNull()
    const online = await service.audit(session, { rawText }, [])
    expect(generate.mock.calls.some(([task]) => task === 'FORENSIC_DEEP_REASONING')).toBe(true)
    generate.mockRejectedValue(new Error('offline'))
    const offline = await service.audit(session, { rawText }, [])
    for (const audit of [online, offline]) {
      expect(audit.riskScore).toBeGreaterThanOrEqual(30)
      expect(audit.reasoningFindings).toEqual([])
      expect(audit.findings).toContainEqual(expect.objectContaining({
        ruleCode, evidenceQuote: rawText, description: expect.stringContaining('chính thức'),
      }))
    }
    expect(offline.riskScore).toBe(online.riskScore)
  })

  it.each([
    'Công an không yêu cầu chuyển tiền ngay để chứng minh vô tội.',
    'Lưu ý: không tải app VNeID qua đường link lạ',
    'Cảnh báo thủ đoạn giả danh công an',
    'Cảnh báo thủ đoạn giả danh công an gọi yêu cầu cài app VNeID.',
    'Tôi tự tải VNeID trên App Store/CH Play',
    'Công an phường hướng dẫn tải ứng dụng VNeID trên CH Play',
    'Hướng dẫn kích hoạt VNeID mức 2 tại công an phường',
    'Shipper nhắn đừng bấm link lạ để nhận hàng',
    'Không bấm link lạ',
    'Ngân hàng báo không nên mở đường dẫn lạ',
    'Tôi kiểm tra đơn hàng trong ứng dụng chính thức.',
    'Tôi chuyển tiền mua hàng theo hóa đơn.',
    'Mã OTP dùng để đăng nhập. Cài đặt ứng dụng lịch từ App Store.',
  ])('keeps advice and ordinary activity at SAFE 0/100 (%s)', async (rawText) => {
    const { service } = setup(0, [])
    expect(await service.screenAudit({ rawText }, [])).toBeNull()
    await expect(service.audit(session, { rawText }, []))
      .resolves.toMatchObject({ verdictLevel: 'SAFE', riskScore: 0, findings: [] })
  })

  it.each(['sếp', 'kế toán'])('recognizes explicit impersonation of a %s with an urgent transfer', async (role) => {
    const { service } = setup(0, [])
    const rawText = `Có người giả danh ${role} nhờ chuyển gấp và giữ bí mật.`
    expect(await service.screenAudit({ rawText }, [])).toBeNull()
    await expect(service.audit(session, { rawText }, [])).resolves.toMatchObject({
      verdictLevel: 'HIGH_RISK', deterministicOverride: true,
      findings: [expect.objectContaining({ ruleCode: 'RULE_11_DEEPFAKE_URGENT_COERCION', evidenceQuote: rawText })],
    })
  })

  it('preserves a Tier 1 lock above the System 2 cap and promotes caution from SAFE', () => {
    const locked = { verdictLevel: 'HIGH_RISK', riskScore: 95 } as const
    expect(elevateVerdict(locked, [high])).toEqual(locked)
    expect(elevateVerdict(locked, [{ ...high, severity: 'CAUTION' }])).toEqual(locked)
    expect(elevateVerdict({ verdictLevel: 'SAFE', riskScore: 0 }, [{ ...high, severity: 'CAUTION' }]))
      .toEqual({ verdictLevel: 'CAUTION', riskScore: 40 })
  })
})
