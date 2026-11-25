import { Module } from '@nestjs/common'
import { ForensicController } from './forensic.controller'
import { ForensicService } from './forensic.service'
import { ThreatMemoryService } from './threat-memory.service'

@Module({ controllers: [ForensicController], providers: [ForensicService, ThreatMemoryService], exports: [ThreatMemoryService] })
export class ForensicModule {}
