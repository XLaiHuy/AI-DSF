import Decimal from 'decimal.js'
import { catalogInstitutions } from '../../common/catalog-institutions'
import type { PrismaService } from '../../common/prisma.service'
import { classifyProductFreshness, compareCatalogQuality, readProductSnapshot } from '../survey-calc/product-catalog'

type Category = 'UNSECURED_LOAN' | 'SECURED_LOAN' | 'SAVING'
type ReferenceRow = {
  nominalRateMin: { toFixed(): string }
  nominalRateMax: { toFixed(): string }
  effectiveDate: Date | string
  dataProvenance: string
}
const Precise = Decimal.clone({ precision: 40 })

export function decimalMedian(values: Decimal[]) {
  const sorted = [...values].sort((a, b) => a.cmp(b))
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : sorted[middle - 1].add(sorted[middle]).div(2)
}

export async function copilotReferenceRate(prisma: PrismaService, productCategory: Category, termMonths: number) {
  const now = new Date()
  let rows: ReferenceRow[] = []
  let fromSnapshot = false
  try {
    rows = await prisma.financialProduct.findMany({
      where: { isActive: true, productCategory, minTermMonths: { lte: termMonths }, maxTermMonths: { gte: termMonths },
        effectiveDate: { lte: now }, dataProvenance: { in: ['CATALOG_VERIFIED', 'WEB_REFERENCE'] },
        institution: { trustStatus: 'LICENSED', institutionType: 'BANK', licenseIssuer: 'NHNN' } },
      select: { nominalRateMin: true, nominalRateMax: true, dataProvenance: true, effectiveDate: true },
    })
  } catch {
    fromSnapshot = true
    const bankCodes = new Set(catalogInstitutions.filter(item => item.institutionType === 'BANK' && item.licenseIssuer === 'NHNN')
      .map(item => item.code))
    const snapshot = await readProductSnapshot().catch(() => [])
    rows = snapshot.filter(item => bankCodes.has(item.institutionCode) && item.productCategory === productCategory &&
      item.minTermMonths <= termMonths && item.maxTermMonths >= termMonths && new Date(item.effectiveDate) <= now)
      .map(item => ({ ...item, nominalRateMin: new Precise(item.nominalRateMin), nominalRateMax: new Precise(item.nominalRateMax) }))
  }
  const ranked = rows.map(item => ({ ...item, freshnessTier: classifyProductFreshness(item.effectiveDate, now) }))
    .sort(compareCatalogQuality)
  if (!ranked.length) return undefined
  const comparable = ranked.filter(row => compareCatalogQuality(row, ranked[0]) === 0)
  const rate = decimalMedian(comparable.map(row =>
    new Precise(row.nominalRateMin.toFixed()).plus(row.nominalRateMax.toFixed()).div(2)))
  const source = ranked[0].dataProvenance === 'CATALOG_VERIFIED' ? 'gói đã xác minh' : 'mức lãi công bố để tham khảo'
  const summary = 'Dùng trung vị ' + comparable.length + ' ' + source +
    (fromSnapshot ? ' trong bản lưu ngoại tuyến.' : ' từ ngân hàng được cấp phép.') +
    (ranked[0].freshnessTier === 'STALE' ? ' Dữ liệu quá 60 ngày. Hãy đối chiếu lãi hiện hành.' : '')
  return { rate: rate.toFixed(), summary }
}
