import { Controller, Get } from '@nestjs/common'
import { PrismaService } from '../../common/prisma.service'

@Controller('home')
export class HomeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('market')
  async market() {
    const [alert, articles] = await Promise.all([
      this.prisma.threatAlert.findFirst({
        where: { verificationStatus: 'VERIFIED', publishedAt: { not: null } },
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        select: { id: true, tacticSummary: true, preventionGuidance: true, publishedAt: true },
      }),
      this.prisma.marketArticle.findMany({
        where: { feedStatus: 'ACTIVE', duplicateOfId: null },
        orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        select: { id: true, title: true, imageUrl: true, publishedAt: true },
        take: 4,
      }),
    ])
    return { alert, articles }
  }
}
