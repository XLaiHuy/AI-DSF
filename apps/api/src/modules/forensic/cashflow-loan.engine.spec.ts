import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { calculateLoanScheduleBreakdown, findConditionalLoanSchedule, solveCashFlowIrr } from './cashflow-loan.engine'
import { classifyAuditComplexity } from './complexity-router'
import { calculateFlatRateApr, evaluateHardRules } from './hard-rules.engine'
import { evaluatePersonalImpact } from './personal-impact.engine'

const sample = [
  'Khoản vay 50 000 000 đồng. Kỳ hạn 12 tháng. Lãi phẳng trên dư nợ ban đầu.',
  '3 tháng đầu 0,8%/tháng, 9 tháng sau 2,2%/tháng.',
  'Phí quản lý 200 000 đồng/tháng.',
  'Nếu trễ hạn dù 1 ngày sẽ mất ưu đãi, áp dụng 2,2%/tháng cho cả 12 tháng.',
].join('\n')

function breakdown(text: string) {
  const schedule = findConditionalLoanSchedule(text)
  if (!schedule) throw new Error('Missing supported schedule')
  return calculateLoanScheduleBreakdown(schedule)
}

describe('cashflow loan schedules', () => {
  it('matches the historical single-rate APR and EAR to four decimals', () => {
    const terms = { principalNominalVnd: '50000000', upfrontFeeVnd: '5000000', termMonths: 12, flatMonthlyRatePct: '0.9', evidenceQuote: 'Lãi phẳng 0,9%/tháng' }
    const flat = calculateFlatRateApr(terms)
    const schedule = calculateLoanScheduleBreakdown({
      ...terms, repaymentMethod: 'FLAT',
      ratePhases: [{ fromMonth: 1, toMonth: 12, monthlyRatePct: terms.flatMonthlyRatePct, evidenceQuote: terms.evidenceQuote }],
    })
    expect(schedule).toMatchObject({
      effectiveAprPct: flat?.effectiveAprPct, effectiveEarPct: flat?.effectiveEarPct,
      totalPayableVnd: flat?.totalPayableVnd,
    })
    const irr = solveCashFlowIrr(new Decimal(45_000_000), Array<Decimal>(12).fill(new Decimal(55_400_000).div(12)))
    expect(irr?.mul(1200).toFixed(4)).toBe('40.2398')
    expect(solveCashFlowIrr(new Decimal(100), [new Decimal(0), new Decimal(100)])?.toFixed()).toBe('0')
    expect(solveCashFlowIrr(new Decimal(100), [new Decimal(90)])?.toFixed(4)).toBe('-0.1000')
  })

  it('calculates phase payments, APR, retroactive difference and DTI at the highest monthly payment', () => {
    const result = breakdown(sample)
    expect(result).toMatchObject({
      scheduleType: 'MULTI_PHASE', monthlyPaymentVnd: '4766667', minMonthlyPaymentVnd: '4766667',
      maxMonthlyPaymentVnd: '5466667', totalPayableVnd: '63500000', totalExtraCostVnd: '13500000',
      effectiveAprPct: '45.4223', effectiveEarPct: '56.1797',
      phaseBreakdown: [
        { fromMonth: 1, toMonth: 3, monthlyPaymentVnd: '4766667', recurringFeeVnd: '200000' },
        { fromMonth: 4, toMonth: 12, monthlyPaymentVnd: '5466667', recurringFeeVnd: '200000' },
      ],
      stressScenario: {
        maxMonthlyPaymentVnd: '5466667', totalPayableVnd: '65600000', totalExtraCostVnd: '15600000',
        extraDeltaOverBaseVnd: '2100000', effectiveAprPct: '53.3628', effectiveEarPct: '68.5570',
      },
    })
    expect(evaluatePersonalImpact({
      monthlyIncomeVnd: '10000000', monthlyExpenseVnd: '4000000',
      existingDebtPaymentVnd: '0', liquidSavingsVnd: '50000000',
    }, result, [])).toMatchObject({ projectedDtiPct: '54.67', proposedMonthlyPaymentVnd: '5466667.00' })
  })

  it('calculates declining balances and insurance withheld from disbursement', () => {
    expect(breakdown('Khoản vay 12 triệu. Kỳ hạn 3 tháng. Lãi 1%/tháng trên dư nợ giảm dần. Phí quản lý 200 000 đồng/tháng. Bảo hiểm khoản vay 5% trừ trước giải ngân.'))
      .toMatchObject({
        scheduleType: 'DECLINING_WITH_FEES', upfrontFeeVnd: '600000', principalNetVnd: '11400000',
        totalPayableVnd: '12840000', minMonthlyPaymentVnd: '4240000', maxMonthlyPaymentVnd: '4320000',
      })
    expect(breakdown('Khoản vay 12 triệu. Kỳ hạn 3 tháng. Trả góp đều theo dư nợ giảm dần, lãi 1%/tháng. Phí dịch vụ 1,5%/tháng.'))
      .toMatchObject({ maxMonthlyPaymentVnd: '4260265', minMonthlyPaymentVnd: '4260265' })
  })

  it('uses the contract term for the remaining phase and deducts an upfront fee', () => {
    const result = breakdown('Khoản vay 30 triệu. Kỳ hạn 12 tháng. 6 tháng đầu 1%/tháng, các tháng còn lại 2,5%/tháng. Phí trừ trước 600 nghìn.')
    expect(result).toMatchObject({
      principalNetVnd: '29400000', upfrontFeeVnd: '600000', totalPayableVnd: '36300000',
      phaseBreakdown: [{ fromMonth: 1, toMonth: 6, monthlyPaymentVnd: '2800000' },
        { fromMonth: 7, toMonth: 12, monthlyPaymentVnd: '3250000' }],
    })
  })

  it('keeps incomplete floating schedules visible without quoting a fixed APR', () => {
    const text = 'Khoản vay 20 triệu. Kỳ hạn 12 tháng. 3 tháng đầu 0,8%/tháng. Sau đó lãi thả nổi theo thông báo của công ty từng thời kỳ.'
    expect(breakdown(text)).toMatchObject({ effectiveAprPct: null, effectiveEarPct: null, hasUncappedFloatingClause: true })
    const rules = evaluateHardRules({ evidence: [text], claimedEntityName: null, qrPayloads: [], indicators: [], institutions: [] })
    expect(rules.findings.some(({ ruleCode }) => ruleCode === 'RULE_12_CONDITIONAL_LOAN_TERMS')).toBe(true)
    expect(classifyAuditComplexity({
      findings: [{ severity: 'CRITICAL' }], riskScore: 95, fileCount: 1, hasPdf: false,
      hasQr: false, textLength: 150, licensedWithAnomaly: false, hasConditionalLoanTerms: true,
    })).toBe('MEDIUM')
  })
})
