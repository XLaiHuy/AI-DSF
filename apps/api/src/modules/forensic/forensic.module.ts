import { BullModule } from '@nestjs/bullmq'
import { CommunityProposalProcessor, communityProposalQueue } from './community-proposal.processor'
import { Module } from '@nestjs/common'
import { ConversationSessionStore } from './conversation-session.store'
import { ForensicController } from './forensic.controller'
import { ForensicService } from './forensic.service'
import { ThreatMemoryService } from './threat-memory.service'

@Module({ imports: [BullModule.registerQueue({ name: communityProposalQueue })], controllers: [ForensicController], providers: [ConversationSessionStore, ForensicService, ThreatMemoryService, CommunityProposalProcessor], exports: [ThreatMemoryService] })
export class ForensicModule {}
