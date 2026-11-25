import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { GuestSessionGuard } from '../../common/guest-session.guard'
import { RadarService } from './radar.service'

@Controller('radar')
export class RadarMediaController {
  constructor(private readonly service: RadarService) {}

  @Get('image-proxy')
  async proxyImage(@Query('url') rawUrl: string | undefined, @Res() reply: FastifyReply) {
    if (!rawUrl || rawUrl.length > 2048) throw new BadRequestException('URL ảnh không hợp lệ.')
    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      throw new BadRequestException('URL ảnh không hợp lệ.')
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new BadRequestException('Chỉ hỗ trợ ảnh qua HTTPS công khai.')
    }
    try {
      const { buffer, contentType } = await this.service.proxyArticleImage(parsed.toString())
      return reply
        .header('Content-Type', contentType)
        .header('Cache-Control', 'public, max-age=86400')
        .header('X-Content-Type-Options', 'nosniff')
        .send(buffer)
    } catch {
      throw new NotFoundException('Không tải được ảnh bài viết.')
    }
  }
}

@Controller('radar')
@UseGuards(GuestSessionGuard)
export class RadarController {
  constructor(private readonly service: RadarService) {}

  @Get('articles')
  listArticles(@Query() query: { category?: string; search?: string; cursor?: string; limit?: string; period?: string; year?: string; from?: string; to?: string }) {
    return this.service.listArticles({ ...query, limit: query.limit ? Number(query.limit) : undefined })
  }

  @Get('articles/highlights')
  articleHighlights() {
    return this.service.articleHighlights()
  }

  @Post('daily-brief')
  dailyBrief(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service.dailyBrief(request.session, body)
  }

  @Post('recommendation-signals')
  recommendationSignals(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service.recommendationSignals(request.session, body)
  }

  @Get('articles/:id')
  readArticle(@Param('id') id: string) {
    return this.service.articleDetail(id)
  }

  @Post('articles/:id/analyze')
  analyzeArticle(@Param('id') id: string, @Body() body: { mode?: 'GENERAL' | 'PERSONALIZED' } | undefined, @Req() request: FastifyRequest) {
    return this.service.analyzeArticle(id, request.session, body?.mode)
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
