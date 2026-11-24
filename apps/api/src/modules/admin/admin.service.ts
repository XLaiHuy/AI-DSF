import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma.service'
import { RadarService } from '../radar/radar.service'
import { ProductCategory, CalcMethod, RateType } from '@fincopilot/shared-types'
import { z } from 'zod'

const productSchema = z.strictObject({
  institutionId: z.uuid(), productCategory: ProductCategory, productName: z.string().trim().min(1).max(200),
  calcMethod: CalcMethod, rateType: RateType, nominalRateMin: z.string().regex(/^\d+(\.\d+)?$/), nominalRateMax: z.string().regex(/^\d+(\.\d+)?$/),
  promoMonths: z.number().int().positive().nullable().optional(), floatingMargin: z.string().regex(/^\d+(\.\d+)?$/).nullable().optional(),
  upfrontFeeRate: z.string().regex(/^\d+(\.\d+)?$/).optional(), monthlyFeeVnd: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  earlySettlementFeeRate: z.string().regex(/^\d+(\.\d+)?$/).optional(), minAmountVnd: z.string().regex(/^\d+(\.\d+)?$/),
  maxAmountVnd: z.string().regex(/^\d+(\.\d+)?$/), minTermMonths: z.number().int().positive(), maxTermMonths: z.number().int().positive(),
  sourceUrl: z.url(), effectiveDate: z.iso.date(), dataProvenance: z.enum(['CATALOG_VERIFIED', 'WEB_REFERENCE']).default('CATALOG_VERIFIED'), isActive: z.boolean().default(true),
})
const imageRightsReviewSchema = z.strictObject({
  imageLicenseStatus: z.enum(['UNKNOWN', 'REVIEW_REQUIRED', 'PERMITTED', 'PROHIBITED']),
  imageCredit: z.string().trim().max(300).default(''),
  rightsBasis: z.enum(['PUBLISHER_PERMISSION', 'OPEN_LICENSE', 'PUBLIC_DOMAIN', 'FINCOPILOT_OWNED']).nullable().optional(),
  licenseIdentifier: z.string().trim().min(1).max(120).nullable().optional(),
  licenseUrl: z.url().refine((value) => value.startsWith('https://'), 'Chỉ chấp nhận HTTPS.').nullable().optional(),
  evidenceUrl: z.url().refine((value) => value.startsWith('https://'), 'Chỉ chấp nhận HTTPS.').nullable().optional(),
  note: z.string().trim().min(8).max(2000),
  reviewerLabel: z.string().trim().min(2).max(120),
}).superRefine((review, ctx) => {
  if (review.imageLicenseStatus === 'PERMITTED') {
    if (!review.imageCredit) ctx.addIssue({ code: 'custom', path: ['imageCredit'], message: 'Cần ghi công ảnh.' })
    if (!review.rightsBasis) ctx.addIssue({ code: 'custom', path: ['rightsBasis'], message: 'Cần ghi căn cứ quyền sử dụng.' })
    if (!review.licenseIdentifier) ctx.addIssue({ code: 'custom', path: ['licenseIdentifier'], message: 'Cần ghi mã/loại giấy phép.' })
    if (!review.evidenceUrl) ctx.addIssue({ code: 'custom', path: ['evidenceUrl'], message: 'Cần liên kết bằng chứng quyền sử dụng.' })
    if (review.rightsBasis === 'OPEN_LICENSE' && !review.licenseUrl) ctx.addIssue({ code: 'custom', path: ['licenseUrl'], message: 'Giấy phép mở cần URL điều khoản.' })
  }
})

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly radar: RadarService) {}

  async sources() {
    return this.prisma.marketSource.findMany({ orderBy: { sourceKey: 'asc' }, include: { _count: { select: { articles: true } } } })
  }

  async imageReviewQueue() {
    const rows = await this.prisma.marketArticle.findMany({
      where: { imageUrl: { not: null }, imageLicenseStatus: { in: ['UNKNOWN', 'REVIEW_REQUIRED'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
      select: {
        id: true, title: true, canonicalUrl: true, imageUrl: true, imageAlt: true, imageCredit: true,
        imageSourceUrl: true, imageLicenseStatus: true, sources: { select: { sourceUrl: true, source: { select: { name: true } } } },
      },
    })
    return rows.map((row) => ({ ...row, sources: row.sources.map((item) => ({ sourceName: item.source.name, url: item.sourceUrl })) }))
  }

  async imageReviewHistory() {
    return this.prisma.articleImageRightsReview.findMany({
      orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }], take: 100,
      include: { article: { select: { id: true, title: true, canonicalUrl: true } } },
    })
  }

  async reviewArticleImage(id: string, input: unknown) {
    const parsed = imageRightsReviewSchema.safeParse(input)
    if (!parsed.success) throw new BadRequestException({ errorCode: 'ERR_VALIDATION_FAILED', message: 'Thông tin quyền ảnh chưa đầy đủ hoặc không hợp lệ.', details: parsed.error.issues })
    const exists = await this.prisma.marketArticle.findUnique({ where: { id }, select: { id: true, imageUrl: true, imageSourceUrl: true, imageLicenseStatus: true } })
    if (!exists) throw new NotFoundException('Không tìm thấy bài viết.')
    if (!exists.imageUrl) throw new BadRequestException('Bài viết chưa có ảnh nguồn để rà soát.')
    const review = parsed.data
    if (review.imageLicenseStatus === 'PERMITTED') {
      try {
        const image = new URL(exists.imageUrl)
        const source = new URL(exists.imageSourceUrl ?? '')
        const imageHost = image.hostname.toLowerCase().replace(/^www\./, '')
        const sourceHost = source.hostname.toLowerCase().replace(/^www\./, '')
        if (image.protocol !== 'https:' || source.protocol !== 'https:' || (imageHost !== sourceHost && !imageHost.endsWith(`.${sourceHost}`))) throw new Error('host mismatch')
      } catch { throw new BadRequestException('Chỉ cho phép ảnh HTTPS cùng miền với nguồn bài viết; CDN ngoài danh sách chưa được hỗ trợ.') }
    }
    const reviewedAt = new Date()
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.marketArticle.update({ where: { id }, data: {
        imageLicenseStatus: review.imageLicenseStatus,
        ...(review.imageCredit ? { imageCredit: review.imageCredit } : {}),
        imageRightsBasis: review.rightsBasis ?? null,
        imageLicenseIdentifier: review.licenseIdentifier ?? null,
        imageLicenseUrl: review.licenseUrl ?? null,
        imageRightsEvidenceUrl: review.evidenceUrl ?? null,
        imageRightsNote: review.note,
        imageReviewedAt: reviewedAt,
        updatedAt: reviewedAt,
      } })
      const history = await tx.articleImageRightsReview.create({ data: {
        id: randomUUID(), articleId: id, previousStatus: exists.imageLicenseStatus,
        decisionStatus: review.imageLicenseStatus, rightsBasis: review.rightsBasis ?? null,
        licenseIdentifier: review.licenseIdentifier ?? null, licenseUrl: review.licenseUrl ?? null,
        evidenceUrl: review.evidenceUrl ?? null,
        note: review.note, reviewedAt,
        reviewerLabel: review.reviewerLabel,
      } })
      return { articleId: updated.id, imageLicenseStatus: updated.imageLicenseStatus, reviewedAt, reviewId: history.id }
    })
  }

  async fetch(sourceKey?: string) {
    return this.radar.enqueueFetch(sourceKey)
  }

  async job(jobId: string) { return this.radar.getJob(jobId) }

  async products() {
    return this.prisma.financialProduct.findMany({ orderBy: [{ institution: { name: 'asc' } }, { productName: 'asc' }], include: { institution: true } })
  }

  async createProduct(input: Record<string, unknown>) {
    const parsed = productSchema.refine((data) => Number(data.nominalRateMin) <= Number(data.nominalRateMax), { path: ['nominalRateMax'], message: 'Lãi suất tối đa phải lớn hơn hoặc bằng tối thiểu.' }).safeParse(input)
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
    if (Number(nextMin) > Number(nextMax)) throw new BadRequestException({ errorCode: 'ERR_VALIDATION_FAILED', message: 'Lãi suất tối đa phải lớn hơn hoặc bằng tối thiểu.' })
    const data = { ...parsed.data, ...(parsed.data.effectiveDate ? { effectiveDate: new Date(parsed.data.effectiveDate) } : {}), updatedAt: new Date() }
    return this.prisma.financialProduct.update({ where: { id }, data: data as Prisma.FinancialProductUpdateInput, include: { institution: true } })
  }
}
