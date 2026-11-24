import { describe, expect, it } from 'vitest'
import { buildForensicDossier, completeNarrativePayment, deterministicNarrative, isGroundedForensicNarrative, mentionsCasePayment } from './forensic-narrative'

const context = {
  verdictLevel: 'HIGH_RISK', riskScore: 95, claimedEntityName: 'Công ty Tài chính ABC',
  qrPayloads: [{
    qrScheme: 'VIETQR_NAPAS', bankName: 'MBBank', qrAmountVnd: '2500000', accountNumberMasked: '******1234',
    serviceCode: null, purposeText: 'PHI GIAI NGAN LOI 102', crcValid: true, entityMismatchFlag: false,
    acqBin: null, visionBeneficiaryName: null,
  }],
  mathBreakdown: {
    principalNominalVnd: '50000000', principalNetVnd: '50000000', upfrontFeeVnd: '0',
    effectiveAprPct: '45.4223', effectiveEarPct: '56.1797', quotedRateLabel: 'Lãi bậc thang',
    termMonths: 12, totalPayableVnd: '63500000',
  },
  findings: [{
    ruleCode: 'RULE_02_ERROR_102_FREEZE_TRAP', severity: 'CRITICAL', scoreImpact: 90,
    title: 'Bẫy lỗi 102', description: 'Đề nghị nộp phí trước', evidenceQuote: 'Báo lỗi 102', matchedIndicatorId: null,
  }],
} satisfies Parameters<typeof buildForensicDossier>[0]
const dossier = buildForensicDossier(context)

const cryptoContext = {
  verdictLevel: 'HIGH_RISK', riskScore: 85, claimedEntityName: null,
  qrPayloads: [{
    qrScheme: 'CRYPTO_WALLET', providerLabel: 'TRON', walletNetwork: 'TRC20', bankName: null, qrAmountVnd: null,
    accountNumberMasked: 'TNP****************************qeL', serviceCode: null, purposeText: null,
    crcValid: false, entityMismatchFlag: false, acqBin: null, visionBeneficiaryName: null,
  }],
  mathBreakdown: null,
  findings: [{
    ruleCode: 'RULE_10_FAKE_EXCHANGE_CRYPTO_CLONE', severity: 'HIGH', scoreImpact: 55,
    title: 'Dấu hiệu sàn giao dịch tiền mã hóa giả', description: 'Yêu cầu nạp tiếp để rút tiền.',
    evidenceQuote: 'Bên sàn đầu tư gửi mã ví USDT TRC-20 này bảo mình nạp 1 500 USDT để mở khóa rút lãi.', matchedIndicatorId: null,
  }],
} satisfies Parameters<typeof buildForensicDossier>[0]
const cryptoDossier = buildForensicDossier(cryptoContext)

describe('forensic narrative grounding', () => {
  it.each([
    'Vay 50 000 000 đ, tổng trả 63 500 000 đ, APR 45,42%.',
    'Mã báo lỗi 102 và yêu cầu nộp 2 500 000 đ.',
    'Đừng chuyển tiền. Khoản vay có kỳ hạn 12 tháng.',
  ])('allows only grounded figures in %s', (text) => {
    expect(isGroundedForensicNarrative(text, dossier)).toBe(true)
  })
  it.each([
    'Khoản vay 99 triệu.', 'APR lên 88%.', 'Tổng trả 2.500.001 đ.',
    'Chắc chắn phạm tội.', 'Chi phí vượt quá mức pháp luật cho phép.',
    'Bạn cứ chuyển khoản qua mã này.', 'Giao dịch này là an toàn.',
  ])('rejects unsupported figures or conclusions in %s', (text) => {
    expect(isGroundedForensicNarrative(text, dossier)).toBe(false)
  })
  it('does not send masked account fields to the model and preserves payment details in fallback', () => {
    expect(dossier.qrSummary[0]).not.toHaveProperty('accountNumberMasked')
    const fallback = deterministicNarrative({ ...context, findingCount: 1 })
    expect(fallback.narrative).toContain('Công ty Tài chính ABC')
    expect(fallback.narrative).toContain('mã VietQR (MBBank), số tiền 2 500 000 đ, nội dung “PHI GIAI NGAN LOI 102”')
    expect(mentionsCasePayment(fallback.narrative, dossier)).toBe(true)
    expect(mentionsCasePayment(fallback.narrative.replace('2 500 000 đ', '2.500.000 VND'), dossier)).toBe(false)
  })
  it('grounds foreign crypto currency amounts and flexible TRC-20 wallet wording', () => {
    expect(isGroundedForensicNarrative('Nạp 1 500 USDT vào ví tiền mã hóa TRC-20 có rủi ro cao.', cryptoDossier)).toBe(true)
    expect(isGroundedForensicNarrative('Ví TRC20 yêu cầu 1500 USDT.', cryptoDossier)).toBe(true)
    expect(isGroundedForensicNarrative('Nạp 9 999 USDT vào ví này.', cryptoDossier)).toBe(false)
    expect(mentionsCasePayment('Bạn đang được yêu cầu chuyển vào ví tiền mã hóa USDT TRC-20.', cryptoDossier)).toBe(true)
    expect(mentionsCasePayment('Mình đọc được mã ví tiền mã hóa (TRC20).', cryptoDossier)).toBe(true)
    expect(mentionsCasePayment('Mình đọc được yêu cầu chuyển khoản ngân hàng.', cryptoDossier)).toBe(false)
  })

  it('completes missing payment details from the masked dossier without hiding unsupported amounts', () => {
    const detail = 'Bạn nên dừng chuyển tiền và hỏi lại qua kênh chính thức.'
    const completed = completeNarrativePayment(detail, dossier)
    expect(completed).toContain('số tiền 2 500 000 đ, nội dung “PHI GIAI NGAN LOI 102”')
    expect(completed).toContain(detail)
    expect(mentionsCasePayment(completed, dossier)).toBe(true)
    expect(isGroundedForensicNarrative(completed, dossier)).toBe(true)
    expect(completeNarrativePayment(completed, dossier)).toBe(completed)
    expect(isGroundedForensicNarrative(completeNarrativePayment('Phí là 99 triệu.', dossier), dossier)).toBe(false)
  })

  it('grounds installment counts only with the matching period unit', () => {
    const weekly = buildForensicDossier({ ...context, mathBreakdown: {
      ...context.mathBreakdown, periodicRepayment: { unit: 'WEEK', count: 10, paymentVnd: '1500000' },
    } })
    expect(isGroundedForensicNarrative('Góp 1 500 000 đ mỗi tuần trong 10 tuần.', weekly)).toBe(true)
    expect(isGroundedForensicNarrative('Góp 1 500 000 đ mỗi ngày trong 10 ngày.', weekly)).toBe(false)
    expect(isGroundedForensicNarrative('Góp 1 500 000 đ mỗi tuần trong 11 tuần.', weekly)).toBe(false)
  })
})
