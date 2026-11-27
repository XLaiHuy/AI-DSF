import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { ThreatMemoryService, type CommunityProposal } from './threat-memory.service'

export const communityProposalQueue = 'forensic-community-proposal'

@Processor(communityProposalQueue, { concurrency: 1 })
export class CommunityProposalProcessor extends WorkerHost {
  private readonly logger = new Logger(CommunityProposalProcessor.name)
  constructor(private readonly memory: ThreatMemoryService) { super() }

  process(job: Job<CommunityProposal>) {
    return this.memory.applyProposal(job.data)
  }

  @OnWorkerEvent('failed')
  failed(job?: Job<CommunityProposal>) {
    this.logger.warn({ event: 'forensic_community_proposal_failed', jobId: job?.id, attemptsMade: job?.attemptsMade })
  }
}
