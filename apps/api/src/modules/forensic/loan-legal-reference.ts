import { civilLoanAnnualRateCapPct, criminalLoanAnnualRateScreenPct } from '@fincopilot/financial-math'
import type Decimal from 'decimal.js'
import type { ForensicAuditResponse } from '@fincopilot/shared-types'

type MathBreakdown = NonNullable<ForensicAuditResponse['mathBreakdown']>

export type EntityLicense = (NonNullable<ForensicAuditResponse['entityLicense']> & { institutionType?: string }) | null | undefined

export function loanLegalReference(apr: Decimal, license: EntityLicense): NonNullable<MathBreakdown['legalReference']> {
  const note = 'Thông tin tham khảo pháp lý.'
  if (license?.issuer === 'NHNN' && license.status === 'LICENSED' &&
      (license.institutionType === undefined || license.institutionType === 'BANK' || license.institutionType === 'FINANCE_COMPANY')) return {
    status: 'REGULATED_INSTITUTION_EXEMPT',
    lawCitation: 'Luật Các tổ chức tín dụng 2024 (ngoại lệ Khoản 1 Điều 468 Bộ luật Dân sự 2015)',
    legalCeilingPct: null, excessOverCeilingPct: null, multipleOfCeiling: null,
    plainSummary: 'Khoản cấp tín dụng của tổ chức tín dụng được NHNN cấp phép áp dụng quy định chuyên ngành về lãi suất và phí. Cần xác minh bên cho vay và yêu cầu họ cung cấp biểu phí, cách tính và lãi suất quy đổi theo năm. ' + note,
  }

  const ceiling = civilLoanAnnualRateCapPct
  // Strip numerical noise from IRR convergence at the exact statutory thresholds.
  const comparisonApr = apr.toDecimalPlaces(20)
  const excess = comparisonApr.minus(ceiling).toFixed(2)
  const multiple = comparisonApr.div(ceiling).toFixed(2)
  const civil = 'Khoản 1 Điều 468 Bộ luật Dân sự 2015'
  const civilRule = 'Với khoản vay dân sự thuộc Điều 468, phần lãi suất thỏa thuận vượt mức 20%/năm không có hiệu lực, trừ trường hợp luật khác quy định.'
  const aprNote = 'APR tính cả phí và dùng để sàng lọc. Cần đối chiếu lãi suất thỏa thuận và khoản thu thực tế.'
  const criminal = comparisonApr.gte(criminalLoanAnnualRateScreenPct)
  const aboveCeiling = comparisonApr.gt(ceiling)
  const comparison = aboveCeiling
    ? `APR cao hơn mốc dân sự ${excess.replace('.', ',')} điểm phần trăm, tương đương ${multiple.replace('.', ',')} lần.`
    : 'APR ước tính nằm trong mốc tham chiếu 20%/năm.'
  const criminalNote = 'Mốc gấp 5 lần là một dấu hiệu cần đối chiếu Điều 201. Trách nhiệm hình sự còn phụ thuộc khoản thu lợi bất chính hoặc tiền sử xử phạt, kết án theo luật.'
  return {
    status: criminal ? 'POTENTIAL_USURY_CRIME' : aboveCeiling ? 'EXCEEDS_CIVIL_CEILING' : 'WITHIN_CIVIL_LIMIT',
    lawCitation: criminal ? `Điều 201 Bộ luật Hình sự 2015 (Nghị quyết 01/2021/NQ-HĐTP) & ${civil}` : civil,
    legalCeilingPct: '20.00', excessOverCeilingPct: excess, multipleOfCeiling: multiple,
    plainSummary: [comparison, aprNote, civilRule, ...(criminal ? [criminalNote] : []), note].join(' '),
  }
}
