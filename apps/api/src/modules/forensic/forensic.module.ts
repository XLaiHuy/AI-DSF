import { BullModule } from '@nestjs/bullmq'
import { CommunityProposalProcessor, communityProposalQueue } from './community-proposal.processor'
import { Module } from '@nestjs/common'
import { ForensicController } from './forensic.controller'
import { ForensicService } from './forensic.service'
import { ThreatMemoryService } from './threat-memory.service'

@Module({ imports: [BullModule.registerQueue({ name: communityProposalQueue })], controllers: [ForensicController], providers: [ForensicService, ThreatMemoryService, CommunityProposalProcessor], exports: [ThreatMemoryService] })
export class ForensicModule {}
