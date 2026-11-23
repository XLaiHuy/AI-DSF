import { describe, expect, it, vi } from 'vitest'
import { ConfigService } from '@nestjs/config'
import type { SessionContext } from '@fincopilot/shared-types'
import { PrismaService } from '../../common/prisma.service'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { ForensicService } from './forensic.service'
import { evaluateHardRules } from './hard-rules.engine'
import { parseAnyQr } from './vietqr-parser'

const session: SessionContext = { kind: 'guest', guestSessionId: '6efaf59b-554d-4bd8-80e9-c864ad513ceb' }
const auditId = 'ce4bfd2d-9104-4ff1-81a9-38297261f01a'

function rules(raw: string, evidence: string, indicators: { id: string; indicatorText: string; indicatorType: string }[] = []) {
  const qr = parseAnyQr(raw)
  if (!qr) throw new Error('Expected a recognized QR fixture')
  return evaluateHardRules({ evidence: [evidence], qrPayloads: [qr], claimedEntityName: null, institutions: [], indicators })
}

describe('Universal QR risk context', () => {
  it('does not flag an ordinary MoMo transfer as organization impersonation', () => {
    const result = rules('2|99|0901234567|NGUYEN VAN A|a@example.test|transfer_myqr', 'Mình trả tiền ăn cho bạn, xem giúp có ổn không.')
    expect(result.verdictLevel).toBe('SAFE')
    expect(result.findings).toEqual([])
  })

  it('flags an APK link and matches the actual checked hostname', () => {
    const result = rules('https://example.test/files/package.apk?session=opaque', 'Quét mã này', [
      { id: auditId, indicatorText: 'example.test', indicatorType: 'DOMAIN' },
    ])
    expect(result.findings.map(({ ruleCode }) => ruleCode)).toEqual(expect.arrayContaining([
      'RULE_05_NCSC_THREAT_MATCH', 'RULE_09_BIOMETRIC_OTP_PHISHING',
    ]))
    expect(result.verdictLevel).toBe('HIGH_RISK')
  })

  it('uses crypto payment together with scam-investment context', () => {
    const result = rules('tron:TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj', 'Nạp tiền để đầu tư, đóng phí để rút tiền.')
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({
      ruleCode: 'RULE_10_FAKE_EXCHANGE_CRYPTO_CLONE',
    })]))
  })
})

describe('Forensic follow-up chat', () => {
  it('checks owner before making an outbound call', async () => {
    const prisma = new PrismaService()
    const read = vi.spyOn(prisma.forensicAudit, 'findFirst').mockResolvedValue(null)
    const ai = new AiGatewayService(new ConfigService())
    const generate = vi.spyOn(ai, 'generateWithProvider')
    const service = new ForensicService(prisma, ai, new ConfigService())
    await expect(service.followUp(session, auditId, { question: 'Tôi nên làm gì?' })).rejects.toMatchObject({ status: 404 })
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ where: { id: auditId, guestSessionId: session.guestSessionId, userId: null } }))
    expect(generate).not.toHaveBeenCalled()
  })

  it('masks conversation before AI and falls back with locked severity when unavailable', async () => {
    const ai = new AiGatewayService(new ConfigService())
    const generate = vi.spyOn(ai, 'generateWithProvider').mockRejectedValue(new Error('offline'))
    const service = new ForensicService(new PrismaService(), ai, new ConfigService())
    vi.spyOn(service, 'read').mockResolvedValue({
      auditId, verdictLevel: 'HIGH_RISK', riskScore: 95, deterministicOverride: true,
      claimedEntityName: null, mathBreakdown: null, qrPayloads: [], findings: [],
      privacyProof: { sourceFilesPurgedAt: new Date().toISOString(), rawTextMasked: null },
      aiNarrative: '', immediateActions: [], handoffPayload: null, meta: { llmProvider: null, degradedMode: false },
    })
    const answer = await service.followUp(session, auditId, {
      question: 'Số 0901234567, OTP 123456 và email a@example.com?',
      history: [{ role: 'assistant', content: 'CCCD 079123456234' }],
    })
    expect(answer).toMatchObject({ answer: expect.stringContaining('95/100'), meta: { llmProvider: null, degradedMode: true } })
    const transmitted = generate.mock.calls[0]?.[2].text
    for (const secret of ['0901234567', '123456', 'a@example.com', '079123456234']) {
      expect(transmitted).not.toContain(secret)
    }
  })
})
