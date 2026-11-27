import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import type { OnModuleInit } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { Job, Queue } from 'bullmq'
import { PrismaService } from '../../common/prisma.service'

export const maintenanceQueue = 'db-maintenance'
const schedulerId = 'daily-db-maintenance'
const dayMs = 86_400_000
const batchSize = 200

@Processor(maintenanceQueue, { concurrency: 1 })
export class MaintenanceScheduler extends WorkerHost implements OnModuleInit {
  constructor(@InjectQueue(maintenanceQueue) private readonly queue: Queue, private readonly prisma: PrismaService) { super() }

  async onModuleInit() {
    // Keep the previous start date on bootstrap so frequent restarts cannot postpone maintenance.
    const existing = await this.scheduler()
    if (existing) return
    await this.queue.upsertJobScheduler(schedulerId, { every: dayMs, startDate: Date.now() + dayMs }, {
      name: schedulerId, opts: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
    })
  }

  scheduler() { return this.queue.getJobScheduler(schedulerId) }

  async process(job: Job) {
    if (job.name !== schedulerId) return
    const guestCutoff = new Date(Date.now() - 30 * dayMs)
    const proposalCutoff = new Date(Date.now() - 60 * dayMs)
    let batch: { calculations: number; audits: number; profiles: number; proposals: number }
    const deleted = { calculations: 0, audits: 0, profiles: 0, proposals: 0 }
    do {
      batch = await this.prisma.$transaction(tx => this.purgeBatch(tx, guestCutoff, proposalCutoff), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      })
      deleted.calculations += batch.calculations
      deleted.audits += batch.audits
      deleted.profiles += batch.profiles
      deleted.proposals += batch.proposals
    } while (Object.values(batch).some(count => count === batchSize))
    return deleted
  }

  private async purgeBatch(tx: Prisma.TransactionClient, guestCutoff: Date, proposalCutoff: Date) {
    const guest = { userId: null, createdAt: { lt: guestCutoff } }
    const select = { id: true } as const
    const batchOptions = { select, take: batchSize, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } as const
    const orderBy = [...batchOptions.orderBy]
    const calculations = await tx.calculationSession.findMany({ ...batchOptions, orderBy, where: guest })
    const removedCalculations = await tx.calculationSession.deleteMany({
      where: { ...guest, id: { in: calculations.map(row => row.id) } },
    })

    const removableAudit = {
      ...guest,
      calculationSessions: { none: { userId: { not: null } } },
      feedbackExamples: { none: { reviewStatus: 'APPROVED' } },
    }
    const audits = await tx.forensicAudit.findMany({ ...batchOptions, orderBy, where: removableAudit })
    const auditIds = audits.map(row => row.id)
    if (auditIds.length) {
      await tx.forensicFinding.deleteMany({ where: { auditId: { in: auditIds } } })
      await tx.forensicQrPayload.deleteMany({ where: { auditId: { in: auditIds } } })
    }
    const removedAudits = await tx.forensicAudit.deleteMany({ where: { ...removableAudit, id: { in: auditIds } } })
    if (removedAudits.count !== auditIds.length) throw new Error('Guest audit changed during maintenance')

    const orphan = {
      ...guest, updatedAt: { lt: guestCutoff }, forensicAudits: { none: {} },
      calculationSessions: { none: {} }, impactAnalyses: { none: {} },
    }
    const profiles = await tx.financialProfile.findMany({ ...batchOptions, orderBy, where: orphan })
    const removedProfiles = await tx.financialProfile.deleteMany({
      where: { ...orphan, id: { in: profiles.map(row => row.id) } },
    })

    const removableProposal = {
      originSource: 'FORENSIC_COMMUNITY', verificationStatus: 'UNVERIFIED', hitCount: 1, createdAt: { lt: proposalCutoff },
      forensicAudits: { none: { userId: { not: null } } },
      feedbackExamples: { none: { reviewStatus: 'APPROVED' } },
      indicators: { none: { forensicFindings: { some: {} } } },
    }
    const proposals = await tx.threatAlert.findMany({ ...batchOptions, orderBy, where: removableProposal })
    const proposalIds = proposals.map(row => row.id)
    if (proposalIds.length) {
      await tx.threatIndicator.deleteMany({ where: { threatAlertId: { in: proposalIds } } })
      await tx.threatEvidence.deleteMany({ where: { threatAlertId: { in: proposalIds } } })
    }
    const removedProposals = await tx.threatAlert.deleteMany({ where: { ...removableProposal, id: { in: proposalIds } } })
    if (removedProposals.count !== proposalIds.length) throw new Error('Community proposal changed during maintenance')

    return { calculations: removedCalculations.count, audits: removedAudits.count,
      profiles: removedProfiles.count, proposals: removedProposals.count }
  }
}
