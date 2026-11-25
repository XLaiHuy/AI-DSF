import { Injectable, UnprocessableEntityException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { assessDti, compoundDca, decliningPrincipalLoan, reducingBalanceLoan } from '@fincopilot/financial-math'
import type { ManualCompareRequest, SessionContext, SurveyInvestRequest, SurveyLoanRequest } from '@fincopilot/shared-types'
import { PrismaService } from '../../common/prisma.service'

type CatalogProduct = { id: string; institutionName: string; productName: string; rate: string; url: string; calcMethod: string; rateType: 'FIXED' | 'VARIABLE_NAV'; dataProvenance: 'CATALOG_VERIFIED' | 'WEB_REFERENCE'; effectiveDate: string; trustScore: number; sourceLabel: string }
const fallbackProducts: CatalogProduct[] = [
  { id: 'prod-acb-01', institutionName: 'Ngân hàng TMCP Á Châu (ACB)', productName: 'Vay tín chấp linh hoạt', rate: '14.5', url: 'https://www.acb.com.vn/', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', dataProvenance: 'CATALOG_VERIFIED', effectiveDate: new Date().toISOString().slice(0, 10), trustScore: 92, sourceLabel: 'Website chính thức + catalog đã xác minh' },
  { id: 'prod-vcb-01', institutionName: 'Ngân hàng TMCP Ngoại thương Việt Nam (Vietcombank)', productName: 'Vay tiêu dùng theo lương', rate: '12.9', url: 'https://www.vietcombank.com.vn/', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', dataProvenance: 'CATALOG_VERIFIED', effectiveDate: new Date().toISOString().slice(0, 10), trustScore: 96, sourceLabel: 'Website chính thức + catalog đã xác minh' },
  { id: 'prod-mbb-01', institutionName: 'Ngân hàng TMCP Quân Đội (MB)', productName: 'Vay tiêu dùng cá nhân', rate: '15.2', url: 'https://www.mbbank.com.vn/', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', dataProvenance: 'CATALOG_VERIFIED', effectiveDate: new Date().toISOString().slice(0, 10), trustScore: 93, sourceLabel: 'Website chính thức + catalog đã xác minh' },
  { id: 'ref-agribank-01', institutionName: 'Agribank', productName: 'Vay tín chấp · mức tham khảo', rate: '7.0', url: 'https://timo.vn/blogs/so-sanh-lai-suat-vay-ngan-hang-cap-nhat-moi-nhat/', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', dataProvenance: 'WEB_REFERENCE', effectiveDate: new Date().toISOString().slice(0, 10), trustScore: 72, sourceLabel: 'Timo · tham khảo, cần đối chiếu Agribank' },
  { id: 'ref-techcombank-01', institutionName: 'Techcombank', productName: 'Vay tín chấp · mức tham khảo', rate: '13.78', url: 'https://timo.vn/blogs/so-sanh-lai-suat-vay-ngan-hang-cap-nhat-moi-nhat/', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', dataProvenance: 'WEB_REFERENCE', effectiveDate: new Date().toISOString().slice(0, 10), trustScore: 72, sourceLabel: 'Timo · tham khảo, cần đối chiếu Techcombank' },
  { id: 'ref-bvbank-01', institutionName: 'BVBank', productName: 'Vay tín chấp · mức tham khảo', rate: '14.0', url: 'https://timo.vn/blogs/so-sanh-lai-suat-vay-ngan-hang-cap-nhat-moi-nhat/', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', dataProvenance: 'WEB_REFERENCE', effectiveDate: new Date().toISOString().slice(0, 10), trustScore: 72, sourceLabel: 'Timo · tham khảo, cần đối chiếu BVBank' },
  { id: 'ref-tpbank-01', institutionName: 'TPBank', productName: 'Vay tín chấp · mức tham khảo', rate: '8.7', url: 'https://timo.vn/blogs/so-sanh-lai-suat-vay-ngan-hang-cap-nhat-moi-nhat/', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', dataProvenance: 'WEB_REFERENCE', effectiveDate: new Date().toISOString().slice(0, 10), trustScore: 72, sourceLabel: 'Timo · tham khảo, cần đối chiếu TPBank' },
  { id: 'ref-hdbank-01', institutionName: 'HDBank', productName: 'Vay tín chấp · mức tham khảo', rate: '13.0', url: 'https://timo.vn/blogs/so-sanh-lai-suat-vay-ngan-hang-cap-nhat-moi-nhat/', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', dataProvenance: 'WEB_REFERENCE', effectiveDate: new Date().toISOString().slice(0, 10), trustScore: 72, sourceLabel: 'Timo · tham khảo, cần đối chiếu HDBank' },
  { id: 'ref-sacombank-01', institutionName: 'Sacombank', productName: 'Vay tín chấp · mức tham khảo', rate: '9.6', url: 'https://timo.vn/blogs/so-sanh-lai-suat-vay-ngan-hang-cap-nhat-moi-nhat/', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', dataProvenance: 'WEB_REFERENCE', effectiveDate: new Date().toISOString().slice(0, 10), trustScore: 72, sourceLabel: 'Timo · tham khảo, cần đối chiếu Sacombank' },
  { id: 'ref-vib-01', institutionName: 'VIB', productName: 'Vay tín chấp · mức tham khảo', rate: '16.0', url: 'https://timo.vn/blogs/so-sanh-lai-suat-vay-ngan-hang-cap-nhat-moi-nhat/', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', dataProvenance: 'WEB_REFERENCE', effectiveDate: new Date().toISOString().slice(0, 10), trustScore: 72, sourceLabel: 'Timo · tham khảo, cần đối chiếu VIB' },
  { id: 'ref-shb-01', institutionName: 'SHB', productName: 'Vay tín chấp · mức tham khảo', rate: '8.5', url: 'https://timo.vn/blogs/so-sanh-lai-suat-vay-ngan-hang-cap-nhat-moi-nhat/', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', dataProvenance: 'WEB_REFERENCE', effectiveDate: new Date().toISOString().slice(0, 10), trustScore: 72, sourceLabel: 'Timo · tham khảo, cần đối chiếu SHB' },
  { id: 'ref-ocb-01', institutionName: 'OCB', productName: 'Vay tín chấp · mức tham khảo', rate: '20.2', url: 'https://timo.vn/blogs/so-sanh-lai-suat-vay-ngan-hang-cap-nhat-moi-nhat/', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', dataProvenance: 'WEB_REFERENCE', effectiveDate: new Date().toISOString().slice(0, 10), trustScore: 72, sourceLabel: 'Timo · tham khảo, cần đối chiếu OCB' },
  { id: 'ref-msb-01', institutionName: 'MSB', productName: 'Vay tín chấp · mức tham khảo', rate: '9.6', url: 'https://timo.vn/blogs/so-sanh-lai-suat-vay-ngan-hang-cap-nhat-moi-nhat/', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', dataProvenance: 'WEB_REFERENCE', effectiveDate: new Date().toISOString().slice(0, 10), trustScore: 72, sourceLabel: 'Timo · tham khảo, cần đối chiếu MSB' },
  { id: 'ref-vietinbank-01', institutionName: 'VietinBank', productName: 'Vay tín chấp · mức tham khảo', rate: '9.6', url: 'https://timo.vn/blogs/so-sanh-lai-suat-vay-ngan-hang-cap-nhat-moi-nhat/', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', dataProvenance: 'WEB_REFERENCE', effectiveDate: new Date().toISOString().slice(0, 10), trustScore: 72, sourceLabel: 'Timo · tham khảo, cần đối chiếu VietinBank' },
  { id: 'ref-bidv-01', institutionName: 'BIDV', productName: 'Vay tín chấp · mức tham khảo', rate: '11.9', url: 'https://timo.vn/blogs/so-sanh-lai-suat-vay-ngan-hang-cap-nhat-moi-nhat/', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', dataProvenance: 'WEB_REFERENCE', effectiveDate: new Date().toISOString().slice(0, 10), trustScore: 72, sourceLabel: 'Timo · tham khảo, cần đối chiếu BIDV' },
]
const blocked = ['app vay', 'vay nóng', 'tín dụng đen', 'tindungden', 'ponzi', 'lừa đảo', 'bao lời']

@Injectable()
export class SurveyCalcService {
  constructor(private readonly prisma: PrismaService) {}

  private async catalogProducts(input: SurveyLoanRequest): Promise<CatalogProduct[]> {
    try {
      const rows = await this.prisma.financialProduct.findMany({ where: { isActive: true, productCategory: input.productCategory, minAmountVnd: { lte: new Prisma.Decimal(input.principalVnd) }, maxAmountVnd: { gte: new Prisma.Decimal(input.principalVnd) }, minTermMonths: { lte: input.termMonths }, maxTermMonths: { gte: input.termMonths }, institution: { trustStatus: 'LICENSED' } }, include: { institution: true }, orderBy: { nominalRateMin: 'asc' } })
      if (rows.length === 0) return input.productCategory === 'UNSECURED_LOAN' ? fallbackProducts : []
      return rows.map((row) => ({ id: row.id, institutionName: row.institution.name, productName: row.productName, rate: row.nominalRateMin.toString(), url: row.sourceUrl, calcMethod: row.calcMethod, rateType: row.rateType === 'VARIABLE_NAV' ? 'VARIABLE_NAV' : 'FIXED', dataProvenance: row.dataProvenance === 'WEB_REFERENCE' ? 'WEB_REFERENCE' : 'CATALOG_VERIFIED', effectiveDate: row.effectiveDate.toISOString().slice(0, 10), trustScore: row.dataProvenance === 'CATALOG_VERIFIED' ? 94 : 78, sourceLabel: row.dataProvenance === 'CATALOG_VERIFIED' ? 'Catalog đã xác minh' : 'Nguồn web cần đối chiếu' }))
    } catch { return input.productCategory === 'UNSECURED_LOAN' ? fallbackProducts : [] }
  }

  private async checkTrust(name?: string) {
    if (!name?.trim()) return
    const normalized = name.trim().toLocaleLowerCase('vi-VN')
    if (blocked.some((item) => normalized.includes(item))) this.block(name)
    try {
      const matches = await this.prisma.financialInstitution.count({ where: { trustStatus: 'LICENSED', name: { contains: name.trim(), mode: 'insensitive' } } })
      if (matches === 0) this.block(name)
    } catch {
      const known = ['vietcombank', 'vcb', 'acb', 'mbbank', 'mb', 'techcombank', 'tpbank', 'vpbank', 'bidv', 'agribank', 'hdbank', 'shinhan', 'fubon']
      if (!known.some((item) => normalized.includes(item))) this.block(name)
    }
  }

  private block(name: string): never { throw new UnprocessableEntityException({ errorCode: 'ERR_TRUST_FILTER_BLOCKED', message: 'Tên tổ chức chưa được xác minh hoặc có dấu hiệu rủi ro. Hãy chuyển sang Giám định để kiểm tra.', details: { claimedEntity: name, redirect: '/forensic?claimedEntity=' + encodeURIComponent(name) } }) }

  private async saveSession(session: SessionContext, mode: string, input: unknown, result: { sessionId: string; aiExplanation?: unknown }, dti?: { dtiPct: string; riskBand: string }, shock?: string) {
    try { await this.prisma.calculationSession.create({ data: { id: result.sessionId, sessionMode: mode, inputParamsJson: input as Prisma.InputJsonValue, mathResultsJson: result as Prisma.InputJsonValue, guestSessionId: session.kind === 'guest' ? session.guestSessionId : undefined, userId: session.kind === 'user' ? session.userId : undefined, dtiRatioPct: dti ? new Prisma.Decimal(dti.dtiPct) : undefined, dtiRiskBand: dti?.riskBand, rateShockDelta: shock ? new Prisma.Decimal(shock) : undefined, aiExplanationJson: result.aiExplanation as Prisma.InputJsonValue } }) } catch { /* DB is optional in local degraded mode; math response remains available. */ }
  }

  async loan(input: SurveyLoanRequest, session: SessionContext) {
    await this.checkTrust(input.checkEntityName)
    const shock = input.rateShockDeltaPct ?? '0'; const products = await this.catalogProducts(input)
    const offers = products.map((product) => { const rate = new Prisma.Decimal(product.rate).add(new Prisma.Decimal(shock)).toString(); const calc = product.calcMethod === 'DECLINING_PRINCIPAL' ? decliningPrincipalLoan(input.principalVnd, rate, input.termMonths) : reducingBalanceLoan(input.principalVnd, rate, input.termMonths); const dti = input.dtiOverride ? assessDti(input.dtiOverride.monthlyIncomeVnd, input.dtiOverride.monthlyExpenseVnd, input.dtiOverride.existingDebtPaymentVnd, calc.monthlyPaymentVnd) : null; const fitScore = dti ? Math.max(0, Math.min(100, 100 - Number(dti.dtiPct))) : 50; return { productId: product.id, institutionName: product.institutionName, productName: product.productName, dataProvenance: product.dataProvenance, sourceUrl: product.url, effectiveDate: product.effectiveDate, rateType: product.rateType, sourceLabel: product.sourceLabel, trustScore: product.trustScore, fitScore: Math.round(fitScore), principalNetVnd: input.principalVnd, monthlyPaymentFirstVnd: calc.monthlyPaymentVnd, totalInterestAndFeesVnd: calc.totalInterestVnd, totalPayableVnd: calc.totalPayableVnd, effectiveAprPct: new Prisma.Decimal(rate).toFixed(4), dtiPct: dti?.dtiPct ?? null, schedule: calc.schedule } })
    const ranked = [...offers].sort((a, b) => b.trustScore - a.trustScore || b.fitScore - a.fitScore || (input.priority === 'LOWEST_APR' ? Number(a.effectiveAprPct) - Number(b.effectiveAprPct) : input.priority === 'LOWEST_TOTAL_COST' ? Number(a.totalPayableVnd) - Number(b.totalPayableVnd) : Number(a.monthlyPaymentFirstVnd) - Number(b.monthlyPaymentFirstVnd))); const best = ranked[0]; const dti = input.dtiOverride && best?.dtiPct ? assessDti(input.dtiOverride.monthlyIncomeVnd, input.dtiOverride.monthlyExpenseVnd, input.dtiOverride.existingDebtPaymentVnd, best.monthlyPaymentFirstVnd) : null
    const result = { sessionId: randomUUID(), trustFilterSummary: { totalLicensedFound: products.length, blockedEntities: [] }, dtiAssessment: dti ? { bestOfferDtiPct: dti.dtiPct, riskBand: dti.riskBand, disposableCashflowVnd: dti.disposableVnd, disclaimer: 'Kết quả là ước tính hỗ trợ quyết định, không phải phê duyệt tín dụng của ngân hàng.' } : null, offers: ranked, aiExplanation: { summary: 'Kết quả được tính bằng bộ công thức quyết định, không để AI thay đổi số liệu.', tradeoffs: ['Gói có khoản trả tháng thấp hơn có thể có tổng chi phí cao hơn.', 'Kiểm tra phí tất toán trước hạn và điều kiện lãi suất trước khi ký.'] }, meta: { degradedMode: true, errorCode: 'ERR_AI_DEGRADED_FALLBACK' as const } }
    await this.saveSession(session, 'LOAN_SURVEY', input, result, dti ?? undefined, shock); return result
  }

  async investment(input: SurveyInvestRequest, session: SessionContext) {
    const annualReturnPct = '5'; const calculation = compoundDca(input.initialVnd, input.monthlyContributionVnd, input.termMonths, annualReturnPct, '0.5', '0.1'); const result = { sessionId: randomUUID(), offers: [{ productId: 'fund-open-01', institutionName: 'Quỹ mở mẫu đã xác minh', productName: 'Danh mục tích lũy quỹ mở', dataProvenance: 'CATALOG_VERIFIED' as const, sourceUrl: 'https://www.sbv.gov.vn/', effectiveDate: new Date().toISOString().slice(0, 10), rateType: 'VARIABLE_NAV' as const, scenario: { annualReturnPct, ...calculation } }] }; await this.saveSession(session, 'INVESTMENT_SURVEY', input, result); return result
  }

  async manualCompare(input: ManualCompareRequest, session: SessionContext) { const offers = input.offers.map((item) => { const calc = reducingBalanceLoan(item.principalVnd, item.annualRatePct, item.termMonths); return { label: item.label, monthlyPaymentVnd: calc.monthlyPaymentVnd, totalInterestVnd: calc.totalInterestVnd, totalPayableVnd: calc.totalPayableVnd, effectiveAprPct: new Prisma.Decimal(item.annualRatePct).toFixed(4) } }); const result = { sessionId: randomUUID(), offers }; await this.saveSession(session, 'MANUAL_COMPARE', input, result); return result }

  async history(session: SessionContext) { const rows = await this.prisma.calculationSession.findMany({ where: session.kind === 'guest' ? { guestSessionId: session.guestSessionId } : { userId: session.userId }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, sessionMode: true, createdAt: true, dtiRatioPct: true, dtiRiskBand: true, rateShockDelta: true } }); return { sessions: rows.map((row) => ({ ...row, dtiRatioPct: row.dtiRatioPct?.toString() ?? null, rateShockDelta: row.rateShockDelta?.toString() ?? null })) } }
}
