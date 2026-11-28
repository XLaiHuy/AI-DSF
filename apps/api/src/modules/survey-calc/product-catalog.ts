import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Prisma } from '@prisma/client'
import {
  AdminProductSyncResultSchema, CalcMethod, DataProvenance, LoanCategory, LoanUseCase, ProductCategory, RateType, SurveyTermMonthsSchema, type ProductFreshness,
} from '@fincopilot/shared-types'
import { parse } from 'yaml'
import { z } from 'zod'
import { catalogInstitutions, isCatalogSource } from '../../common/catalog-institutions'
import type { PrismaService } from '../../common/prisma.service'
import { stableUuid } from '../../common/stable-uuid'
import { fetchPublicDocument } from '../admin/threat-safety'

const httpsUrl = z.url({ protocol: /^https$/ }).refine((value) => {
  const url = new URL(value)
  return !url.username && !url.password && !url.port
})
const amount = z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/)
const rate = z.string().regex(/^-?\d{1,3}(?:\.\d{1,4})?$/)
const feeRate = rate.refine((value) => new Prisma.Decimal(value).gte(0) && new Prisma.Decimal(value).lte(100))
export const redemptionFeeTiers = z.array(z.object({
  throughMonths: SurveyTermMonthsSchema, ratePct: feeRate,
})).max(12).refine((tiers) => tiers.every((tier, index) => index === 0 || tiers[index - 1].throughMonths < tier.throughMonths))

const productSchema = z.strictObject({
  key: z.string().regex(/^[\w-]+$/), institutionCode: z.string(),
  productName: z.string().trim().min(1).max(200), productCategory: ProductCategory,
  loanUseCase: LoanUseCase.optional(),
  calcMethod: CalcMethod, rateType: RateType, nominalRateMin: rate, nominalRateMax: rate,
  minAmountVnd: amount, maxAmountVnd: amount,
  minTermMonths: SurveyTermMonthsSchema, maxTermMonths: SurveyTermMonthsSchema,
  sourceUrl: httpsUrl, effectiveDate: z.iso.date(), dataProvenance: DataProvenance,
  rateNote: z.string().min(1).max(800),
  promoMonths: SurveyTermMonthsSchema.optional(), floatingMargin: rate.optional(),
  upfrontFeeRate: feeRate.optional(), monthlyFeeVnd: amount.optional(),
  redemptionFeeTiers: redemptionFeeTiers.optional(), investmentTaxPct: feeRate.optional(),
  investmentTaxFreeAfterMonths: SurveyTermMonthsSchema.optional(),
}).refine((entry) => {
  const institution = catalogInstitutions.find(({ code }) => code === entry.institutionCode)
  if (!institution) return false
  const isLoan = LoanCategory.safeParse(entry.productCategory).success
  const cashDeposit = entry.productCategory === 'SAVING' || entry.productCategory === 'ACCUMULATION'
  const maxRate = new Prisma.Decimal(entry.nominalRateMax)
  if ((cashDeposit || isLoan) && new Prisma.Decimal(entry.nominalRateMin).lt(0)) return false
  if ((cashDeposit && maxRate.gt(20)) || (isLoan && institution.institutionType === 'BANK' && maxRate.gt(60))) return false
  if (entry.promoMonths && entry.promoMonths > entry.maxTermMonths) return false
  return (!entry.loanUseCase || LoanCategory.safeParse(entry.productCategory).success) &&
    isCatalogSource(institution, new URL(entry.sourceUrl)) &&
    new Prisma.Decimal(entry.nominalRateMin).lte(entry.nominalRateMax) &&
    new Prisma.Decimal(entry.minAmountVnd).lte(entry.maxAmountVnd) && entry.minTermMonths <= entry.maxTermMonths
})
export const productSnapshotSchema = z.strictObject({ products: z.array(productSchema).min(1) }).refine(
  ({ products }) => new Set(products.map(({ key }) => key)).size === products.length,
)
const sourcesSchema = z.object({
  sources: z.array(z.object({ endpointUrl: httpsUrl, isTrustedForRates: z.boolean() })),
})
const configDir = resolve(__dirname, '../../../../../config')
const dayMs = 86_400_000

export function catalogProductAgeDays(effectiveDate: Date | string, now = new Date()) {
  return Math.max(0, Math.floor(now.getTime() / dayMs) - Math.floor(new Date(effectiveDate).getTime() / dayMs))
}

export function classifyProductFreshness(effectiveDate: Date | string, now = new Date()): ProductFreshness {
  const age = catalogProductAgeDays(effectiveDate, now)
  return age <= 30 ? 'FRESH' : age <= 60 ? 'AGING' : 'STALE'
}

export function compareCatalogQuality(
  a: { dataProvenance: string; freshnessTier?: ProductFreshness },
  b: { dataProvenance: string; freshnessTier?: ProductFreshness },
) {
  return Number(b.dataProvenance === 'CATALOG_VERIFIED') - Number(a.dataProvenance === 'CATALOG_VERIFIED')
    || Number(a.freshnessTier === 'STALE') - Number(b.freshnessTier === 'STALE')
}

const sourceChecks = new Map<string, { until: number; ready: Promise<boolean> }>()
function checkSource(url: string) {
  const cached = sourceChecks.get(url)
  if (cached && cached.until > Date.now()) return cached.ready
  const ready = fetchPublicDocument(url, { timeoutMs: 3500, method: 'HEAD' }).then(() => true, () => false)
  sourceChecks.set(url, { until: Date.now() + 5 * 60_000, ready })
  return ready
}

export async function syncProductCatalog(prisma: PrismaService) {
  const [snapshotText, sourcesText] = await Promise.all([
    readFile(resolve(configDir, 'loan-rate-snapshot.json'), 'utf8'),
    readFile(resolve(configDir, 'loan-rate-sources.yaml'), 'utf8'),
  ])
  const { products } = productSnapshotSchema.parse(JSON.parse(snapshotText))
  const { sources } = sourcesSchema.parse(parse(sourcesText))
  const endpoints = [...new Set(sources.filter(({ isTrustedForRates }) => isTrustedForRates).map(({ endpointUrl }) => endpointUrl))]
  const checks = await Promise.all(endpoints.map(checkSource))

  const result = await prisma.$transaction(async (tx) => {
    let productsUpserted = 0
    let productsActivated = 0
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('finance-product-catalog-sync', 0))`
    for (const product of products) {
      const { key, institutionCode, effectiveDate, ...fields } = product
      const institution = catalogInstitutions.find(({ code }) => code === institutionCode)
      if (!institution) throw new Error('Unknown snapshot institution')
      const owner = await tx.financialInstitution.upsert({
        where: { code: institutionCode },
        create: { id: stableUuid('institution:' + institutionCode), ...institution, licenseNumber: 'NOT_PROVIDED_IN_PROJECT_SPEC', trustStatus: 'LICENSED' },
        update: {}, select: { id: true, trustStatus: true },
      })
      if (owner.trustStatus !== 'LICENSED') continue
      const id = stableUuid('catalog:' + key)
      const catalogSyncFingerprint = createHash('sha256').update(JSON.stringify(product)).digest('hex')
      const data = {
        ...fields, institutionId: owner.id, isActive: true, catalogSyncFingerprint,
        effectiveDate: new Date(effectiveDate),
        loanUseCase: fields.loanUseCase ?? null,
        redemptionFeeTiers: fields.redemptionFeeTiers ?? Prisma.DbNull,
        investmentTaxPct: fields.investmentTaxPct ?? null,
        investmentTaxFreeAfterMonths: fields.investmentTaxFreeAfterMonths ?? null,
        promoMonths: fields.promoMonths ?? null, floatingMargin: fields.floatingMargin ?? null,
        upfrontFeeRate: fields.upfrontFeeRate ?? 0, monthlyFeeVnd: fields.monthlyFeeVnd ?? 0,
      }
      const existing = await tx.financialProduct.findFirst({
        where: { OR: [{ id }, { institutionId: owner.id, productName: fields.productName }] },
        orderBy: { catalogSyncFingerprint: { sort: 'asc', nulls: 'first' } },
        select: { id: true, isActive: true, catalogSyncFingerprint: true },
      })
      if (!existing) {
        const inserted = await tx.financialProduct.createMany({ data: [{ id, ...data }], skipDuplicates: true })
        productsUpserted += inserted.count
        productsActivated += inserted.count
      } else if (existing.id === id && existing.catalogSyncFingerprint && existing.catalogSyncFingerprint !== catalogSyncFingerprint) {
        const updated = await tx.financialProduct.updateMany({
          where: { id, catalogSyncFingerprint: existing.catalogSyncFingerprint }, data,
        })
        productsUpserted += updated.count
        if (!existing.isActive) productsActivated += updated.count
      }
    }
    return { productsUpserted, productsActivated }
  }, { timeout: 15000 })

  return AdminProductSyncResultSchema.parse({
    ...result, sourcesChecked: endpoints.length, sourcesReachable: checks.filter(Boolean).length,
    syncedAt: new Date().toISOString(),
  })
}
