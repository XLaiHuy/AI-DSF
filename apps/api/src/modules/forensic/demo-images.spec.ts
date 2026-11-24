import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ConfigService } from '@nestjs/config'
import { AI_TASK_SCHEMAS } from '@fincopilot/shared-types'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { extractAuditEvidence } from './forensic-extraction'
import { calculateFlatRateApr } from './hard-rules.engine'
import { decodeAnyQrs } from './vietqr-parser'
import { calculateLoanScheduleBreakdown } from './cashflow-loan.engine'

const fixture = (name: string) => readFile(resolve(__dirname, '../../../../web/public/demo-qr', name))

describe('public forensic samples', () => {
  it.each([
    ['demo-loi-102-vietqr.png', { qrScheme: 'VIETQR_NAPAS', amountVnd: '2500000', purpose: 'PHI GIAI NGAN LOI 102' }],
    ['demo-momo-canhan.png', { qrScheme: 'EWALLET_VN', providerLabel: 'MoMo', account: 'DEMOONLY' }],
  ])('decodes %s from the PNG using ZXing', async (name, expected) => {
    const results = await decodeAnyQrs(await fixture(name))
    expect(results).toEqual([expect.objectContaining({ ...expected, crcValid: true })])
  })

  it('decodes the fifth PNG as a TRON wallet using ZXing', async () => {
    const results = await decodeAnyQrs(await fixture('demo-crypto-usdt-trc20.png'))
    expect(results).toEqual([expect.objectContaining({
      qrScheme: 'CRYPTO_WALLET', walletNetwork: 'TRC20', account: 'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL',
    })])
  })

  it('sends the contract image to Vision and calculates the sample APR from returned OCR evidence', async () => {
    const ai = new AiGatewayService(new ConfigService())
    vi.spyOn(ai, 'classifyForensicIntent').mockResolvedValue(null)
    const vision = vi.spyOn(ai, 'generateWithProvider').mockResolvedValue({ provider: 'fixture', output: {
      claimedEntityName: null, visionBeneficiaryName: null, nominalAmountVnd: '50.0000000', rateMethod: 'FLAT_RATE',
      documentTranscript: null, repaymentMethod: null, repaymentMethodEvidenceQuote: null, ratePhases: null,
      recurringMonthlyFeeVnd: null, recurringFeeEvidenceQuote: null, stressTriggerCondition: null, stressMonthlyRatePct: null,
      stressEvidenceQuote: null, hasUncappedFloatingClause: false, uncappedFloatingQuote: null,
      nominalAmountEvidenceQuote: 'Khoản vay 50.000.000 VNĐ',
      termMonths: { value: 12, evidenceQuote: 'Kỳ hạn 12 tháng' },
      quotedRatePct: { value: '0.9', evidenceQuote: 'Lãi phẳng 0,9%/tháng' },
      upfrontFees: [{ amountVnd: '5.0000000', evidenceQuote: 'Phí thu trước 5.000.000 VNĐ' }], redFlagPhrases: [],
    } })
    const evidence = await extractAuditEvidence(ai, { rawText: 'Đọc hợp đồng trong ảnh giúp mình.' }, [
      { buffer: await fixture('demo-lai-phang-hopdong.png') },
    ], 20, 5)
    expect(vision).toHaveBeenCalledWith('FORENSIC_VISION_EXTRACT', expect.anything(), expect.objectContaining({ images: [expect.any(Buffer)] }))
    expect(evidence.loan && calculateFlatRateApr(evidence.loan)).toMatchObject({
      termMonths: 12, monthlyPaymentVnd: '4616667', effectiveAprPct: '40.2398', effectiveEarPct: '48.5569',
    })
  })

  it('reads the fourth PNG and only uses rate phases whose numbers match their OCR quote', async () => {
    const filename = 'demo-lai-bacthang-dieukien.png'
    const source = await fixture(filename)
    expect(await sharp(source).metadata()).toMatchObject({ format: 'png', width: 1120, height: 1200 })
    const extracted = AI_TASK_SCHEMAS.FORENSIC_VISION_EXTRACT.parse({
      claimedEntityName: null, visionBeneficiaryName: null, nominalAmountVnd: '50000000', rateMethod: 'FLAT_RATE',
      nominalAmountEvidenceQuote: 'Khoản vay 50 000 000 đ',
      documentTranscript: 'Khoản vay 50 000 000 đ\nKỳ hạn 12 tháng\nLãi phẳng trên dư nợ ban đầu\n3 tháng đầu 0,8%/tháng\n9 tháng sau 2,2%/tháng\nPhí quản lý 200 000 đ/tháng\nNếu trễ hạn dù 1 ngày sẽ mất ưu đãi, áp dụng 2,2%/tháng cho cả 12 tháng.',
      termMonths: { value: 12, evidenceQuote: 'Kỳ hạn 12 tháng' }, quotedRatePct: null, upfrontFees: [], redFlagPhrases: [],
      repaymentMethod: 'FLAT', repaymentMethodEvidenceQuote: 'Lãi phẳng trên dư nợ ban đầu',
      ratePhases: [
        { fromMonth: 1, toMonth: 3, monthlyRatePct: '0.8', evidenceQuote: '3 tháng đầu 0,8%/tháng' },
        { fromMonth: 4, toMonth: 12, monthlyRatePct: '2.2', evidenceQuote: '9 tháng sau 2,2%/tháng' },
      ],
      recurringMonthlyFeeVnd: '200000', recurringFeeEvidenceQuote: 'Phí quản lý 200 000 đ/tháng',
      stressTriggerCondition: 'Trễ hạn dù 1 ngày', stressMonthlyRatePct: '2.2',
      stressEvidenceQuote: 'Nếu trễ hạn dù 1 ngày sẽ mất ưu đãi, áp dụng 2,2%/tháng cho cả 12 tháng.',
      hasUncappedFloatingClause: false, uncappedFloatingQuote: null,
    })
    const ai = new AiGatewayService(new ConfigService())
    vi.spyOn(ai, 'classifyForensicIntent').mockResolvedValue(null)
    const vision = vi.spyOn(ai, 'generateWithProvider').mockResolvedValue({ provider: 'fixture', output: extracted })
    const evidence = await extractAuditEvidence(ai, {}, [{ buffer: Buffer.from(source) }], 20, 5)
    const schedule = evidence.conditionalLoan.spec
    expect(schedule && calculateLoanScheduleBreakdown(schedule)).toMatchObject({
      totalPayableVnd: '63500000', stressScenario: { totalPayableVnd: '65600000' },
    })
    vision.mockResolvedValueOnce({ provider: 'fixture', output: {
      ...extracted, ratePhases: extracted.ratePhases?.map((phase) => ({ ...phase, monthlyRatePct: '8' })),
    } })
    const mismatched = await extractAuditEvidence(ai, {}, [{ buffer: Buffer.from(source) }], 20, 5)
    expect(mismatched.conditionalLoan.spec).toBeNull()
    const invented = await extractAuditEvidence(ai, { rawText: 'Bạn đọc giúp mình thông tin khoản vay.' }, [], 20, 5)
    expect(invented.conditionalLoan.spec).toBeNull()
    expect(invented.visionQuotes).toEqual([])
  }, 15_000)
})
