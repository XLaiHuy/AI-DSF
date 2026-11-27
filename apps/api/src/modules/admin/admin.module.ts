import { ProductScheduler, productQueue } from './product-scheduler'
import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { AdminGuard } from '../../common/admin.guard'
import { RadarModule } from '../radar/radar.module'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { ForensicModule } from '../forensic/forensic.module'
import { threatIntakeQueue, ThreatIntakeService } from './threat-intake.service'
import { ThreatReviewService } from './threat-review.service'
import { SurveyCalcModule } from '../survey-calc/survey-calc.module'

@Module({
  imports: [RadarModule, ForensicModule, SurveyCalcModule, BullModule.registerQueue({ name: threatIntakeQueue }, { name: productQueue })],
  controllers: [AdminController],
  providers: [ProductScheduler, AdminService, AdminGuard, ThreatIntakeService, ThreatReviewService],
})
export class AdminModule {}
