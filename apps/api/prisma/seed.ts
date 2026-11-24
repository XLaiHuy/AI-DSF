import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { parse } from 'yaml'

const prisma = new PrismaClient()
const sourceConfig = parse(readFileSync(resolve(__dirname, '../../../config/sources.yaml'), 'utf8')) as {
  sources: Array<{ sourceKey: string; name: string; sourceType: string; endpointUrl: string; isTrustedForAlerts: boolean }>
}

type InstitutionSeed = {
  code: string; name: string; institutionType: string; licenseIssuer: string; vietqrBin: string | null; officialWebsite: string
}

type ProductSeed = {
  institutionCode: string; productCategory: string; productName: string; calcMethod: string; rateType: string
  nominalRateMin: string; nominalRateMax: string; promoMonths?: number | null
}

// Names, classifications, BINs and indicative rates follow the project seed table
// in docs/specs/05_Agent_Coding_Spec.md. License IDs and product-level source URLs
// were not supplied there, so these fixtures are explicitly non-production data.
const institutions: InstitutionSeed[] = [
  { code: 'VCB', name: 'Vietcombank', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970436', officialWebsite: 'https://www.vietcombank.com.vn/' },
  { code: 'BIDV', name: 'BIDV', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970418', officialWebsite: 'https://www.bidv.com.vn/' },
  { code: 'CTG', name: 'VietinBank', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970415', officialWebsite: 'https://www.vietinbank.vn/' },
  { code: 'AGR', name: 'Agribank', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970405', officialWebsite: 'https://www.agribank.com.vn/' },
  { code: 'TCB', name: 'Techcombank', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970407', officialWebsite: 'https://www.techcombank.com.vn/' },
  { code: 'MBB', name: 'MBBank', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970422', officialWebsite: 'https://www.mbbank.com.vn/' },
  { code: 'ACB', name: 'ACB', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970416', officialWebsite: 'https://www.acb.com.vn/' },
  { code: 'VPB', name: 'VPBank', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970432', officialWebsite: 'https://www.vpbank.com.vn/' },
  { code: 'TPB', name: 'TPBank', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970423', officialWebsite: 'https://tpb.vn/' },
  { code: 'VIB', name: 'VIB', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970441', officialWebsite: 'https://www.vib.com.vn/' },
  { code: 'FEC', name: 'FE Credit', institutionType: 'FINANCE_COMPANY', licenseIssuer: 'NHNN', vietqrBin: null, officialWebsite: 'https://www.fecredit.com.vn/' },
  { code: 'HMC', name: 'Home Credit Việt Nam', institutionType: 'FINANCE_COMPANY', licenseIssuer: 'NHNN', vietqrBin: null, officialWebsite: 'https://www.homecredit.vn/' },
  { code: 'MCR', name: 'Mcredit (MB Shinsei)', institutionType: 'FINANCE_COMPANY', licenseIssuer: 'NHNN', vietqrBin: null, officialWebsite: 'https://www.mcredit.com.vn/' },
  { code: 'HDS', name: 'HD SAISON', institutionType: 'FINANCE_COMPANY', licenseIssuer: 'NHNN', vietqrBin: null, officialWebsite: 'https://www.hdsaison.com.vn/' },
  { code: 'MOMO_TTT', name: 'Ví / Túi Thần Tài (đối tác tích lũy)', institutionType: 'EWALLET', licenseIssuer: 'NHNN', vietqrBin: null, officialWebsite: 'https://www.momo.vn/' },
  { code: 'VCBF', name: 'Quỹ mở VCBF', institutionType: 'FUND_HOUSE', licenseIssuer: 'UBCKNN', vietqrBin: null, officialWebsite: 'https://www.vcbf.com/' },
  { code: 'VINA', name: 'VinaCapital', institutionType: 'FUND_HOUSE', licenseIssuer: 'UBCKNN', vietqrBin: null, officialWebsite: 'https://vinacapital.com/' },
  { code: 'DCVFM', name: 'Dragon Capital Việt Nam', institutionType: 'FUND_HOUSE', licenseIssuer: 'UBCKNN', vietqrBin: null, officialWebsite: 'https://www.dragoncapital.com.vn/' },
]

// Rates are the approximate examples documented by the project, not current offers.
// All seeded products remain inactive until a reviewer supplies a product-specific
// source URL, effective date, amount/term bounds and confirms the rate/provenance.
const products: ProductSeed[] = [
  { institutionCode: 'VCB', productCategory: 'UNSECURED_LOAN', productName: 'Vay tín chấp lương (mẫu)', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', nominalRateMin: '12.9', nominalRateMax: '12.9' },
  { institutionCode: 'VCB', productCategory: 'SAVING', productName: 'Tiết kiệm (mẫu)', calcMethod: 'COMPOUND_DCA', rateType: 'FIXED', nominalRateMin: '4.7', nominalRateMax: '5.0' },
  { institutionCode: 'BIDV', productCategory: 'SECURED_LOAN', productName: 'Vay thế chấp bất động sản ưu đãi (mẫu)', calcMethod: 'REDUCING_BALANCE', rateType: 'PROMO_THEN_FLOATING', nominalRateMin: '7.5', nominalRateMax: '7.5' },
  { institutionCode: 'BIDV', productCategory: 'SAVING', productName: 'Tiết kiệm (mẫu)', calcMethod: 'COMPOUND_DCA', rateType: 'FIXED', nominalRateMin: '4.8', nominalRateMax: '4.8' },
  { institutionCode: 'CTG', productCategory: 'UNSECURED_LOAN', productName: 'Vay tiêu dùng tín chấp (mẫu)', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', nominalRateMin: '13.2', nominalRateMax: '13.2' },
  { institutionCode: 'CTG', productCategory: 'SAVING', productName: 'Tiết kiệm (mẫu)', calcMethod: 'COMPOUND_DCA', rateType: 'FIXED', nominalRateMin: '4.8', nominalRateMax: '4.8' },
  { institutionCode: 'AGR', productCategory: 'UNSECURED_LOAN', productName: 'Vay tiêu dùng / nông nghiệp (mẫu)', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', nominalRateMin: '11.5', nominalRateMax: '11.5' },
  { institutionCode: 'AGR', productCategory: 'SAVING', productName: 'Tiết kiệm (mẫu)', calcMethod: 'COMPOUND_DCA', rateType: 'FIXED', nominalRateMin: '4.8', nominalRateMax: '4.8' },
  { institutionCode: 'TCB', productCategory: 'UNSECURED_LOAN', productName: 'Vay tín chấp thả nổi (mẫu)', calcMethod: 'REDUCING_BALANCE', rateType: 'FLOATING', nominalRateMin: '15.2', nominalRateMax: '15.2' },
  { institutionCode: 'TCB', productCategory: 'SAVING', productName: 'Tiết kiệm trực tuyến (mẫu)', calcMethod: 'COMPOUND_DCA', rateType: 'FIXED', nominalRateMin: '5.1', nominalRateMax: '5.1' },
  { institutionCode: 'MBB', productCategory: 'SECURED_LOAN', productName: 'Vay thế chấp cố định 24 tháng (mẫu)', calcMethod: 'REDUCING_BALANCE', rateType: 'PROMO_THEN_FLOATING', nominalRateMin: '8.4', nominalRateMax: '8.4', promoMonths: 24 },
  { institutionCode: 'MBB', productCategory: 'UNSECURED_LOAN', productName: 'Vay nhanh trên ứng dụng (mẫu)', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', nominalRateMin: '15.8', nominalRateMax: '15.8' },
  { institutionCode: 'ACB', productCategory: 'UNSECURED_LOAN', productName: 'Vay tín chấp cố định (mẫu)', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', nominalRateMin: '14.5', nominalRateMax: '14.5' },
  { institutionCode: 'ACB', productCategory: 'SAVING', productName: 'Tiết kiệm (mẫu)', calcMethod: 'COMPOUND_DCA', rateType: 'FIXED', nominalRateMin: '5.0', nominalRateMax: '5.0' },
  { institutionCode: 'VPB', productCategory: 'UNSECURED_LOAN', productName: 'Vay tín chấp trực tuyến (mẫu)', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', nominalRateMin: '17.0', nominalRateMax: '17.0' },
  { institutionCode: 'VPB', productCategory: 'SAVING', productName: 'Tiết kiệm (mẫu)', calcMethod: 'COMPOUND_DCA', rateType: 'FIXED', nominalRateMin: '5.3', nominalRateMax: '5.3' },
  { institutionCode: 'TPB', productCategory: 'UNSECURED_LOAN', productName: 'Vay tiêu dùng (mẫu)', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', nominalRateMin: '16.5', nominalRateMax: '16.5' },
  { institutionCode: 'TPB', productCategory: 'SAVING', productName: 'Tiết kiệm LiveBank (mẫu)', calcMethod: 'COMPOUND_DCA', rateType: 'FIXED', nominalRateMin: '5.2', nominalRateMax: '5.2' },
  { institutionCode: 'VIB', productCategory: 'SECURED_LOAN', productName: 'Vay thế chấp mua xe/nhà (mẫu)', calcMethod: 'REDUCING_BALANCE', rateType: 'PROMO_THEN_FLOATING', nominalRateMin: '8.2', nominalRateMax: '8.2' },
  { institutionCode: 'VIB', productCategory: 'SAVING', productName: 'Tiết kiệm (mẫu)', calcMethod: 'COMPOUND_DCA', rateType: 'FIXED', nominalRateMin: '5.1', nominalRateMax: '5.1' },
  { institutionCode: 'FEC', productCategory: 'UNSECURED_LOAN', productName: 'Vay tiền mặt công ty tài chính (mẫu)', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', nominalRateMin: '32.0', nominalRateMax: '38.0' },
  { institutionCode: 'HMC', productCategory: 'UNSECURED_LOAN', productName: 'Vay tiền mặt tiêu chuẩn (mẫu)', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', nominalRateMin: '28.0', nominalRateMax: '28.0' },
  { institutionCode: 'MCR', productCategory: 'UNSECURED_LOAN', productName: 'Vay tiêu dùng tiền mặt (mẫu)', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', nominalRateMin: '26.5', nominalRateMax: '26.5' },
  { institutionCode: 'HDS', productCategory: 'UNSECURED_LOAN', productName: 'Vay trả góp tiêu dùng (mẫu)', calcMethod: 'REDUCING_BALANCE', rateType: 'FIXED', nominalRateMin: '29.5', nominalRateMax: '29.5' },
  { institutionCode: 'MOMO_TTT', productCategory: 'ACCUMULATION', productName: 'Tích lũy linh hoạt (mẫu)', calcMethod: 'COMPOUND_DCA', rateType: 'FIXED', nominalRateMin: '5.0', nominalRateMax: '5.5' },
  { institutionCode: 'VCBF', productCategory: 'OPEN_FUND', productName: 'VCBF-FIF trái phiếu (mẫu)', calcMethod: 'COMPOUND_DCA', rateType: 'VARIABLE_NAV', nominalRateMin: '7.6', nominalRateMax: '7.6' },
  { institutionCode: 'VCBF', productCategory: 'OPEN_FUND', productName: 'VCBF-TBF cân bằng (mẫu)', calcMethod: 'COMPOUND_DCA', rateType: 'VARIABLE_NAV', nominalRateMin: '10.0', nominalRateMax: '10.0' },
  { institutionCode: 'VINA', productCategory: 'OPEN_FUND', productName: 'VESAF cổ phiếu (mẫu)', calcMethod: 'COMPOUND_DCA', rateType: 'VARIABLE_NAV', nominalRateMin: '13.5', nominalRateMax: '13.5' },
  { institutionCode: 'VINA', productCategory: 'OPEN_FUND', productName: 'VFF trái phiếu (mẫu)', calcMethod: 'COMPOUND_DCA', rateType: 'VARIABLE_NAV', nominalRateMin: '7.5', nominalRateMax: '7.5' },
  { institutionCode: 'DCVFM', productCategory: 'OPEN_FUND', productName: 'DCDS đầu tư năng động (mẫu)', calcMethod: 'COMPOUND_DCA', rateType: 'VARIABLE_NAV', nominalRateMin: '12.8', nominalRateMax: '12.8' },
  { institutionCode: 'DCVFM', productCategory: 'OPEN_FUND', productName: 'DCBF trái phiếu (mẫu)', calcMethod: 'COMPOUND_DCA', rateType: 'VARIABLE_NAV', nominalRateMin: '7.4', nominalRateMax: '7.4' },
]

function stableUuid(key: string): string {
  const bytes = createHash('sha1').update(`fincopilot-seed:${key}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function seed() {
  try {
    await prisma.$connect()

    const sourcesByKey = new Map<string, string>()
    for (const source of sourceConfig.sources) {
      const row = await prisma.marketSource.upsert({
        where: { sourceKey: source.sourceKey },
        create: { id: stableUuid(`source:${source.sourceKey}`), ...source, isActive: true },
        update: { name: source.name, sourceType: source.sourceType, endpointUrl: source.endpointUrl, isTrustedForAlerts: source.isTrustedForAlerts, isActive: true },
        select: { id: true },
      })
      sourcesByKey.set(source.sourceKey, row.id)
    }

    const institutionIds = new Map<string, string>()
    for (const institution of institutions) {
      const row = await prisma.financialInstitution.upsert({
        where: { code: institution.code },
        create: {
          id: stableUuid(`institution:${institution.code}`), ...institution,
          licenseNumber: 'NOT_PROVIDED_IN_PROJECT_SPEC', trustStatus: 'LICENSED',
        },
        update: {
          name: institution.name, institutionType: institution.institutionType,
          licenseIssuer: institution.licenseIssuer, officialWebsite: institution.officialWebsite,
          vietqrBin: institution.vietqrBin,
        },
        select: { id: true },
      })
      institutionIds.set(institution.code, row.id)
    }

    const effectiveDate = new Date('2026-01-01T00:00:00.000Z')
    for (const product of products) {
      const institutionId = institutionIds.get(product.institutionCode)
      const institution = institutions.find((item) => item.code === product.institutionCode)
      if (!institutionId || !institution) throw new Error(`Missing institution seed for ${product.institutionCode}`)
      const id = stableUuid(`product:${product.institutionCode}:${product.productName}`)
      await prisma.financialProduct.upsert({
        where: { id },
        create: {
          id, institutionId, productCategory: product.productCategory, productName: product.productName,
          calcMethod: product.calcMethod, rateType: product.rateType,
          nominalRateMin: product.nominalRateMin, nominalRateMax: product.nominalRateMax,
          promoMonths: product.promoMonths ?? null, minAmountVnd: '1', maxAmountVnd: '9999999999999999',
          minTermMonths: 1, maxTermMonths: 600, sourceUrl: institution.officialWebsite,
          effectiveDate, dataProvenance: 'WEB_REFERENCE', isActive: false,
        },
        update: {
          institutionId, productCategory: product.productCategory, productName: product.productName,
          calcMethod: product.calcMethod, rateType: product.rateType,
          nominalRateMin: product.nominalRateMin, nominalRateMax: product.nominalRateMax,
          promoMonths: product.promoMonths ?? null, minAmountVnd: '1', maxAmountVnd: '9999999999999999',
          minTermMonths: 1, maxTermMonths: 600, sourceUrl: institution.officialWebsite,
          effectiveDate, dataProvenance: 'WEB_REFERENCE', isActive: false,
        },
      })
    }

    // An unpublished, explicitly marked fixture exercises the evidence and indicator
    // relations without presenting a fabricated NCSC warning as a real public alert.
    const ncscSourceId = sourcesByKey.get('ncsc')
    if (ncscSourceId) {
      const articleId = stableUuid('demo:ncsc-article')
      const alertId = stableUuid('demo:ncsc-alert')
      const articleUrl = 'https://example.invalid/fincopilot-demo/ncsc-warning'
      const articleTitle = '[DEMO — CHƯA XÁC MINH] Ví dụ cảnh báo mạo danh tổ chức tài chính'
      const contentHash = createHash('sha256').update(articleTitle).digest('hex')
      await prisma.marketArticle.upsert({
        where: { canonicalUrl: articleUrl },
        create: { id: articleId, canonicalUrl: articleUrl, title: articleTitle, contentHash, feedStatus: 'ACTIVE' },
        update: { title: articleTitle, contentHash, feedStatus: 'ACTIVE' },
      })
      await prisma.articleSource.upsert({
        where: { articleId_sourceId: { articleId, sourceId: ncscSourceId } },
        create: { articleId, sourceId: ncscSourceId, sourceUrl: articleUrl, normalizedSourceUrl: articleUrl, firstSeenAt: effectiveDate, lastSeenAt: effectiveDate },
        update: { lastSeenAt: effectiveDate },
      })
      await prisma.threatAlert.upsert({
        where: { id: alertId },
        create: {
          id: alertId, threatCategory: 'IMPERSONATION', tacticSummary: 'DEMO — Mạo danh yêu cầu phí trước khi giải ngân',
          preventionGuidance: 'Mẫu dữ liệu thử nghiệm, không phải cảnh báo thật. Không chuyển phí hoặc cung cấp OTP khi chưa xác minh qua kênh chính thức.',
          verificationStatus: 'UNVERIFIED', issuedAt: null, publishedAt: null, verifiedAt: null,
        },
        update: { verificationStatus: 'UNVERIFIED', issuedAt: null, publishedAt: null, verifiedAt: null },
      })
      await prisma.threatEvidence.upsert({
        where: { threatAlertId_articleId_sourceId: { threatAlertId: alertId, articleId, sourceId: ncscSourceId } },
        create: { threatAlertId: alertId, articleId, sourceId: ncscSourceId }, update: {},
      })
      const indicatorId = stableUuid('demo:ncsc-indicator:error-102')
      await prisma.threatIndicator.upsert({
        where: { id: indicatorId },
        create: { id: indicatorId, threatAlertId: alertId, indicatorType: 'KEYWORD', indicatorText: '[DEMO] lỗi 102' },
        update: { indicatorText: '[DEMO] lỗi 102', indicatorType: 'KEYWORD' },
      })
    }

    console.info(`Seeded ${sourceConfig.sources.length} Radar sources, ${institutions.length} institutions, ${products.length} inactive reference products, and one unpublished demo alert.`)
  } finally {
    await prisma.$disconnect()
  }
}

void seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seed failed')
  process.exitCode = 1
})
