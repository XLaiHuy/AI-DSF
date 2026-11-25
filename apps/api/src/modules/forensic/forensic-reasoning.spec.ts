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

  it('preserves a Tier 1 lock above the System 2 cap and promotes caution from SAFE', () => {
    const locked = { verdictLevel: 'HIGH_RISK', riskScore: 95 } as const
    expect(elevateVerdict(locked, [high])).toEqual(locked)
    expect(elevateVerdict(locked, [{ ...high, severity: 'CAUTION' }])).toEqual(locked)
    expect(elevateVerdict({ verdictLevel: 'SAFE', riskScore: 0 }, [{ ...high, severity: 'CAUTION' }]))
      .toEqual({ verdictLevel: 'CAUTION', riskScore: 40 })
  })
})
