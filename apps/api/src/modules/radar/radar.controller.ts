import { BadRequestException, Body, Controller, Get, Header, NotFoundException, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common'
import { ThreatTrendsQuerySchema, type ThreatTrendsQuery } from '@fincopilot/shared-types'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { GuestSessionGuard } from '../../common/guest-session.guard'
import { publicRadarCacheControl } from '../../common/public-cache-keys'
import { ZodValidationPipe } from '../../common/zod-validation.pipe'
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
export class RadarController {
  constructor(private readonly service: RadarService) {}

  @Get('articles')
  @Header('Cache-Control', publicRadarCacheControl)
  listArticles(@Query() query: { category?: string; search?: string; cursor?: string; limit?: string; period?: string; year?: string; from?: string; to?: string }) {
    return this.service.listArticles({ ...query, limit: query.limit ? Number(query.limit) : undefined })
  }

  @Get('articles/highlights')
  @Header('Cache-Control', publicRadarCacheControl)
  articleHighlights() {
    return this.service.articleHighlights()
  }

  @Post('daily-brief')
  @UseGuards(GuestSessionGuard)
  dailyBrief(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service.dailyBrief(request.session, body)
  }

  @Post('recommendation-signals')
  @UseGuards(GuestSessionGuard)
  recommendationSignals(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service.recommendationSignals(request.session, body)
  }

  @Get('articles/:id')
  @Header('Cache-Control', publicRadarCacheControl)
  readArticle(@Param('id') id: string) {
    return this.service.articleDetail(id)
  }

  @Post('articles/:id/analyze')
  @UseGuards(GuestSessionGuard)
  analyzeArticle(@Param('id') id: string, @Body() body: { mode?: 'GENERAL' | 'PERSONALIZED' } | undefined, @Req() request: FastifyRequest) {
    return this.service.analyzeArticle(id, request.session, body?.mode)
  }

  @Get('alerts')
  @Header('Cache-Control', publicRadarCacheControl)
  listAlerts() {
    return this.service.listAlerts()
  }

  @Get('alerts/trends')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  alertTrends(@Query(new ZodValidationPipe(ThreatTrendsQuerySchema)) query: ThreatTrendsQuery) {
    return this.service.alertTrends(query)
  }

  @Get('alerts/:id')
  @Header('Cache-Control', publicRadarCacheControl)
  readAlert(@Param('id') id: string) {
    return this.service.alertDetail(id)
  }
}
