import type { ForensicAuditResponse, VerdictLevel } from '@fincopilot/shared-types'
import Decimal from 'decimal.js'
import { normalizeVietnamese } from './data/trusted-institutions'
import { describeCasePayment, describePaymentQr, formatCaseAmount } from './payment-qr-description'

const schemeNames = {
  VIETQR_NAPAS: 'VietQR NAPAS', EWALLET_VN: 'Ví điện tử Việt Nam', EMVCO_INTL: 'EMVCo quốc tế',
  URL_LINK: 'Đường dẫn QR', CRYPTO_WALLET: 'Ví Crypto', UNKNOWN: 'Mã QR chưa rõ loại',
}
type AuditContext = Pick<ForensicAuditResponse, 'verdictLevel' | 'riskScore' | 'claimedEntityName' | 'entityLicense' |
  'qrPayloads' | 'mathBreakdown' | 'personalImpact' | 'findings' | 'reasoningFindings' | 'legalCitations'>

export function buildForensicDossier(audit: AuditContext) {
  const { qrPayloads, mathBreakdown, personalImpact, legalCitations, findings, reasoningFindings,
    verdictLevel, riskScore, claimedEntityName, entityLicense } = audit
  return {
    verdictLevel, riskScore, claimedEntityName, entityLicense,
    findingCount: findings.length + (reasoningFindings?.length ?? 0),
    qrSummary: qrPayloads.map(({ qrScheme, providerLabel, bankName, serviceCode, qrAmountVnd, amount, currencyCode,
      purposeText, crcValid, entityMismatchFlag, walletNetwork, merchantCategoryCode, channelIntelligence }) => ({
      qrScheme, type: schemeNames[qrScheme ?? 'UNKNOWN'], channel: describePaymentQr({ qrScheme, providerLabel, bankName, walletNetwork }),
      providerLabel, bankName, serviceCode, qrAmountVnd, amount, currencyCode: currencyCode ?? (qrAmountVnd ? 'VND' : null),
      purposeText, crcValid, entityMismatchFlag, walletNetwork, merchantCategoryCode, channelIntelligence,
    })),
    mathSummary: mathBreakdown,
    personalImpact: personalImpact ? {
      status: personalImpact.status, currentDtiPct: personalImpact.currentDtiPct, projectedDtiPct: personalImpact.projectedDtiPct,
      maxSafeEmiVnd: personalImpact.maxSafeEmiVnd, emiExcessVnd: personalImpact.emiExcessVnd,
      proposedMonthlyPaymentVnd: personalImpact.proposedMonthlyPaymentVnd, paymentAmountVnd: personalImpact.paymentAmountVnd,
      shareOfSavingsPct: personalImpact.shareOfSavingsPct, shareOfMonthlyIncomePct: personalImpact.shareOfMonthlyIncomePct,
    } : null,
    findings: findings.map(({ title, severity, description, evidenceQuote }) => ({ title, severity, description, evidenceQuote })),
    reasoningFindings: reasoningFindings ?? [],
    legalCitations: legalCitations?.map(({ code, title, articleRef, caseRelevance }) => ({ code, title, articleRef, caseRelevance })) ?? [],
  }
}

type Dossier = ReturnType<typeof buildForensicDossier>

export function buildNarrativeInput(dossier: Dossier) {
  return {
    ...dossier,
    findings: dossier.findings.map(({ title, severity, evidenceQuote }) => ({ title, severity, evidenceQuote })),
    legalCitations: dossier.legalCitations.map(({ code, articleRef }) => ({ code, articleRef })),
    qrSummary: dossier.qrSummary.map(({ channelIntelligence, ...qr }) => ({
      ...qr,
      channelIntelligence: channelIntelligence && {
        reputationStatus: channelIntelligence.reputationStatus,
        sourceName: channelIntelligence.sourceName,
        riskFlags: channelIntelligence.riskFlags,
      },
    })),
  }
}
const Numeric = Decimal.clone({ precision: 40 })
const multipliers: Record<string, string> = { tỷ: '1000000000', tỉ: '1000000000', triệu: '1000000', nghìn: '1000', ngàn: '1000' }
const currencies = new Set(['usd', 'eur', 'jpy', 'gbp', 'cny', 'krw', 'thb', 'sgd', 'myr', 'usdt', 'btc', 'eth'])
const writtenFigure = /\b(?:khong|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|tram)(?: (?:khong|mot|hai|ba|bon|nam|lam|sau|bay|tam|chin|muoi|tram|linh|le|phay))* (?:phan tram|dong|trieu|ty|nghin|ngan|thang|ngay|tuan|nam|usd|eur)\b/
const numberTokens = /(?<![\d.,])([+−-]?(?:\d{1,3}(?:[ .,\u00a0\u202f]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?))(?:[ \t]*(%|phần trăm|điểm(?: phần trăm)?|tháng|ngày|tuần|năm|lần|tỷ|tỉ|triệu|nghìn|ngàn|đồng|vnd|đ|₫|usd|eur|jpy|gbp|cny|krw|thb|sgd|myr|usdt|btc|eth)(?!\p{L}))?/giu
const normalizeNumbers = (source: string) =>
  source.normalize('NFKC').toLowerCase()
    .replace(/(?<=\d)\s*[-–—]\s*(?=\d)/gu, ' đến ')
    .replace(/(?<=\p{L})[-–—](?=\d)/gu, ' ')

function numberValue(raw: string, unit?: string) {
  const compact = raw.replace(/\s/gu, '').replace('−', '-')
  const grouped = unit !== '%' && unit !== 'phần trăm' && !unit?.startsWith('điểm') && !currencies.has(unit ?? '') &&
    /^[+-]?\d{1,3}(?:[.,]\d{3})+(?:,\d{1,2})?$/.test(compact)
  const decimal = grouped ? compact.replace(/[.,](?=\d{3}(?!\d))/g, '').replace(',', '.') : compact.replace(',', '.')
  return /^[+-]?\d+(?:\.\d+)?$/.test(decimal) ? new Numeric(decimal).mul(multipliers[unit ?? ''] ?? 1) : null
}

export function financialNumericGrounding(values: readonly unknown[], evidence: readonly string[] = [], options?: { allFigures?: boolean }) {
  const allowed = { money: new Set<string>(), rate: new Set<string>(), figure: new Set<string>(), foreign: new Set<string>() }
  const add = (kind: keyof typeof allowed, value: Decimal) => {
    allowed[kind].add(value.toFixed())
    if (kind === 'rate') allowed.rate.add(value.toDecimalPlaces(2).toFixed())
  }
  const claims = (text: string) => Array.from(normalizeNumbers(text).matchAll(numberTokens)).flatMap(([, raw, unit]) => {
    const kind = unit === '%' || unit === 'phần trăm' || unit?.startsWith('điểm') ? 'rate'
      : unit && (unit in multipliers || /^(?:đồng|vnd|đ|₫)$/.test(unit)) ? 'money'
        : options?.allFigures ? (currencies.has(unit ?? '') ? 'foreign' : 'figure') : undefined
    const value = numberValue(raw, unit)
    return kind && (value || options?.allFigures) ? [{ kind, value } as const] : []
  })
  const collect = (record: unknown) => {
    if (!record || typeof record !== 'object') return
    for (const [key, value] of Object.entries(record)) {
      if (value && typeof value === 'object') collect(value)
      else if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)) {
        if (/Vnd$/.test(key)) add('money', new Numeric(value))
        if (/Pct$/.test(key)) add('rate', new Numeric(value))
      } else if (options?.allFigures && typeof value === 'number' && Number.isSafeInteger(value)) {
        add('figure', new Numeric(value))
      }
    }
  }
  values.forEach(collect)
  for (const text of evidence) for (const { kind, value } of claims(text)) if (value) add(kind, value)
  return (text: string) => !/\b(?:mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|tram)(?: (?:mot|hai|ba|bon|nam|lam|sau|bay|tam|chin|muoi|tram|linh|le))* (?:trieu|ty|nghin|ngan|phan tram)\b/.test(normalizeVietnamese(text)) &&
    (!options?.allFigures || (!/[$€£]/u.test(text) && !writtenFigure.test(normalizeVietnamese(text)))) &&
    claims(text).every(({ kind, value }) => value && allowed[kind].has(value.toFixed()))
}

export function contradictsHighRisk(text: string) {
  const normal = normalizeVietnamese(text.replace(/(?:không|đừng|chớ)\s+(?:nên\s+)?(?:yên tâm|cứ|hãy|tiếp tục)?\s*chuyển tiền/giu, ' '))
  return /\b(?:yen tam (?:chuyen|gui tien|thanh toan|thuc hien giao dich)|giao dich (?:nay )?(?:la )?an toan|tiep tuc chuyen|chuyen tien ngay|(?:cu|hay|nen|co the|vui long) (?:chuyen|thanh toan|nap tien|gui tien)|khong co rui ro|bo qua canh bao|khong can kiem tra)\b/.test(normal)
}

export function isGroundedForensicNarrative(text: string, dossier: Dossier) {
  const normal = normalizeVietnamese(text)
  if (/\b(?:lai (?:suat )?cat co|chac chan (?:pham toi|lua dao|bat hop phap)|pham toi|ket luan (?:bat hop phap|vi pham|la lua dao)|trai phap luat|trai quy dinh|bat hop phap|vi pham (?:phap luat|tran lai|dieu \d+)|(?:vuot (?:qua )?|cao hon )muc (?:phap luat|luat|quy dinh) cho phep|khong (?:co giay phep|duoc cap phep))\b/.test(normal)
    || dossier.verdictLevel === 'HIGH_RISK' && contradictsHighRisk(text)) return false
  // Require digits for quantitative assertions so they can be compared exactly.
  if (/\b(?:mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|tram)(?: (?:mot|hai|ba|bon|nam|lam|sau|bay|tam|chin|muoi|tram|linh|le))* (?:trieu|ty|nghin|ngan|phan tram)\b/.test(normal)) return false

  const values = { any: new Set<string>(), money: new Set<string>(), rate: new Set<string>(), month: new Set<string>(),
    day: new Set<string>(), week: new Set<string>(), point: new Set<string>(), factor: new Set<string>() }
  const foreign = new Map<string, Set<string>>()
  type Kind = keyof typeof values
  const add = (kind: Kind, value: string | number | Decimal | null | undefined, rounded = false) => {
    if (value == null || typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value)) return
    const n = new Numeric(value)
    for (const token of rounded ? [n.toFixed(), n.toDecimalPlaces(2).toFixed()] : [n.toFixed()]) {
      values[kind].add(token)
      values.any.add(token)
    }
  }
  const addForeign = (currency: string, value: string | Decimal | null | undefined) => {
    if (value == null || typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value)) return
    const n = new Numeric(value)
    const amounts = foreign.get(currency) ?? new Set<string>()
    amounts.add(n.toFixed())
    foreign.set(currency, amounts)
    add('any', n)
  }
  const category = (unit?: string): Kind => unit === '%' || unit === 'phần trăm' ? 'rate'
    : unit === 'tháng' ? 'month' : unit === 'ngày' ? 'day' : unit === 'tuần' ? 'week' : unit === 'lần' ? 'factor'
      : unit?.startsWith('điểm') ? 'point' : unit && unit !== 'năm' ? 'money' : 'any'
  const addQuote = (quote: string) => {
    for (const [, raw, unit] of normalizeNumbers(quote).matchAll(numberTokens)) {
      const value = numberValue(raw, unit)
      if (unit && currencies.has(unit)) addForeign(unit, value)
      else add(category(unit), value, category(unit) === 'rate')
    }
  }
  const collect = (record: object) => {
    for (const [key, value] of Object.entries(record)) {
      if (value && typeof value === 'object') collect(value)
      else if (typeof value === 'number' || typeof value === 'string') {
        if (/Vnd$/.test(key)) add('money', value)
        else if (/Pct$/.test(key)) add(key === 'excessOverCeilingPct' ? 'point' : 'rate', value, true)
        else if (/Months?$/.test(key)) add('month', value)
        else if (key === 'multipleOfCeiling') add('factor', value)
        else if (/Quote$|Condition$|Label$/.test(key)) addQuote(String(value))
      }
    }
  }
  add('point', dossier.riskScore)
  add('any', 100)
  add('any', dossier.findingCount)
  if (dossier.mathSummary) {
    collect(dossier.mathSummary)
    const periodic = dossier.mathSummary.periodicRepayment
    if (periodic) add(periodic.unit === 'DAY' ? 'day' : 'week', periodic.count)
    for (const { fromMonth, toMonth } of dossier.mathSummary.phaseBreakdown ?? []) add('month', toMonth - fromMonth + 1)
  }
  if (dossier.personalImpact) collect(dossier.personalImpact)
  for (const qr of dossier.qrSummary) {
    const currency = qr.currencyCode?.toLowerCase()
    if (qr.qrAmountVnd != null || currency === 'vnd') add('money', qr.qrAmountVnd ?? qr.amount)
    else if (qr.amount != null && currency) addForeign(currency, qr.amount)
    addQuote([qr.providerLabel, qr.bankName, qr.channel, qr.serviceCode, qr.purposeText].filter(Boolean).join(' · '))
  }
  addQuote(dossier.claimedEntityName ?? '')
  for (const entry of [...dossier.findings, ...dossier.reasoningFindings]) addQuote(entry.evidenceQuote)
  for (const citation of dossier.legalCitations) {
    addQuote([citation.code, citation.title, citation.articleRef, citation.caseRelevance].filter(Boolean).join(' · '))
    if (citation.code === '91/2015/QH13' || citation.code === '01/2019/NQ-HĐTP') {
      add('rate', 20)
      add('rate', 150)
    }
    if (citation.code === '01/2021/NQ-HĐTP') {
      add('rate', 100)
      add('money', 30_000_000)
      add('factor', 5)
    }
  }
  const remaining = normalizeNumbers(text).replace(numberTokens, (_match, raw: string, unit?: string) => {
    const n = numberValue(raw, unit)
    const allowed = unit && currencies.has(unit) ? foreign.get(unit) : values[category(unit)]
    return n !== null && allowed?.has(n.toFixed()) ? '' : '0'
  })
  return !/\p{N}/u.test(remaining)
}

export function mentionsCasePayment(text: string, dossier: Dossier) {
  const qr = dossier.qrSummary[0]
  if (!qr) return true
  const amount = qr.qrAmountVnd ?? qr.amount
  const currency = qr.qrAmountVnd != null ? 'VND' : qr.currencyCode
  if (amount && currency && !text.replace(/\s+/gu, ' ').includes(formatCaseAmount(amount, currency))) return false
  const normal = normalizeVietnamese(text)
  if (qr.qrScheme === 'CRYPTO_WALLET') {
    const provider = qr.providerLabel ? normalizeVietnamese(qr.providerLabel) : null
    const network = qr.walletNetwork?.toLowerCase() ?? null
    const hasWalletChannel = /\b(?:vi tien ma hoa|vi crypto|dia chi vi|vi usdt|vi bitcoin|vi tron|vi ethereum|vi trc ?20|vi erc ?20|vi btc)\b/.test(normal)
    const hasProviderOrNetwork = (!provider && !network)
      || Boolean(provider && normal.includes(provider))
      || Boolean(network && normal.replace(/\s+/g, '').includes(network))
    return hasWalletChannel && hasProviderOrNetwork
      && [dossier.claimedEntityName, qr.purposeText].every((value) => !value || normal.includes(normalizeVietnamese(value)))
  }
  const channelNames = {
    VIETQR_NAPAS: 'VietQR', EWALLET_VN: 'ví điện tử', EMVCO_INTL: 'EMVCo',
    URL_LINK: 'đường dẫn', CRYPTO_WALLET: 'ví tiền mã hóa', UNKNOWN: 'mã QR',
  }
  const terms = [dossier.claimedEntityName, channelNames[qr.qrScheme ?? 'UNKNOWN'], qr.providerLabel ?? qr.bankName, qr.purposeText]
  return terms.every((value) => !value || normal.includes(normalizeVietnamese(value)))
}

export function completeNarrativePayment(text: string, dossier: Dossier) {
  if (mentionsCasePayment(text, dossier)) return text
  const qr = dossier.qrSummary[0]
  if (!qr) return text
  const payment = describeCasePayment({ ...qr, providerLabel: qr.providerLabel ?? qr.bankName })
  const provider = qr.providerLabel ?? qr.bankName
  const channel = provider && !normalizeVietnamese(payment).includes(normalizeVietnamese(provider)) ? ' (' + provider + ')' : ''
  return describeNarrativeParty(dossier.claimedEntityName) + 'Mình đọc được ' + payment + channel + '.\n\n' + text
}

function describeNarrativeParty(name?: string | null) {
  return name ? 'Đơn vị được nêu là “' + name + '”. ' : ''
}

export function deterministicNarrative(context: {
  verdictLevel: VerdictLevel; findingCount: number; claimedEntityName?: string | null
  qrPayloads?: AuditContext['qrPayloads']; mathBreakdown?: AuditContext['mathBreakdown']; personalImpact?: AuditContext['personalImpact']
  findings?: AuditContext['findings']
}) {
  const { verdictLevel, findingCount, mathBreakdown: math, personalImpact: impact } = context
  const qr = context.qrPayloads?.[0]
  const party = describeNarrativeParty(context.claimedEntityName)
  const feeTrap = context.findings?.some(({ ruleCode }) => ruleCode.startsWith('RULE_01') || ruleCode.startsWith('RULE_02'))
  const rate = (value: string) => new Numeric(value).toFixed(2).replace('.', ',') + '%'
  const lead = party + (qr ? 'Mình đọc được ' + describeCasePayment(qr) + '. ' +
    (feeTrap ? 'Yêu cầu chuyển phí để mở khóa khoản vay có thể kéo theo những lần đòi tiền tiếp theo. ' : '')
    : math ? 'Khoản vay ghi ' + formatCaseAmount(math.principalNominalVnd) + ', bạn thực nhận ' +
      formatCaseAmount(math.principalNetVnd) + (math.totalPayableVnd ? ' và dự kiến trả tổng cộng ' + formatCaseAmount(math.totalPayableVnd) : '') + '. ' : '')
  const cost = (math?.stressScenario ? 'Nếu mất ưu đãi, tổng tiền trả tăng thêm ' + formatCaseAmount(math.stressScenario.extraDeltaOverBaseVnd) + '. ' : '')
    + (impact?.projectedDtiPct ? 'Ở tháng trả cao nhất, tiền trả nợ chiếm ' + rate(impact.projectedDtiPct) + ' thu nhập của bạn. ' : '')
  const detail = (lead + cost).trim()
  const introduce = (takeaway: string) => [detail, takeaway].filter(Boolean).join('\n\n')
  switch (verdictLevel) {
    case 'HIGH_RISK':
      return {
        narrative: introduce('Mình thấy ' + findingCount + ' dấu hiệu đáng lo. Bạn nên dừng chuyển tiền và kiểm tra lại qua kênh chính thức.'),
        immediateActions: [
          'Dừng chuyển tiền và ngừng chia sẻ OTP hoặc thông tin sinh trắc học.',
          'Nếu đã chuyển tiền, gọi tổng đài chính thức của ngân hàng để yêu cầu hỗ trợ khẩn cấp.',
          'Giữ lại biên lai và tin nhắn, sau đó trình báo cơ quan Công an.',
        ],
      }
    case 'CAUTION':
      return {
        narrative: introduce('Bạn nên kiểm tra lại thông tin và người nhận qua kênh chính thức trước khi quyết định.'),
        immediateActions: ['Hỏi lại người nhận qua số bạn đã biết. Với bên cho vay hoặc đầu tư, kiểm tra thêm qua kênh chính thức của họ.'],
      }
    case 'SAFE':
      return {
        narrative: introduce('Bạn vẫn nên đối chiếu tên người nhận và số tiền trên ứng dụng trước khi xác nhận.'),
        immediateActions: ['Nếu tên hoặc số tiền hiện trên app khác với thỏa thuận, hãy hỏi lại người nhận trước khi chuyển.'],
      }
  }
}

export function followUpAnchor(audit: ForensicAuditResponse) {
  const headline = audit.verdictLevel === 'HIGH_RISK' ? 'Mức nguy hiểm cao'
    : audit.verdictLevel === 'CAUTION' ? 'Cần thận trọng' : 'Chưa thấy dấu hiệu đáng ngờ'
  const action = deterministicNarrative({ verdictLevel: audit.verdictLevel, findingCount: audit.findings.length }).immediateActions[0]
  return headline + ' (' + audit.riskScore + '/100). ' + action
}
