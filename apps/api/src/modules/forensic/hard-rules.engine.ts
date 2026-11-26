import Decimal from 'decimal.js'
import type { ChannelIntelligence, FindingSeverity, ForensicAuditResponse, ForensicIntentSignals, RuleCode } from '@fincopilot/shared-types'
import { findInstitution, normalizeVietnamese, scamTactics, type CatalogInstitution } from './data/trusted-institutions'
import { loanLegalReference, type EntityLicense } from './loan-legal-reference'
import { calculateLoanScheduleBreakdown, solveCashFlowIrr } from './cashflow-loan.engine'
import { inspectConditionalLoan, type ConditionalLoanEvidence } from './conditional-loan.parser'
import { describeCasePayment, describePaymentQr, formatCaseAmount } from './payment-qr-description'
import { suspiciousQrLink } from './qr-evidence'
import type { ParsedQr } from './vietqr-parser'

type Finding = ForensicAuditResponse['findings'][number]
type MathBreakdown = NonNullable<ForensicAuditResponse['mathBreakdown']>

export interface LoanTerms {
  principalNominalVnd: string
  upfrontFeeVnd: string
  flatMonthlyRatePct: string
  termMonths: number
  evidenceQuote: string
}

const Precise = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

export function calculateFlatRateApr(terms: LoanTerms, entityLicense?: EntityLicense): MathBreakdown | null {
  if (!Number.isInteger(terms.termMonths) || terms.termMonths < 1 || terms.termMonths > 600
    || !/^\d{1,16}(?:\.\d{1,2})?$/.test(terms.principalNominalVnd)
    || !/^\d{1,16}(?:\.\d{1,2})?$/.test(terms.upfrontFeeVnd)
    || !/^\d{1,3}(?:\.\d{1,4})?$/.test(terms.flatMonthlyRatePct)) return null

  const principal = new Precise(terms.principalNominalVnd)
  const fees = new Precise(terms.upfrontFeeVnd)
  const quoted = new Precise(terms.flatMonthlyRatePct)
  const net = principal.minus(fees)
  if (!net.gt(0)) return null
  const total = principal.plus(principal.mul(quoted).mul(terms.termMonths).div(100))
  const installment = total.div(terms.termMonths)
  const monthlyIrr = quoted.isZero() && fees.isZero()
    ? new Precise(0)
    : solveCashFlowIrr(net, Array<Decimal>(terms.termMonths).fill(installment))
  if (monthlyIrr === null) return null
  const apr = monthlyIrr.mul(1200)
  const totalPayable = total.toDecimalPlaces(0)
  return {
    principalNominalVnd: principal.toFixed(),
    upfrontFeeVnd: fees.toFixed(),
    principalNetVnd: net.toFixed(),
    quotedRateLabel: quoted.toFixed() + '%/tháng (Lãi phẳng)',
    effectiveAprPct: apr.toFixed(4),
    effectiveEarPct: monthlyIrr.plus(1).pow(12).minus(1).mul(100).toFixed(4),
    termMonths: terms.termMonths,
    monthlyPaymentVnd: installment.toFixed(0),
    totalPayableVnd: totalPayable.toFixed(),
    // Rounding to whole VND can put a fee-free total a fraction below the net amount.
    totalExtraCostVnd: Precise.max(0, totalPayable.minus(net)).toFixed(),
    flatRateExplainer: 'Lãi phẳng tính lãi mỗi tháng trên số tiền vay ban đầu dù bạn đã trả bớt nợ gốc. Phí thu trước làm giảm tiền thực nhận, nên chi phí tính theo số tiền bạn thực sự cầm về có thể cao hơn mức lãi hằng tháng ghi trong hợp đồng.',
    legalReference: loanLegalReference(apr, entityLicense),
  }
}

const amountToken = String.raw`(\d{1,16}(?:[., ]\d{1,3}){0,5})\s*(triệu|tr\b|tỷ|tỉ|nghìn|ngàn|k\b|đồng|đ(?![\p{L}\p{N}])|vn[dđ]|₫)?`
const principalPattern = new RegExp(String.raw`\b(?:số\s+tiền\s+vay|khoản\s+vay|tiền\s+gốc|gốc\s+danh\s+nghĩa|vay)\s*(?:là\s*|[:=]\s*)?` + amountToken, 'iu')
const baseAmountPattern = new RegExp(String.raw`(?:trên|tính\s+theo)\s+` + amountToken, 'iu')
const feePattern = new RegExp(String.raw`(?:phí\s+(?:thu\s+)?(?:trước|ẩn|ban\s+đầu|giữ\s+lại)|trừ\s+trước|khấu\s+trừ\s+trước|phí\s+trừ\s+trước)\s*(?:là\s*|[:=]\s*)?` + amountToken, 'iu')

export function parseVnd(match: RegExpMatchArray | null): string | null {
  if (!match) return null
  const [, raw, label] = match
  const unit = normalizeVietnamese(label ?? '')
  const factor = unit === 'trieu' || unit === 'tr' ? 1_000_000
    : unit === 'ty' || unit === 'ti' ? 1_000_000_000
      : ['nghin', 'ngan', 'k'].includes(unit) ? 1000 : 1
  // Grouped amounts in VND are integers. A decimal multiplier may use comma or dot.
  const number = /^[0-9]{1,3}(?:[., ]\d{3})+$/.test(raw.trim())
    ? raw.replace(/[., ]/g, '') : raw.trim().replace(',', '.')
  if (!/^\d{1,16}(?:\.\d{1,4})?$/.test(number)) return null
  return new Precise(number).mul(factor).toFixed()
}

export function findLoanQuoteAmount(quote: string, kind: 'principal' | 'fee') {
  return parseVnd(kind === 'principal' ? quote.match(principalPattern) ?? quote.match(baseAmountPattern) : quote.match(feePattern))
}

export function findLoanTerms(text: string): LoanTerms | null {
  const flat = text.match(/(?:lãi\s+(?:suất\s+)?phẳng\s*(?:là\s*|[:=]\s*)?(\d{1,3}(?:[.,]\d{1,4})?)\s*%\s*(?:\/|mỗi|một|mỗi|theo)\s*tháng|(\d{1,3}(?:[.,]\d{1,4})?)\s*%\s*(?:\/|mỗi|một|theo)\s*tháng\s*\(\s*lãi\s+phẳng\s*\))/iu)
  const principalMatch = text.match(principalPattern) ?? text.match(baseAmountPattern)
  const principal = parseVnd(principalMatch)
  const feeMatch = text.match(feePattern)
  const upfront = feeMatch ? parseVnd(feeMatch) : '0'
  const afterPrincipal = principalMatch?.index === undefined ? ''
    : text.slice(principalMatch.index + principalMatch[0].length)
  const months = text.match(/(?:kỳ\s*hạn|thời\s*hạn|trả\s+góp|\/)\s*[:=]?\s*(\d{1,3})\s*tháng/iu)
    ?? afterPrincipal.match(/^[\s,]*(?:trong(?:\s+vòng)?|vòng)\s+(\d{1,3})\s*tháng/iu)
  if (!flat || !principal || !upfront || !months) return null
  return {
    principalNominalVnd: principal,
    upfrontFeeVnd: upfront,
    flatMonthlyRatePct: (flat[1] ?? flat[2]).replace(',', '.'),
    termMonths: Number(months[1]),
    evidenceQuote: flat[0],
  }
}

const periodicPayment = new RegExp(/(?:trả\s+)?góp\s*(?:[:=]\s*)?/.source + amountToken +
  /\s*(?:\/\s*|mỗi\s+|một\s+|theo\s+)(ngày|tuần)(?!\p{L})/u.source, 'iu')
const periodicDuration = /(?:trong(?:\s+vòng)?|kỳ\s*hạn|thời\s*hạn)\s*[:=]?\s*(\d{1,3})\s*(ngày|tuần)(?!\p{L})/iu

function periodicLoan(source: string, license: EntityLicense): { quote: string; math: MathBreakdown } | null {
  const installment = source.match(periodicPayment)
  const duration = source.match(periodicDuration)
  if (!installment || !duration || normalizeVietnamese(installment[3]) !== normalizeVietnamese(duration[2])) return null
  const principalAmount = parseVnd(source.match(principalPattern))
  const fee = source.match(feePattern)
  const feeAmount = fee ? parseVnd(fee) : '0'
  const installmentAmount = parseVnd(installment)
  const count = Number(duration[1])
  if (!principalAmount || !feeAmount || !installmentAmount || count < 1 || count > 600) return null

  const principal = new Precise(principalAmount)
  const fees = new Precise(feeAmount)
  const payment = new Precise(installmentAmount)
  const net = principal.minus(fees)
  if (!net.gt(0) || !payment.gt(0)) return null
  const irr = solveCashFlowIrr(net, Array<Decimal>(count).fill(payment))
  if (irr === null) return null
  const daily = normalizeVietnamese(duration[2]) === 'ngay'
  const periodsPerYear = new Precise(365).div(daily ? 1 : 7)
  const apr = irr.mul(periodsPerYear).mul(100)
  const ear = irr.plus(1).pow(periodsPerYear).minus(1).mul(100)
  const total = payment.mul(count)
  return {
    quote: installment[0],
    math: {
      principalNominalVnd: principal.toFixed(), upfrontFeeVnd: fees.toFixed(), principalNetVnd: net.toFixed(),
      quotedRateLabel: 'Trả góp cố định theo ' + (daily ? 'ngày' : 'tuần'),
      effectiveAprPct: apr.toFixed(4), effectiveEarPct: ear.toFixed(4),
      periodicRepayment: { unit: daily ? 'DAY' : 'WEEK', count, paymentVnd: payment.toFixed() },
      totalPayableVnd: total.toFixed(), totalExtraCostVnd: Precise.max(0, total.minus(net)).toFixed(),
      legalReference: loanLegalReference(apr, license),
    },
  }
}

type RuleQr = Pick<ParsedQr, 'acqBin' | 'bankName' | 'account' | 'serviceCode' | 'amountVnd' | 'purpose' | 'crcValid'>
  & Partial<Pick<ParsedQr, 'raw' | 'qrScheme' | 'targetUrl' | 'walletNetwork' | 'providerLabel' | 'currencyCode' | 'amount'>> & {
  visionBeneficiaryName?: string | null
    channelIntelligence?: ChannelIntelligence
    channelIndicatorId?: string | null
}
export interface Indicator {
  id: string
  indicatorText: string
  indicatorType: string
}
interface HardRuleInput {
  evidence: readonly string[]
  normalizeEvidence?: (text: string) => string
  claimedEntityName: string | null
  qrPayloads: readonly RuleQr[]
  indicators: readonly Indicator[]
  institutions: readonly CatalogInstitution[]
  intentSignals?: ForensicIntentSignals | null
  loan?: LoanTerms | null
  conditionalLoan?: ConditionalLoanEvidence
  statedTransferAmountVnd?: string | null
  hasPromptTampering?: boolean
}

const upfrontFee = /\b(phi (?:bao hiem|giai ngan|mo khoa|ho so|xac minh|loi 102)|coc ho so|phi (?:thu )?truoc)\b/
const negation = /\b(khong (?:can|phai|co|nen|duoc|yeu cau|thu|nop|chuyen|cung cap)|mien phi)\b/
const feeDemand = /\b(nop|dong|chuyen|tra|thanh toan|truoc|loi 102|mo khoa|dat coc)\b/
const freeze = /\b(loi 102|dong bang (?:tai khoan|khoan vay|so tien|tien|von)|mo khoa (?:khoan vay|tai khoan|giai ngan))\b/
const normalizeRuleText = (quote: string) => normalizeVietnamese(quote).replace(/\bl\s*[o0]\s*i\s*1\s*0\s*2\b/g, 'loi 102')
const personalAccount = /\b(?:tai khoan|stk|tk) ca nhan\b/
const organizationName = /\b(tai chinh|ngan hang|chung khoan|quan ly quy|vi dien tu|san dau tu|cong ty|to chuc|cong an|co quan|tnhh|tmcp|ctcp)\b/
const personalContext = /\b(tra tien an|tra tien|chia tien|tien an|mua do|ban be|cho ban|hoan tien|gui tien cho)\b/
const cryptoInvestmentContext = /\b(dau tu|san giao dich|rut tien|rut von|nap them|loi nhuan|phi mo khoa)\b/
const cryptoPaymentContext = /\b(chuyen|nap|dong phi|phi de rut|thanh toan|gui|yeu cau tra)\b/

function isPaymentQr(qr: RuleQr) {
  return qr.crcValid || qr.qrScheme === 'EWALLET_VN'
}

export function normalizeIndicatorPhone(phone: string) {
  return phone.replace(/\D/g, '').replace(/^(?:0084|84)(?=\d{9}$)/, '0')
}

export function indicatorPhoneTokens(text: string) {
  return text.match(/(?<!\d)(?:0|\+84|0084)(?:[ .-]?\d){9}(?!\d)/g) ?? []
}

export function indicatorUrlHost(url: string) {
  return URL.parse(url)?.hostname.replace(/\.$/, '')
}

export function indicatorTextHosts(text: string) {
  const urls = /https?:\/\/[^\s<>"'()[\]]+/gi
  const hostnameTokens = text.replace(urls, '').toLowerCase().match(/(?<![a-z0-9-])[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) ?? []
  return [...(text.match(urls) ?? []).map(indicatorUrlHost).filter((host) => host !== undefined), ...hostnameTokens]
}

export function matchIndicator(indicator: Indicator, qrPayloads: readonly RuleQr[], quotes: readonly string[]): string | undefined {
  const value = indicator.indicatorText.trim()
  if (!value) return undefined
  switch (indicator.indicatorType) {
    case 'CRYPTO_WALLET':
    case 'WALLET_ADDRESS':
    case 'BANK_ACCOUNT': {
      const wallet = qrPayloads.find((qr) => qr.qrScheme === 'CRYPTO_WALLET' && qr.account &&
        (qr.walletNetwork === 'ERC20' || /^bc1/i.test(qr.account) ? qr.account.toLowerCase() === value.toLowerCase() : qr.account === value))
      if (wallet?.account || indicator.indicatorType !== 'BANK_ACCOUNT') return wallet?.account ?? undefined
      const account = value.replace(/[ -]/g, '').toUpperCase()
      if (!/^[A-Z0-9]{7,32}$/.test(account)) return undefined
      const exact = qrPayloads.find((qr) => qr.account?.toUpperCase() === account)?.account
      if (exact) return exact
      const pattern = /^\d+$/.test(account) ? Array.from(account).join('[ .-]?') : account
      const inText = new RegExp('(?<![A-Z0-9])' + pattern + '(?![A-Z0-9])', 'i')
      return quotes.find((quote) => inText.test(quote))
    }
    case 'PHONE': {
      const phone = normalizeIndicatorPhone(value)
      if (!/^0\d{9}$/.test(phone)) return undefined
      const walletPhone = qrPayloads.find((qr) => qr.qrScheme === 'EWALLET_VN' &&
        qr.account && normalizeIndicatorPhone(qr.account) === phone)?.account
      if (walletPhone) return walletPhone
      return quotes.find((quote) => indicatorPhoneTokens(quote).some((token) => normalizeIndicatorPhone(token) === phone))
    }
    case 'DOMAIN': {
      const domain = value.toLowerCase().replace(/^https?:\/\//, '').split(/[/:?#]/)[0].replace(/\.$/, '')
      if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)) return undefined
      const matchesHost = (host: string) => host === domain || host.endsWith('.' + domain)
      const decodedLink = qrPayloads.find((qr) => qr.targetUrl &&
        matchesHost(indicatorUrlHost(qr.targetUrl) ?? ''))?.targetUrl
      if (decodedLink) return decodedLink
      return quotes.find((quote) => indicatorTextHosts(quote).some(matchesHost))
    }
    case 'KEYWORD': {
      const keyword = normalizeVietnamese(value)
      if (keyword.length < 3) return undefined
      return quotes.find((quote) => (' ' + normalizeVietnamese(quote) + ' ').includes(' ' + keyword + ' '))
    }
    case 'QR_PATTERN': {
      // Indicator values are literal fingerprints, never executable regular expressions.
      const match = value.length >= 8 ? qrPayloads.find((qr) => qr.raw?.includes(value)) : undefined
      return match?.purpose ?? match?.targetUrl ?? match?.account ?? match?.serviceCode ?? match?.qrScheme
    }
    default:
      return undefined
  }
}

export function evaluateHardRules(input: HardRuleInput) {
  const qrPayloads = input.qrPayloads.filter((qr) => isPaymentQr(qr) ||
    qr.qrScheme === 'URL_LINK' || qr.qrScheme === 'CRYPTO_WALLET')
  const quotes = [...input.evidence, ...qrPayloads.flatMap((qr) => qr.crcValid && qr.purpose ? [qr.purpose] : [])]
    .flatMap((line) => line.split(/\n+|(?<=[.!?])\s+/).map((phrase) => phrase.trim()).filter(Boolean))
  const normalized = quotes.map((quote) => ({ quote, text: (input.normalizeEvidence ?? normalizeRuleText)(quote) }))
  const findQuote = (matches: (text: string) => boolean) => normalized.find(({ text }) => matches(text))?.quote
  const context = normalized.filter(({ text }) => !negation.test(text)).map(({ text }) => text).join(' ')
  const findings: Finding[] = []
  const add = (ruleCode: RuleCode, severity: FindingSeverity, scoreImpact: number, title: string, description: string,
    evidenceQuote: string, matchedIndicatorId: string | null = null) => {
    findings.push({ ruleCode, severity, scoreImpact, title, description, evidenceQuote, matchedIndicatorId })
  }
  const entity = input.claimedEntityName
  const matchedInstitution = entity ? findInstitution(entity, input.institutions) : null
  const entityLicense = matchedInstitution ? { issuer: matchedInstitution.issuer, status: matchedInstitution.status } : null
  const source = input.evidence.join('\n')
  const loan = input.loan ?? findLoanTerms(source)
  const conditional = input.conditionalLoan ?? inspectConditionalLoan(source)
  const periodic = periodicLoan(source, matchedInstitution)
  const loanQuote = conditional.conditionalQuote ?? conditional.floatingQuote ?? conditional.insuranceQuote ??
    conditional.spec?.ratePhases[0]?.evidenceQuote ?? periodic?.quote ?? loan?.evidenceQuote
  const mathBreakdown = conditional.spec ? calculateLoanScheduleBreakdown(conditional.spec, matchedInstitution)
    : periodic?.math ?? (loan && !conditional.conditionalQuote && !conditional.floatingQuote && !conditional.insuranceQuote
      ? calculateFlatRateApr(loan, matchedInstitution) : null)

  const fee = findQuote((text) => upfrontFee.test(text) && feeDemand.test(text) && !negation.test(text))
  const primaryQr = qrPayloads.find(isPaymentQr) ?? qrPayloads.find((qr) => qr.qrScheme === 'CRYPTO_WALLET' || qr.qrScheme === 'URL_LINK')
  if (fee && primaryQr) add(
    'RULE_01_UPFRONT_FEE_QR', 'CRITICAL', 85, 'Yêu cầu nộp phí trước qua ' + describePaymentQr(primaryQr),
    'Yêu cầu chuyển qua ' + describeCasePayment({ ...primaryQr, qrAmountVnd: primaryQr.amountVnd, purposeText: primaryQr.purpose }) +
      '. Ngân hàng và công ty tài chính được cấp phép không yêu cầu bạn tự chuyển phí giải ngân qua mã QR hoặc tài khoản cá nhân để mở khóa tiền vay. Hãy kiểm tra trực tiếp qua kênh chính thức.',
    fee,
  )
  const trap = findQuote((text) => freeze.test(text) && !negation.test(text))
  if (trap) add(
    'RULE_02_ERROR_102_FREEZE_TRAP', 'CRITICAL', 90, 'Kịch bản lỗi 102 hoặc đóng băng vốn',
    'Bên kia viện lỗi hoặc đóng băng khoản vay để thúc bạn nộp tiền “mở khóa”. Sau lần chuyển đầu, kẻ gian có thể dựng thêm lỗi hoặc yêu cầu khoản phí mới để lấy thêm tiền.', trap,
  )

  const claimedCompany = entity && (entityLicense !== null || organizationName.test(normalizeVietnamese(entity)) || !!loanQuote)
  const personal = findQuote((text) => personalAccount.test(text) && !negation.test(text))
  const mismatchedQrs = claimedCompany && entity ? qrPayloads.filter((qr) => {
    if (qr.serviceCode !== 'QRIBFTTA') return false
    const beneficiary = qr.visionBeneficiaryName
    if (!beneficiary) return !!personal && (qrPayloads.length === 1 || !!qr.account && personal.includes(qr.account))
    const sameInstitution = findInstitution(beneficiary, input.institutions)
    return normalizeVietnamese(beneficiary) !== normalizeVietnamese(entity)
      && !sameInstitution && !/\b(cong ty|ngan hang|tnhh|tmcp|ctcp)\b/.test(normalizeVietnamese(beneficiary))
  }) : []
  if (mismatchedQrs.length) add(
    'RULE_03_ENTITY_MISMATCH', 'CRITICAL', 80, 'Tên bên giao dịch và tài khoản nhận có dấu hiệu không khớp',
    '“' + entity + '” là đơn vị được nêu, nhưng mã QR có dấu hiệu nhận tiền qua tài khoản cá nhân. Biên lai khi đó có thể không thể hiện tổ chức là bên nhận, khiến việc đối chiếu và yêu cầu tra soát khó hơn.',
    personal ?? mismatchedQrs[0].visionBeneficiaryName ?? entity ?? '',
  )

  const impersonation = entity ? findQuote((text) => text.includes(normalizeVietnamese(entity))
    && /\b(?:mao danh|gia danh|gia mao)\b/.test(text) && !negation.test(text)) : undefined
  if (entity && (claimedCompany || impersonation) &&
    (!entityLicense || entityLicense.status !== 'LICENSED' || mismatchedQrs.length > 0 || impersonation)) {
    const critical = entityLicense?.status === 'BLACKLISTED'
      || (entityLicense?.status === 'LICENSED' && (mismatchedQrs.length > 0 || !!impersonation))
    add(
      'RULE_04_UNLICENSED_OR_IMPERSONATION', critical ? 'CRITICAL' : 'HIGH', critical ? 90 : 38,
      'Chưa xác minh được đơn vị hoặc có dấu hiệu mạo danh',
      '“' + entity + '” chưa có thông tin khớp, còn hiệu lực hoặc nhất quán trong dữ liệu đối chiếu của hồ sơ. Nếu chuyển tiền lúc này, bạn khó xác định đơn vị chịu trách nhiệm. Kiểm tra tên pháp nhân, giấy phép và tài khoản nhận qua NHNN hoặc UBCKNN.', impersonation ?? entity,
    )
  } else if (!entity && loanQuote && mathBreakdown) {
    add(
      'RULE_04_UNLICENSED_OR_IMPERSONATION', 'HIGH', 38, 'Chưa xác minh được bên cho vay',
      'Hồ sơ có điều khoản vay nhưng thiếu tên pháp nhân để kiểm tra giấy phép. Nếu chưa biết ai đứng tên hợp đồng và nhận tiền, bạn sẽ khó yêu cầu họ giải trình phí hoặc xử lý tranh chấp.', loanQuote,
    )
  }

  for (const indicator of input.indicators) {
    if (!['BANK_ACCOUNT', 'PHONE', 'DOMAIN', 'CRYPTO_WALLET', 'QR_PATTERN'].includes(indicator.indicatorType)) continue
    const match = matchIndicator(indicator, qrPayloads, quotes)
    if (!match) continue
    add(
      'RULE_05_NCSC_THREAT_MATCH', 'CRITICAL', 95, 'Trùng chỉ dấu đe dọa đã xác minh',
      'Số liên hệ, tài khoản, tên miền hoặc chi tiết khác trong hồ sơ trùng một chỉ dấu cảnh báo đã xác minh. Dừng thao tác và đối chiếu qua kênh chính thức trước khi cung cấp dữ liệu hoặc chuyển tiền.', match, indicator.id,
    )
    break
  }

  // Screening references only. Article 468 permits exceptions under specialized laws.
  const aprReference = entityLicense?.status === 'LICENSED' ? '30' : '20'
  const apr = mathBreakdown?.effectiveAprPct
  const stressApr = mathBreakdown?.stressScenario?.effectiveAprPct
  if (apr && loanQuote && new Precise(apr).gt(aprReference)) {
    add(
      'RULE_06_FLAT_RATE_AND_USURY_APR', 'HIGH', 34,
      conditional.spec || periodic ? 'Chi phí vay thực vượt mốc tham chiếu' : 'Lãi phẳng làm tăng lãi suất thực',
      'APR tính từ tiền thực nhận và lịch trả là ' + apr.replace('.', ',') + '%/năm, cao hơn mốc sàng lọc ' + aprReference +
        '%/năm. Lãi phẳng, phí thu trước hoặc phí quản lý có thể làm khoản vay đắt hơn mức lãi nhìn trên hợp đồng. Đối chiếu phí thực thu và lãi thỏa thuận trước khi ký.', loanQuote,
    )
  }
  const elevatedCost = [apr, stressApr].some((value) => value != null && new Precise(value).gte(40))
  const conditionalQuote = conditional.floatingQuote ?? conditional.conditionalQuote
  if (conditionalQuote) add(
    'RULE_12_CONDITIONAL_LOAN_TERMS', elevatedCost || conditional.floatingQuote ? 'HIGH' : 'MEDIUM', elevatedCost ? 40 : 30,
    conditional.floatingQuote ? 'Điều khoản thả nổi chưa rõ mức trần' : 'Lãi suất thay đổi theo giai đoạn hoặc điều kiện',
    conditional.floatingQuote
      ? 'Bên cho vay có thể điều chỉnh lãi mà hồ sơ chưa ghi rõ mức cao nhất, nên bạn chưa biết phải chuẩn bị tối đa bao nhiêu mỗi tháng.'
      : mathBreakdown?.stressScenario
        ? 'Khi mất ưu đãi, tổng tiền trả trong kịch bản này tăng ' + formatCaseAmount(mathBreakdown.stressScenario.extraDeltaOverBaseVnd) +
          '. Hỏi rõ điều khoản trễ hạn có đổi lãi cho các tháng đã qua hay chỉ từ thời điểm trễ.'
        : 'Khi hết ưu đãi, tiền trả có thể tăng. Yêu cầu ghi rõ ngày đổi lãi, mức lãi và số phải trả theo từng giai đoạn.',
    conditionalQuote,
  )
  if (conditional.insuranceQuote) add(
    'RULE_13_INSURANCE_BUNDLING', elevatedCost ? 'HIGH' : 'MEDIUM', elevatedCost ? 40 : 30,
    'Bảo hiểm gắn với khoản vay', 'Tổ chức tín dụng không được gắn bảo hiểm không bắt buộc với khoản vay. Hỏi bằng văn bản xem bạn có thể từ chối bảo hiểm không, phí là bao nhiêu và khoản giải ngân còn lại bao nhiêu.',
    conditional.insuranceQuote,
  )
  const ponzi = normalized.find(({ quote, text }) => {
    if (negation.test(text)) return false
    const tasks = /\b(?:chot don|lam nhiem vu|theo nhiem vu|viec nhe|cong tac vien|them don)\b/.test(text)
    const deposit = /\b(?:nap (?:them )?tien|chuyen (?:them )?tien|ung tien|dat coc|nop tien)\b/.test(text)
    const reward = /\b(?:hoa hong|hoan (?:tien|don)|nhan thuong)\b/.test(text)
    if (tasks && deposit && reward) return true
    const promise = /\b(cam ket|bao loi|loi nhuan co dinh|lai co dinh|lai suat co dinh)\b/.test(text)
    const percent = quote.match(/(\d{1,4}(?:[.,]\d{1,4})?)\s*%\s*(?:\/|mỗi|một|theo)\s*(tháng|ngày|tuần)/iu)
    const unit = normalizeVietnamese(percent?.[2] ?? '')
    const threshold = unit === 'ngay' ? '0.5' : unit === 'tuan' ? '3' : '10'
    return promise
      && (/\b(?:bao loi 100|hoa hong f[1-9]|tuyen nguoi nhan hoa hong)\b/.test(text)
        || !!percent && new Precise(percent[1].replace(',', '.')).gte(threshold))
  })
  if (ponzi) add(
    'RULE_07_PONZI_UNREALISTIC_RETURN', 'CRITICAL', 85, 'Cam kết lợi nhuận phi thực tế',
    'Lãi cao được bảo đảm hoặc yêu cầu nạp tiền để nhận hoa hồng, hoàn tiền theo nhiệm vụ là dấu hiệu cần xác minh. Dừng nạp tiền và kiểm tra qua kênh độc lập.', ponzi.quote,
  )

  const extraRules = [
    {
      ruleCode: 'RULE_08_RECOVERY_SCAM_TRAP', tactic: scamTactics.recovery, signal: input.intentSignals?.recoveryScamProb,
      title: 'Bẫy thu hồi tiền đã mất', description: 'Người hứa lấy lại tiền có thể nhắm vào người vừa bị lừa và yêu cầu nộp thêm phí để mở hồ sơ. Liên hệ ngân hàng hoặc cơ quan tiếp nhận trình báo qua số chính thức.',
    },
    {
      ruleCode: 'RULE_09_BIOMETRIC_OTP_PHISHING', tactic: scamTactics.biometric, signal: input.intentSignals?.biometricPhishingProb,
      title: 'Dụ cung cấp OTP hoặc dữ liệu sinh trắc học', description: 'Mã OTP, ảnh giấy tờ và dữ liệu khuôn mặt có thể bị dùng để đăng nhập, xác thực giao dịch hoặc mở tài khoản mang tên bạn. Chỉ xác thực trong ứng dụng chính thức.',
    },
    {
      ruleCode: 'RULE_10_FAKE_EXCHANGE_CRYPTO_CLONE', tactic: scamTactics.exchange, signal: undefined,
      title: 'Dấu hiệu sàn giao dịch tiền mã hóa giả', description: 'Số dư trên sàn giả có thể chỉ là số hiển thị. Yêu cầu nạp thêm tiền hoặc đóng phí để rút là cách giữ tiền cũ và lấy thêm tiền mới.',
    },
    {
      ruleCode: 'RULE_11_DEEPFAKE_URGENT_COERCION', tactic: scamTactics.coercion, signal: input.intentSignals?.urgentCoercionProb,
      title: 'Giả danh và ép chuyển tiền khẩn cấp', description: 'Người gọi có thể dùng giọng hoặc hình ảnh giả rồi thúc bạn chuyển tiền trước khi kịp kiểm tra. Hãy ngắt cuộc gọi và gọi lại số bạn đã lưu.',
    },
  ] as const
  const remote = scamTactics.remoteRequest
  for (const { ruleCode, tactic, signal, title, description } of extraRules) {
    if (ruleCode === 'RULE_09_BIOMETRIC_OTP_PHISHING') {
      const url = qrPayloads.find((qr) => qr.targetUrl && suspiciousQrLink(qr.raw ?? qr.targetUrl, context))?.targetUrl
      if (url) {
        add(ruleCode, 'CRITICAL', 85, 'Liên kết QR yêu cầu cài đặt hoặc xác thực đáng ngờ',
          'Liên kết có thể dẫn đến ứng dụng giả hoặc trang lấy OTP và thông tin đăng nhập. Đóng liên kết và mở ứng dụng chính thức theo cách bạn vẫn dùng.', url)
        continue
      }
    }
    if (ruleCode === 'RULE_10_FAKE_EXCHANGE_CRYPTO_CLONE' && cryptoInvestmentContext.test(context) &&
      cryptoPaymentContext.test(context) && qrPayloads.some((qr) => qr.qrScheme === 'CRYPTO_WALLET')) {
      add(ruleCode, 'HIGH', 55, title,
        'Tiền gửi vào ví có thể khó thu hồi. Sàn giả thường dùng số dư hiển thị và yêu cầu nạp tiếp để mở quyền rút tiền.',
        findQuote((text) => cryptoInvestmentContext.test(text) && !negation.test(text)) ?? 'Mã ví tiền mã hóa')
      continue
    }
    const recoveryAdvice = ruleCode === 'RULE_08_RECOVERY_SCAM_TRAP'
    const safeRecovery = /\b(?:khong|dung|cho) (?:nen |can |phai )?(?:tra phi|dong phi|nop phi|chuyen phi|chuyen tien|bam (?:vao )?link)\b/
    const bankContact = /\b(?:chuyen nham|lien he ngan hang|tong dai (?:chinh thuc|ngan hang)|luu bien lai)\b/
    const recoveryOffer = /\b(?:hua|cam ket|bao dam|thu hoi ho|lay lai ho|yeu cau|doi|bat buoc|can tam ung)\b/
    const evidence = (text: string) => !negation.test(text) &&
      !((ruleCode === 'RULE_09_BIOMETRIC_OTP_PHISHING' || ruleCode === 'RULE_11_DEEPFAKE_URGENT_COERCION') && remote.advice.test(text)) &&
      !(recoveryAdvice && (safeRecovery.test(text) || bankContact.test(text) && !recoveryOffer.test(text)))
    const sameClause = findQuote((text) => tactic.topic.test(text) && tactic.corroboration.test(text) && evidence(text))
    const topic = findQuote((text) => tactic.topic.test(text) && evidence(text))
    const corroboration = ruleCode === 'RULE_09_BIOMETRIC_OTP_PHISHING'
      ? sameClause
      : findQuote((text) => tactic.corroboration.test(text) && evidence(text))
    if (sameClause || (topic && corroboration)) {
      const quote = sameClause ?? (topic === corroboration ? topic! : corroboration!)
      add(ruleCode, 'CRITICAL', 85, title, description, quote)
    } else if (topic && signal !== undefined && signal >= 0.7) {
      add(ruleCode, 'HIGH', 38, title, description, topic)
    }
  }

  // Contextual requests need their sender and requested action in the same evidence clause.
  const requestedAction = (text: string) => {
    if (remote.advice.test(text)) return ''
    const request = remote.request.exec(text)
    return request ? text.slice(request.index) : ''
  }
  const appOrLink = (action: string) => remote.link.test(action) ||
    (remote.install.test(action) && (remote.sentInstaller.test(action) || !remote.officialStore.test(action)))
  const identityRequest = findQuote((text) => remote.identity.test(text) && appOrLink(requestedAction(text)) &&
    (remote.contact.test(text) || remote.authority.test(text) || remote.sender.test(text) || remote.sentInstaller.test(text)))
  const authorityRequest = findQuote((text) => remote.authority.test(text) && remote.contact.test(text) &&
    (remote.verifyOrPay.test(requestedAction(text)) || appOrLink(requestedAction(text))))
  const channelRequest = findQuote((text) => remote.sender.test(text) && appOrLink(requestedAction(text)))
  if (identityRequest) {
    if (!findings.some(({ ruleCode }) => ruleCode === 'RULE_09_BIOMETRIC_OTP_PHISHING')) {
      add('RULE_09_BIOMETRIC_OTP_PHISHING', 'HIGH', 55, 'Yêu cầu định danh qua ứng dụng hoặc liên kết cần xác minh',
        'Không cài ứng dụng từ tệp được gửi và tránh mở liên kết trong tin nhắn. Tự mở ứng dụng chính thức hoặc liên hệ cơ quan qua số công khai để kiểm tra yêu cầu.', identityRequest)
    }
  } else if (authorityRequest) {
    if (!findings.some(({ ruleCode }) => ruleCode === 'RULE_11_DEEPFAKE_URGENT_COERCION')) {
      add('RULE_11_DEEPFAKE_URGENT_COERCION', 'HIGH', 45, 'Yêu cầu từ người tự nhận là cơ quan hoặc đơn vị dịch vụ',
        'Tạm dừng thao tác và tra số liên hệ chính thức của đơn vị để xác minh. Giữ lại tin nhắn hoặc thông tin cuộc gọi nếu cần trình báo.', authorityRequest)
    }
  } else if (channelRequest) {
    add('RULE_15_CHANNEL_RISK', 'MEDIUM', 40, 'Yêu cầu mở liên kết hoặc cài ứng dụng cần xác minh',
      'Tự mở ứng dụng hoặc trang chính thức của đơn vị và kiểm tra đơn hàng hay giao dịch tại đó. Tránh mở liên kết hoặc cài ứng dụng theo tin nhắn hay cuộc gọi.', channelRequest)
  }

  for (const { channelIntelligence: channel, channelIndicatorId } of qrPayloads) {
    if (!channel) continue
    if (channel.reputationStatus === 'FLAGGED_SCAM') {
      if (channelIndicatorId && findings.some(({ matchedIndicatorId }) => matchedIndicatorId === channelIndicatorId)) continue
      add('RULE_14_CHANNEL_REPUTATION', 'CRITICAL', 95, 'Kênh giao dịch trùng cảnh báo rủi ro đã ghi nhận',
        channel.riskFlags.join(' '), channel.sourceName, channelIndicatorId)
    } else if (channel.channelGroup === 'CRYPTO_WALLET' ||
      ((channel.channelGroup === 'URL_LINK' || channel.channelGroup === 'EMVCO_CARD') && channel.riskFlags.length > 0)) {
      add('RULE_15_CHANNEL_RISK', 'MEDIUM', 30, 'Kênh giao dịch cần xác minh thêm',
        [...channel.riskFlags, channel.legalNotice].filter(Boolean).join(' '),
        [channel.sourceName, channel.activitySummary].filter(Boolean).join(' · '))
    }
  }
  const stated = input.statedTransferAmountVnd
  if (stated && new Precise(stated).gte(10_000_000)) {
    add('RULE_16_TRANSFER_AMOUNT_REVIEW', 'MEDIUM', 30, 'Xác minh khoản chuyển giá trị lớn',
      'Đối chiếu số tiền, người nhận và chứng từ. Kiểm tra hạn mức và yêu cầu xác thực sinh trắc học trực tiếp trong ứng dụng ngân hàng.',
      'Số tiền người dùng nêu: ' + formatCaseAmount(stated) + '.')
  }
  if (input.hasPromptTampering) {
    add('RULE_17_PROMPT_INJECTION_TAMPER', 'HIGH', 45, 'Dấu hiệu thao túng giám định',
      'Nội dung tài liệu hoặc mã QR chứa câu lệnh tìm cách điều khiển hệ thống đánh giá',
      '[đoạn nghi thao túng đã bị cô lập]')
  }
  const deterministicOverride = findings.some(({ severity }) => severity === 'CRITICAL')
  const score = Math.min(95, findings.reduce((total, finding) => total + finding.scoreImpact, 0))
  const clearPayment = qrPayloads.some(isPaymentQr) && personalContext.test(context)
  const qrNeedsReview = input.qrPayloads.some((qr) => !isPaymentQr(qr)) ||
    (qrPayloads.some(isPaymentQr) && !clearPayment && !entity && !loanQuote)
  const riskScore = deterministicOverride ? Math.max(75, score) : qrNeedsReview ? Math.max(30, score) : score
  const verdictLevel: ForensicAuditResponse['verdictLevel'] = riskScore >= 70 ? 'HIGH_RISK' : riskScore >= 30 ? 'CAUTION' : 'SAFE'
  return { findings, riskScore, verdictLevel, deterministicOverride, entityLicense, entityMismatchFlag: mismatchedQrs.length > 0, mismatchedQrs, mathBreakdown, clearPayment }
}
