import { Controller, Get } from '@nestjs/common'
import { PrismaService } from '../../common/prisma.service'

@Controller('home')
export class HomeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('market')
  async market() {
    const select = {
      id: true,
      title: true,
      imageUrl: true,
      publishedAt: true,
      categories: { select: { categoryCode: true } },
    } as const
    const orderBy = [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }] as const
    const [alert, withImages] = await Promise.all([
      this.prisma.threatAlert.findFirst({
        where: { verificationStatus: 'VERIFIED', publishedAt: { not: null } },
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        select: { id: true, tacticSummary: true, preventionGuidance: true, publishedAt: true },
      }),
      this.prisma.marketArticle.findMany({
        where: { feedStatus: 'ACTIVE', duplicateOfId: null, imageUrl: { not: null } },
        orderBy: [...orderBy],
        select,
        take: 4,
      }),
    ])
    const remaining = 4 - withImages.length
    const fallback = remaining > 0 ? await this.prisma.marketArticle.findMany({
      where: { feedStatus: 'ACTIVE', duplicateOfId: null, imageUrl: null },
      orderBy: [...orderBy],
      select,
      take: remaining,
    }) : []
    const articles = [...withImages, ...fallback].map(({ categories, ...article }) => ({
      ...article,
      categories: categories.map(({ categoryCode }) => categoryCode),
    }))
    return { alert, articles }
  }
}
