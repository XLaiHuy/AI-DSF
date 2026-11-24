import { LegalCitationItemSchema, type ForensicAuditResponse, type RuleCode } from '@fincopilot/shared-types'
import { describe, expect, it } from 'vitest'
import { calculateFlatRateApr } from './hard-rules.engine'
import { selectLegalCitations, vnLegalRegistry } from './data/vn-legal-registry'
import { calculateLoanScheduleBreakdown, findConditionalLoanSchedule } from './cashflow-loan.engine'

const citationContext = { mathBreakdown: null, findings: [], qrPayloads: [], entityLicense: null, verdictLevel: 'SAFE' } as const
const base = { ...citationContext, findings: [], qrPayloads: [] }
const loan = (flatMonthlyRatePct: string) => calculateFlatRateApr({
  principalNominalVnd: '25000000', upfrontFeeVnd: '0', termMonths: 12, flatMonthlyRatePct, evidenceQuote: 'Điều khoản lãi',
})
const finding = (ruleCode: RuleCode): ForensicAuditResponse['findings'][number] => ({
  ruleCode, severity: 'CRITICAL', scoreImpact: 85, title: 'Phí trước', description: 'Kiểm tra phí',
  evidenceQuote: 'Phí giải ngân', matchedIndicatorId: null,
})
const qr = {
  acqBin: null, bankName: null, accountNumberMasked: null, serviceCode: null, qrAmountVnd: '2500000',
  purposeText: null, crcValid: true, visionBeneficiaryName: null, entityMismatchFlag: false,
}

describe('Vietnamese legal registry', () => {
  it('contains nine official, dated legal references', () => {
    const entries = Object.values(vnLegalRegistry)
    expect(new Set(entries.map(({ code }) => code)).size).toBe(9)
    for (const entry of entries) {
      expect(LegalCitationItemSchema.safeParse(entry).success).toBe(true)
      expect(entry.effectiveDate).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
      expect(entry.plainMeaning && entry.replacesOrSupplements).toBeTruthy()
      expect(['vanban.chinhphu.vn', 'chinhphu.vn', 'vbpl.vn']).toContain(new URL(entry.sourceUrl).hostname)
    }
  })

  it('selects fraud provisions for 102 and payment rules for safe QR', () => {
    const citations = selectLegalCitations({ ...base, verdictLevel: 'HIGH_RISK', claimedEntityName: 'Công ty Tài chính ABC',
      findings: [{ ...finding('RULE_02_ERROR_102_FREEZE_TRAP'), evidenceQuote: 'Báo lỗi 102 để yêu cầu nộp phí.' }],
      qrPayloads: [{ ...qr, qrScheme: 'VIETQR_NAPAS', bankName: 'MBBank', purposeText: 'PHI GIAI NGAN LOI 102' }],
    })
    expect(citations).toMatchObject([{ code: '100/2015/QH13', articleRef: 'Điều 174, Điều 290' },
      { code: '12/2017/QH14' }, { code: '52/2024/NĐ-CP' }])
    expect(citations[0].caseRelevance).toContain('Công ty Tài chính ABC')
    expect(citations[0].caseRelevance).toContain('Báo lỗi 102')
    expect(citations[2].caseRelevance).toContain('mã VietQR (MBBank), số tiền 2 500 000 đ, nội dung “PHI GIAI NGAN LOI 102”')
    expect(selectLegalCitations({ ...base, qrPayloads: [qr] })).toMatchObject([{ code: '52/2024/NĐ-CP' }])
  })

  it('relates the installment and retrospective clause to the civil and consumer rules', () => {
    const clause = 'Nếu trễ hạn dù 1 ngày sẽ mất ưu đãi, áp dụng 2,2%/tháng cho cả 12 tháng.'
    const parsed = findConditionalLoanSchedule('Khoản vay 50 000 000 đồng. Kỳ hạn 12 tháng. Lãi phẳng trên dư nợ ban đầu.\n' +
      '3 tháng đầu 0,8%/tháng, 9 tháng sau 2,2%/tháng.\nPhí quản lý 200 000 đồng/tháng.\n' + clause)
    const citations = selectLegalCitations({ ...base, mathBreakdown: parsed && calculateLoanScheduleBreakdown(parsed) })
    expect(citations[0].caseRelevance).toContain('45,42%/năm')
    expect(citations[0].caseRelevance).toContain('53,36%/năm')
    expect(citations[1].caseRelevance).toContain('trừ vào nợ gốc')
    expect(citations[2].caseRelevance).toContain(clause.replace(/\.$/, ''))
  })

  it('selects civil, consumer and usury provisions by scenario', () => {
    expect(selectLegalCitations({ ...base, mathBreakdown: loan('0.9'), hasConditionalRateTrap: true }))
      .toMatchObject([{ code: '91/2015/QH13' }, { code: '01/2019/NQ-HĐTP' }, { code: '19/2023/QH15' }])
    expect(selectLegalCitations({ ...base, mathBreakdown: loan('10') }))
      .toMatchObject([{ code: '91/2015/QH13' }, { code: '01/2019/NQ-HĐTP' }, { code: '100/2015/QH13', articleRef: 'Điều 201' },
        { code: '12/2017/QH14' }, { code: '01/2021/NQ-HĐTP' }])
  })

  it('selects the specialized credit rules and consumer law for licensed lenders with adverse terms', () => {
    expect(selectLegalCitations({
      ...base, mathBreakdown: loan('2'), entityLicense: { issuer: 'NHNN', status: 'LICENSED' }, hasInsuranceBundling: true,
    })).toMatchObject([{ code: '32/2024/QH15' }, { code: '96/2025/QH15' }, { code: '19/2023/QH15' }])
  })
})
