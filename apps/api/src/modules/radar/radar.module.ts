import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { RadarController } from './radar.controller'
import { RadarService } from './radar.service'

@Module({
  imports: [BullModule.registerQueue({ name: 'radar-ingestion' })],
  controllers: [RadarController],
  providers: [RadarService],
})
export class RadarModule {}
