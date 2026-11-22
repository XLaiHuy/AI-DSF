import { Controller, Get, UseGuards } from '@nestjs/common'
import { GuestSessionGuard } from '../../common/guest-session.guard'
import { RadarService } from './radar.service'

@Controller('radar')
@UseGuards(GuestSessionGuard)
export class RadarController {
  constructor(private readonly service: RadarService) {}

  @Get('articles')
  listArticles() {
    return this.service.pending()
  }

  @Get('articles/:id')
  readArticle() {
    return this.service.pending()
  }

  @Get('alerts')
  listAlerts() {
    return this.service.pending()
  }

  @Get('alerts/:id')
  readAlert() {
    return this.service.pending()
  }
}
