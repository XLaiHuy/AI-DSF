import { AI_TASK_SCHEMAS, type AiTaskOutput, type ForensicAuditFields } from '@fincopilot/shared-types'
import Decimal from 'decimal.js'
import { maskPii } from '../../common/pii-masker'
import type { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { validateFiles } from './file-guard'
import { findLoanTerms, type LoanTerms } from './hard-rules.engine'
import { extractPdf } from './pdf-extractor'
import { decodeVietQr, parseVietQr } from './vietqr-parser'

type Vision = AiTaskOutput<'FORENSIC_VISION_EXTRACT'>
export type Upload = { buffer: Buffer }

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
) {
  const derivedImages: Buffer[] = []
  try {
    const kinds = validateFiles(files, uploadMaxMb)
    const images = files.filter((_, index) => kinds[index] !== 'PDF').map(({ buffer }) => buffer)
    const pdfs = files.filter((_, index) => kinds[index] === 'PDF')
    const manualQr = fields.rawQrString && parseVietQr(fields.rawQrString)
    const [qrExtraction, pdfExtraction] = await Promise.allSettled([
      Promise.all(images.map((image) => decodeVietQr(image).catch(() => null))),
      Promise.allSettled(pdfs.map(async ({ buffer }) => {
        const result = await extractPdf(buffer, pdfMaxPages)
        derivedImages.push(...result.images)
        return result.text
      })),
    ])
    if (qrExtraction.status === 'rejected') throw qrExtraction.reason
    if (pdfExtraction.status === 'rejected') throw pdfExtraction.reason
    const pdfText = pdfExtraction.value.map((result) => {
      if (result.status === 'rejected') throw result.reason
      return result.value
    })
    const qrs = [...new Map([manualQr || null, ...qrExtraction.value]
      .filter((qr) => qr !== null).map((qr) => [qr.raw, qr])).values()]
    const qrPurposes = qrs.flatMap((qr) => qr.crcValid && qr.purpose ? [qr.purpose] : [])
    const rawText = [fields.rawText, ...pdfText].filter(Boolean).join('\n').slice(0, 50_000)
    const aiText = maskPii(rawText)
    const allImages = [...images, ...derivedImages]
    const visionNeeded = allImages.length > 0 || aiText.length > 0
    const visionTask = 'FORENSIC_VISION_EXTRACT'
    const [vision, intentSignals] = await Promise.all([
      visionNeeded
        ? ai.generateWithProvider(visionTask, AI_TASK_SCHEMAS[visionTask], {
          text: aiText || 'Trích dữ kiện từ các ảnh được cung cấp.',
          images: allImages,
        }).catch(() => null)
        : null,
      ai.classifyForensicIntent(maskPii([rawText, ...qrPurposes].join('\n')).slice(0, 12_000)),
    ])
    const supportsQuote = (quote: string) => allImages.length > 0 || aiText.includes(quote)
    const facts = vision?.output
    const beneficiary = facts?.visionBeneficiaryName
    const beneficiaryName = namedBeneficiary(rawText) ?? (beneficiary && supportsQuote(beneficiary.evidenceQuote) &&
      beneficiary.evidenceQuote.includes(beneficiary.value) ? beneficiary.value.trim() : null)
    const entity = facts?.claimedEntityName
    const extractedEntity = entity && supportsQuote(entity.evidenceQuote) &&
      entity.evidenceQuote.includes(entity.value) ? entity.value : null
    const quotes = facts
      ? facts.redFlagPhrases.map(({ evidenceQuote }) => evidenceQuote)
        .concat(facts.upfrontFees.map(({ evidenceQuote }) => evidenceQuote))
        .filter(supportsQuote)
      : []
    return {
      claimedEntityName: (fields.claimedEntityName ?? extractedEntity)?.slice(0, 200) ?? null,
      beneficiaryName,
      evidence: [rawText, ...quotes, ...qrPurposes].filter(Boolean),
      rawText,
      qrPayloads: qrs.map((qr, index) => ({
        ...qr,
        // An OCR name returned for multiple QR images cannot safely be assigned to a specific QR.
        visionBeneficiaryName: qrs.length === 1 && index === 0 ? beneficiaryName : null,
      })),
      channels: [...new Set([
        ...(fields.rawText || fields.rawQrString || fields.claimedEntityName ? ['TEXT'] : []),
        ...(pdfs.length ? ['PDF'] : []),
        ...(images.length ? ['CHAT_IMAGE'] : []),
        ...(qrExtraction.value.some((qr) => qr?.crcValid) ? ['VIETQR_IMAGE'] : []),
      ])],
      loan: findLoanTerms(rawText) ?? (facts ? visualLoanTerms(facts, supportsQuote) : null),
      intentSignals,
      visionProvider: vision?.provider ?? null,
      visionDegraded: visionNeeded && !vision,
    }
  } finally {
    for (const { buffer } of files) buffer.fill(0)
    for (const image of derivedImages) image.fill(0)
  }
}

function visualLoanTerms(facts: Vision, supportsQuote: (quote: string) => boolean): LoanTerms | null {
  const rate = facts.quotedRatePct
  const term = facts.termMonths
  if (facts.rateMethod !== 'FLAT_RATE' || !facts.nominalAmountVnd || !rate || !term ||
    !supportsQuote(rate.evidenceQuote) || !supportsQuote(term.evidenceQuote) ||
    !/tháng|month/i.test(rate.evidenceQuote) || new Decimal(rate.value).lt(0)) return null
  const fees = facts.upfrontFees.filter(({ evidenceQuote }) => supportsQuote(evidenceQuote))
  const upfrontFeeVnd = fees.reduce((sum, { amountVnd }) => sum.plus(amountVnd), new Decimal(0))
  return {
    principalNominalVnd: facts.nominalAmountVnd,
    upfrontFeeVnd: upfrontFeeVnd.toFixed(),
    flatMonthlyRatePct: rate.value,
    termMonths: term.value,
    evidenceQuote: rate.evidenceQuote,
  }
}
