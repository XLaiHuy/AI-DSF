import { BullModule } from '@nestjs/bullmq'
import { CommunityProposalProcessor, communityProposalQueue } from './community-proposal.processor'
import { Module } from '@nestjs/common'
import { SurveyCalcModule } from '../survey-calc/survey-calc.module'
import { CopilotToolsService } from './copilot-tools.service'
import { ConversationSessionStore } from './conversation-session.store'
import { ForensicController } from './forensic.controller'
import { ForensicService } from './forensic.service'
import { ThreatMemoryService } from './threat-memory.service'

@Module({ imports: [SurveyCalcModule, BullModule.registerQueue({ name: communityProposalQueue })], controllers: [ForensicController], providers: [ConversationSessionStore, CopilotToolsService, ForensicService, ThreatMemoryService, CommunityProposalProcessor], exports: [ThreatMemoryService] })
export class ForensicModule {}
