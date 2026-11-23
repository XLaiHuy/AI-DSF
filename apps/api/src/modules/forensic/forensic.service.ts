import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  AI_TASK_SCHEMAS, ForensicAuditListResponseSchema, ForensicAuditResponseSchema,
  type ForensicAuditFields, type ForensicAuditResponse, type SessionContext,
} from '@fincopilot/shared-types'
import { z } from 'zod'
import { maskAccount, maskPii } from '../../common/pii-masker'
import { PrismaService } from '../../common/prisma.service'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { extractAuditEvidence, type Upload } from './forensic-extraction'
import { deterministicNarrative } from './forensic-narrative'
import { evaluateHardRules } from './hard-rules.engine'

const reportExtras = ForensicAuditResponseSchema.pick({
  mathBreakdown: true, handoffPayload: true, immediateActions: true, intentSignals: true, entityLicense: true, meta: true,
})

function ownerFilter(session: SessionContext) {
  return session.kind === 'user' ? { userId: session.userId } : { userId: null, guestSessionId: session.guestSessionId }
}

function sanitize(text: string): string {
  return maskPii(text.replaceAll('\0', ''))
}

function redactBeneficiary(text: string, name: string | null, redacted: string | null) {
  if (!name || !redacted) return sanitize(text)
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return sanitize(text.replace(new RegExp(escaped, 'giu'), () => redacted))
}

function beneficiaryLabel(name: string | null) {
  if (!name) return null
  return name.trim().split(/\s+/).map((part) => `${[...part][0]}***`).join(' ').slice(0, 150)
}

@Injectable()
export class ForensicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiGatewayService,
    private readonly config: ConfigService,
  ) {}

  async audit(session: SessionContext, fields: ForensicAuditFields, files: readonly Upload[]) {
    if (!files.length && !fields.rawText && !fields.rawQrString && !fields.claimedEntityName) {
      throw new BadRequestException({
        errorCode: 'ERR_VALIDATION_FAILED',
        message: 'Hãy cung cấp tệp, văn bản, mã VietQR hoặc tên tổ chức cần kiểm tra.',
      })
    }
    const limit = z.coerce.number().int().positive()
    const evidence = await extractAuditEvidence(this.ai, fields, files,
      limit.parse(this.config.get('UPLOAD_MAX_MB', '20')),
      limit.parse(this.config.get('PDF_MAX_PAGES', '5')))
    const sourceFilesPurgedAt = new Date()
    const [indicators, institutions] = await Promise.all([
      this.prisma.threatIndicator.findMany({
        where: { threatAlert: { verificationStatus: 'VERIFIED' } },
        select: { id: true, indicatorText: true, indicatorType: true },
      }),
      this.prisma.financialInstitution.findMany({
        select: { code: true, name: true, licenseIssuer: true, trustStatus: true, vietqrBin: true },
      }),
    ])
    const rules = evaluateHardRules({
      evidence: evidence.evidence,
      claimedEntityName: evidence.claimedEntityName,
      qrPayloads: evidence.qrPayloads,
      indicators,
      institutions,
      loan: evidence.loan,
      intentSignals: evidence.intentSignals,
    })
    const insufficientEvidence = !evidence.evidence.length && !evidence.qrPayloads.some((qr) => qr.crcValid)
    const needsReview = rules.verdictLevel === 'SAFE' && (insufficientEvidence || evidence.visionDegraded && files.length > 0)
    const verdictLevel = needsReview ? 'CAUTION' : rules.verdictLevel
    const riskScore = needsReview ? Math.max(30, rules.riskScore) : rules.riskScore
    const bankNames = new Map(institutions.flatMap(({ vietqrBin, name }) => vietqrBin ? [[vietqrBin, name]] : []))
    const redactedBeneficiary = beneficiaryLabel(evidence.beneficiaryName)
    const redact = (text: string) => redactBeneficiary(text, evidence.beneficiaryName, redactedBeneficiary)
    const findings = rules.findings.map((finding) => ({
      ...finding, evidenceQuote: redact(finding.evidenceQuote),
    }))
    const qrPayloads: ForensicAuditResponse['qrPayloads'] = evidence.qrPayloads.map((qr) => ({
      acqBin: qr.acqBin,
      bankName: (qr.acqBin ? bankNames.get(qr.acqBin) ?? qr.bankName : qr.bankName)?.slice(0, 120) ?? null,
      accountNumberMasked: qr.account ? maskAccount(qr.account) : null,
      serviceCode: qr.serviceCode,
      qrAmountVnd: qr.amountVnd,
      purposeText: qr.purpose ? redact(qr.purpose) : null,
      crcValid: qr.crcValid,
      visionBeneficiaryName: beneficiaryLabel(qr.visionBeneficiaryName),
      entityMismatchFlag: rules.mismatchedQrs.includes(qr),
    }))
    const fallback = deterministicNarrative(verdictLevel, findings.length)
    const narrativeTask = 'FORENSIC_VERDICT_NARRATIVE'
    // Use curated descriptions so quotes from untrusted evidence never become narrative instructions.
    const narrative = await this.ai.generateWithProvider(narrativeTask, AI_TASK_SCHEMAS[narrativeTask], {
      text: JSON.stringify({ verdictLevel, riskScore, findings: findings.map(({ ruleCode, severity, title }) => ({
        ruleCode, severity, title,
      })) }),
    }).catch(() => null)
    const degradedMode = evidence.visionDegraded || !narrative
    const response = ForensicAuditResponseSchema.parse({
      auditId: randomUUID(), riskScore, verdictLevel,
      deterministicOverride: rules.deterministicOverride,
      claimedEntityName: evidence.claimedEntityName ? redact(evidence.claimedEntityName) : null,
      entityLicense: rules.entityLicense,
      mathBreakdown: rules.mathBreakdown, qrPayloads, findings,
      privacyProof: { sourceFilesPurgedAt: sourceFilesPurgedAt.toISOString(), rawTextMasked: evidence.rawText ? redact(evidence.rawText) : null },
      aiNarrative: narrative ? `${fallback.narrative}\n\n${sanitize(narrative.output.narrative)}` : fallback.narrative,
      immediateActions: [...new Set([
        ...fallback.immediateActions,
        ...(narrative?.output.immediateActions.map(sanitize) ?? []),
      ])].slice(0, 6),
      intentSignals: evidence.intentSignals,
      handoffPayload: rules.mathBreakdown && evidence.loan ? {
        suggestedAmountVnd: rules.mathBreakdown.principalNominalVnd, suggestedTermMonths: evidence.loan.termMonths,
      } : null,
      meta: { llmProvider: narrative?.provider ?? evidence.visionProvider, degradedMode,
        ...(degradedMode ? { errorCode: 'ERR_AI_DEGRADED_FALLBACK' } : {}) },
    })
    const apr = response.mathBreakdown?.effectiveAprPct
    await this.prisma.forensicAudit.create({
      data: {
        id: response.auditId, ...ownerFilter(session), sourceFilesPurgedAt,
        claimedEntityName: response.claimedEntityName,
        inputChannels: evidence.channels,
        rawTextMasked: response.privacyProof.rawTextMasked,
        extractedClaimsJson: reportExtras.parse({
          mathBreakdown: response.mathBreakdown, handoffPayload: response.handoffPayload,
          immediateActions: response.immediateActions, intentSignals: response.intentSignals,
          entityLicense: response.entityLicense, meta: response.meta,
        }),
        principalNominalVnd: response.mathBreakdown?.principalNominalVnd,
        principalNetVnd: response.mathBreakdown?.principalNetVnd,
        quotedRatePct: response.mathBreakdown ? evidence.loan?.flatMonthlyRatePct : undefined,
        // The scalar column is Decimal(8,4). The report JSON retains the exact result.
        effectiveAprPct: apr && /^\d{1,4}\.\d{4}$/.test(apr) ? apr : undefined,
        verdictLevel, riskScore, deterministicOverride: response.deterministicOverride,
        aiExplanationText: response.aiNarrative, llmProvider: response.meta.llmProvider ?? 'deterministic',
        qrPayloads: { create: qrPayloads.map((qr) => ({ id: randomUUID(), rawQrString: '[redacted]', ...qr })) },
        findings: { createMany: { data: findings.map((finding) => ({ id: randomUUID(), ...finding })) } },
      },
    })
    return response
  }

  async list(session: SessionContext) {
    const audits = await this.prisma.forensicAudit.findMany({
      where: ownerFilter(session),
      select: { id: true, verdictLevel: true, riskScore: true, claimedEntityName: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    })
    return ForensicAuditListResponseSchema.parse({ audits: audits.map(({ id, createdAt, ...audit }) => ({
      ...audit, auditId: id, createdAt: createdAt.toISOString(),
    })) })
  }

  async read(session: SessionContext, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException()
    const row = await this.prisma.forensicAudit.findFirst({
      where: { id, ...ownerFilter(session) },
      include: {
        qrPayloads: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        findings: { orderBy: [{ ruleCode: 'asc' }, { id: 'asc' }] },
      },
    })
    if (!row) throw new NotFoundException()
    const extras = reportExtras.safeParse(row.extractedClaimsJson)
    const defaults = deterministicNarrative(ForensicAuditResponseSchema.shape.verdictLevel.parse(row.verdictLevel), row.findings.length)
    return ForensicAuditResponseSchema.parse({
      auditId: row.id, verdictLevel: row.verdictLevel, riskScore: row.riskScore,
      deterministicOverride: row.deterministicOverride, claimedEntityName: row.claimedEntityName,
      qrPayloads: row.qrPayloads.map(({
        acqBin, bankName, accountNumberMasked, serviceCode, qrAmountVnd, purposeText,
        crcValid, visionBeneficiaryName, entityMismatchFlag,
      }) => ({
        acqBin, bankName, accountNumberMasked, serviceCode, qrAmountVnd: qrAmountVnd?.toFixed() ?? null,
        purposeText, crcValid, visionBeneficiaryName, entityMismatchFlag,
      })),
      findings: row.findings.map(({ ruleCode, severity, scoreImpact, title, description, evidenceQuote, matchedIndicatorId }) => ({
        ruleCode, severity, scoreImpact, title, description, evidenceQuote, matchedIndicatorId,
      })),
      privacyProof: { sourceFilesPurgedAt: row.sourceFilesPurgedAt.toISOString(), rawTextMasked: row.rawTextMasked },
      aiNarrative: row.aiExplanationText,
      ...(extras.success ? extras.data : {
        mathBreakdown: null, handoffPayload: null, immediateActions: defaults.immediateActions,
        meta: { llmProvider: row.llmProvider === 'deterministic' ? null : row.llmProvider,
          degradedMode: row.llmProvider === 'deterministic' },
      }),
    })
  }
}
