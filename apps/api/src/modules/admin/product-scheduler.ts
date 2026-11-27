import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import type { OnModuleInit } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { SurveyCalcService } from '../survey-calc/survey-calc.service'

export const productQueue = 'product-rate-sync'

@Processor(productQueue)
export class ProductScheduler extends WorkerHost implements OnModuleInit {
  constructor(@InjectQueue(productQueue) private readonly queue: Queue, private readonly survey: SurveyCalcService) { super() }

  async onModuleInit() {
    await this.queue.upsertJobScheduler('daily-product-sync', { every: 86400000 }, { name: 'sync-products' })
  }

  scheduler() { return this.queue.getJobScheduler('daily-product-sync') }

  process() { return this.survey.syncTrustedProducts() }
}
