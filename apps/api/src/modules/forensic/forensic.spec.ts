import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { ConfigService } from '@nestjs/config'
import sharp from 'sharp'
import { prepareZXingModule, writeBarcode } from 'zxing-wasm/writer'
import { maskAccount, maskPii } from '../../common/pii-masker'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { validateFiles } from './file-guard'
import { extractAuditEvidence } from './forensic-extraction'
import { statedTransferAmount } from './forensic-follow-up'
import { calculateFlatRateApr, evaluateHardRules, findLoanTerms } from './hard-rules.engine'
import { extractPdf } from './pdf-extractor'
import * as pdfExtractor from './pdf-extractor'
import { decodeVietQr, parseVietQr } from './vietqr-parser'

const QR1 = '00020101021238540010A00000072701240006970422011009876543210208QRIBFTTA5303704540725000005802VN62250821PHI GIAI NGAN LOI 1026304CA92'
const QR2 = '00020101021138540010A00000072701240006970436011010123456780208QRIBFTTA53037045802VN62230819COC HO SO VAY NHANH630415DB'
const indicator = { id: 'a2714a2a-f21c-4c57-a1cc-ebfe63bd320e', indicatorText: '0987654321', indicatorType: 'BANK_ACCOUNT' }

describe('periodic loans and evasive payment wording', () => {
  const inspect = (source: string, options: Partial<Parameters<typeof evaluateHardRules>[0]> = {}) =>
    evaluateHardRules({ evidence: [source], claimedEntityName: null, qrPayloads: [], institutions: [], indicators: [], ...options })

  it.each([
    ['Vay 10 000 000 đ, góp 400 000 đ/ngày trong 30 ngày.', 'DAY', 30, '400000', '444.9652', '8232.4913'],
    ['Vay 10 triệu, trả góp 1,5 triệu/tuần trong 10 tuần.', 'WEEK', 10, '1500000', '424.6601', '5829.5057'],
  ])('annualizes the actual repayment cadence for %s', (source, unit, count, paymentVnd, effectiveAprPct, effectiveEarPct) => {
    const report = inspect(source)
    expect(report.mathBreakdown).toMatchObject({
      periodicRepayment: { unit, count, paymentVnd }, effectiveAprPct, effectiveEarPct,
      legalReference: { status: 'POTENTIAL_USURY_CRIME', lawCitation: expect.stringContaining('Điều 201') },
    })
    expect(report.mathBreakdown?.monthlyPaymentVnd).toBeUndefined()
    expect(report.findings.map(({ ruleCode }) => ruleCode)).toContain('RULE_06_FLAT_RATE_AND_USURY_APR')
  })

  it('does not treat weeks as days when duration evidence conflicts', () => {
    expect(inspect('Vay 10 triệu, trả góp 1,5 triệu/tuần trong 30 ngày.').mathBreakdown).toBeNull()
  })

  it.each(['l0i 102', 'l.o.i 1-0-2', 'loi 1 0 2'])('matches the freeze evidence %s', (source) => {
    expect(inspect(source + ', nộp tiền ngay.').findings).toContainEqual(expect.objectContaining({
      ruleCode: 'RULE_02_ERROR_102_FREEZE_TRAP', evidenceQuote: expect.stringContaining(source),
    }))
  })

  it.each(['chuyển hộ', 'chuyển giùm', 'chuyển giúp', 'nhờ chuyển'])('recognizes large transfers with %s', (verb) => {
    const source = 'Chị kế toán ' + verb + ' 45tr gấp vào STK cá nhân.'
    expect(statedTransferAmount(source)).toBe('45000000')
    expect(inspect(source, { statedTransferAmountVnd: statedTransferAmount(source) }).findings)
      .toContainEqual(expect.objectContaining({ ruleCode: 'RULE_16_TRANSFER_AMOUNT_REVIEW' }))
  })

  it.each(['0,5%/ngày', '3%/tuần', '10%/tháng'])('matches promised returns at %s', (rate) => {
    expect(inspect('Cam kết lợi nhuận cố định ' + rate).findings).toContainEqual(expect.objectContaining({
      ruleCode: 'RULE_07_PONZI_UNREALISTIC_RETURN',
    }))
  })

  it('distinguishes funded task rewards from ordinary commerce and recovery advice', () => {
    expect(inspect('Chốt đơn hộ, nạp tiền để nhận hoa hồng.').verdictLevel).toBe('HIGH_RISK')
    expect(inspect('Chốt đơn mua đồ trên sàn, cửa hàng hoàn tiền mua hàng.').findings).toEqual([])
    const intentSignals = { provider: 'fixture', recoveryScamProb: 0.7, biometricPhishingProb: 0, urgentCoercionProb: 0 }
    expect(inspect('Nếu chuyển nhầm, liên hệ ngân hàng và lưu biên lai. Không trả phí để lấy lại tiền.', { intentSignals }).findings).toEqual([])
    expect(inspect('Bên kia hứa thu hồi tiền, yêu cầu ký quỹ hoàn trả.').findings).toContainEqual(expect.objectContaining({
      ruleCode: 'RULE_08_RECOVERY_SCAM_TRAP', severity: 'CRITICAL',
    }))
    expect(inspect('Bên kia hứa thu hồi tiền.', { intentSignals }).findings).toContainEqual(expect.objectContaining({
      ruleCode: 'RULE_08_RECOVERY_SCAM_TRAP', severity: 'HIGH',
    }))
  })
})

describe('golden vector V5', () => {
  it.each([
    [QR1, '970422', 'MBBank', '0987654321', '2500000', 'PHI GIAI NGAN LOI 102'],
    [QR2, '970436', 'Vietcombank', '1012345678', null, 'COC HO SO VAY NHANH'],
  ])('decodes valid EMVCo/NAPAS content', (raw, acqBin, bankName, account, amountVnd, purpose) => {
    expect(parseVietQr(raw)).toMatchObject({
      acqBin, bankName, account, serviceCode: 'QRIBFTTA', amountVnd, purpose, crcValid: true,
    })
  })

  it('detects CRC tampering and rejects invalid nested lengths', () => {
    expect(parseVietQr(QR1.slice(0, -1) + '0')?.crcValid).toBe(false)
    expect(parseVietQr(QR1.replace('3854', '3850'))).toBeNull()
  })

  it.each([
    ['00020101021238540010A000000727012600069704220112VCB0001234560206QRPUSH53037045802VN62110807HOA DON630476DB', 'MERCHANT'],
    ['00020101021238600010A00000072701300006970422011697042211122233330208QRIBFTTC53037045802VN62140810THANH TOAN630475B8', 'QRIBFTTC'],
  ])('distinguishes card transfers and merchant payments', (raw, serviceCode) => {
    expect(parseVietQr(raw)).toMatchObject({ crcValid: true, serviceCode })
  })

  it('decodes a QR rendered as PNG through the installed native and WASM libraries', async () => {
    const bytes = readFileSync(require.resolve('zxing-wasm/writer/zxing_writer.wasm'))
    prepareZXingModule({ overrides: { wasmBinary: Uint8Array.from(bytes).buffer } })
    const { image } = await writeBarcode(QR1, { format: 'QRCode', scale: 5 })
    expect(image).not.toBeNull()
    const png = Buffer.from(await image!.arrayBuffer())
    await expect(decodeVietQr(png)).resolves.toMatchObject({ crcValid: true, bankName: 'MBBank', amountVnd: '2500000' })
  })
})

const loan = {
  principalNominalVnd: '50000000', upfrontFeeVnd: '5000000', flatMonthlyRatePct: '0.9',
  termMonths: 24, evidenceQuote: 'Lãi phẳng 0.9%/tháng',
}

describe('golden vector V2', () => {
  it('extracts a term phrased directly after the loan amount', () => {
    const source = 'Khoản vay 50.000.000 VNĐ trong 24 tháng. Lãi phẳng 0.9%/tháng. Phí thu trước 5.000.000 VNĐ, khấu trừ vào khoản thực nhận.'
    expect(findLoanTerms(source)).toEqual(loan)
  })

  it('calculates net principal, APR and EAR exclusively from cash flows', () => {
    expect(calculateFlatRateApr(loan)).toMatchObject({
      principalNetVnd: '45000000', effectiveAprPct: '30.7436', effectiveEarPct: '35.4678',
      termMonths: 24, monthlyPaymentVnd: '2533333', totalPayableVnd: '60800000', totalExtraCostVnd: '15800000',
      flatRateExplainer: expect.stringContaining('ban đầu'),
      legalReference: { status: 'EXCEEDS_CIVIL_CEILING', lawCitation: expect.stringContaining('Điều 468'),
        legalCeilingPct: '20.00', excessOverCeilingPct: '10.74', multipleOfCeiling: '1.54' },
    })
    expect(calculateFlatRateApr({ ...loan, upfrontFeeVnd: '50000000' })).toBeNull()
    expect(calculateFlatRateApr({ ...loan, upfrontFeeVnd: '0', flatMonthlyRatePct: '0' }))
      .toMatchObject({ effectiveAprPct: '0.0000', effectiveEarPct: '0.0000' })
  })

  it('distinguishes the civil benchmark, possible usury review, and supervised credit institutions', () => {
    expect(calculateFlatRateApr({ ...loan, upfrontFeeVnd: '0', flatMonthlyRatePct: '0' })?.legalReference)
      .toMatchObject({ status: 'WITHIN_CIVIL_LIMIT', excessOverCeilingPct: '-20.00', multipleOfCeiling: '0.00' })
    expect(calculateFlatRateApr({ ...loan, flatMonthlyRatePct: '10' })?.legalReference)
      .toMatchObject({ status: 'POTENTIAL_USURY_CRIME', lawCitation: expect.stringContaining('Điều 201'), plainSummary: expect.stringContaining('thu lợi bất chính') })
    expect(calculateFlatRateApr(loan, { issuer: 'NHNN', status: 'LICENSED' })?.legalReference)
      .toMatchObject({ status: 'REGULATED_INSTITUTION_EXEMPT', lawCitation: expect.stringContaining('Luật Các tổ chức tín dụng 2024'), legalCeilingPct: null })
    expect(calculateFlatRateApr(loan, { issuer: 'UBCKNN', status: 'LICENSED' })?.legalReference?.status)
      .toBe('EXCEEDS_CIVIL_CEILING')
    expect(calculateFlatRateApr(loan, { issuer: 'NHNN', status: 'LICENSED', institutionType: 'EWALLET' })?.legalReference?.status)
      .toBe('EXCEEDS_CIVIL_CEILING')
    expect(calculateFlatRateApr({ ...loan, principalNominalVnd: '100.75', upfrontFeeVnd: '0', flatMonthlyRatePct: '0' }))
      .toMatchObject({ totalPayableVnd: '101', totalExtraCostVnd: '0.25' })
  })

  it('uses the exact 20% and 100% threshold boundaries', () => {
    const oneMonth = { ...loan, termMonths: 1, flatMonthlyRatePct: '0' }
    expect(calculateFlatRateApr({ ...oneMonth, principalNominalVnd: '6100', upfrontFeeVnd: '100' }))
      .toMatchObject({ effectiveAprPct: '20.0000', legalReference: { status: 'WITHIN_CIVIL_LIMIT', excessOverCeilingPct: '0.00' } })
    expect(calculateFlatRateApr({ ...oneMonth, principalNominalVnd: '13000', upfrontFeeVnd: '1000' }))
      .toMatchObject({ effectiveAprPct: '100.0000', legalReference: { status: 'POTENTIAL_USURY_CRIME', multipleOfCeiling: '5.00' } })
  })

  it('extracts terms and preserves their source quote', () => {
    const source = 'Vay 50 triệu đồng. Lãi phẳng 0,9%/tháng, trừ trước 5 triệu đồng, kỳ hạn 24 tháng.'
    expect(findLoanTerms(source)).toMatchObject({
      principalNominalVnd: '50000000', upfrontFeeVnd: '5000000', flatMonthlyRatePct: '0.9', termMonths: 24,
    })
    expect(source).toContain(findLoanTerms(source)?.evidenceQuote)
    expect(findLoanTerms('Lãi 14,5%/năm dư nợ giảm dần, kỳ hạn 24 tháng.')).toBeNull()
  })
})

function inspect(overrides: Partial<Parameters<typeof evaluateHardRules>[0]> = {}) {
  return evaluateHardRules({ evidence: [], claimedEntityName: null, qrPayloads: [], indicators: [], institutions: [], ...overrides })
}

describe('11 hard rules', () => {
  it.each([
    ['EWALLET_VN', 'MoMo', 'mã ví điện tử MoMo'],
    ['EMVCO_INTL', 'EMVCo', 'mã QR thanh toán quốc tế (EMVCo)'],
  ] as const)('names the actual payment channel in RULE_01 for %s', (qrScheme, providerLabel, label) => {
    const qr = { ...parseVietQr(QR1)!, qrScheme, providerLabel, currencyCode: 'VND' }
    const result = inspect({ evidence: ['Cần chuyển phí giải ngân để mở khóa khoản vay.'], qrPayloads: [qr] })
    const fee = result.findings.find(({ ruleCode }) => ruleCode === 'RULE_01_UPFRONT_FEE_QR')
    expect(fee?.title).toContain(label)
    expect(fee?.description).toContain(label)
    expect(fee?.description).not.toContain('VietQR')
  })
  it('locks the error 102 sample at 95 with a verified indicator fixture', () => {
    const qr = parseVietQr(QR1)!
    const result = inspect({
      claimedEntityName: 'Công ty Tài chính ABC',
      evidence: ['cần chuyển 2.500.000đ phí bảo hiểm mở khóa giải ngân vì lỗi 102'],
      qrPayloads: [{ ...qr, visionBeneficiaryName: 'NGUYEN VAN HUNG' }],
      indicators: [indicator],
    })
    expect(result.findings.map((f) => f.ruleCode)).toEqual([
      'RULE_01_UPFRONT_FEE_QR', 'RULE_02_ERROR_102_FREEZE_TRAP', 'RULE_03_ENTITY_MISMATCH',
      'RULE_04_UNLICENSED_OR_IMPERSONATION', 'RULE_05_NCSC_THREAT_MATCH',
    ])
    expect(result.findings[4]?.matchedIndicatorId).toBe(indicator.id)
    expect(result).toMatchObject({ riskScore: 95, deterministicOverride: true, verdictLevel: 'HIGH_RISK' })
  })

  it('scores the unverified lender and flat APR at 72', () => {
    const result = inspect({ evidence: ['Hợp đồng lãi phẳng 0.9%/tháng trừ trước 5tr trên 50tr, thời hạn 24 tháng.'] })
    expect(result.findings.map((f) => f.ruleCode)).toEqual([
      'RULE_04_UNLICENSED_OR_IMPERSONATION', 'RULE_06_FLAT_RATE_AND_USURY_APR',
    ])
    expect(result).toMatchObject({ riskScore: 72, deterministicOverride: false, verdictLevel: 'HIGH_RISK' })
  })

  it('locks a Ponzi promise above 85', () => {
    const source = 'lợi nhuận cố định 25%/tháng, bao lời 100%, hoa hồng F1–F3'
    const result = inspect({ evidence: [source] })
    expect(result.findings).toEqual([expect.objectContaining({
      ruleCode: 'RULE_07_PONZI_UNREALISTIC_RETURN', evidenceQuote: source,
    })])
    expect(result.riskScore).toBeGreaterThanOrEqual(85)
    expect(result).toMatchObject({ deterministicOverride: true, verdictLevel: 'HIGH_RISK' })
  })

  it('accepts the ACB declining-balance case without findings', () => {
    expect(inspect({
      claimedEntityName: 'ACB',
      evidence: ['Vay ACB 50tr / 24 tháng / 14.5%/năm dư nợ giảm dần, không phí thu trước qua QR'],
    })).toMatchObject({ riskScore: 0, findings: [], deterministicOverride: false, verdictLevel: 'SAFE' })
  })

  it('prefers an exact DB institution entry over its fallback aliases', () => {
    const result = inspect({
      claimedEntityName: 'Ngân hàng Thương mại Cổ phần Á Châu',
      institutions: [{ code: 'ACB', name: 'ACB', licenseIssuer: 'NHNN', trustStatus: 'SUSPENDED', vietqrBin: '970416' }],
    })
    expect(result.entityLicense).toEqual({ issuer: 'NHNN', status: 'SUSPENDED' })
    expect(result.findings[0]?.ruleCode).toBe('RULE_04_UNLICENSED_OR_IMPERSONATION')
  })

  it.each([
    ['RULE_08_RECOVERY_SCAM_TRAP', 'Chuyển phí trước để thu hồi tiền đã mất'],
    ['RULE_09_BIOMETRIC_OTP_PHISHING', 'Cung cấp mã OTP và quét khuôn mặt qua link lạ'],
    ['RULE_10_FAKE_EXCHANGE_CRYPTO_CLONE', 'Nạp thêm tiền để mở khóa rút tiền trên sàn crypto'],
    ['RULE_11_DEEPFAKE_URGENT_COERCION', 'Cuộc gọi giả giọng người thân yêu cầu chuyển tiền ngay'],
  ])('triggers %s with a source quote', (ruleCode, evidence) => {
    const result = inspect({ evidence: [evidence] })
    expect(result.findings).toEqual([expect.objectContaining({ ruleCode, evidenceQuote: evidence })])
    expect(result).toMatchObject({ deterministicOverride: true, verdictLevel: 'HIGH_RISK' })
  })

  it('does not treat invalid CRC, loose domain substrings or AI scores alone as evidence', () => {
    expect(inspect({
      evidence: ['https://not-fraud.example/', 'https://safe.example/fraud.example/'],
      qrPayloads: [{ ...parseVietQr(QR1)!, crcValid: false }],
      indicators: [indicator, { ...indicator, indicatorType: 'DOMAIN', indicatorText: 'fraud.example' }],
      intentSignals: { provider: 'openrouter', recoveryScamProb: 1, biometricPhishingProb: 1, urgentCoercionProb: 1 },
    }).findings).toEqual([])
  })

  it('matches a verified account in spaced user text and a domain at a real hostname boundary', () => {
    const accountEvidence = 'Chuyển vào STK 098 765 4321.'
    expect(inspect({ evidence: [accountEvidence], indicators: [indicator] }).findings[0])
      .toMatchObject({ ruleCode: 'RULE_05_NCSC_THREAT_MATCH', evidenceQuote: accountEvidence })
    const domainEvidence = 'Dùng trang (https://login.fraud.example) để tiếp tục.'
    expect(inspect({
      evidence: [domainEvidence], indicators: [{ ...indicator, indicatorType: 'DOMAIN', indicatorText: 'fraud.example' }],
    }).findings[0]).toMatchObject({ ruleCode: 'RULE_05_NCSC_THREAT_MATCH', evidenceQuote: domainEvidence })
  })
})

describe('upload signature guard', () => {
  it.each([
    ['JPEG', Buffer.from([0xff, 0xd8, 0xff])],
    ['PNG', Buffer.from('89504e470d0a1a0a', 'hex')],
    ['WEBP', Buffer.from('524946461000000057454250', 'hex')],
    ['PDF', Buffer.from('%PDF-1.7')],
  ])('recognizes %s from bytes', (kind, buffer) => {
    expect(validateFiles([{ buffer }], 20)).toEqual([kind])
  })

  it('rejects malformed signatures, excess count and oversize', async () => {
    const validate = (files: { buffer: Buffer }[], limit: number) => Promise.resolve().then(() => validateFiles(files, limit))
    const invalidMagic = { response: { errorCode: 'ERR_INVALID_FILE_MAGIC' } }
    await expect(validate([{ buffer: Buffer.from('RIFF0000FAKE') }], 20)).rejects.toMatchObject(invalidMagic)
    await expect(validate([{ buffer: Buffer.from('d24946461000000057454250', 'hex') }], 20)).rejects.toMatchObject(invalidMagic)
    await expect(validate([{ buffer: Buffer.from('89504e470d0a1a00', 'hex') }], 20)).rejects.toMatchObject(invalidMagic)
    const tooLarge = { response: { errorCode: 'ERR_FILE_TOO_LARGE' } }
    await expect(validate([{ buffer: Buffer.alloc(1024 * 1024 + 1) }], 1)).rejects.toMatchObject(tooLarge)
    await expect(validate(Array.from({ length: 7 }, () => ({ buffer: Buffer.alloc(0) })), 20)).rejects.toMatchObject(tooLarge)
  })
})

function makePdf(content: string, count = 1): Buffer {
  const pages = Array.from({ length: count }, (_, index) => index + 5)
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count ' + count + ' /Kids [' + pages.map((id) => id + ' 0 R').join(' ') + '] >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(content) + ' >>\nstream\n' + content + '\nendstream',
    ...pages.map(() => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 321 211] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>'),
  ]
  let body = '%PDF-1.7\n'
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(body)
    body += (index + 1) + ' 0 obj\n' + object + '\nendobj\n'
    return offset
  })
  const xref = Buffer.byteLength(body)
  body += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n'
  body += offsets.map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n').join('')
  body += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'
  return Buffer.from(body)
}

describe('Vision image preparation', () => {
  it('skips short text, parsed contracts and decoded text QR without marking degraded', async () => {
    const ai = new AiGatewayService(new ConfigService())
    const classify = vi.spyOn(ai, 'classifyForensicIntent').mockResolvedValue(null)
    const generated = vi.spyOn(ai, 'generateWithProvider').mockRejectedValue(new Error('offline'))
    const flat = 'Khoản vay 50 000 000 đồng. Kỳ hạn 12 tháng. Lãi phẳng 0,9%/tháng. Phí thu trước 5 000 000 đồng. ' + 'Đọc hợp đồng. '.repeat(8)
    for (const fields of [{ rawText: 'Trả tiền ăn' }, { rawText: flat }, { rawText: 'Cần đối chiếu. '.repeat(20), rawQrString: QR1 }]) {
      const result = await extractAuditEvidence(ai, fields, [], 20, 5)
      expect(result.visionDegraded).toBe(false)
    }
    expect(generated).not.toHaveBeenCalled()
    expect(classify).toHaveBeenCalledTimes(3)
    const unstructured = await extractAuditEvidence(ai, { rawText: 'Có thêm đoạn thông tin tài chính chưa rõ. '.repeat(6) }, [], 20, 5)
    expect(generated).toHaveBeenCalledWith('FORENSIC_VISION_EXTRACT', expect.anything(), expect.anything())
    expect(unstructured.visionDegraded).toBe(true)
  })

  it('classifies masked vision documentTranscript on image-only audits without benchmark observe', async () => {
    const ai = new AiGatewayService(new ConfigService())
    const classify = vi.spyOn(ai, 'classifyForensicIntent').mockResolvedValue(null)
    vi.spyOn(ai, 'generateWithProvider').mockResolvedValue({
      provider: 'fixture',
      output: {
        documentTranscript: 'Chuyển khoản xác minh qua đường link lạ và đọc OTP, SĐT 0901234567',
        redFlagPhrases: [], upfrontFees: [],
      },
    } as never)
    const buffer = await sharp({ create: { width: 80, height: 80, channels: 3, background: 'white' } }).png().toBuffer()
    await extractAuditEvidence(ai, {}, [{ buffer }], 20, 5)
    expect(classify).toHaveBeenCalledOnce()
    expect(classify.mock.calls[0]?.[0]).toContain('đọc OTP')
    expect(classify.mock.calls[0]?.[0]).not.toContain('0901234567')
  })

  it('caps rasterized pages and sends at most eight resized JPEGs, then wipes the buffers', async () => {
    const photo = sharp({ create: { width: 1800, height: 1500, channels: 3, background: 'white' } })
    const files = [
      { buffer: await photo.clone().png().toBuffer() },
      { buffer: await photo.clone().jpeg().toBuffer() },
      { buffer: makePdf('BT /F1 12 Tf 20 80 Td (first) Tj ET', 5) },
      { buffer: makePdf('BT /F1 12 Tf 20 80 Td (second) Tj ET', 5) },
      { buffer: makePdf('BT /F1 12 Tf 20 80 Td (last) Tj ET') },
    ]
    const extract = vi.spyOn(pdfExtractor, 'extractPdf')
    const ai = new AiGatewayService(new ConfigService())
    vi.spyOn(ai, 'classifyForensicIntent').mockResolvedValue(null)
    const sent: Uint8Array[] = []
    const metadata: sharp.Metadata[] = []
    vi.spyOn(ai, 'generateWithProvider').mockImplementation(async (_task, _schema, input) => {
      for (const image of input.images ?? []) {
        if (typeof image === 'string') throw new Error('Expected an image buffer')
        sent.push(image)
        metadata.push(await sharp(image).metadata())
      }
      throw new Error('offline')
    })
    try {
      const evidence = await extractAuditEvidence(ai, {}, files, 20, 5)
      expect(evidence.rawText).toContain('last')
      expect(evidence.visionDegraded).toBe(true)
      const pdfs: Awaited<ReturnType<typeof extractPdf>>[] = await Promise.all(extract.mock.results.map(({ value }) => value))
      expect(pdfs.map(({ images }) => images.length)).toEqual([5, 3, 0])
      expect(metadata).toHaveLength(8)
      expect(metadata.slice(0, 2)).toEqual(Array.from({ length: 2 }, () => expect.objectContaining({ width: 1400, height: 1167 })))
      for (const image of metadata) {
        expect(image.format).toBe('jpeg')
        expect(image.width).toBeLessThanOrEqual(1400)
        expect(image.height).toBeLessThanOrEqual(1400)
      }
      for (const buffer of [...sent, ...files.map(({ buffer }) => buffer), ...pdfs.flatMap(({ images }) => images)]) {
        expect(buffer.every((byte) => byte === 0)).toBe(true)
      }
    } finally {
      extract.mockRestore()
    }
  }, 15_000)
})

describe('PDF extraction', () => {
  it('extracts digital text and rasterizes a sparse scan using canvas', async () => {
    const sentence = 'Digital contract with payment terms and an electronic signature.'
    const paragraphs = [sentence, sentence, sentence]
    const digital = await extractPdf(makePdf('BT /F1 8 Tf 5 160 Td (' + paragraphs.join(') Tj 0 -20 Td (') + ') Tj ET'), 5)
    expect(digital.text.replace(/\s+/g, ' ')).toBe(paragraphs.join(' '))
    expect(digital.images).toHaveLength(0)
    const pdf = makePdf('1 0 0 rg 10 20 90 60 re f')
    const { text, images } = await extractPdf(pdf, 5)
    expect(text).toBe('')
    expect(validateFiles(images.map((buffer) => ({ buffer })), 20)).toEqual(['PNG'])
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
  }, 20_000)

  it('rejects oversized page counts before extraction', async () => {
    await expect(extractPdf(makePdf('', 6), 5)).rejects.toMatchObject({ response: { errorCode: 'ERR_PDF_PAGE_LIMIT' } })
  })
})

describe('masking before persistence', () => {
  it('masks CCCD, CMND, local and international phone, emails and account strings', () => {
    expect(maskPii('CCCD 079123456234, CMND 123456789, 0901234123, +84 912 345 678, alice@domain.com, STK 0012 3456 7890.'))
      .toBe('CCCD 079******234, CMND 123***789, 090****123, +8491****678, a***@domain.com, STK 001******890.')
    expect(maskAccount('0987654321')).toBe('098****321')
    expect(maskPii('CCCD 079.123.456.234, STK VCB000123456')).toBe('CCCD 079******234, STK VCB******456')
    expect(maskPii('Khoản vay 50000000 VND, phí 2.500.000đ, BIN 970422')).toBe('Khoản vay 50000000 VND, phí 2.500.000đ, BIN 970422')
  })
})
