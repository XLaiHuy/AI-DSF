import { Controller, Post, Get, UseGuards } from '@nestjs/common'
import { GuestSessionGuard } from '../../common/guest-session.guard'
import { ForensicService } from './forensic.service'

@Controller('forensic')
@UseGuards(GuestSessionGuard)
export class ForensicController {
  constructor(private readonly service: ForensicService) {}

  @Post('audit')
  audit() {
    return this.service.pending()
  }

  @Get('audits')
  listAudits() {
    return this.service.pending()
  }

  @Get('audits/:id')
  readAudit() {
    return this.service.pending()
  }

  @Get('audits/:id/export')
  exportAudit() {
    return this.service.pending()
  }
}
