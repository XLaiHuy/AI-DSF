import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../../common/prisma.service'
import type { RadarService } from '../radar/radar.service'
import { AdminService } from './admin.service'

describe('Radar image-rights review', () => {
  it('rejects PERMITTED without item-specific rights evidence before writing', async () => {
    const prisma = {
      marketArticle: { findUnique: vi.fn(), update: vi.fn() },
      articleImageRightsReview: { create: vi.fn() },
      $transaction: vi.fn(),
    }
    const service = new AdminService(prisma as unknown as PrismaService, {} as RadarService)
    await expect(service.reviewArticleImage('article-1', {
      imageLicenseStatus: 'PERMITTED', note: 'Insufficient evidence', reviewerLabel: 'QA',
    })).rejects.toThrow('Thông tin quyền ảnh chưa đầy đủ')
    expect(prisma.marketArticle.findUnique).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('records permitted decisions with rights metadata and a separate append-only review event', async () => {
    const tx = {
      marketArticle: { update: vi.fn().mockResolvedValue({ id: 'article-1', imageLicenseStatus: 'PERMITTED' }) },
      articleImageRightsReview: { create: vi.fn().mockResolvedValue({ id: 'review-1' }) },
    }
    const prisma = {
      marketArticle: { findUnique: vi.fn().mockResolvedValue({ id: 'article-1', imageUrl: 'https://img.publisher.example/photo.jpg', imageSourceUrl: 'https://publisher.example/story', imageLicenseStatus: 'UNKNOWN' }) },
      $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    }
    const service = new AdminService(prisma as unknown as PrismaService, {} as RadarService)
    const result = await service.reviewArticleImage('article-1', {
      imageLicenseStatus: 'PERMITTED', imageCredit: 'Photographer Example',
      rightsBasis: 'OPEN_LICENSE', licenseIdentifier: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      evidenceUrl: 'https://publisher.example/photo-rights', note: 'License verified for this image.', reviewerLabel: 'Reviewer 01',
    })
    expect(tx.marketArticle.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ imageLicenseStatus: 'PERMITTED', imageCredit: 'Photographer Example', imageRightsBasis: 'OPEN_LICENSE', imageRightsEvidenceUrl: 'https://publisher.example/photo-rights' }) }))
    expect(tx.articleImageRightsReview.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ previousStatus: 'UNKNOWN', decisionStatus: 'PERMITTED', reviewerLabel: 'Reviewer 01', note: 'License verified for this image.' }) }))
    expect(result).toMatchObject({ articleId: 'article-1', imageLicenseStatus: 'PERMITTED', reviewId: 'review-1' })
  })
})
