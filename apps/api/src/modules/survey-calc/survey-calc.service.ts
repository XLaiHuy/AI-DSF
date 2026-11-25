import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common'
import { Prisma, type FinancialProduct } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import {
  AI_TASK_SCHEMAS, DataProvenance, InvestmentCategory, LoanUseCase, RateType, SurveySessionDetailResponseSchema, handoffRoutes,
  type ManualCompareRequest, type ManualCompareResponse, type SessionContext,
  type SurveyInvestRequest, type SurveyInvestResponse, type SurveyLoanRequest, type SurveyLoanResponse, type SurveySessionDetailResponse,
} from '@fincopilot/shared-types'
import { amortizeLoan, assessDti, compoundDca, effectiveLoanApr, openFundScenarioBands, simulateEarlySettlement } from '@fincopilot/financial-math'
import { z } from 'zod'
import { PrismaService } from '../../common/prisma.service'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { normalizeVietnamese } from '../forensic/data/trusted-institutions'
import { redemptionFeeTiers, syncProductCatalog } from './product-catalog'

const D = Prisma.Decimal
const sessionIdSchema = z.guid()
const investmentCategories = InvestmentCategory.options
const loanMethods = ['REDUCING_BALANCE', 'DECLINING_PRINCIPAL', 'FLAT_RATE'] as const
const blockedTerms = ['app vay', 'vay nong', 'tin dung den', 'tindungden', 'ponzi', 'lua dao', 'bao loi']
const fallbackExplanation = {
  summary: 'Kết quả được tính từ dòng tiền của từng phương án.',
  tradeoffs: ['Khoản trả tháng thấp có thể đi kèm tổng chi phí cao hơn.', 'Kiểm tra phí và điều kiện thay đổi lãi suất trước khi ký.'],
}

function owner(session: SessionContext) {
  return session.kind === 'guest' ? { guestSessionId: session.guestSessionId } : { userId: session.userId }
}

function invalid(message: string): never {
  throw new BadRequestException({ errorCode: 'ERR_VALIDATION_FAILED', message })
}

function validateRate(rate: Prisma.Decimal) {
  if (rate.lt(0) || rate.gt(200)) invalid('Lãi suất hằng năm sau điều chỉnh phải từ 0% đến 200%.')
  return rate
}

function disbursement(principal: Prisma.Decimal, fee: Prisma.Decimal) {
  if (fee.gte(principal)) invalid('Phí trả trước phải nhỏ hơn số tiền vay.')
  const net = principal.sub(fee).toDecimalPlaces(0)
  if (!net.gt(0)) invalid('Số tiền thực nhận phải lớn hơn 0 đồng.')
  return net
}

function offerSource(product: FinancialProduct & { institution: { name: string } }) {
  const dataProvenance = DataProvenance.parse(product.dataProvenance)
  return {
    productId: product.id, institutionName: product.institution.name, productName: product.productName,
    dataProvenance, sourceUrl: product.sourceUrl, effectiveDate: product.effectiveDate.toISOString().slice(0, 10),
    rateType: RateType.parse(product.rateType),
    sourceLabel: dataProvenance === 'CATALOG_VERIFIED' ? 'Danh mục đã xác minh' : 'Tham khảo từ nguồn công bố',
  }
}

function dtiAssessment(input: SurveyLoanRequest['dtiOverride'], payment: string) {
  if (!input) return null
  const dti = assessDti(input.monthlyIncomeVnd, input.monthlyExpenseVnd, input.existingDebtPaymentVnd, payment)
  return {
    bestOfferDtiPct: dti.dtiPct, riskBand: dti.riskBand, disposableCashflowVnd: dti.disposableVnd,
    disclaimer: 'Kết quả ước tính không thay thế đánh giá tín dụng của tổ chức cho vay.',
  }
}

@Injectable()
export class SurveyCalcService {
  private readonly logger = new Logger(SurveyCalcService.name)

  constructor(private readonly prisma: PrismaService, private readonly ai: AiGatewayService) {}

  syncTrustedProducts() {
    return syncProductCatalog(this.prisma)
  }

  private async catalog(selection: Pick<Prisma.FinancialProductWhereInput, 'productCategory' | 'loanUseCase'>, input: {
    enableWebFallback?: boolean; termMonths: number; amount: Prisma.Decimal
  }, calcMethod: Prisma.StringFilter) {
    const base = {
      isActive: true, ...selection, calcMethod, institution: { trustStatus: 'LICENSED' },
      effectiveDate: { lte: new Date() },
      dataProvenance: { in: input.enableWebFallback === false ? ['CATALOG_VERIFIED'] : [...DataProvenance.options] },
    } satisfies Prisma.FinancialProductWhereInput
    try {
      const products = await this.prisma.financialProduct.findMany({
        where: { ...base, minAmountVnd: { lte: input.amount }, maxAmountVnd: { gte: input.amount },
          minTermMonths: { lte: input.termMonths }, maxTermMonths: { gte: input.termMonths } },
        include: { institution: { select: { name: true } } }, orderBy: [{ nominalRateMin: 'asc' }, { id: 'asc' }],
      })
      if (products.length) return { products, catalogStatus: 'AVAILABLE' as const }
      const active = await this.prisma.financialProduct.count({ where: base })
      return { products, catalogStatus: active ? 'NO_MATCH' as const : 'EMPTY_CATALOG' as const }
    } catch {
      this.logger.warn({ event: 'survey_catalog_unavailable' })
      return { products: [], catalogStatus: 'CATALOG_UNAVAILABLE' as const }
    }
  }

  private async checkTrust(name?: string) {
    if (!name?.trim()) return
    const normalized = normalizeVietnamese(name)
    const block = () => { throw new UnprocessableEntityException({
      errorCode: 'ERR_TRUST_FILTER_BLOCKED',
      message: 'Tên tổ chức chưa được xác minh. Hãy chuyển sang Giám định để kiểm tra.',
      details: { claimedEntity: name, redirect: handoffRoutes.trustFilterToForensic({ claimedEntity: name }) },
    }) }
    if (blockedTerms.some((term) => normalized.includes(term))) block()
    let institutions
    try {
      institutions = await this.prisma.financialInstitution.findMany({
        where: { trustStatus: 'LICENSED' }, select: { name: true, code: true },
      })
    } catch {
      throw new ServiceUnavailableException({ errorCode: 'ERR_SERVICE_UNAVAILABLE', message: 'Chưa kết nối được danh mục để xác minh tổ chức.' })
    }
    const aliases: Record<string, string[]> = {
      VCB: ['ngan hang tmcp ngoai thuong viet nam'], BIDV: ['ngan hang tmcp dau tu va phat trien viet nam'],
      MBB: ['mb', 'ngan hang tmcp quan doi'], ACB: ['ngan hang tmcp a chau'],
      CTG: ['ngan hang tmcp cong thuong viet nam'], AGR: ['ngan hang nong nghiep va phat trien nong thon viet nam'],
    }
    if (!institutions.some(({ name: registeredName, code }) =>
      [normalizeVietnamese(registeredName), normalizeVietnamese(code), ...(aliases[code] ?? [])].includes(normalized),
    )) block()
  }

  private async profile(session: SessionContext) {
    try {
      return await this.prisma.financialProfile.findUnique({ where: owner(session) })
    } catch {
      this.logger.warn({ event: 'survey_profile_unavailable' })
      return null
    }
  }

  private async sourceLinks(input: SurveyLoanRequest, session: SessionContext) {
    const { sourceArticleId, sourceAuditId } = input
    if (sourceArticleId && !await this.prisma.marketArticle.findFirst({
      where: { id: sourceArticleId, feedStatus: 'ACTIVE' }, select: { id: true },
    })) invalid('Bài viết nguồn không khả dụng.')
    if (sourceAuditId && !await this.prisma.forensicAudit.findFirst({
      where: { id: sourceAuditId, ...owner(session) }, select: { id: true },
    })) invalid('Kết quả giám định nguồn không khả dụng trong phiên này.')
    return { sourceArticleId, sourceAuditId }
  }

  private async saveSession(
    session: SessionContext, mode: string, input: object, result: { sessionId: string; aiExplanation?: unknown; meta?: object },
    links: { profileId?: string; sourceArticleId?: string; sourceAuditId?: string } = {},
    dti?: NonNullable<SurveyLoanResponse['dtiAssessment']> | null, shock?: string,
  ) {
    try {
      await this.prisma.calculationSession.create({ data: {
        id: result.sessionId, sessionMode: mode, ...owner(session), ...links,
        inputParamsJson: input as Prisma.InputJsonValue, mathResultsJson: result as Prisma.InputJsonValue,
        dtiRatioPct: dti?.bestOfferDtiPct, dtiRiskBand: dti?.riskBand, rateShockDelta: shock,
        aiExplanationJson: result.aiExplanation ? result.aiExplanation as Prisma.InputJsonValue : undefined,
      } })
      return true
    } catch (error) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined
      this.logger.warn({ event: 'survey_session_save_failed', mode, code })
      return false
    }
  }

  async loan(input: SurveyLoanRequest, session: SessionContext): Promise<SurveyLoanResponse> {
    await this.checkTrust(input.checkEntityName)
    const shock = new D(input.rateShockDeltaPct ?? 0).toDecimalPlaces(3)
    if (shock.abs().gt(200)) invalid('Mức điều chỉnh lãi suất nằm ngoài phạm vi mô phỏng.')
    const principal = new D(input.principalVnd).toDecimalPlaces(0)
    if (!principal.gt(0)) invalid('Số tiền vay phải từ 1 đồng.')
    const [links, profile, catalog] = await Promise.all([
      this.sourceLinks(input, session), this.profile(session),
      this.catalog(input.loanUseCase ? { loanUseCase: input.loanUseCase } : { productCategory: input.productCategory },
        { ...input, amount: principal }, { in: [...loanMethods] }),
    ])
    const dtiInput = input.dtiOverride ?? (profile?.monthlyIncomeVnd != null && profile.monthlyExpenseVnd != null && profile.existingDebtPaymentVnd != null
      ? { monthlyIncomeVnd: profile.monthlyIncomeVnd.toString(), monthlyExpenseVnd: profile.monthlyExpenseVnd.toString(),
        existingDebtPaymentVnd: profile.existingDebtPaymentVnd.toString() }
      : undefined)
    const offers = catalog.products.flatMap((product): SurveyLoanResponse['offers'] => {
      const calcMethod = loanMethods.find((method) => method === product.calcMethod)
      if (!calcMethod) return []
      const source = offerSource(product)
      const initialRate = validateRate(product.nominalRateMin.add(shock))
      let rateAssumption = product.rateNote ?? undefined
      let laterRate
      if (source.rateType === 'FLOATING' || source.rateType === 'PROMO_THEN_FLOATING') {
        const hasLaterRate = source.rateType === 'PROMO_THEN_FLOATING' && product.promoMonths != null
          && product.promoMonths < input.termMonths && product.nominalRateMax.gt(product.nominalRateMin)
        if (hasLaterRate && product.promoMonths != null) {
          const rate = validateRate(product.nominalRateMax.add(shock))
          laterRate = { afterMonths: product.promoMonths, annualRatePct: rate }
          rateAssumption = [rateAssumption, 'Kịch bản dùng mức lãi cao trong danh mục sau ưu đãi. Hợp đồng thực tế có thể theo lãi tham chiếu' +
            (product.floatingMargin ? ' cộng ' + product.floatingMargin + ' điểm phần trăm.' : '.')].filter(Boolean).join(' ')
        } else {
          rateAssumption = [rateAssumption, 'Mô phỏng giữ mức lãi công bố vì danh mục chưa có lãi tham chiếu cho các kỳ tiếp theo.'].filter(Boolean).join(' ')
        }
      }
      const upfrontFee = principal.mul(product.upfrontFeeRate ?? 0).div(100).toDecimalPlaces(0)
      const monthlyFee = new D(product.monthlyFeeVnd ?? 0).toDecimalPlaces(0)
      const net = disbursement(principal, upfrontFee)
      const calculation = amortizeLoan(principal, initialRate, input.termMonths, calcMethod, { monthlyFeeVnd: monthlyFee, laterRate })
      const shockedRate = (rate: Prisma.Decimal) => D.min(200, rate.add(2))
      const stressSchedule = amortizeLoan(principal, laterRate ? initialRate : shockedRate(initialRate), input.termMonths, calcMethod, {
        monthlyFeeVnd: monthlyFee,
        laterRate: laterRate && { ...laterRate, annualRatePct: shockedRate(laterRate.annualRatePct) },
      }).schedule
      const stressPaymentFirstVnd = laterRate
        ? D.max(...calculation.schedule.slice(laterRate.afterMonths).map(({ paymentVnd }) => paymentVnd)).toFixed(0)
        : stressSchedule[0].paymentVnd
      const dti = dtiAssessment(dtiInput, calculation.monthlyPaymentVnd)
      const fitScore = dti?.bestOfferDtiPct == null ? 50
        : D.max(0, D.min(100, new D(100).sub(dti.bestOfferDtiPct))).toDecimalPlaces(0).toNumber()
      return [{
        ...source, calcMethod, rateAssumption, upfrontFeeVnd: upfrontFee.toFixed(0), monthlyFeeVnd: monthlyFee.toFixed(0),
        loanUseCase: LoanUseCase.safeParse(product.loanUseCase).data ?? null,
        nominalRatePct: product.nominalRateMin.toFixed(), stressPaymentFirstVnd, stressSchedule,
        principalNetVnd: net.toFixed(0), monthlyPaymentFirstVnd: calculation.monthlyPaymentVnd,
        effectiveAprPct: effectiveLoanApr(net, calculation.schedule), totalPayableVnd: calculation.totalPayableVnd,
        totalInterestAndFeesVnd: new D(calculation.totalPayableVnd).sub(net).toFixed(0),
        trustScore: source.dataProvenance === 'CATALOG_VERIFIED' ? 94 : 78, fitScore,
        dtiPct: dti?.bestOfferDtiPct ?? null, dtiAssessment: dti, schedule: calculation.schedule,
      }]
    })
    const priorityField = {
      LOWEST_APR: 'effectiveAprPct', LOWEST_MONTHLY_PAYMENT: 'monthlyPaymentFirstVnd', LOWEST_TOTAL_COST: 'totalInterestAndFeesVnd',
    } as const
    const field = priorityField[input.priority]
    offers.sort((a, b) => b.trustScore - a.trustScore || new D(a[field]).cmp(b[field]) || (b.fitScore ?? 0) - (a.fitScore ?? 0))
    let aiExplanation: SurveyLoanResponse['aiExplanation'] = offers.length ? fallbackExplanation : null
    let degradedMode = false
    if (offers.length) {
      try {
        aiExplanation = await this.ai.generateStructured('SURVEY_EXPLAIN', AI_TASK_SCHEMAS.SURVEY_EXPLAIN, {
          instruction: 'Giải thích bằng tiếng Việt sự đánh đổi giữa khoản trả tháng và tổng chi phí. Không tính lại, sửa số liệu, nhắc thông tin định danh hay khuyên chọn một gói.',
          termMonths: input.termMonths,
          offers: offers.slice(0, 5).map(({ monthlyPaymentFirstVnd, totalInterestAndFeesVnd, effectiveAprPct, rateType }) =>
            ({ monthlyPaymentFirstVnd, totalInterestAndFeesVnd, effectiveAprPct, rateType })),
        })
      } catch {
        degradedMode = true
      }
    }
    const dti = offers[0]?.dtiAssessment ?? null
    const result = {
      sessionId: randomUUID(), offers, dtiAssessment: dti, aiExplanation,
      trustFilterSummary: { totalLicensedFound: offers.length, blockedEntities: [] },
    }
    const meta = { degradedMode, catalogStatus: catalog.catalogStatus, savedToHistory: true,
      ...(degradedMode ? { errorCode: 'ERR_AI_DEGRADED_FALLBACK' as const } : {}) }
    const savedToHistory = await this.saveSession(session, 'LOAN_SURVEY', input, { ...result, meta },
      { ...links, profileId: profile?.id }, dti, shock.toString())
    return { ...result, meta: { ...meta, savedToHistory } }
  }

  async investment(input: SurveyInvestRequest, session: SessionContext): Promise<SurveyInvestResponse> {
    await this.checkTrust(input.checkEntityName)
    const initial = new D(input.initialVnd)
    const monthly = new D(input.monthlyContributionVnd)
    const [profile, catalog] = await Promise.all([
      this.profile(session),
      this.catalog({ productCategory: input.productCategory ?? { in: investmentCategories } }, {
        ...input, amount: initial.isZero() ? monthly : initial,
      }, { equals: 'COMPOUND_DCA' }),
    ])
    const offers = catalog.products.map((product) => {
      const source = offerSource(product)
      const productCategory = InvestmentCategory.parse(product.productCategory)
      const annualReturnPct = product.nominalRateMin.toString()
      const tiers = redemptionFeeTiers.safeParse(product.redemptionFeeTiers)
      const tax = product.investmentTaxPct ?? 0
      const options = { effectiveAnnualYield: source.rateType === 'VARIABLE_NAV',
        taxFreeAfterMonths: product.investmentTaxFreeAfterMonths ?? undefined, redemptionFeeTiers: tiers.data }
      const bandsAt = (month: number) => productCategory === 'OPEN_FUND'
        ? openFundScenarioBands(initial, monthly, month, annualReturnPct, '0', tax, options)
        : undefined
      const project = (month: number) => {
        const bands = bandsAt(month)
        const base = bands?.base ?? { annualReturnPct, ...compoundDca(initial, monthly, month, annualReturnPct, '0', tax, options) }
        return { base, bands }
      }
      const { base: scenario, bands: scenarios } = project(input.termMonths)
      const step = Math.max(1, Math.ceil(input.termMonths / 24))
      const months = Array.from({ length: Math.ceil(input.termMonths / step) }, (_, index) => index * step)
      const projection = [...months, input.termMonths].map((month) => {
        if (month === 0) return { month, contributedVnd: initial.toFixed(0), baseVnd: initial.toFixed(0),
          ...(scenarios ? { conservativeVnd: initial.toFixed(0), optimisticVnd: initial.toFixed(0) } : {}) }
        const { base, bands } = month === input.termMonths ? { base: scenario, bands: scenarios } : project(month)
        return { month, contributedVnd: base.totalContributedVnd, baseVnd: base.netValueVnd,
          ...(bands ? { conservativeVnd: bands.conservative.netValueVnd, optimisticVnd: bands.optimistic.netValueVnd } : {}) }
      })
      return {
        ...source, productCategory,
        sourceLabel: product.rateNote ?? source.sourceLabel,
        scenario, scenarios, projection,
      }
    })
    const result = { sessionId: randomUUID(), offers, meta: { catalogStatus: catalog.catalogStatus, savedToHistory: true } }
    const savedToHistory = await this.saveSession(session, 'INVESTMENT_SURVEY', input, result, { profileId: profile?.id })
    return { ...result, meta: { catalogStatus: catalog.catalogStatus, savedToHistory } }
  }

  async manualCompare(input: ManualCompareRequest, session: SessionContext): Promise<ManualCompareResponse> {
    const offers = input.offers.map((item) => {
      const principal = new D(item.principalVnd).toDecimalPlaces(0)
      const fee = new D(item.upfrontFeeVnd ?? 0).toDecimalPlaces(0)
      const net = disbursement(principal, fee)
      const { termMonths, promoMonths, floatingRatePct, earlySettlementMonth, earlySettlementFeePct } = item
      if ((promoMonths === undefined) !== (floatingRatePct === undefined) || (promoMonths != null && promoMonths >= termMonths)) {
        invalid('Nhập cả lãi suất thả nổi và thời gian ưu đãi ngắn hơn kỳ hạn vay.')
      }
      if ((earlySettlementMonth != null && earlySettlementMonth > termMonths) ||
        (earlySettlementFeePct != null && (earlySettlementMonth == null || new D(earlySettlementFeePct).gt(100)))) {
        invalid('Tháng tất toán phải nằm trong kỳ hạn vay và phí tất toán phải từ 0% đến 100%.')
      }
      const calcMethod = item.calcMethod ?? 'REDUCING_BALANCE'
      const monthlyFeeVnd = new D(item.monthlyFeeVnd ?? 0).toFixed(0)
      const laterRate = promoMonths != null && floatingRatePct != null
        ? { afterMonths: promoMonths, annualRatePct: validateRate(new D(floatingRatePct)) } : undefined
      const calc = amortizeLoan(principal, validateRate(new D(item.annualRatePct)), termMonths, calcMethod, { monthlyFeeVnd, laterRate })
      return {
        label: item.label, monthlyPaymentVnd: calc.monthlyPaymentVnd, totalInterestVnd: calc.totalInterestVnd,
        totalPayableVnd: calc.totalPayableVnd, effectiveAprPct: effectiveLoanApr(net, calc.schedule),
        principalNetVnd: net.toFixed(0), upfrontFeeVnd: fee.toFixed(0),
        calcMethod, monthlyFeeVnd, schedule: calc.schedule,
        earlySettlement: earlySettlementMonth != null
          ? simulateEarlySettlement(net, calc.schedule, earlySettlementMonth, earlySettlementFeePct ?? '0') : null,
      }
    })
    const profile = await this.profile(session)
    const result = { sessionId: randomUUID(), offers, meta: { savedToHistory: true } }
    const savedToHistory = await this.saveSession(session, 'MANUAL_COMPARE', input, result, { profileId: profile?.id })
    return { ...result, meta: { savedToHistory } }
  }

  async history(session: SessionContext) {
    const rows = await this.prisma.calculationSession.findMany({
      where: owner(session), orderBy: { createdAt: 'desc' }, take: 20,
      select: { id: true, sessionMode: true, createdAt: true, dtiRatioPct: true, dtiRiskBand: true, rateShockDelta: true },
    })
    return { sessions: rows.map((row) => ({
      ...row, dtiRatioPct: row.dtiRatioPct?.toString() ?? null, rateShockDelta: row.rateShockDelta?.toString() ?? null,
    })) }
  }

  async sessionDetail(session: SessionContext, id: string): Promise<SurveySessionDetailResponse> {
    const notFound = () => new NotFoundException('Không tìm thấy phiên khảo sát.')
    if (!sessionIdSchema.safeParse(id).success) throw notFound()
    const row = await this.prisma.calculationSession.findFirst({ where: { id, ...owner(session) },
      select: { id: true, sessionMode: true, createdAt: true, inputParamsJson: true, mathResultsJson: true } })
    if (!row) throw notFound()
    const detail = SurveySessionDetailResponseSchema.safeParse({
      id: row.id, sessionMode: row.sessionMode, createdAt: row.createdAt.toISOString(),
      inputParams: row.inputParamsJson, result: row.mathResultsJson,
    })
    if (!detail.success) throw notFound()
    const saved = detail.data
    if (saved.sessionMode === 'MANUAL_COMPARE') {
      saved.result.offers.forEach((offer, index) => {
        const input = saved.inputParams.offers[index]
        if (!offer.schedule.length && input) {
          offer.schedule = amortizeLoan(input.principalVnd, input.annualRatePct, input.termMonths, offer.calcMethod).schedule
        }
      })
    }
    return saved
  }
}
