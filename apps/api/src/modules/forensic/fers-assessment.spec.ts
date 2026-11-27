import { randomUUID } from 'node:crypto'
import { ForensicRiskAssessmentSchema, type ForensicAuditResponse, type SessionContext } from '@fincopilot/shared-types'
import { ConfigService } from '@nestjs/config'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../../common/prisma.service'
import type { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { ForensicController } from './forensic.controller'
import { ForensicService } from './forensic.service'
import { buildForensicRiskAssessment } from './risk-assessment.engine'
import { buildStix21Bundle } from './stix-exporter'
import { classifyVnScamTaxonomy, vnScamTaxonomy } from './vn-scam-taxonomy'

const time = '2026-11-27T00:00:00.000Z'
const id = '00000000-0000-4000-8000-000000000101'
const base: ForensicAuditResponse = {
  auditId: id, createdAt: time, riskScore: 0, verdictLevel: 'SAFE', deterministicOverride: false,
  claimedEntityName: null, qrPayloads: [], mathBreakdown: null, handoffPayload: null, findings: [],
  privacyProof: { rawTextMasked: null, sourceFilesPurgedAt: time },
  aiNarrative: '', immediateActions: [], meta: { llmProvider: null, degradedMode: true },
}
const quote: ForensicAuditResponse['findings'][number] = {
  severity: 'MEDIUM', scoreImpact: 0, ruleCode: 'RULE_13_INSURANCE_BUNDLING',
  title: 'Có khoản phí cần đối chiếu', description: 'Xem hợp đồng', evidenceQuote: 'Hợp đồng ghi phí bảo hiểm 100 000 đồng.', matchedIndicatorId: null,
}

describe('FERS v1', () => {
  it('maps every published AIS topic to its own code and prioritizes explicit rules', () => {
    const subjects = [
      'combo du lịch giá rẻ', 'video deepfake', 'khóa SIM', 'làm giả biên lai', 'nhân viên y tế gọi báo cấp cứu',
      'tuyển người mẫu nhí', 'giả danh ngân hàng', 'app quảng cáo cá độ', 'giả mạo website', 'SMS Brandname',
      'đầu tư chứng khoán', 'tuyển cộng tác viên', 'chiếm quyền tài khoản mạng xã hội', 'giả danh công an',
      'hàng giả trên sàn', 'CCCD để vay tín dụng', 'lừa đảo chuyển nhầm tiền', 'lấy lại tiền đã mất',
      'Telegram hỏi mã OTP', 'FlashAI', 'lấy lại Facebook', 'lừa đảo tình cảm', 'phishing', 'cho số đánh đề',
    ]
    expect(vnScamTaxonomy).toHaveLength(24)
    expect(new Set(vnScamTaxonomy.map(row => row.vnAisGroup)).size).toBe(3)
    subjects.forEach((text, index) => {
      expect(classifyVnScamTaxonomy({ text }).map(row => row.vnAisCode)).toContain(vnScamTaxonomy[index].vnAisCode)
    })
    expect(classifyVnScamTaxonomy({ text: 'báo lỗi 102 và gửi link giả', ruleCodes: ['RULE_02_ERROR_102_FREEZE_TRAP'] })
      .map(row => row.vnAisCode)).toEqual(['VN-AIS-07', 'VN-AIS-23'])
  })

  for (const [confidence, inputs] of [
    ['A1', { entityLicense: { issuer: 'NHNN', status: 'LICENSED' } }],
    ['B2', { findings: [quote] }],
    ['C3', { findings: [{ ...quote, ruleCode: 'RULE_15_CHANNEL_RISK' }] }],
    ['D4', {}],
  ] satisfies [string, Partial<ForensicAuditResponse>][]) {
    for (const [normalTier, riskScore, verdictLevel] of [
      ['T0', 0, 'SAFE'], ['T1', 25, 'CAUTION'], ['T2', 55, 'HIGH_RISK'], ['T3', 75, 'HIGH_RISK'],
    ] as const) {
      it('maps ' + normalTier + ' with ' + confidence, () => {
        const result = ForensicRiskAssessmentSchema.parse(buildForensicRiskAssessment({ ...base, ...inputs, riskScore, verdictLevel }))
        const expected = confidence === 'D4' || (confidence === 'C3' && normalTier === 'T0') ? 'T1' : normalTier
        expect(result).toMatchObject({ riskTier: expected, evidenceConfidence: confidence, abstention: confidence === 'D4' })
        if (confidence === 'D4') {
          expect(result.abstentionPrompt).toContain('mã QR')
          expect(ForensicRiskAssessmentSchema.safeParse({ ...result, riskTier: 'T0', abstention: false }).success).toBe(false)
        }
      })
    }
  }

  it('keeps raw identifiers out of STIX objects and resolves all report references', () => {
    const sensitive = ['0912345678', '001123456789', '8901029384756']
    const data: ForensicAuditResponse = {
      ...base, riskScore: 95, verdictLevel: 'HIGH_RISK', deterministicOverride: true,
      claimedEntityName: sensitive[1],
      findings: [{ ...quote, severity: 'CRITICAL', evidenceQuote: 'https://case.example.test/' + sensitive.join('/') }],
      qrPayloads: [{
        accountNumberMasked: sensitive[2], targetUrl: 'https://case.example.test/?c=' + sensitive[0],
        acqBin: null, bankName: null, serviceCode: null, qrAmountVnd: null, purposeText: sensitive[1],
        qrScheme: 'VIETQR_NAPAS', crcValid: true, visionBeneficiaryName: null, entityMismatchFlag: false,
      }],
    }
    const bundle = buildStix21Bundle(data)
    expect(bundle).toMatchObject({ type: 'bundle', spec_version: '2.1' })
    expect(bundle.objects.map(object => object.type)).toEqual(['identity', 'indicator', 'artifact', 'observed-data', 'report'])
    const serialized = JSON.stringify(bundle)
    for (const object of bundle.objects) {
      expect(object.id).toMatch(/^[a-z-]+--[\da-f-]{36}$/)
      expect(object.spec_version).toBe('2.1')
      if ('object_refs' in object) expect(object.object_refs.every(ref => bundle.objects.some(item => item.id === ref))).toBe(true)
      if ('payload_bin' in object) {
        for (const value of sensitive) expect(Buffer.from(object.payload_bin, 'base64').toString()).not.toContain(value)
      }
    }
    for (const value of sensitive) expect(serialized).not.toContain(value)
    expect(serialized).toContain("domain-name:value = 'case.example.test'")
  })

  it('checks audit ownership before setting STIX response headers', async () => {
    const findFirst = vi.fn().mockResolvedValue(null)
    const prisma = { forensicAudit: { findFirst } } as unknown as PrismaService
    const service = new ForensicService(prisma, {} as AiGatewayService, new ConfigService())
    const controller = new ForensicController(service)
    const guest = { kind: 'guest', guestSessionId: randomUUID() } satisfies SessionContext
    const header = vi.fn()
    const request = { session: guest } as FastifyRequest
    await expect(controller.exportAudit(request, id, { header } as unknown as FastifyReply, 'stix'))
      .rejects.toMatchObject({ status: 404 })
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id, userId: null, guestSessionId: guest.guestSessionId } }))
    expect(header).not.toHaveBeenCalled()
  })
})
