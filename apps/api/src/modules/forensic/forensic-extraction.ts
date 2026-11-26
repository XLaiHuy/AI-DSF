import { AI_TASK_SCHEMAS, type AiTaskOutput, type ForensicAuditFields } from '@fincopilot/shared-types'
import Decimal from 'decimal.js'
import sharp from 'sharp'
import type { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { validateFiles } from './file-guard'
import { findLoanQuoteAmount, findLoanTerms, type LoanTerms } from './hard-rules.engine'
import { inspectConditionalLoan } from './conditional-loan.parser'
import { extractPdf } from './pdf-extractor'
import { inspectForensicInput, stripZeroWidthAndBidi } from './forensic-prompt-guard'
import { maskForensicText } from './qr-evidence'
import { decodeAnyQrs, findCryptoWallets, parseAnyQr } from './vietqr-parser'

type Vision = AiTaskOutput<'FORENSIC_VISION_EXTRACT'>
export type Upload = { buffer: Buffer }
export type ForensicExtractionObservation = {
  vision: Vision | null
  visionProvider: string | null
  visionNeeded: boolean
  imageCount: number
  pdfRasterCount: number
  decodedQrCount: number
}
const maxRasterizedPages = 8

async function prepareVisionImages(buffers: readonly Buffer[], maxImages = 8) {
  const images = await Promise.all(buffers.slice(0, maxImages).map(async (buffer) => {
    try {
      return await sharp(buffer, { limitInputPixels: 25_000_000 })
        .rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: 'white' }).jpeg({ quality: 80, mozjpeg: true }).toBuffer()
    } catch {
      return null
    }
  }))
  return images.filter((image) => image !== null)
}

function namedBeneficiary(text: string): string | null {
  const candidate = /(?:tài khoản cá nhân|chủ tài khoản)\s*:?\s*([^\n,.!?;()]{3,150})/iu.exec(text)?.[1].trim()
  return candidate && /^(?:\p{Lu}\p{L}*\s+){1,7}\p{Lu}\p{L}*$/u.test(candidate) ? candidate : null
}

export async function extractAuditEvidence(
  ai: AiGatewayService,
  fields: ForensicAuditFields,
  files: readonly Upload[],
  uploadMaxMb: number,
  pdfMaxPages: number,
  observe?: (observation: ForensicExtractionObservation) => void,
) {
  const derivedImages: Buffer[] = []
  let visionImages: Buffer[] = []
  try {
    const kinds = validateFiles(files, uploadMaxMb)
    const images = files.filter((_, index) => kinds[index] !== 'PDF').map(({ buffer }) => buffer)
    const pdfs = files.filter((_, index) => kinds[index] === 'PDF')
    const manualQr = fields.rawQrString ? parseAnyQr(fields.rawQrString) : null
    const pastedQr = fields.rawText && fields.rawText.length <= 4096 && !fields.rawText.includes('\n')
      ? parseAnyQr(fields.rawText) : null
    const [qrExtraction, pdfExtraction] = await Promise.allSettled([
      Promise.all(images.map((image) => decodeAnyQrs(image).catch(() => []))),
      (async () => {
        const text: string[] = []
        for (const { buffer } of pdfs) {
          const result = await extractPdf(buffer, pdfMaxPages, maxRasterizedPages - derivedImages.length, Boolean(observe))
          derivedImages.push(...result.images)
          text.push(result.text)
        }
        return text
      })(),
    ])
    if (qrExtraction.status === 'rejected') throw qrExtraction.reason
    if (pdfExtraction.status === 'rejected') throw pdfExtraction.reason
    const pdfText = pdfExtraction.value
    const pdfQrs = await Promise.all(derivedImages.map((image) => decodeAnyQrs(image).catch(() => [])))
    const decodedQrs = [...qrExtraction.value.flat(), ...pdfQrs.flat()]
    const pastedWallets = findCryptoWallets(fields.rawText ?? '')
    const qrs = [...new Map([manualQr, pastedQr?.qrScheme !== 'UNKNOWN' ? pastedQr : null, ...decodedQrs, ...pastedWallets]
      .filter((qr) => qr !== null).map((qr) => [qr.raw, qr])).values()]
    let hasPromptTampering = false
    const isolate = (value: string) => {
      const inspection = inspectForensicInput(value)
      if (inspection.strippedControlSpans > 0) hasPromptTampering = true
      return inspection.sanitizedText
    }
    const safeQrs = qrs.map((qr) => ({ ...qr, purpose: qr.purpose ? isolate(qr.purpose) : qr.purpose }))
    const qrPurposes = safeQrs.flatMap((qr) => qr.crcValid && qr.purpose ? [qr.purpose] : [])
    const rawText = isolate([pastedQr && pastedQr.qrScheme !== 'UNKNOWN' ? undefined : fields.rawText, ...pdfText]
      .filter(Boolean).join('\n').slice(0, 50_000))
    const aiText = maskForensicText(stripZeroWidthAndBidi(rawText))
    const allImages = [...images, ...derivedImages]
    const flatLoan = findLoanTerms(rawText)
    const textLoan = inspectConditionalLoan(rawText)
    visionImages = await prepareVisionImages(allImages)
    const visionNeeded = allImages.length > 0 || (rawText.length > 120 && !flatLoan && !textLoan.spec && qrs.length === 0)
    const visionTask = 'FORENSIC_VISION_EXTRACT'
    const intentText = maskForensicText(stripZeroWidthAndBidi([rawText, ...qrPurposes].join('\n'))).slice(0, 12_000)
    const [visionResult, intentResult] = await Promise.allSettled([
      visionNeeded && (visionImages.length > 0 || aiText.length > 0)
        ? ai.generateWithProvider(visionTask, AI_TASK_SCHEMAS[visionTask], {
          text: observe && visionImages.length ? 'Trích dữ kiện từ các ảnh được cung cấp.' : aiText || 'Trích dữ kiện từ các ảnh được cung cấp.',
          images: visionImages,
        })
        : null,
      !intentText.trim() ? null : ai.classifyForensicIntent(intentText),
    ])
    if (intentResult.status === 'rejected') throw intentResult.reason
    const vision = visionResult.status === 'fulfilled' ? visionResult.value : null
    const documentTranscript = vision?.output.documentTranscript ?? ''
    const safeTranscript = isolate(documentTranscript)
    const transcriptIntent = maskForensicText(safeTranscript || (observe ? 'Hồ sơ chỉ có tệp đính kèm.' : '')).slice(0, 12_000)
    const intentSignals = !intentText.trim()
      ? (transcriptIntent.trim() ? await ai.classifyForensicIntent(transcriptIntent) : null)
      : intentResult.value
    observe?.({
      vision: vision?.output ?? null, visionProvider: vision?.provider ?? null, visionNeeded,
      imageCount: visionImages.length, pdfRasterCount: derivedImages.length, decodedQrCount: decodedQrs.length,
    })
    const supportsQuote = (quote: string) => isolate(quote) === quote && (visionImages.length > 0 || aiText.includes(quote))
    const facts = vision?.output && { ...vision.output, ratePhases: vision.output.ratePhases?.slice(0, 30) ?? null }
    const beneficiary = facts?.visionBeneficiaryName
    const beneficiaryName = namedBeneficiary(rawText) ?? (beneficiary && supportsQuote(beneficiary.evidenceQuote) &&
      beneficiary.evidenceQuote.includes(beneficiary.value) ? beneficiary.value.trim() : null)
    const entity = facts?.claimedEntityName
    const organizationContext = /công ty|tổ chức|ngân hàng|công an|cơ quan|quỹ đầu tư|đại diện|nhân viên|bên cho vay|bên cho mượn/iu
    const payeeLabel = /tài khoản cá nhân|ngân hàng (?:của |bên )?(?:nhận|thụ hưởng)|tên ngân hàng|logo ví/iu
    const extractedEntity = entity && supportsQuote(entity.evidenceQuote) &&
      entity.evidenceQuote.includes(entity.value) && organizationContext.test(entity.evidenceQuote) &&
      !payeeLabel.test(entity.evidenceQuote) ? entity.value : null
    const quotes = facts
      ? facts.redFlagPhrases.map(({ evidenceQuote }) => evidenceQuote)
        .concat(facts.upfrontFees.map(({ evidenceQuote }) => evidenceQuote))
        .filter(supportsQuote)
      : []
    // Second-pass claims must match text, QR evidence, or a quote already transcribed from the image.
    const visionQuotes = [facts?.nominalAmountEvidenceQuote, facts?.termMonths?.evidenceQuote, facts?.quotedRatePct?.evidenceQuote]
      .filter((quote): quote is string => Boolean(quote && supportsQuote(quote)))
    const normalizeQuote = (quote: string) => quote.normalize('NFC').replace(/\s+/g, ' ').trim()
    const normalizedText = normalizeQuote(aiText)
    const transcript = visionImages.length && safeTranscript ? normalizeQuote(safeTranscript) : ''
    const visualSchedule = facts && groundVisualSchedule(facts, (quote) => {
      const normalized = normalizeQuote(quote)
      return normalizedText.includes(normalized) || transcript.includes(normalized)
    })
    const conditionalLoan = textLoan.spec ? textLoan : {
      spec: visualSchedule ? visualSchedule.spec : null,
      conditionalQuote: textLoan.conditionalQuote ?? (visualSchedule ? visualSchedule.conditionalQuote : undefined),
      floatingQuote: textLoan.floatingQuote ?? (visualSchedule ? visualSchedule.floatingQuote : undefined),
      insuranceQuote: textLoan.insuranceQuote ?? (visualSchedule ? visualSchedule.insuranceQuote : undefined),
    }
    return {
      claimedEntityName: (fields.claimedEntityName ? isolate(fields.claimedEntityName) : extractedEntity)?.slice(0, 200) ?? null,
      beneficiaryName,
      evidence: [rawText, ...quotes, ...qrPurposes, ...(safeTranscript !== documentTranscript ? [safeTranscript] : [])].filter(Boolean),
      visionQuotes: [...visionQuotes, ...[
        conditionalLoan.conditionalQuote, conditionalLoan.floatingQuote, conditionalLoan.insuranceQuote,
        ...(conditionalLoan.spec?.ratePhases.map(({ evidenceQuote }) => evidenceQuote) ?? []),
      ].filter((quote): quote is string => Boolean(quote))],
      hasVisionRedFlags: facts?.redFlagPhrases.some(({ evidenceQuote }) => supportsQuote(evidenceQuote)) ?? false,
      hasPromptTampering,
      rawText,
      qrPayloads: safeQrs.map((qr, index) => ({
        ...qr,
        // An OCR name returned for multiple QR images cannot safely be assigned to a specific QR.
        visionBeneficiaryName: qrs.length === 1 && index === 0 ? beneficiaryName : null,
      })),
      channels: [...new Set([
        ...(fields.rawText || fields.rawQrString || fields.claimedEntityName ? ['TEXT'] : []),
        ...(pdfs.length ? ['PDF'] : []),
        ...(images.length ? ['CHAT_IMAGE'] : []),
        ...(decodedQrs.some((qr) => qr.qrScheme === 'VIETQR_NAPAS') ? ['VIETQR_IMAGE'] : []),
      ])],
      loan: flatLoan ?? (facts && (facts.ratePhases?.length ?? 0) <= 1 &&
        !facts.stressEvidenceQuote && !facts.hasUncappedFloatingClause ? visualLoanTerms(facts, supportsQuote) : null),
      conditionalLoan,
      intentSignals,
      visionProvider: vision?.provider ?? null,
      visionDegraded: visionNeeded && !vision,
    }
  } finally {
    for (const image of visionImages) image.fill(0)
    for (const { buffer } of files) buffer.fill(0)
    for (const image of derivedImages) image.fill(0)
  }
}

function groundVisualSchedule(facts: Vision, supportsQuote: (quote: string) => boolean) {
  const grounded = (quote: string | null | undefined): quote is string => Boolean(quote?.trim() && supportsQuote(quote))
  const nominal = facts.nominalAmountEvidenceQuote
  const term = facts.termMonths?.evidenceQuote
  const phases = (facts.ratePhases ?? []).filter((phase) => grounded(phase.evidenceQuote))
  const fee = facts.recurringFeeEvidenceQuote
  const stress = facts.stressEvidenceQuote
  const floating = facts.uncappedFloatingQuote
  const upfrontQuotes = facts.upfrontFees.map(({ evidenceQuote }) => evidenceQuote)
  const quotes = [...new Set([nominal, term, facts.quotedRatePct?.evidenceQuote, facts.repaymentMethodEvidenceQuote,
    ...upfrontQuotes, ...phases.map(({ evidenceQuote }) => evidenceQuote), fee, stress, floating].filter(grounded))]
  const parsed = inspectConditionalLoan(quotes.join('\n'))
  const spec = parsed.spec
  if (!spec) return parsed
  if (spec.termMonths !== facts.termMonths?.value ||
      facts.repaymentMethod && spec.repaymentMethod !== facts.repaymentMethod ||
      facts.recurringMonthlyFeeVnd != null && (!grounded(fee) || spec.recurringFeeVnd === undefined ||
        !new Decimal(spec.recurringFeeVnd).eq(facts.recurringMonthlyFeeVnd))) return { ...parsed, spec: null }
  if (facts.ratePhases?.length && (spec.ratePhases.length !== phases.length ||
      spec.ratePhases.some((phase, index) => {
        const claimed = phases[index]
        return !claimed || phase.fromMonth !== claimed.fromMonth || phase.toMonth !== claimed.toMonth ||
          !new Decimal(phase.monthlyRatePct).eq(claimed.monthlyRatePct)
      }))) return { ...parsed, spec: null }
  if (spec.stressScenario && (facts.stressMonthlyRatePct == null ||
      !new Decimal(spec.stressScenario.monthlyRatePct).eq(facts.stressMonthlyRatePct))) {
    return { ...parsed, spec: { ...spec, stressScenario: undefined } }
  }
  return parsed
}

function visualLoanTerms(facts: Vision, supportsQuote: (quote: string) => boolean): LoanTerms | null {
  const rate = facts.quotedRatePct
  const term = facts.termMonths
  if (facts.rateMethod !== 'FLAT_RATE' || !rate || !term ||
    !supportsQuote(rate.evidenceQuote) || !supportsQuote(term.evidenceQuote) ||
    !/tháng|month/i.test(rate.evidenceQuote) || !/^\d{1,3}(?:\.\d{1,4})?$/.test(rate.value)) return null
  const quote = facts.nominalAmountEvidenceQuote
  const principal = quote && supportsQuote(quote) ? findLoanQuoteAmount(quote, 'principal') : null
  const nominalVnd = principal ?? facts.nominalAmountVnd
  if (!nominalVnd || !/^\d{1,16}(?:\.\d{1,2})?$/.test(nominalVnd)) return null

  let upfrontFeeVnd = new Decimal(0)
  for (const { amountVnd, evidenceQuote } of facts.upfrontFees) {
    if (!supportsQuote(evidenceQuote)) continue
    const fee = findLoanQuoteAmount(evidenceQuote, 'fee') ?? amountVnd
    if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(fee)) return null
    upfrontFeeVnd = upfrontFeeVnd.plus(fee)
  }
  return {
    principalNominalVnd: nominalVnd,
    upfrontFeeVnd: upfrontFeeVnd.toFixed(),
    flatMonthlyRatePct: rate.value,
    termMonths: term.value,
    evidenceQuote: rate.evidenceQuote,
  }
}
