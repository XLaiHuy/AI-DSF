import Decimal from 'decimal.js'
import { criminalLoanAnnualRateScreenPct, exceedsOverdueInterestCap } from '@fincopilot/financial-math'
import { describeCasePayment } from '../payment-qr-description'
import type { ForensicAuditResponse, LegalCitationItem } from '@fincopilot/shared-types'

const government = 'Cổng TTĐT Chính phủ'
export const cryptoPaymentNotice = 'Tiền mã hóa không phải phương tiện thanh toán hợp pháp tại Việt Nam theo Nghị định 52/2024/NĐ-CP. Địa chỉ ví không xác nhận danh tính pháp lý. Giao dịch blockchain đã xác nhận thường không thể đảo ngược và không có cơ chế tra soát qua ngân hàng.'
export const vnLegalRegistry = {
  civil: {
    code: '91/2015/QH13', title: 'Bộ luật Dân sự 2015', articleRef: 'Điều 466, Điều 468',
    status: 'IN_FORCE', effectiveDate: '01/01/2017', replacesOrSupplements: 'Được hướng dẫn bởi Nghị quyết 01/2019/NQ-HĐTP.',
    plainMeaning: 'Người vay phải trả nợ theo thỏa thuận. Với khoản vay dân sự, lãi suất thỏa thuận thường tối đa 20%/năm, trừ khi luật khác có quy định.',
    sourceUrl: 'https://vanban.chinhphu.vn/default.aspx?pageid=27160&docid=183188', sourceLabel: government,
  },
  civilGuidance: {
    code: '01/2019/NQ-HĐTP', title: 'Nghị quyết hướng dẫn về lãi, lãi suất, phạt vi phạm', articleRef: 'Điều 2, Điều 9',
    status: 'SUPPLEMENTARY', effectiveDate: '15/03/2019', replacesOrSupplements: 'Hướng dẫn áp dụng Điều 468 Bộ luật Dân sự 2015.',
    plainMeaning: 'Phần lãi vượt mức pháp luật cho phép không có hiệu lực. Tiền lãi vượt đã trả được trừ vào nợ gốc tại thời điểm trả lãi. Phần còn dư được hoàn lại.',
    sourceUrl: 'https://vbpl.vn/en/van-ban/chi-tiet/134278', sourceLabel: 'CSDL Quốc gia về Pháp luật (VBPL)',
  },
  penal: {
    code: '100/2015/QH13', title: 'Bộ luật Hình sự 2015', articleRef: 'Điều 174, Điều 201, Điều 290',
    status: 'IN_FORCE', effectiveDate: '01/01/2018', replacesOrSupplements: 'Áp dụng cùng Luật sửa đổi, bổ sung 12/2017/QH14 và các sửa đổi có liên quan.',
    plainMeaning: 'Các điều này lần lượt đề cập đến lừa đảo chiếm đoạt tài sản, cho vay lãi nặng và hành vi chiếm đoạt tài sản qua phương tiện điện tử. Cần đối chiếu tình tiết và chứng cứ của từng vụ việc.',
    sourceUrl: 'https://vanban.chinhphu.vn/default.aspx?pageid=27160&docid=183216', sourceLabel: government,
  },
  penalAmendment: {
    code: '12/2017/QH14', title: 'Luật sửa đổi, bổ sung một số điều của Bộ luật Hình sự 2015', articleRef: 'Điều 1',
    status: 'AMENDING', effectiveDate: '01/01/2018', replacesOrSupplements: 'Sửa đổi, bổ sung Bộ luật Hình sự 100/2015/QH13.',
    plainMeaning: 'Đọc cùng Bộ luật Hình sự để đối chiếu nội dung đã được sửa đổi.',
    sourceUrl: 'https://vanban.chinhphu.vn/default.aspx?pageid=27160&docid=190507', sourceLabel: government,
  },
  penalGuidance: {
    code: '01/2021/NQ-HĐTP', title: 'Nghị quyết hướng dẫn áp dụng Điều 201 Bộ luật Hình sự', articleRef: 'Điều 2, Điều 5, Điều 6',
    status: 'SUPPLEMENTARY', effectiveDate: '24/12/2021', replacesOrSupplements: 'Hướng dẫn đối chiếu tội cho vay lãi nặng trong giao dịch dân sự theo Điều 201.',
    plainMeaning: 'Mốc lãi suất gấp 5 lần trần dân sự tương ứng 100%/năm. Việc xem xét trách nhiệm hình sự còn phụ thuộc khoản thu lợi bất chính từ 30 triệu đồng hoặc trường hợp đã bị xử phạt, kết án theo luật và còn vi phạm.',
    sourceUrl: 'https://vanban.chinhphu.vn/default.aspx?pageid=27160&docid=204779', sourceLabel: government,
  },
  credit: {
    code: '32/2024/QH15', title: 'Luật Các tổ chức tín dụng 2024', articleRef: 'Khoản 5 Điều 15, Điều 100',
    status: 'IN_FORCE', effectiveDate: '01/07/2024',
    replacesOrSupplements: 'Thay thế Luật 47/2010/QH12 và Luật 17/2017/QH14 đã hết hiệu lực, có quy định chuyển tiếp. Được sửa đổi bởi Luật 96/2025/QH15.',
    plainMeaning: 'Tổ chức tín dụng áp dụng quy định chuyên ngành về lãi và phí. Luật cấm gắn bán bảo hiểm không bắt buộc với việc cung ứng sản phẩm, dịch vụ ngân hàng dưới mọi hình thức.',
    sourceUrl: 'https://vanban.chinhphu.vn/?pageid=27160&docid=211190', sourceLabel: government,
  },
  creditAmendment: {
    code: '96/2025/QH15', title: 'Luật sửa đổi, bổ sung một số điều của Luật Các tổ chức tín dụng', articleRef: 'Điều 1',
    status: 'AMENDING', effectiveDate: '15/10/2025', replacesOrSupplements: 'Sửa đổi, bổ sung Luật Các tổ chức tín dụng 32/2024/QH15.',
    plainMeaning: 'Đọc cùng Luật Các tổ chức tín dụng để đối chiếu quy định hiện hành, gồm các nội dung được cập nhật về xử lý nợ xấu và tài sản bảo đảm.',
    sourceUrl: 'https://chinhphu.vn/?pageid=27160&docid=214588&classid=1&orggroupid=1', sourceLabel: government,
  },
  payment: {
    code: '52/2024/NĐ-CP', title: 'Nghị định về thanh toán không dùng tiền mặt', articleRef: 'Quy định về tài khoản thanh toán và dịch vụ trung gian thanh toán',
    status: 'IN_FORCE', effectiveDate: '01/07/2024', replacesOrSupplements: 'Thay thế Nghị định 101/2012/NĐ-CP và 80/2016/NĐ-CP đã hết hiệu lực.',
    plainMeaning: 'Nghị định đặt khung pháp lý cho tài khoản thanh toán và ví điện tử. Khi dùng mã QR, đối chiếu tên người nhận, số tài khoản và số tiền trên màn hình xác nhận.',
    sourceUrl: 'https://vanban.chinhphu.vn/?pageid=27160&docid=210262&classid=1&orggroupid=2', sourceLabel: government,
  },
  interestDayCount: {
    code: '14/2017/TT-NHNN', title: 'Phương pháp tính lãi của tổ chức tín dụng', articleRef: 'Điều 5, Điều 6',
    status: 'IN_FORCE', effectiveDate: '01/01/2018',
    replacesOrSupplements: 'Thay thế Quyết định 652/2001/QĐ-NHNN về phương pháp tính và hạch toán thu, trả lãi.',
    plainMeaning: 'Tính tiền lãi theo số dư và số ngày thực tế trên cơ sở một năm 365 ngày.',
    sourceUrl: 'https://vanban.chinhphu.vn/?docid=191944&pageid=27160', sourceLabel: government,
  },
  overdueInterest: {
    code: '39/2016/TT-NHNN', title: 'Quy định về hoạt động cho vay của tổ chức tín dụng', articleRef: 'Điểm c khoản 4 Điều 13',
    status: 'IN_FORCE', effectiveDate: '15/03/2017',
    replacesOrSupplements: 'Đọc cùng các thông tư sửa đổi, bổ sung hoạt động cho vay của tổ chức tín dụng.',
    plainMeaning: 'Lãi trên dư nợ gốc quá hạn không vượt 150% mức lãi trong hạn tại thời điểm chuyển nợ quá hạn.',
    sourceUrl: 'https://vanban.chinhphu.vn/?docid=188822&pageid=27160', sourceLabel: government,
  },
  consumerCredit: {
    code: '43/2016/TT-NHNN', title: 'Cho vay tiêu dùng của công ty tài chính', articleRef: 'Điều 10',
    status: 'IN_FORCE', effectiveDate: '15/03/2017',
    replacesOrSupplements: 'Được sửa đổi, bổ sung bởi Thông tư 18/2019/TT-NHNN.',
    plainMeaning: 'Hợp đồng phải nêu điều kiện trả nợ trước hạn và phí trả nợ trước hạn.',
    sourceUrl: 'https://vanban.chinhphu.vn/?docid=188917&pageid=27160', sourceLabel: government,
  },
  investmentTax: {
    code: '109/2025/QH15', title: 'Luật Thuế thu nhập cá nhân', articleRef: 'Thu nhập miễn thuế và thuế chuyển nhượng chứng khoán',
    status: 'IN_FORCE', effectiveDate: '01/07/2026',
    replacesOrSupplements: 'Được hướng dẫn bởi Nghị định 253/2026/NĐ-CP.',
    plainMeaning: 'Lãi tiền gửi cá nhân tại tổ chức tín dụng được miễn thuế. Thuế chuyển nhượng chứng khoán thông thường là 0,1% giá chuyển nhượng. Chứng chỉ quỹ mở đủ điều kiện được miễn nếu nắm giữ từ hai năm.',
    sourceUrl: 'https://vanban.chinhphu.vn/?classid=1&docid=216495&pageid=27160', sourceLabel: government,
  },
  consumer: {
    code: '19/2023/QH15', title: 'Luật Bảo vệ quyền lợi người tiêu dùng 2023', articleRef: 'Điều 25',
    status: 'IN_FORCE', effectiveDate: '01/07/2024', replacesOrSupplements: 'Thay thế Luật Bảo vệ quyền lợi người tiêu dùng 59/2010/QH12 đã hết hiệu lực, có quy định chuyển tiếp.',
    plainMeaning: 'Hợp đồng theo mẫu không được cài điều khoản cho bên kinh doanh tự ý thay đổi nội dung đã thỏa thuận hoặc hạn chế quyền hợp pháp của người tiêu dùng.',
    sourceUrl: 'https://vanban.chinhphu.vn/?pageid=27160&docid=208363&classid=1&orggroupid=1', sourceLabel: government,
  },
} satisfies Record<string, LegalCitationItem>

type CitationContext = Pick<ForensicAuditResponse, 'verdictLevel' | 'mathBreakdown' | 'findings' | 'qrPayloads' | 'entityLicense'> & {
  claimedEntityName?: string | null
  hasConditionalRateTrap?: boolean
  hasInsuranceBundling?: boolean
  maskedEvidence?: readonly string[]
}

function hasExcessOverdueRate(text: string) {
  const expression = /lãi(?: suất)?(?: trên dư nợ gốc)?\s+(quá hạn|trong hạn)\s*[:=]?\s*(\d{1,3}(?:[.,]\d+)?)\s*%\s*\/\s*(năm|tháng)/giu
  let previous: RegExpMatchArray | undefined
  for (const match of text.matchAll(expression)) {
    if (previous && match[1].toLowerCase() !== previous[1].toLowerCase() &&
      match.index - (previous.index ?? 0) <= 180) {
      const [base, overdue] = match[1].toLowerCase() === 'trong hạn' ? [match, previous] : [previous, match]
      const annual = (value: RegExpMatchArray) => new Decimal(value[2].replace(',', '.')).mul(value[3].toLowerCase() === 'tháng' ? 12 : 1)
      if (exceedsOverdueInterestCap(annual(base), annual(overdue))) return true
    }
    previous = match
  }
  const ratio = /lãi(?: suất)?(?: trên dư nợ gốc)? quá hạn\s*[:=]?\s*(\d{1,3}(?:[.,]\d+)?)\s*%\s*(?:của\s+)?(?:mức\s+)?lãi(?: suất)? trong hạn/giu
  return [...text.matchAll(ratio)].some(match => exceedsOverdueInterestCap(100, match[1].replace(',', '.')))
}

export function selectLegalCitations(context: CitationContext): LegalCitationItem[] {
  const { mathBreakdown: math, entityLicense: license, findings, qrPayloads } = context
  const registry = vnLegalRegistry
  const codes = findings.map(({ ruleCode }) => ruleCode)
  const conditional = context.hasConditionalRateTrap || !!math?.stressScenario || math?.hasUncappedFloatingClause ||
    codes.includes('RULE_12_CONDITIONAL_LOAN_TERMS')
  const insurance = context.hasInsuranceBundling || codes.includes('RULE_13_INSURANCE_BUNDLING')
  const regulated = license?.issuer === 'NHNN' && license.status === 'LICENSED'
  const crypto = qrPayloads.some(({ qrScheme }) => qrScheme === 'CRYPTO_WALLET')
  const fraud = findings.some(({ ruleCode, severity, evidenceQuote }) => /^RULE_0[123589]|^RULE_1[014]/.test(ruleCode) ||
    ruleCode === 'RULE_04_UNLICENSED_OR_IMPERSONATION' && (severity === 'CRITICAL' || /mạo danh|giả danh|giả mạo/iu.test(evidenceQuote)))
    || (context.verdictLevel === 'HIGH_RISK' && qrPayloads.length > 0)
  const seriousCivil = !regulated && [math?.effectiveAprPct, math?.stressScenario?.effectiveAprPct].some((apr) =>
    apr != null && new Decimal(apr).gte(criminalLoanAnnualRateScreenPct))
  const items: LegalCitationItem[] = []
  if (regulated) items.push(registry.credit, registry.creditAmendment)
  else if (math || conditional || insurance) items.push(registry.civil, registry.civilGuidance)
  if (conditional || insurance) items.push(registry.consumer)
  if ([...(context.maskedEvidence ?? []), ...findings.map(({ evidenceQuote }) => evidenceQuote)].some(hasExcessOverdueRate)) {
    items.push(registry.overdueInterest)
  }
  if (insurance && !regulated) items.push(registry.credit, registry.creditAmendment)
  if (fraud || seriousCivil) {
    const penal = fraud && seriousCivil ? registry.penal : {
      ...registry.penal,
      articleRef: seriousCivil ? 'Điều 201' : 'Điều 174, Điều 290',
      plainMeaning: seriousCivil
        ? 'Điều 201 quy định về cho vay lãi nặng trong giao dịch dân sự. Cần đối chiếu lãi suất, khoản thu và các tình tiết cụ thể.'
        : 'Điều 174 quy định về lừa đảo chiếm đoạt tài sản. Điều 290 quy định về hành vi chiếm đoạt tài sản qua mạng hoặc phương tiện điện tử.',
    }
    items.push(penal, registry.penalAmendment)
  }
  if (seriousCivil) items.push(registry.penalGuidance)
  if (fraud || qrPayloads.length) items.push(registry.payment)
  const quote = (code: string) => findings.find((finding) => finding.ruleCode.startsWith(code))?.evidenceQuote
  const reference = math?.legalReference
  const pct = (value: string) => new Decimal(value).toFixed(2).replace('.', ',') + '%/năm'
  const apr = math?.effectiveAprPct
  const stress = math?.stressScenario
  const comparison = apr ? `Chi phí vay quy năm trong hồ sơ là ${pct(apr)}` +
    (reference?.excessOverCeilingPct && reference.multipleOfCeiling && new Decimal(reference.excessOverCeilingPct).gt(0)
      ? `, cao hơn mốc tham chiếu dân sự 20%/năm ${reference.excessOverCeilingPct.replace('.', ',')} điểm phần trăm, tương đương ${reference.multipleOfCeiling.replace('.', ',')} lần`
      : '') + '.' + (stress ? ` Nếu điều kiện bất lợi được kích hoạt, APR lên ${pct(stress.effectiveAprPct)}.` : '')
    : 'Hồ sơ có điều khoản vay cần kiểm tra theo lãi suất thỏa thuận và số tiền thực thu.'
  const condition = stress?.evidenceQuote ?? quote('RULE_12') ?? quote('RULE_13')
  const insuranceQuote = quote('RULE_13')
  const payment = qrPayloads[0] ? describeCasePayment(qrPayloads[0]) : null
  const fraudQuote = ['RULE_02', 'RULE_01', 'RULE_09', 'RULE_11', 'RULE_03', 'RULE_08', 'RULE_10', 'RULE_05', 'RULE_04']
    .map(quote).find(Boolean)
  const party = context.claimedEntityName ? `Đơn vị được nêu là “${context.claimedEntityName}”. ` : ''
  const fraudRelevance = party + (fraudQuote ? `Trong hồ sơ có chi tiết “${fraudQuote}”. ` : '') +
    (payment ? `Kênh nhận tiền đọc được là ${payment}. ` : '') +
    'Đối chiếu dấu hiệu dùng thông tin gian dối hoặc phương tiện điện tử theo Điều 174 và Điều 290 khi lưu chứng cứ và trình báo.'
  const seriousApr = [apr, stress?.effectiveAprPct].find((value) => value && new Decimal(value).gte(criminalLoanAnnualRateScreenPct))
  const usury = seriousCivil && seriousApr ? `APR ${pct(seriousApr)} chạm hoặc vượt mốc sàng lọc 100%/năm, gấp 5 lần trần lãi dân sự. Cần đối chiếu lãi thỏa thuận, tiền thực thu và các điều kiện khác theo Điều 201.` : ''
  const insuranceRelevance = insurance ? (insuranceQuote ? `Hồ sơ ghi “${insuranceQuote}”. ` : '') +
    'Đối chiếu Khoản 5 Điều 15 nếu tổ chức tín dụng đặt việc mua bảo hiểm không bắt buộc làm điều kiện cấp khoản vay.' : ''
  const regulatedRelevance = regulated ? party + 'Giấy phép NHNN đã được đối chiếu. Khoản cấp tín dụng áp dụng quy định chuyên ngành về lãi và phí.' : ''
  const relevance: Record<string, string> = {
    [registry.overdueInterest.code]: 'Mức lãi trên dư nợ gốc quá hạn ghi trong hồ sơ vượt 150% lãi trong hạn. Đối chiếu quy định nếu bên cho vay là tổ chức tín dụng.',
    [registry.civil.code]: comparison + ' Cần đối chiếu lãi thỏa thuận và phí thực thu theo Điều 466 và Điều 468.',
    [registry.civilGuidance.code]: comparison + ' Nếu khoản vay thuộc Điều 468, phần lãi vượt mức luật cho phép không có hiệu lực và tiền lãi vượt đã trả được trừ vào nợ gốc.',
    [registry.consumer.code]: (condition ? `Điều khoản cần làm rõ là “${condition}”. ` : '') +
      'Đối chiếu Điều 25 nếu hợp đồng theo mẫu cho bên cho vay tự đổi điều kiện hoặc hạn chế quyền của bạn.',
    [registry.credit.code]: [regulatedRelevance, insuranceRelevance].filter(Boolean).join(' '),
    [registry.creditAmendment.code]: [regulatedRelevance, insuranceRelevance].filter(Boolean).join(' '),
    [registry.penal.code]: [fraud ? fraudRelevance : '', usury].filter(Boolean).join(' '),
    [registry.penalAmendment.code]: [fraud ? fraudRelevance : '', usury].filter(Boolean).join(' '),
    [registry.penalGuidance.code]: usury,
    [registry.payment.code]: (payment ? `Hồ sơ có ${payment}. ` : '') +
      (crypto ? cryptoPaymentNotice : 'Đối chiếu người nhận và số tiền trên màn hình xác nhận. Nếu đã giao dịch, dùng biên lai để yêu cầu ngân hàng hoặc đơn vị trung gian tra soát.'),
  }
  return items.map((item) => ({ ...item, caseRelevance: relevance[item.code] }))
}
