import { Body, Controller, Get, Header, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ThreatCrawlSchema, ThreatDraftSchema, ThreatExtractSchema, ThreatFeedbackPatchSchema, ThreatFeedbackSchema, ThreatPatchSchema,
  ThreatStatusSchema, ThreatTestSchema, type ThreatDraft, type ThreatExtract, type ThreatFeedback, type ThreatPatch, type ThreatStatus } from '@fincopilot/shared-types'
import { z } from 'zod'
import { AdminGuard } from '../../common/admin.guard'
import { ZodValidationPipe } from '../../common/zod-validation.pipe'
import { AdminService } from './admin.service'
import { ThreatIntakeService } from './threat-intake.service'
import { ThreatReviewService } from './threat-review.service'

const uuid = new ZodValidationPipe(z.uuid())

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly service: AdminService, private readonly intake: ThreatIntakeService,
    private readonly review: ThreatReviewService) {}

  @Get('alerts')
  listAlerts(@Query('status', new ZodValidationPipe(ThreatStatusSchema.optional())) status?: ThreatStatus) {
    return this.review.list(status)
  }

  @Post('alerts/extract')
  extractAlert(@Body(new ZodValidationPipe(ThreatExtractSchema)) input: ThreatExtract) {
    return this.intake.extractFromInput(input)
  }

  @Post('alerts')
  createAlert(@Body(new ZodValidationPipe(ThreatDraftSchema)) input: ThreatDraft) {
    return this.review.create(input)
  }

  @Patch('alerts/:id')
  updateAlert(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(ThreatPatchSchema)) input: ThreatPatch) {
    return this.review.patch(id, input)
  }

  @Post('alerts/:id/test')
  testAlert(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(ThreatTestSchema)) input: z.infer<typeof ThreatTestSchema>) {
    return this.review.test(id, input.message)
  }

  @Get('crawl-status')
  crawlStatus() { return this.intake.status() }

  @Post('crawl-now')
  crawlNow(@Body(new ZodValidationPipe(ThreatCrawlSchema)) input: z.infer<typeof ThreatCrawlSchema>) {
    return this.intake.hotCrawlNow(input.sourceKey)
  }

  @Get('audits/recent')
  recentAudits() { return this.review.recentAudits() }

  @Get('feedback')
  feedback() { return this.review.listFeedback() }

  @Post('feedback')
  saveFeedback(@Body(new ZodValidationPipe(ThreatFeedbackSchema)) input: ThreatFeedback) { return this.review.saveFeedback(input) }

  @Patch('feedback/:id')
  toggleFeedback(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(ThreatFeedbackPatchSchema)) input: z.infer<typeof ThreatFeedbackPatchSchema>) {
    return this.review.setFeedback(id, input.isActive)
  }

  @Get('rnd/summary')
  rndSummary() { return this.review.summary() }

  @Post('rnd/run-eval')
  runEval() { return this.review.runEval() }

  @Get('rnd/export-cases')
  @Header('Content-Disposition', 'attachment; filename="forensic-rnd-cases.json"')
  @Header('Cache-Control', 'private, no-store')
  exportCases() { return this.review.exportCases() }

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

  @Get('institutions')
  listInstitutions() {
    return this.service.institutions()
  }

  @Post('products')
  createProduct(@Body() body: Record<string, unknown>) {
    return this.service.createProduct(body)
  }

  @Post('products/sync')
  syncProducts() {
    return this.service.syncProducts()
  }

  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.updateProduct(id, body)
  }
}
