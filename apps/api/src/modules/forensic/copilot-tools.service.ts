import { assessDti } from '@fincopilot/financial-math'
import { Injectable, Optional } from '@nestjs/common'
import {
  ForensicGuidanceSchema, SurveyInvestRequestSchema, SurveyLoanRequestSchema, SurveyRefinanceTermsSchema, handoffRoutes,
  type CopilotRichCard, type CopilotToolTraceItem, type FinancialHealthRequest, type ForensicGuidance, type SurveyInvestResponse,
} from '@fincopilot/shared-types'
import Decimal from 'decimal.js'
import { PrismaService } from '../../common/prisma.service'
import { hasInternalIdentifierLeak } from '../../common/untrusted-text'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { calculateFinancialHealth } from '../profile-auth/financial-health.engine'
import { readThreatTrends } from '../radar/threat-trends'
import { compareCatalogQuality } from '../survey-calc/product-catalog'
import { SurveyCalcService } from '../survey-calc/survey-calc.service'
import { copilotAmounts, copilotIntent, copilotLoanGoal, copilotLoanUseCase, copilotProfileAmounts, copilotRefinanceRates, type CopilotInput } from './copilot-input'
import { normalizeVietnamese } from './data/trusted-institutions'
import { formatCaseAmount } from './payment-qr-description'
import { maskForensicText } from './qr-evidence'
import { publicThreatAlertWhere } from './threat-draft'
import { vnScamTaxonomy } from './vn-scam-taxonomy'

type Guidance = Omit<ForensicGuidance, 'type'>
type Tool = CopilotToolTraceItem['tool']
const labels: Record<Tool, string> = {
  PROFILE_HEALTH: 'Hồ sơ DTI', LOAN_SURVEY: 'Kho ngân hàng NHNN', INVESTMENT_SURVEY: 'Danh mục đầu tư đã xác minh',
  REFINANCE_SIM: 'Mô phỏng đổi khoản vay', RADAR_ALERTS: 'Radar cảnh báo đã xác minh',
}
const investmentCategories = { SAVING: 'Tiết kiệm', ACCUMULATION: 'Tích lũy', OPEN_FUND: 'Quỹ mở' } as const
const marketCategories = { UNSECURED_LOAN: 'Vay tín chấp', SECURED_LOAN: 'Vay thế chấp', SAVING: 'Tiết kiệm', ACCUMULATION: 'Tích lũy' } as const
const profileFields = ['monthlyIncomeVnd', 'monthlyExpenseVnd', 'existingDebtPaymentVnd', 'liquidSavingsVnd'] as const
const Precise = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP })
const safeText = (input: string, fallback: string, max = 200) => {
  const masked = maskForensicText(input).trim()
  const text = masked.length > max ? masked.slice(0, max - 1).replace(/\s+\S*$/u, '') + '…' : masked
  return !text || hasInternalIdentifierLeak([input, text]) ? fallback : text
}
const offerNames = (offer: { institutionName: string; productName: string }) => ({
  institutionName: safeText(offer.institutionName, 'Tổ chức trong danh mục'),
  productName: safeText(offer.productName, 'Sản phẩm trong danh mục'),
})
const offerProvenance = (offer: {
  dataProvenance: 'CATALOG_VERIFIED' | 'WEB_REFERENCE'
  sourceLabel: string
  effectiveDate: string
  freshnessTier?: NonNullable<SurveyInvestResponse['offers'][number]['freshnessTier']>
  verificationReceipt?: SurveyInvestResponse['offers'][number]['verificationReceipt']
}) => ({
  dataProvenance: offer.dataProvenance,
  sourceLabel: safeText(offer.sourceLabel, 'Nguồn công bố', 120),
  effectiveDate: offer.effectiveDate, freshnessTier: offer.freshnessTier, verificationReceipt: offer.verificationReceipt,
})
const safeResult = (trace: CopilotToolTraceItem[], result: Guidance): Guidance => {
  const parsed = ForensicGuidanceSchema.safeParse({ type: 'guidance', ...result, toolTrace: trace })
  if (!parsed.success || hasInternalIdentifierLeak([
    result.message, result.cta?.label ?? '', result.extractedSlots?.goalNote ?? '', ...(result.suggestedPrompts ?? []), ...(result.checklist ?? []),
    ...trace.flatMap(({ label, summary }) => [label, summary]),
  ])) return { intent: 'NEEDS_DETAILS', message: 'Chưa thể hiển thị kết quả đối chiếu. Vui lòng thử lại.' }
  return { ...result, toolTrace: trace }
}

@Injectable()
export class CopilotToolsService {
  // Verified calculations do not need an AI provider.
  constructor(private readonly survey: SurveyCalcService, private readonly prisma: PrismaService, @Optional() _ai?: AiGatewayService) {}

  async planAndExecute(input: CopilotInput): Promise<Guidance | undefined> {
    const intent = copilotIntent(input.rawText, input.domain)
    if (!intent) return undefined
    const trace: CopilotToolTraceItem[] = []
    const result = intent === 'RADAR' ? await this.radar(trace)
      : intent === 'PROFILE' ? await this.profileSnapshot(input, trace)
        : intent === 'LOAN' ? await this.loan(input, trace)
          : intent === 'REFINANCE' ? await this.refinance(input, trace)
            : await this.investment(input, intent, trace)
    return result ? safeResult(trace, result) : undefined
  }

  private async step<T>(trace: CopilotToolTraceItem[], tool: Tool, run: () => Promise<{
    data: T; summary: string; empty?: boolean
  }>): Promise<T | undefined> {
    const start = performance.now()
    try {
      const { data, summary, empty } = await run()
      trace.push({ tool, label: labels[tool], status: empty ? 'empty' : 'done', summary, durationMs: Math.round(performance.now() - start) })
      return data
    } catch {
      trace.push({ tool, label: labels[tool], status: 'skipped', summary: 'Tạm thời chưa truy cập được dữ liệu.', durationMs: Math.round(performance.now() - start) })
    }
  }

  private profile(input: CopilotInput, trace: CopilotToolTraceItem[]) {
    return this.step(trace, 'PROFILE_HEALTH', async () => {
      const stated = copilotProfileAmounts(input.rawText)
      const inline = profileFields.some(key => stated[key] != null)
      const stored = await this.prisma.financialProfile.findUnique({
        where: input.session.kind === 'user' ? { userId: input.session.userId } : { guestSessionId: input.session.guestSessionId },
        select: { monthlyIncomeVnd: true, monthlyExpenseVnd: true, existingDebtPaymentVnd: true, liquidSavingsVnd: true },
      }).catch((cause: unknown) => {
        if (!inline) throw cause
        return null
      })
      const values: FinancialHealthRequest = {
        monthlyIncomeVnd: stated.monthlyIncomeVnd ?? stored?.monthlyIncomeVnd?.toFixed() ?? null,
        monthlyExpenseVnd: stated.monthlyExpenseVnd ?? stored?.monthlyExpenseVnd?.toFixed() ?? null,
        existingDebtPaymentVnd: stated.existingDebtPaymentVnd ?? stored?.existingDebtPaymentVnd?.toFixed() ?? null,
        liquidSavingsVnd: stated.liquidSavingsVnd ?? stored?.liquidSavingsVnd?.toFixed() ?? null,
      }
      const assumedDebt = inline && values.existingDebtPaymentVnd == null && values.monthlyIncomeVnd != null && values.monthlyExpenseVnd != null
      if (assumedDebt) values.existingDebtPaymentVnd = '0'
      const { monthlyIncomeVnd: income, monthlyExpenseVnd: expense, existingDebtPaymentVnd: debt } = values
      const baseline = income != null && expense != null && debt != null ? assessDti(income, expense, debt, '0') : null
      const empty = profileFields.every(key => values[key] == null)
      const summary = empty ? 'Chưa có số liệu thu nhập, chi phí hoặc khoản trả nợ.'
        : assumedDebt ? 'Dùng số liệu bạn nhập. Tạm tính khoản trả nợ hiện tại bằng 0 đ vì chưa có số liệu.'
          : inline ? 'Đã đối chiếu số liệu bạn nhập với thông tin sẵn có trong hồ sơ.'
            : 'Đã dùng số liệu tài chính từ hồ sơ của phiên này.'
      return { data: { values, inline, summary, baseline }, summary, empty }
    })
  }

  private async loan(input: CopilotInput, trace: CopilotToolTraceItem[]): Promise<Guidance | undefined> {
    const { amount, term } = copilotAmounts(input.rawText, 'LOAN', input.slots)
    const goalNote = copilotLoanGoal(input.rawText) ?? input.slots.goalNote
    const loanUseCase = copilotLoanUseCase(goalNote ?? '')
    const secured = (loanUseCase && loanUseCase !== 'UNSECURED_SALARY') || /\bthe chap\b/.test(normalizeVietnamese(input.rawText))
    const checked = SurveyLoanRequestSchema.safeParse({
      principalVnd: amount, termMonths: term, loanUseCase, productCategory: secured ? 'SECURED_LOAN' : 'UNSECURED_LOAN',
      priority: 'LOWEST_APR', enableWebFallback: true,
    })
    if (!checked.success || new Precise(checked.data.principalVnd).lt(1)) return undefined
    const terms = checked.data
    const profile = await this.profile(input, trace)
    const income = profile?.values.monthlyIncomeVnd
    const expense = profile?.values.monthlyExpenseVnd
    const debt = profile?.values.existingDebtPaymentVnd
    const dtiOverride = income != null && expense != null && debt != null
      ? { monthlyIncomeVnd: income, monthlyExpenseVnd: expense, existingDebtPaymentVnd: debt } : undefined
    const result = await this.step(trace, 'LOAN_SURVEY', async () => {
      const data = await this.survey.loan({ ...terms, dtiOverride }, input.session, {
        verifiedBanksOnly: true, deterministic: true, persistDtiOverride: !profile?.inline,
      })
      if (data.meta?.catalogStatus === 'CATALOG_UNAVAILABLE') throw new Error('Catalog unavailable')
      return { data, empty: !data.offers.length, summary: data.offers.length
        ? 'Đã đối chiếu gói của ngân hàng có giấy phép và phân loại nguồn lãi suất.'
        : 'Chưa tìm thấy gói phù hợp với số tiền và kỳ hạn đã nhập.' }
    })
    const openSurveyHref = result?.meta?.savedToHistory
      ? handoffRoutes.surveySession({ sessionId: result.sessionId, mode: 'loan' })
      : handoffRoutes.quickSurvey({ amount: terms.principalVnd, term: terms.termMonths })
    const dti = result?.dtiAssessment
    const richCard = result && {
      kind: 'LOAN_PLAN' as const, principalVnd: terms.principalVnd, termMonths: terms.termMonths,
      categoryLabel: secured ? marketCategories.SECURED_LOAN : marketCategories.UNSECURED_LOAN,
      profileUsed: Boolean(dtiOverride), dtiPct: dti?.bestOfferDtiPct ?? profile?.baseline?.dtiPct ?? null,
      dtiRiskBand: dti?.riskBand ?? profile?.baseline?.riskBand ?? 'UNAVAILABLE' as const,
      disposableCashflowVnd: dti?.disposableCashflowVnd ?? profile?.baseline?.disposableVnd ?? null, openSurveyHref,
      topOffers: result.offers.slice(0, 3).map(offer => ({
        ...offerNames(offer), ...offerProvenance(offer), monthlyPaymentFirstVnd: offer.monthlyPaymentFirstVnd, effectiveAprPct: offer.effectiveAprPct,
        totalInterestAndFeesVnd: offer.totalInterestAndFeesVnd, trustScore: offer.trustScore,
      })),
    }
    const best = result?.offers[0]
    const message = best
      ? 'Với khoản vay ' + formatCaseAmount(terms.principalVnd) + ' trong ' + terms.termMonths +
        ' tháng, gói đứng đầu có khoản trả tháng đầu ' + formatCaseAmount(best.monthlyPaymentFirstVnd) + '.'
      : result ? 'Danh mục ngân hàng chưa có gói phù hợp với số tiền và kỳ hạn bạn nhập.'
        : 'Chưa đối chiếu được danh mục ngân hàng. Bạn có thể mở Khảo sát để thử lại.'
    return {
      intent: 'FINANCIAL_EDUCATION', message, richCard,
      extractedSlots: { domain: 'LOAN', amountVnd: terms.principalVnd, termMonths: terms.termMonths, goalNote },
      cta: { label: best ? 'Mở bảng trả nợ trong Khảo sát' : 'Mở Khảo sát khoản vay', href: openSurveyHref },
    }
  }

  private async investment(input: CopilotInput, domain: 'INVEST' | 'SAVINGS', trace: CopilotToolTraceItem[]): Promise<Guidance | undefined> {
    const { amount, contribution, term } = copilotAmounts(input.rawText, domain, input.slots)
    const checked = SurveyInvestRequestSchema.safeParse({
      initialVnd: amount ?? '0', monthlyContributionVnd: contribution ?? '0', termMonths: term, enableWebFallback: true,
    })
    if (!checked.success || ![checked.data.initialVnd, checked.data.monthlyContributionVnd].some(value => new Precise(value).gte(1))) return undefined
    const terms = checked.data
    const result = await this.step(trace, 'INVESTMENT_SURVEY', async () => {
      const data = await this.survey.investment(terms, input.session)
      if (data.meta?.catalogStatus === 'CATALOG_UNAVAILABLE') throw new Error('Catalog unavailable')
      return { data, empty: !data.offers.length, summary: data.offers.length
        ? 'Đã so sánh giá trị cuối kỳ sau phí và thuế trong danh mục.'
        : 'Chưa có sản phẩm phù hợp với số vốn và kỳ hạn đã nhập.' }
    })
    const bestByCategory = new Map<string, SurveyInvestResponse['offers'][number]>()
    for (const offer of result?.offers ?? []) {
      const previous = bestByCategory.get(offer.productCategory)
      if (!previous || (compareCatalogQuality(offer, previous) || new Precise(previous.scenario.netValueVnd).cmp(offer.scenario.netValueVnd)) < 0) bestByCategory.set(offer.productCategory, offer)
    }
    const openSurveyHref = result?.meta?.savedToHistory
      ? handoffRoutes.surveySession({ sessionId: result.sessionId, mode: 'invest' })
      : '/survey?' + new URLSearchParams({ mode: 'invest', amount: terms.initialVnd, term: String(terms.termMonths) })
    const richCard = result && {
      kind: 'INVESTMENT_PLAN' as const, initialVnd: terms.initialVnd, monthlyContributionVnd: terms.monthlyContributionVnd,
      termMonths: terms.termMonths, openSurveyHref,
      topOffers: [...bestByCategory.values()].map(({ scenario, ...offer }) => ({
        ...offerNames(offer), ...offerProvenance(offer), categoryLabel: investmentCategories[offer.productCategory], annualReturnPct: scenario.annualReturnPct,
        totalContributedVnd: scenario.totalContributedVnd, netValueVnd: scenario.netValueVnd, netProfitVnd: scenario.netProfitVnd,
      })),
    }
    return {
      intent: 'FINANCIAL_EDUCATION', richCard,
      message: bestByCategory.size ? 'Mình đã tính giá trị dự phóng sau phí và thuế cho từng kênh có sản phẩm phù hợp.'
        : result ? 'Danh mục chưa có kênh phù hợp với số vốn và thời hạn này.' : 'Chưa truy cập được danh mục đầu tư. Bạn có thể thử lại trong Khảo sát.',
      extractedSlots: { domain, amountVnd: terms.initialVnd, termMonths: terms.termMonths },
      cta: { label: 'Mở Khảo sát đầu tư và tích lũy', href: openSurveyHref },
    }
  }

  private async refinance(input: CopilotInput, trace: CopilotToolTraceItem[]): Promise<Guidance> {
    const { amount, term } = copilotAmounts(input.rawText, 'REFINANCE', input.slots)
    const { rate, exitFee } = copilotRefinanceRates(input.rawText)
    const plain = normalizeVietnamese(input.rawText)
    const checked = SurveyRefinanceTermsSchema.safeParse({
      remainingPrincipalVnd: amount, remainingTermMonths: term, currentAnnualRatePct: rate,
      currentCalcMethod: /\blai phang\b/.test(plain) ? 'FLAT_RATE' : /\bgoc deu\b/.test(plain) ? 'DECLINING_PRINCIPAL' : 'REDUCING_BALANCE',
      currentMonthlyFeeVnd: '0', earlySettlementFeePct: exitFee,
      productCategory: /\b(?:the chap|mua nha|mua xe)\b/.test(plain) ? 'SECURED_LOAN' : 'UNSECURED_LOAN',
    })
    const fallbackHref = '/survey?mode=refinance'
    const cta = { label: 'Mở mô phỏng đổi khoản vay', href: fallbackHref }
    if (!checked.success) return { intent: 'NEEDS_DETAILS', message: 'Bạn còn nợ bao nhiêu tiền gốc, trong bao nhiêu tháng và đang trả lãi bao nhiêu phần trăm mỗi năm?', cta }
    const result = await this.step(trace, 'REFINANCE_SIM', async () => {
      const data = await this.survey.refinance(checked.data, input.session)
      if (data.meta.catalogStatus === 'CATALOG_UNAVAILABLE') throw new Error('Catalog unavailable')
      return { data, empty: !data.offers.length, summary: data.offers.length
        ? 'Đã so sánh dòng tiền giữ khoản vay và đổi khoản vay.'
        : 'Chưa có gói đổi khoản vay phù hợp trong danh mục.' }
    })
    if (!result) return { intent: 'FINANCIAL_EDUCATION', message: 'Chưa đối chiếu được các phương án đổi khoản vay.', cta }
    const best = result.offers[0]
    const openSurveyHref = result.meta.savedToHistory
      ? handoffRoutes.surveySession({ sessionId: result.sessionId, mode: 'refinance' }) : fallbackHref
    const richCard: Extract<CopilotRichCard, { kind: 'REFINANCE_PLAN' }> = {
      kind: 'REFINANCE_PLAN', remainingPrincipalVnd: checked.data.remainingPrincipalVnd,
      remainingTermMonths: checked.data.remainingTermMonths, currentAnnualRatePct: checked.data.currentAnnualRatePct,
      bestBankName: best ? offerNames(best).institutionName : null, monthlySavingsVnd: best?.result.monthlySavingsVnd ?? null,
      totalSwitchCostVnd: best?.result.totalSwitchCostVnd ?? null, breakEvenMonth: best?.result.breakEvenMonth ?? null,
      netSavingsVnd: best?.result.netSavingsVnd ?? null, recommendation: best?.result.recommendation ?? null, verificationReceipt: best?.verificationReceipt, openSurveyHref,
    }
    return { intent: 'FINANCIAL_EDUCATION', richCard, cta: { ...cta, href: openSurveyHref },
      message: safeText(result.bestOptionSummary, 'Đã đối chiếu chi phí giữ và đổi khoản vay.') +
        ' Mô phỏng tạm tính phí tháng bằng 0 đ. Hãy bổ sung các khoản phí thực tế trong Khảo sát.' }
  }

  private async radar(trace: CopilotToolTraceItem[]): Promise<Guidance> {
    const now = new Date()
    const richCard = await this.step(trace, 'RADAR_ALERTS', async () => {
      const [trends, rows, products] = await Promise.all([
        readThreatTrends(this.prisma, { window: '30d', audience: 'ALL' }, now),
        this.prisma.threatAlert.findMany({
          where: { ...publicThreatAlertWhere, publishedAt: { not: null, gte: new Date(now.getTime() - 30 * 86_400_000), lte: now } },
          orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }], take: 3,
          select: { id: true, tacticSummary: true, vnAisCode: true, publishedAt: true },
        }),
        this.prisma.financialProduct.findMany({
          where: { isActive: true, effectiveDate: { lte: now }, dataProvenance: { in: ['CATALOG_VERIFIED', 'WEB_REFERENCE'] },
            productCategory: { in: Object.keys(marketCategories) },
            institution: { trustStatus: 'LICENSED', institutionType: 'BANK', licenseIssuer: 'NHNN' } },
          select: { productCategory: true, nominalRateMin: true, nominalRateMax: true },
        }),
      ])
      const alerts = rows.flatMap(row => {
        if (!row.publishedAt) return []
        const category = vnScamTaxonomy.find(item => item.vnAisCode === row.vnAisCode)
        const title = safeText(row.tacticSummary, category?.vnAisLabel ?? 'Cảnh báo đã xác minh')
        return [{ id: row.id, title, vnAisCode: category?.vnAisCode ?? null, vnAisLabel: category?.vnAisLabel ?? null,
          publishedAt: row.publishedAt.toISOString(), handoffHref: handoffRoutes.radarAlertToForensic({ alertId: row.id, summary: title }) }]
      })
      const marketRates = Object.entries(marketCategories).flatMap(([category, label]) => {
        const ranges = products.filter(item => item.productCategory === category).map(item => ({
          min: new Precise(item.nominalRateMin.toFixed()), max: new Precise(item.nominalRateMax.toFixed()),
        }))
        if (!ranges.length) return []
        const points = ranges.map(({ min, max }) => min.plus(max).div(2)).sort((a, b) => a.cmp(b))
        const middle = Math.floor(points.length / 2)
        const median = points.length % 2 ? points[middle] : points[middle - 1].plus(points[middle]).div(2)
        return [{ label, minRatePct: Precise.min(...ranges.map(item => item.min)).toFixed(),
          maxRatePct: Precise.max(...ranges.map(item => item.max)).toFixed(), medianRatePct: median.toFixed(4), sampleCount: ranges.length }]
      })
      const data: Extract<CopilotRichCard, { kind: 'RADAR_BRIEF' }> = {
        kind: 'RADAR_BRIEF', windowLabel: '30 ngày qua', totalVerified: trends.totalVerifiedInWindow,
        alerts, marketRates, openRadarHref: '/radar?tab=alerts',
      }
      return { data, empty: !trends.totalVerifiedInWindow && !marketRates.length,
        summary: 'Đã đọc các cảnh báo công khai và mức lãi trong danh mục ngân hàng.' }
    })
    return { intent: 'FINANCIAL_EDUCATION', richCard,
      message: richCard ? 'Radar ghi nhận ' + richCard.totalVerified +
        ' cảnh báo đã xác minh trong 30 ngày qua. Mức lãi bên dưới lấy từ các sản phẩm đang có trong danh mục.'
        : 'Chưa tải được dữ liệu Radar. Bạn có thể mở Radar để thử lại.',
      extractedSlots: { domain: 'SCAM' }, cta: { label: 'Mở Radar cảnh báo', href: '/radar?tab=alerts' },
    }
  }

  private async profileSnapshot(input: CopilotInput, trace: CopilotToolTraceItem[]): Promise<Guidance> {
    const profile = await this.profile(input, trace)
    const cta = { label: 'Mở Hồ sơ tài chính', href: '/profile' }
    if (!profile || profileFields.every(key => profile.values[key] == null)) {
      return { intent: 'PROFILE_HEALTH_NAV', message: 'Bạn có thể mở Hồ sơ để thêm thu nhập, chi phí, khoản trả nợ và quỹ dự phòng.', cta }
    }
    const { monthlyIncomeVnd, monthlyExpenseVnd, existingDebtPaymentVnd } = profile.values
    const health = calculateFinancialHealth(profile.values)
    const monthlySurplusVnd = monthlyIncomeVnd != null && monthlyExpenseVnd != null && existingDebtPaymentVnd != null
      ? new Precise(monthlyIncomeVnd).minus(monthlyExpenseVnd).minus(existingDebtPaymentVnd).toFixed(2) : null
    return {
      intent: 'PROFILE_HEALTH_NAV', cta, extractedSlots: { domain: 'PROFILE' },
      message: health.score == null ? 'Đã tính các chỉ số có đủ số liệu. Bạn có thể bổ sung thông tin trong Hồ sơ.'
        : 'Điểm sức khỏe tài chính dựa trên thu nhập, chi phí, khoản trả nợ và quỹ dự phòng.',
      richCard: { kind: 'PROFILE_SNAPSHOT', score: health.score, dtiPct: health.dtiPct, emergencyMonths: health.emergencyMonths,
        maxSafeEmiVnd: health.maxSafeEmiVnd, monthlySurplusVnd, summary: profile.summary, openProfileHref: cta.href },
    }
  }
}
