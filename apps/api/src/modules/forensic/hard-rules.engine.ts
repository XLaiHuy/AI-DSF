import Decimal from 'decimal.js'
import type { FindingSeverity, ForensicAuditResponse, ForensicIntentSignals, RuleCode } from '@fincopilot/shared-types'
import { findInstitution, normalizeVietnamese, scamTactics, type CatalogInstitution } from './data/trusted-institutions'
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

const Precise = Decimal.clone({ precision: 40 })
const epsilon = new Precise('1e-25')

export function calculateFlatRateApr(terms: LoanTerms): MathBreakdown | null {
  if (!Number.isInteger(terms.termMonths) || terms.termMonths < 1 || terms.termMonths > 600
    || !/^\d{1,16}(?:\.\d{1,2})?$/.test(terms.principalNominalVnd)
    || !/^\d{1,16}(?:\.\d{1,2})?$/.test(terms.upfrontFeeVnd)
    || !/^\d{1,3}(?:\.\d{1,4})?$/.test(terms.flatMonthlyRatePct)) return null

  const principal = new Precise(terms.principalNominalVnd)
  const fees = new Precise(terms.upfrontFeeVnd)
  const quoted = new Precise(terms.flatMonthlyRatePct)
  const net = principal.minus(fees)
  if (!net.gt(0)) return null
  const installment = principal.div(terms.termMonths).plus(principal.mul(quoted).div(100))
  const monthlyIrr = quoted.isZero() && fees.isZero()
    ? new Precise(0)
    : solveIrr(net, installment, terms.termMonths)
  if (monthlyIrr === null) return null
  return {
    principalNominalVnd: principal.toFixed(),
    upfrontFeeVnd: fees.toFixed(),
    principalNetVnd: net.toFixed(),
    quotedRateLabel: quoted.toFixed() + '%/tháng (Lãi phẳng)',
    effectiveAprPct: monthlyIrr.mul(1200).toFixed(4),
    effectiveEarPct: monthlyIrr.plus(1).pow(12).minus(1).mul(100).toFixed(4),
  }
}

function solveIrr(net: Decimal, installment: Decimal, months: number): Decimal | null {
  // Present value is strictly decreasing. Keep Newton's steps inside a bracket.
  let lower = new Precise(0)
  let upper = installment.div(net)
  let rate = Precise.min(upper.div(2), '0.05')
  for (let iteration = 0; iteration < 180; iteration++) {
    const discount = rate.plus(1)
    let cashFlow = installment
    let residual = net.negated()
    let slope = new Precise(0)
    for (let month = 1; month <= months; month++) {
      cashFlow = cashFlow.div(discount)
      residual = residual.plus(cashFlow)
      slope = slope.minus(cashFlow.mul(month).div(discount))
    }
    if (residual.abs().div(net).lte(epsilon)) return rate
    if (residual.gt(0)) lower = rate
    else upper = rate
    const proposal = rate.minus(residual.div(slope))
    rate = proposal.gt(lower) && proposal.lt(upper) ? proposal : lower.plus(upper).div(2)
  }
  return null
}

const amountToken = String.raw`(\d{1,16}(?:[., ]\d{1,3}){0,5})\s*(triệu|tr\b|tỷ|tỉ|nghìn|ngàn|k\b|đồng|đ(?![\p{L}\p{N}])|vn[dđ]|₫)?`
const principalPattern = new RegExp(String.raw`\b(?:số\s+tiền\s+vay|khoản\s+vay|tiền\s+gốc|gốc\s+danh\s+nghĩa|vay)\s*(?:là\s*|[:=]\s*)?` + amountToken, 'iu')
const baseAmountPattern = new RegExp(String.raw`(?:trên|tính\s+theo)\s+` + amountToken, 'iu')
const feePattern = new RegExp(String.raw`(?:phí\s+(?:thu\s+)?(?:trước|ẩn|ban\s+đầu|giữ\s+lại)|trừ\s+trước|khấu\s+trừ\s+trước|phí\s+trừ\s+trước)\s*(?:là\s*|[:=]\s*)?` + amountToken, 'iu')

function parseVnd(match: RegExpMatchArray | null): string | null {
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

type RuleQr = Pick<ParsedQr, 'acqBin' | 'bankName' | 'account' | 'serviceCode' | 'amountVnd' | 'purpose' | 'crcValid'>
  & Partial<Pick<ParsedQr, 'raw' | 'qrScheme' | 'targetUrl' | 'walletNetwork'>> & {
  visionBeneficiaryName?: string | null
}
interface Indicator {
  id: string
  indicatorText: string
  indicatorType: string
}
interface HardRuleInput {
  evidence: readonly string[]
  claimedEntityName: string | null
  qrPayloads: readonly RuleQr[]
  indicators: readonly Indicator[]
  institutions: readonly CatalogInstitution[]
  intentSignals?: ForensicIntentSignals | null
  loan?: LoanTerms | null
}

const upfrontFee = /\b(phi (?:bao hiem|giai ngan|mo khoa|ho so|xac minh|loi 102)|coc ho so|phi (?:thu )?truoc)\b/
const negation = /\b(khong (?:can|phai|co|nen|duoc|yeu cau|thu|nop|chuyen|cung cap)|mien phi)\b/
const feeDemand = /\b(nop|dong|chuyen|tra|thanh toan|truoc|loi 102|mo khoa|dat coc)\b/
const freeze = /\b(loi 102|dong bang (?:tai khoan|khoan vay|so tien|tien|von)|mo khoa (?:khoan vay|tai khoan|giai ngan))\b/
const personalAccount = /\b(?:tai khoan|stk|tk) ca nhan\b/
const organizationName = /\b(tai chinh|ngan hang|chung khoan|quan ly quy|vi dien tu|san dau tu|cong ty|to chuc|cong an|co quan|tnhh|tmcp|ctcp)\b/
const personalContext = /\b(tra tien an|tra tien|chia tien|tien an|mua do|ban be|cho ban|hoan tien|gui tien cho)\b/
const cryptoInvestmentContext = /\b(dau tu|san giao dich|rut tien|rut von|nap them|loi nhuan|phi mo khoa)\b/
const cryptoPaymentContext = /\b(chuyen|nap|dong phi|phi de rut|thanh toan|gui|yeu cau tra)\b/

function isPaymentQr(qr: RuleQr) {
  return qr.crcValid || qr.qrScheme === 'EWALLET_VN'
}

function matchIndicator(indicator: Indicator, qrPayloads: readonly RuleQr[], quotes: readonly string[]): string | undefined {
  const value = indicator.indicatorText.trim()
  if (!value) return undefined
  switch (indicator.indicatorType) {
    case 'BANK_ACCOUNT': {
      const account = value.replace(/[ -]/g, '').toUpperCase()
      if (!/^[A-Z0-9]{7,32}$/.test(account)) return undefined
      const exact = qrPayloads.find((qr) => qr.account?.toUpperCase() === account)?.account
      if (exact) return exact
      const pattern = /^\d+$/.test(account) ? Array.from(account).join('[ .-]?') : account
      const inText = new RegExp('(?<![A-Z0-9])' + pattern + '(?![A-Z0-9])', 'i')
      return quotes.find((quote) => inText.test(quote))
    }
    case 'PHONE': {
      const normalizePhone = (phone: string) => phone.replace(/\D/g, '').replace(/^(?:0084|84)(?=\d{9}$)/, '0')
      const phone = normalizePhone(value)
      if (!/^0\d{9}$/.test(phone)) return undefined
      const walletPhone = qrPayloads.find((qr) => qr.qrScheme === 'EWALLET_VN' &&
        qr.account && normalizePhone(qr.account) === phone)?.account
      if (walletPhone) return walletPhone
      return quotes.find((quote) => (quote.match(/(?<!\d)(?:0|\+84|0084)(?:[ .-]?\d){9}(?!\d)/g) ?? [])
        .some((token) => normalizePhone(token) === phone))
    }
    case 'DOMAIN': {
      const domain = value.toLowerCase().replace(/^https?:\/\//, '').split(/[/:?#]/)[0].replace(/\.$/, '')
      if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)) return undefined
      const matchesHost = (host: string) => host === domain || host.endsWith('.' + domain)
      const decodedLink = qrPayloads.find((qr) => qr.targetUrl &&
        matchesHost(URL.parse(qr.targetUrl)?.hostname.replace(/\.$/, '') ?? ''))?.targetUrl
      if (decodedLink) return decodedLink
      const urls = /https?:\/\/[^\s<>"'()[\]]+/gi
      return quotes.find((quote) =>
        (quote.match(urls) ?? []).some((url) => {
          const hostname = URL.parse(url)?.hostname.replace(/\.$/, '')
          return hostname !== undefined && matchesHost(hostname)
        }) || (quote.replace(urls, '').toLowerCase().match(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) ?? []).some(matchesHost))
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
  const normalized = quotes.map((quote) => ({ quote, text: normalizeVietnamese(quote) }))
  const findQuote = (matches: (text: string) => boolean) => normalized.find(({ text }) => matches(text))?.quote
  const context = normalized.filter(({ text }) => !negation.test(text)).map(({ text }) => text).join(' ')
  const findings: Finding[] = []
  const add = (ruleCode: RuleCode, severity: FindingSeverity, scoreImpact: number, title: string, description: string,
    evidenceQuote: string, matchedIndicatorId: string | null = null) => {
    findings.push({ ruleCode, severity, scoreImpact, title, description, evidenceQuote, matchedIndicatorId })
  }
  const entity = input.claimedEntityName
  const entityLicense = entity ? findInstitution(entity, input.institutions) : null
  const loan = input.loan ?? findLoanTerms(input.evidence.join('\n'))
  const mathBreakdown = loan ? calculateFlatRateApr(loan) : null

  const fee = findQuote((text) => upfrontFee.test(text) && feeDemand.test(text) && !negation.test(text))
  if (fee && qrPayloads.some(isPaymentQr)) add(
    'RULE_01_UPFRONT_FEE_QR', 'CRITICAL', 85, 'Yêu cầu nộp phí trước qua VietQR',
    'Khoản thu trước gắn với yêu cầu chuyển tiền qua VietQR có dấu hiệu lừa đảo giải ngân.', fee,
  )
  const trap = findQuote((text) => freeze.test(text) && !negation.test(text))
  if (trap) add(
    'RULE_02_ERROR_102_FREEZE_TRAP', 'CRITICAL', 90, 'Kịch bản lỗi 102 hoặc đóng băng vốn',
    'Dấu hiệu dùng lỗi giao dịch hoặc lý do đóng băng vốn để gây áp lực thanh toán.', trap,
  )

  const claimedCompany = entity && (entityLicense !== null || organizationName.test(normalizeVietnamese(entity)) || !!loan)
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
    'Pháp nhân được nêu nhưng chứng cứ về tài khoản nhận qua QR cho thấy dấu hiệu sử dụng tài khoản cá nhân.',
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
      'Hãy đối chiếu tên pháp nhân, giấy phép và thông tin bên nhận tiền bằng kênh chính thức của NHNN hoặc UBCKNN.', impersonation ?? entity,
    )
  } else if (!entity && loan && mathBreakdown) {
    add(
      'RULE_04_UNLICENSED_OR_IMPERSONATION', 'HIGH', 38, 'Chưa xác minh được bên cho vay',
      'Có điều khoản vay nhưng hồ sơ thiếu tên pháp nhân để đối chiếu giấy phép.', loan.evidenceQuote,
    )
  }

  for (const indicator of input.indicators) {
    const match = matchIndicator(indicator, qrPayloads, quotes)
    if (!match) continue
    add(
      'RULE_05_NCSC_THREAT_MATCH', 'CRITICAL', 95, 'Trùng chỉ dấu đe dọa đã xác minh',
      'Thông tin trong hồ sơ trùng với dữ liệu cảnh báo đã được xác minh.', match, indicator.id,
    )
    break
  }

  // Screening references only. Article 468 permits exceptions under specialized laws.
  const aprReference = entityLicense?.status === 'LICENSED' ? '30' : '20'
  if (mathBreakdown && loan && new Precise(mathBreakdown.effectiveAprPct).gt(aprReference)) {
    add(
      'RULE_06_FLAT_RATE_AND_USURY_APR', 'HIGH', 34, 'Lãi phẳng làm tăng lãi suất thực',
      'APR theo dòng tiền vượt mốc tham chiếu. Đối chiếu biểu phí, điều khoản và quy định áp dụng cho bên cho vay.', loan.evidenceQuote,
    )
  }
  const ponzi = quotes.find((quote) => {
    const text = normalizeVietnamese(quote)
    const promise = /\b(cam ket|bao loi|loi nhuan co dinh|lai co dinh|lai suat co dinh)\b/.test(text)
    const percent = quote.match(/(\d{1,4}(?:[.,]\d{1,4})?)\s*%\s*(?:\/|mỗi|một|theo)\s*(?:tháng|ngày|tuần)/iu)
    return promise && !negation.test(text)
      && (/\b(?:bao loi 100|hoa hong f[1-9]|tuyen nguoi nhan hoa hong)\b/.test(text)
        || !!percent && new Precise(percent[1].replace(',', '.')).gte(10))
  })
  if (ponzi) add(
    'RULE_07_PONZI_UNREALISTIC_RETURN', 'CRITICAL', 85, 'Cam kết lợi nhuận phi thực tế',
    'Cam kết lợi nhuận cao hoặc thưởng theo tuyến giới thiệu là dấu hiệu cần xác minh trước khi đầu tư.', ponzi,
  )

  const extraRules = [
    {
      ruleCode: 'RULE_08_RECOVERY_SCAM_TRAP', tactic: scamTactics.recovery, signal: input.intentSignals?.recoveryScamProb,
      title: 'Bẫy thu hồi tiền đã mất', description: 'Yêu cầu trả phí để được thu hồi tiền có thể là một lần lừa đảo tiếp theo.',
    },
    {
      ruleCode: 'RULE_09_BIOMETRIC_OTP_PHISHING', tactic: scamTactics.biometric, signal: input.intentSignals?.biometricPhishingProb,
      title: 'Dụ cung cấp OTP hoặc dữ liệu sinh trắc học', description: 'Yêu cầu có thể nhằm lấy dữ liệu định danh hoặc chiếm quyền tài khoản.',
    },
    {
      ruleCode: 'RULE_10_FAKE_EXCHANGE_CRYPTO_CLONE', tactic: scamTactics.exchange, signal: undefined,
      title: 'Dấu hiệu sàn giao dịch tiền mã hóa giả', description: 'Yêu cầu nạp thêm tiền hoặc đóng phí để rút tiền là dấu hiệu rủi ro.',
    },
    {
      ruleCode: 'RULE_11_DEEPFAKE_URGENT_COERCION', tactic: scamTactics.coercion, signal: input.intentSignals?.urgentCoercionProb,
      title: 'Giả danh và ép chuyển tiền khẩn cấp', description: 'Kiểm tra danh tính người gọi qua số đã lưu trước khi phản hồi.',
    },
  ] as const
  for (const { ruleCode, tactic, signal, title, description } of extraRules) {
    if (ruleCode === 'RULE_09_BIOMETRIC_OTP_PHISHING') {
      const url = qrPayloads.find((qr) => qr.targetUrl && suspiciousQrLink(qr.raw ?? qr.targetUrl, context))?.targetUrl
      if (url) {
        add(ruleCode, 'CRITICAL', 85, 'Liên kết QR yêu cầu cài đặt hoặc xác thực đáng ngờ',
          'Không mở liên kết hoặc nhập thông tin. Kiểm tra yêu cầu qua ứng dụng hay trang chính thức.', url)
        continue
      }
    }
    if (ruleCode === 'RULE_10_FAKE_EXCHANGE_CRYPTO_CLONE' && cryptoInvestmentContext.test(context) &&
      cryptoPaymentContext.test(context) && qrPayloads.some((qr) => qr.qrScheme === 'CRYPTO_WALLET')) {
      add(ruleCode, 'HIGH', 55, title,
        'Yêu cầu chuyển tiền mã hóa trong bối cảnh đầu tư hoặc rút tiền cần được kiểm tra kỹ.',
        findQuote((text) => cryptoInvestmentContext.test(text) && !negation.test(text)) ?? 'Mã ví tiền mã hóa')
      continue
    }
    const topic = findQuote((text) => tactic.topic.test(text) && !negation.test(text))
    const corroboration = findQuote((text) => tactic.corroboration.test(text) && !negation.test(text))
    if (topic && corroboration) {
      add(ruleCode, 'CRITICAL', 85, title, description, topic === corroboration ? topic : corroboration)
    } else if (topic && signal !== undefined && signal >= 0.9) {
      add(ruleCode, 'HIGH', 38, title, description, topic)
    }
  }

  const deterministicOverride = findings.some(({ severity }) => severity === 'CRITICAL')
  const score = Math.min(95, findings.reduce((total, finding) => total + finding.scoreImpact, 0))
  const clearPayment = qrPayloads.some(isPaymentQr) && personalContext.test(context)
  const qrNeedsReview = input.qrPayloads.some((qr) => !isPaymentQr(qr)) ||
    (qrPayloads.some(isPaymentQr) && !clearPayment && !entity && !loan)
  const riskScore = deterministicOverride ? Math.max(75, score) : qrNeedsReview ? Math.max(30, score) : score
  const verdictLevel: ForensicAuditResponse['verdictLevel'] = riskScore >= 70 ? 'HIGH_RISK' : riskScore >= 30 ? 'CAUTION' : 'SAFE'
  return { findings, riskScore, verdictLevel, deterministicOverride, entityLicense, entityMismatchFlag: mismatchedQrs.length > 0, mismatchedQrs, mathBreakdown, clearPayment }
}
