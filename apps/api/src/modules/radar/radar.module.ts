import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { RadarController } from './radar.controller'
import { RadarService } from './radar.service'
import { ForensicModule } from '../forensic/forensic.module'

@Module({
  imports: [ForensicModule, BullModule.registerQueue({ name: 'radar-ingestion' })],
  controllers: [RadarController],
  providers: [RadarService],
  exports: [RadarService],
})
export class RadarModule {}
