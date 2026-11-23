import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { GuestSessionGuard } from '../../common/guest-session.guard'
import { RadarService } from './radar.service'

@Controller('radar')
@UseGuards(GuestSessionGuard)
export class RadarController {
  constructor(private readonly service: RadarService) {}

  @Get('articles')
  listArticles(@Query() query: { category?: string; search?: string; cursor?: string; limit?: string }) {
    return this.service.listArticles({ ...query, limit: query.limit ? Number(query.limit) : undefined })
  }

  @Get('articles/:id')
  readArticle(@Param('id') id: string) {
    return this.service.articleDetail(id)
  }

  @Post('articles/:id/analyze')
  analyzeArticle(@Param('id') id: string, @Req() request: FastifyRequest) {
    return this.service.analyzeArticle(id, request.session)
  }

  @Get('alerts')
  listAlerts() {
    return this.service.listAlerts()
  }

  @Get('alerts/:id')
  readAlert(@Param('id') id: string) {
    return this.service.alertDetail(id)
  }
}
