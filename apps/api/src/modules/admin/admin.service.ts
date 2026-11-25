import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma.service'
import { RadarService } from '../radar/radar.service'
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
  sourceUrl: z.url(), effectiveDate: z.iso.date(), dataProvenance: z.enum(['CATALOG_VERIFIED', 'WEB_REFERENCE']).default('CATALOG_VERIFIED'), isActive: z.boolean().default(true),
})

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly radar: RadarService) {}

  async sources() {
    return this.prisma.marketSource.findMany({ orderBy: { sourceKey: 'asc' }, include: { _count: { select: { articles: true } } } })
  }

  async fetch(sourceKey?: string) {
    return this.radar.enqueueFetch(sourceKey)
  }

  async job(jobId: string) { return this.radar.getJob(jobId) }

  async products() {
    return this.prisma.financialProduct.findMany({ orderBy: [{ institution: { name: 'asc' } }, { productName: 'asc' }], include: { institution: true } })
  }

  async institutions() {
    return this.prisma.financialInstitution.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
  }

  async createProduct(input: Record<string, unknown>) {
    const parsed = productSchema.refine((data) => new Decimal(data.nominalRateMin).lte(data.nominalRateMax), { path: ['nominalRateMax'], message: 'Lãi suất tối đa phải lớn hơn hoặc bằng tối thiểu.' }).safeParse(input)
    if (!parsed.success) throw new BadRequestException({ errorCode: 'ERR_VALIDATION_FAILED', message: 'Thông tin sản phẩm không hợp lệ.', details: parsed.error.issues })
    return this.prisma.financialProduct.create({ data: { id: randomUUID(), ...parsed.data, effectiveDate: new Date(parsed.data.effectiveDate) } as Prisma.FinancialProductUncheckedCreateInput, include: { institution: true } })
  }

  async updateProduct(id: string, input: Record<string, unknown>) {
    const exists = await this.prisma.financialProduct.findUnique({ where: { id } })
    if (!exists) throw new NotFoundException('Không tìm thấy sản phẩm tài chính.')
    const parsed = productSchema.partial().safeParse(input)
    if (!parsed.success) throw new BadRequestException({ errorCode: 'ERR_VALIDATION_FAILED', message: 'Thông tin sản phẩm không hợp lệ.', details: parsed.error.issues })
    if (Object.keys(parsed.data).length === 0) throw new BadRequestException('Cần cung cấp trường cập nhật.')
    const nextMin = parsed.data.nominalRateMin ?? exists.nominalRateMin.toString()
    const nextMax = parsed.data.nominalRateMax ?? exists.nominalRateMax.toString()
    if (new Decimal(nextMin).gt(nextMax)) throw new BadRequestException({ errorCode: 'ERR_VALIDATION_FAILED', message: 'Lãi suất tối đa phải lớn hơn hoặc bằng tối thiểu.' })
    const data = { ...parsed.data, ...(parsed.data.effectiveDate ? { effectiveDate: new Date(parsed.data.effectiveDate) } : {}), updatedAt: new Date() }
    return this.prisma.financialProduct.update({ where: { id }, data: data as Prisma.FinancialProductUpdateInput, include: { institution: true } })
  }
}
