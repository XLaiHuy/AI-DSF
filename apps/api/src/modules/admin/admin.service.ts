import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma.service'
import { RadarService } from '../radar/radar.service'
import { SurveyCalcService } from '../survey-calc/survey-calc.service'
import { catalogProductAgeDays, classifyProductFreshness } from '../survey-calc/product-catalog'
import { ProductCategory, CalcMethod, RateType } from '@fincopilot/shared-types'
import { z } from 'zod'
import Decimal from 'decimal.js'

const productSchema = z.strictObject({
  institutionId: z.uuid(), productCategory: ProductCategory, productName: z.string().trim().min(1).max(200),
  calcMethod: CalcMethod, rateType: RateType, nominalRateMin: z.string().regex(/^\d+(\.\d+)?$/), nominalRateMax: z.string().regex(/^\d+(\.\d+)?$/),
  promoMonths: z.number().int().positive().nullable().optional(), floatingMargin: z.string().regex(/^\d+(\.\d+)?$/).nullable().optional(),
  upfrontFeeRate: z.string().regex(/^\d+(\.\d+)?$/).optional(), monthlyFeeVnd: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  earlySettlementFeeRate: z.string().regex(/^\d+(\.\d+)?$/).optional(), minAmountVnd: z.string().regex(/^\d+(\.\d+)?$/),
  maxAmountVnd: z.string().regex(/^\d+(\.\d+)?$/), minTermMonths: z.number().int().positive(), maxTermMonths: z.number().int().positive(),
  sourceUrl: z.url({ protocol: /^https?$/ }), effectiveDate: z.iso.date(), dataProvenance: z.enum(['CATALOG_VERIFIED', 'WEB_REFERENCE']), isActive: z.boolean(),
})

const createProductSchema = productSchema.extend({
  dataProvenance: productSchema.shape.dataProvenance.default('CATALOG_VERIFIED'),
  isActive: productSchema.shape.isActive.default(true),
})
const updateProductSchema = productSchema.partial()

function validateProductBounds(product: {
  nominalRateMin: Decimal.Value; nominalRateMax: Decimal.Value;
  minAmountVnd: Decimal.Value; maxAmountVnd: Decimal.Value;
  minTermMonths: number; maxTermMonths: number;
  upfrontFeeRate?: Decimal.Value | null; earlySettlementFeeRate?: Decimal.Value | null;
}) {
  const issues = [
    [new Decimal(product.nominalRateMin).gt(product.nominalRateMax), 'nominalRateMax', 'Lãi suất tối đa phải lớn hơn hoặc bằng mức tối thiểu.'],
    [new Decimal(product.nominalRateMax).gt(200), 'nominalRateMax', 'Lãi suất tối đa không được vượt quá 200%.'],
    [new Decimal(product.minAmountVnd).gt(product.maxAmountVnd), 'maxAmountVnd', 'Số tiền tối đa phải lớn hơn hoặc bằng mức tối thiểu.'],
    [product.minTermMonths > product.maxTermMonths, 'maxTermMonths', 'Kỳ hạn tối đa phải lớn hơn hoặc bằng mức tối thiểu.'],
    [product.upfrontFeeRate != null && new Decimal(product.upfrontFeeRate).gte(100), 'upfrontFeeRate', 'Phí trả trước phải nhỏ hơn 100%.'],
    [product.earlySettlementFeeRate != null && new Decimal(product.earlySettlementFeeRate).gt(100), 'earlySettlementFeeRate', 'Phí tất toán trước hạn không được vượt quá 100%.'],
  ] as const
  const details = issues.filter(([invalid]) => invalid).map(([, field, message]) => ({ path: [field], message }))
  if (details.length) throw new BadRequestException({
    errorCode: 'ERR_VALIDATION_FAILED', message: 'Thông tin sản phẩm không hợp lệ.', details,
  })
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly radar: RadarService, private readonly survey: SurveyCalcService) {}

  scheduler() { return this.radar.scheduler() }

  syncProducts() {
    return this.survey.syncTrustedProducts()
  }

  async sources() {
    return this.prisma.marketSource.findMany({ orderBy: { sourceKey: 'asc' }, include: { _count: { select: { articles: true } } } })
  }

  async fetch(sourceKey?: string) {
    return this.radar.enqueueFetch(sourceKey)
  }

  async job(jobId: string) { return this.radar.getJob(jobId) }

  async products() {
    const now = new Date()
    const rows = await this.prisma.financialProduct.findMany({
      orderBy: [{ institution: { name: 'asc' } }, { productName: 'asc' }], include: { institution: true },
    })
    const counts = { FRESH: 0, AGING: 0, STALE: 0 }
    const products = rows.map(product => {
      const ageDays = catalogProductAgeDays(product.effectiveDate, now)
      const freshnessTier = classifyProductFreshness(product.effectiveDate, now)
      if (product.isActive) counts[freshnessTier] += 1
      return { ...product, ageDays, freshnessTier }
    })
    return { products, freshness: { freshCount: counts.FRESH, agingCount: counts.AGING, staleCount: counts.STALE } }
  }

  async institutions() {
    return this.prisma.financialInstitution.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
  }

  async createProduct(input: Record<string, unknown>) {
    const parsed = createProductSchema.safeParse(input)
    if (!parsed.success) throw new BadRequestException({ errorCode: 'ERR_VALIDATION_FAILED', message: 'Thông tin sản phẩm không hợp lệ.', details: parsed.error.issues })
    validateProductBounds(parsed.data)
    return this.prisma.financialProduct.create({ data: { id: randomUUID(), ...parsed.data, effectiveDate: new Date(parsed.data.effectiveDate) } as Prisma.FinancialProductUncheckedCreateInput, include: { institution: true } })
  }

  async updateProduct(id: string, input: Record<string, unknown>) {
    const exists = await this.prisma.financialProduct.findUnique({ where: { id } })
    if (!exists) throw new NotFoundException('Không tìm thấy sản phẩm tài chính.')
    const parsed = updateProductSchema.safeParse(input)
    if (!parsed.success) throw new BadRequestException({ errorCode: 'ERR_VALIDATION_FAILED', message: 'Thông tin sản phẩm không hợp lệ.', details: parsed.error.issues })
    if (Object.keys(parsed.data).length === 0) throw new BadRequestException('Cần cung cấp trường cập nhật.')
    validateProductBounds({ ...exists, ...parsed.data })
    const data = { ...parsed.data, ...(parsed.data.effectiveDate ? { effectiveDate: new Date(parsed.data.effectiveDate) } : {}), catalogSyncFingerprint: null, updatedAt: new Date() }
    return this.prisma.financialProduct.update({ where: { id }, data: data as Prisma.FinancialProductUpdateInput, include: { institution: true } })
  }
}
