import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { AdminGuard } from '../../common/admin.guard'
import { AdminService } from './admin.service'

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Post('radar/fetch')
  fetchRadar(@Body() body: { sourceKey?: string } = {}) {
    return this.service.fetch(body.sourceKey)
  }

  @Get('radar/sources')
  listRadarSources() {
    return this.service.sources()
  }

  @Post('radar/sources/:sourceKey/retry')
  retryRadarSource(@Param('sourceKey') sourceKey: string) {
    return this.service.fetch(sourceKey)
  }

  @Get('radar/jobs/:jobId')
  radarJob(@Param('jobId') jobId: string) {
    return this.service.job(jobId)
  }

  @Get('products')
  listProducts() {
    return this.service.products()
  }

  @Post('products')
  createProduct(@Body() body: Record<string, unknown>) {
    return this.service.createProduct(body)
  }

  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.updateProduct(id, body)
  }
}
