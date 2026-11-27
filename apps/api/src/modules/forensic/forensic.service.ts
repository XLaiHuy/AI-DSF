import { InjectQueue } from '@nestjs/bullmq'
import type { Queue } from 'bullmq'
import { createHash, randomUUID } from 'node:crypto'
import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Prisma } from '@prisma/client'
import {
  AI_TASK_SCHEMAS, ForensicAuditListResponseSchema, ForensicAuditResponseSchema,
  ForensicFollowUpResponseSchema, ForensicQrMetadataSchema, UserAuditFeedbackResponseSchema, type UserAuditFeedback,
  type ForensicAuditFields, type ForensicAuditResponse, type ForensicAuditStage, type ForensicFollowUpRequest, type SessionContext,
} from '@fincopilot/shared-types'
import { z } from 'zod'
import { maskAccount } from '../../common/pii-masker'
import { PrismaService } from '../../common/prisma.service'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { extractAuditEvidence, type ForensicExtractionObservation, type Upload } from './forensic-extraction'
import { buildForensicDossier, buildNarrativeInput, completeNarrativePayment, deterministicNarrative, isGroundedForensicNarrative, mentionsCasePayment } from './forensic-narrative'
import { evaluateHardRules } from './hard-rules.engine'
import type { CatalogInstitution } from './data/trusted-institutions'
import { maskedQrLink, maskForensicText } from './qr-evidence'
import { threatIndicatorFilters } from './threat-indicator-lookup'
import { classifyAuditComplexity, hasSuspiciousContext } from './complexity-router'
import { elevateVerdict, groundReasoningFindings } from './deep-reasoning'
import { followUpEvents, screened } from './forensic-chat-stream'
import { classifyFollowUpIntent, prepareFollowUp, statedTransferAmount } from './forensic-follow-up'
import { evaluatePersonalImpact } from './personal-impact.engine'
import { selectLegalCitations } from './data/vn-legal-registry'
import { ChannelIntelligenceService } from './channel-intelligence.service'
import { expandTeencode, stripZeroWidthAndBidi } from './forensic-prompt-guard'
import { extractThreatIocs } from './threat-iocs'
import { communityProposalQueue } from './community-proposal.processor'
import { ConversationSessionStore } from './conversation-session.store'
import type { PreAuditTurn } from './context-compressor'
import { buildForensicRiskAssessment } from './risk-assessment.engine'
import { routeForensicConversation } from './forensic-conversation'
import { type CommunityProposal, ThreatMemoryService } from './threat-memory.service'

const institutionCacheTtlMs = 5 * 60_000

export type ForensicBenchmarkObservation = {
  baselineVerdict: ForensicAuditResponse['verdictLevel']
  reasoningProvider: string | null
  reasoningProposed: number
  reasoningGrounded: number
  narrativeProvider: string | null
  narrativeGrounded: boolean | null
  paymentMentioned: boolean | null
  narrativeRetried: boolean
}

const reportExtras = ForensicAuditResponseSchema.pick({
  mathBreakdown: true, handoffPayload: true, immediateActions: true, intentSignals: true, entityLicense: true, meta: true,
  complexityTier: true, reasoningFindings: true, personalImpact: true, legalCitations: true,
}).extend({
  qrMetadata: z.record(z.uuid(), ForensicQrMetadataSchema).optional(),
  repaymentMethod: z.enum(['FLAT', 'DECLINING_EQUAL_PRINCIPAL', 'DECLINING_ANNUITY']).optional(),
})

function ownerFilter(session: SessionContext) {
  return session.kind === 'user' ? { userId: session.userId } : { userId: null, guestSessionId: session.guestSessionId }
}

function feedbackReporter(session: SessionContext) {
  const ownerId = session.kind === 'user' ? session.userId : session.guestSessionId
  return createHash('sha256').update(session.kind + ':' + ownerId).digest('hex')
}

export function validateAuditInput(fields: ForensicAuditFields, files: readonly Upload[]) {
  if (!files.length && !fields.rawText && !fields.rawQrString && !fields.claimedEntityName) {
    throw new BadRequestException({
      errorCode: 'ERR_VALIDATION_FAILED',
      message: 'Hãy cung cấp tệp, văn bản, mã VietQR hoặc tên tổ chức cần kiểm tra.',
    })
  }
}

const stageLabels: Record<ForensicAuditStage['step'], string> = {
  EXTRACT: 'Đọc bằng chứng',
  RULES: 'Đối chiếu dấu hiệu và hồ sơ',
  REASONING: 'Phân tích sâu',
  NARRATIVE: 'Soạn báo cáo',
}

function redactKnown(text: string, replacements: Map<string, string>) {
  text = stripZeroWidthAndBidi(text)
  for (const [value, masked] of replacements) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    text = text.replace(new RegExp(escaped, 'giu'), () => masked)
  }
  return maskForensicText(text)
}

function beneficiaryLabel(name: string | null) {
  if (!name) return null
  return name.trim().split(/\s+/).map((part) => `${[...part][0]}***`).join(' ').slice(0, 150)
}

@Injectable()
export class ForensicService {
  private readonly channelIntelligence = new ChannelIntelligenceService()
  private readonly logger = new Logger(ForensicService.name)
  private institutionCache?: { rows: CatalogInstitution[]; expiresAt: number }
  private institutionRefresh?: Promise<CatalogInstitution[]>

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiGatewayService,
    private readonly config: ConfigService,
    private readonly threatMemory?: ThreatMemoryService,
    @Optional() @InjectQueue(communityProposalQueue) private readonly communityQueue?: Queue<CommunityProposal>,
    @Optional() private readonly conversations?: ConversationSessionStore,
  ) {}

  async screenAudit(fields: ForensicAuditFields, files: readonly Upload[], session?: SessionContext) {
    const { conversationId, rawText } = fields
    const store = this.conversations
    const aliases = this.threatMemory?.cachedAliases()
    if (!session || !conversationId || !store) return routeForensicConversation(fields, files.length > 0, this.ai, aliases)

    let pending: ReturnType<ConversationSessionStore['load']> | undefined
    const load = () => (pending ??= store.load(session, conversationId)).catch(() => undefined)
    const result = await routeForensicConversation(fields, files.length > 0, this.ai, aliases, async () => (await load())?.state)
    if (result?.type !== 'guidance' || !rawText) return result

    const snapshot = await load()
    if (!snapshot) return result
    const previous = snapshot.state
    const { domain, ...slots } = result.extractedSlots ?? {}
    const turns: PreAuditTurn[] = [
      { role: 'user', content: maskForensicText(rawText) },
      { role: 'assistant', content: result.message, intent: result.intent },
    ]
    await store.save(session, conversationId, snapshot.raw, {
      domain: domain ?? previous?.domain,
      slots: { ...(domain && domain !== previous?.domain ? {} : previous?.slots), ...slots },
      rollingSummary: previous?.rollingSummary ?? '',
      recentTurns: [...(previous?.recentTurns ?? []), ...turns.filter(turn => turn.content.length > 0 && turn.content.length <= 800)],
      lastIntent: result.intent,
      updatedAt: new Date().toISOString(),
    }).catch(() => undefined)
    return result
  }

  async deleteConversation(session: SessionContext, id: string) {
    await this.conversations?.remove(session, id)
  }

  private async loadInstitutions() {
    const cached = this.institutionCache
    if (cached && cached.expiresAt > Date.now()) return cached.rows
    this.institutionRefresh ??= this.prisma.financialInstitution.findMany({
      select: { code: true, name: true, licenseIssuer: true, trustStatus: true, institutionType: true, vietqrBin: true },
    }).then((rows) => {
      this.institutionCache = { rows, expiresAt: Date.now() + institutionCacheTtlMs }
      return rows
    }).finally(() => { this.institutionRefresh = undefined })
    return this.institutionRefresh
  }

  private async loadThreatIndicators(evidence: Awaited<ReturnType<typeof extractAuditEvidence>>) {
    const filters = threatIndicatorFilters(evidence)
    const threatAlert = { verificationStatus: 'VERIFIED' }
    const query = {
      select: { id: true, indicatorText: true, indicatorType: true },
      orderBy: [{ threatAlert: { createdAt: 'desc' } }, { id: 'desc' }],
      take: 500,
    } satisfies Prisma.ThreatIndicatorFindManyArgs
    const [exact, patterns] = await Promise.all([
      filters.length ? this.prisma.threatIndicator.findMany({
        ...query, where: { threatAlert, OR: filters },
      }) : [],
      this.prisma.threatIndicator.findMany({
        ...query, where: { threatAlert, indicatorType: { in: ['KEYWORD', 'QR_PATTERN'] } },
      }),
    ])
    return [...exact, ...patterns]
  }

  async audit(session: SessionContext, fields: ForensicAuditFields, files: readonly Upload[],
    onStage?: (stage: ForensicAuditStage) => void,
    benchmark?: {
      onExtraction: (observation: ForensicExtractionObservation) => void
      onReport: (observation: ForensicBenchmarkObservation) => void
    },
  ) {
    validateAuditInput(fields, files)
    const stage = (step: ForensicAuditStage['step'], status: ForensicAuditStage['status'], detail?: string) =>
      onStage?.({ step, status, label: stageLabels[step], detail })
    const limit = z.coerce.number().int().positive()
    stage('EXTRACT', 'running')
    const evidence = await extractAuditEvidence(this.ai, fields, files,
      limit.parse(this.config.get('UPLOAD_MAX_MB', '20')),
      limit.parse(this.config.get('PDF_MAX_PAGES', '5')), benchmark?.onExtraction)
    const sourceFilesPurgedAt = new Date()
    stage('EXTRACT', 'done', `${files.length} tệp · ${evidence.qrPayloads.length} mã QR`)
    stage('RULES', 'running')
    const evidenceText = [...evidence.evidence, ...evidence.visionQuotes].join('\n')
    const iocs = this.threatMemory ? extractThreatIocs(evidenceText, evidence.qrPayloads) : []
    const [learning, institutions, profile, sourceAlert] = await Promise.all([
      this.threatMemory?.get().then(async ({ aliases }) => {
        const suspicious = hasSuspiciousContext(expandTeencode(evidenceText, aliases).normalized)
        const shouldEmbed = Boolean(files.length || evidence.qrPayloads.length || evidenceText.length > 160 || iocs.length || suspicious)
        return { memory: await this.threatMemory?.retrieve(evidenceText, iocs, { shouldEmbed }), suspicious }
      }),
      this.loadInstitutions(),
      this.loadFinancialProfile(session),
      fields.sourceAlertId ? this.prisma.threatAlert.findFirst({
        where: { id: fields.sourceAlertId, verificationStatus: 'VERIFIED', publishedAt: { not: null } }, select: { id: true, threatCategory: true },
      }) : null,
    ])
    const memory = learning?.memory
    const suspicious = learning?.suspicious ?? hasSuspiciousContext(expandTeencode(evidenceText).normalized)
    const hasTier2ThreatMatch = Boolean(memory?.tactics.length || memory?.examples.length)
    const indicators = (memory?.indicators ?? await this.loadThreatIndicators(evidence))
      .filter(({ indicatorType }) => indicatorType !== 'KEYWORD')
    const inspectedQrs = await this.channelIntelligence.inspect(evidence.qrPayloads, indicators)
    const statedTransferAmountVnd = statedTransferAmount(evidence.rawText)
    const rules = evaluateHardRules({
      evidence: evidence.evidence,
      normalizeEvidence: memory ? (text) => expandTeencode(text, memory.aliases).normalized : undefined,
      claimedEntityName: evidence.claimedEntityName,
      qrPayloads: inspectedQrs,
      statedTransferAmountVnd,
      indicators,
      institutions,
      loan: evidence.loan,
      conditionalLoan: evidence.conditionalLoan,
      intentSignals: evidence.intentSignals,
      hasPromptTampering: evidence.hasPromptTampering,
    })
    const insufficientEvidence = !evidence.evidence.length && !evidence.qrPayloads.some((qr) => qr.crcValid)
    const needsReview = rules.verdictLevel === 'SAFE' &&
      (insufficientEvidence || evidence.visionDegraded && files.length > 0 && !rules.clearPayment)
    const baseline = needsReview ? { verdictLevel: 'CAUTION' as const, riskScore: Math.max(30, rules.riskScore) } : rules
    const complexityTier = classifyAuditComplexity({
      ...baseline, findings: rules.findings, intentSignals: evidence.intentSignals, fileCount: files.length,
      hasTier2ThreatMatch, hasSuspiciousContext: suspicious,
      hasPdf: evidence.channels.includes('PDF'), hasQr: evidence.qrPayloads.length > 0, textLength: evidence.rawText.length,
      hasConditionalLoanTerms: Boolean(evidence.conditionalLoan.conditionalQuote || evidence.conditionalLoan.floatingQuote ||
        evidence.conditionalLoan.insuranceQuote),
      licensedWithAnomaly: rules.entityLicense?.status === 'LICENSED' && (
        rules.findings.length > 0 || evidence.hasVisionRedFlags || /[1-9]/.test(evidence.loan?.upfrontFeeVnd ?? '') ||
        evidence.qrPayloads.some((qr) => qr.qrScheme === 'URL_LINK' || qr.qrScheme === 'UNKNOWN' ||
          qr.qrScheme === 'VIETQR_NAPAS' && !qr.crcValid)
      ),
    })
    const tier1ExactMatches = new Set(rules.findings.flatMap(({ ruleCode, matchedIndicatorId }) =>
      ruleCode === 'RULE_05_NCSC_THREAT_MATCH' && matchedIndicatorId ? [matchedIndicatorId] : [])).size
    const learningTrace = memory && {
      ...memory.learningTrace,
      tier1ExactMatches: Math.max(tier1ExactMatches, memory.learningTrace.tier1ExactMatches),
      zeroShotEscalated: suspicious && !tier1ExactMatches && !memory.learningTrace.tier1ExactMatches && !hasTier2ThreatMatch,
    }
    const bankNames = new Map(institutions.flatMap(({ vietqrBin, name }) => vietqrBin ? [[vietqrBin, name]] : []))
    const replacements = new Map<string, string>()
    if (evidence.beneficiaryName) {
      replacements.set(evidence.beneficiaryName, beneficiaryLabel(evidence.beneficiaryName) ?? '')
    }
    for (const qr of evidence.qrPayloads) {
      if (qr.account && qr.account.length >= 7) replacements.set(qr.account, maskAccount(qr.account))
      if (qr.qrScheme === 'EWALLET_VN' && qr.merchantName) {
        replacements.set(qr.merchantName, beneficiaryLabel(qr.merchantName) ?? '')
      }
    }
    const redact = (text: string) => redactKnown(text, replacements)
    const findings = rules.findings.map((finding) => ({
      ...finding, title: redact(finding.title).slice(0, 200), description: redact(finding.description), evidenceQuote: redact(finding.evidenceQuote),
    }))
    const savedQrs = inspectedQrs.map((qr) => ({
      id: randomUUID(), rawQrString: '[redacted]',
      base: {
        acqBin: qr.acqBin,
        bankName: redact((qr.acqBin ? bankNames.get(qr.acqBin) ?? qr.bankName : qr.bankName) ?? '').slice(0, 120) || null,
        accountNumberMasked: qr.account ? maskAccount(qr.account) : null,
        serviceCode: qr.serviceCode,
        qrAmountVnd: qr.amountVnd,
        purposeText: qr.purpose ? redact(qr.purpose) : null,
        crcValid: qr.crcValid,
        visionBeneficiaryName: beneficiaryLabel(qr.visionBeneficiaryName),
        entityMismatchFlag: rules.mismatchedQrs.includes(qr),
      },
      metadata: ForensicQrMetadataSchema.parse({
        qrScheme: qr.qrScheme, providerLabel: qr.providerLabel ? redact(qr.providerLabel) : null,
        countryCode: qr.countryCode, currencyCode: qr.currencyCode, walletNetwork: qr.walletNetwork,
        targetUrl: qr.targetUrl ? maskedQrLink(qr.targetUrl) : null,
        merchantName: qr.merchantName ? redact(qr.merchantName) : null,
        merchantCategoryCode: qr.merchantCategoryCode,
        channelIntelligence: qr.channelIntelligence,
        amount: qr.amount,
      }),
    }))
    const qrPayloads = savedQrs.map(({ base, metadata }) => ({ ...base, ...metadata }))
    const sourceMath = rules.mathBreakdown
    const mathBreakdown = sourceMath?.stressScenario ? {
      ...sourceMath, stressScenario: {
        ...sourceMath.stressScenario,
        evidenceQuote: redact(sourceMath.stressScenario.evidenceQuote),
        triggerCondition: redact(sourceMath.stressScenario.triggerCondition),
      },
    } : sourceMath
    const personalImpact = evaluatePersonalImpact(profile, mathBreakdown, [{ qrAmountVnd: statedTransferAmountVnd }, ...qrPayloads])
    const profileDetail = personalImpact ? 'đã đối chiếu với hồ sơ cá nhân'
      : profile ? 'chưa đủ dữ liệu để đối chiếu cá nhân' : 'chưa có hồ sơ cá nhân'
    stage('RULES', 'done', `${findings.length} dấu hiệu · ${profileDetail}`)
    const reasoningTask = 'FORENSIC_DEEP_REASONING'
    const compactMath = mathBreakdown && Object.fromEntries(Object.entries(mathBreakdown).filter(([field]) => field !== 'schedule' && field !== 'first12Payments'))
    const shouldReason = complexityTier !== 'EASY' || Boolean(benchmark)
    const maskedEvidence = shouldReason ? [...evidence.evidence, ...evidence.visionQuotes].map(redact).filter(Boolean) : []
    if (shouldReason) stage('REASONING', 'running')
    const reasoning = !shouldReason ? null : await this.ai.generateWithProvider(reasoningTask, AI_TASK_SCHEMAS[reasoningTask], {
      text: JSON.stringify({
        evidence: maskedEvidence, qrPayloads, mathBreakdown: compactMath, entityLicense: rules.entityLicense,
        threatTactics: memory?.tactics, threatExamples: memory?.examples.map(({ feedbackType, sample, expectedVerdict }) =>
          ({ feedbackType, sample, expectedVerdict })),
        teencodeGlossary: memory?.glossary ? 'Chú giải cách viết tắt. Khi trích dẫn, dùng nguyên văn bằng chứng. ' + redact(memory.glossary) : undefined,
        intentSignals: evidence.intentSignals, existingFindings: findings, baseline: { verdictLevel: baseline.verdictLevel, riskScore: baseline.riskScore },
      }),
    }).catch(() => null)
    const reasoningFindings = reasoning ? groundReasoningFindings(reasoning.output.findings, maskedEvidence, redact) : []
    if (shouldReason) stage('REASONING', 'done')
    const { verdictLevel, riskScore } = elevateVerdict(baseline, reasoningFindings)
    const claimedEntityName = evidence.claimedEntityName ? redact(evidence.claimedEntityName) : null
    const legalCitations = selectLegalCitations({ verdictLevel, mathBreakdown, findings, qrPayloads, entityLicense: rules.entityLicense, claimedEntityName })
    const dossier = buildForensicDossier({
      verdictLevel, riskScore, claimedEntityName, entityLicense: rules.entityLicense, qrPayloads,
      mathBreakdown, personalImpact, findings, reasoningFindings, legalCitations,
    })
    const fallback = deterministicNarrative({
      verdictLevel, findingCount: dossier.findingCount, claimedEntityName, qrPayloads, mathBreakdown, personalImpact, findings,
    })
    const narrativeTask = 'FORENSIC_VERDICT_NARRATIVE'
    stage('NARRATIVE', 'running')
    const narrativeInput = buildNarrativeInput(dossier)
    const generateNarrative = async (qualitativeOnly: boolean) => {
      const generated = await this.ai.generateWithProvider(narrativeTask, AI_TASK_SCHEMAS[narrativeTask], {
        text: JSON.stringify({ dossier: narrativeInput, ...(qualitativeOnly && { qualitativeOnly }) }),
      }).catch(() => null)
      if (!generated) return null
      const original = generated.output.narrative
      const text = completeNarrativePayment(redact(original), dossier)
      const grounded = Boolean(screened(original, false)) &&
        isGroundedForensicNarrative(original, dossier) && isGroundedForensicNarrative(text, dossier)
      const paymentMentioned = mentionsCasePayment(text, dossier)
      return { generated, text, grounded, paymentMentioned, accepted: grounded && paymentMentioned }
    }
    let candidate = await generateNarrative(false)
    const narrativeRetried = candidate !== null && !candidate.accepted
    if (narrativeRetried) candidate = await generateNarrative(true) ?? candidate
    const narrative = candidate?.accepted ? candidate : null
    const actions = (candidate?.generated.output.immediateActions ?? [])
      .filter((action) => screened(action, false) && isGroundedForensicNarrative(action, dossier)).map(redact)
    const degradedMode = evidence.visionDegraded || !narrative || (shouldReason && !reasoning)
    benchmark?.onReport({
      baselineVerdict: baseline.verdictLevel,
      reasoningProvider: reasoning?.provider ?? null,
      reasoningProposed: reasoning?.output.findings.length ?? 0,
      reasoningGrounded: reasoningFindings.length,
      narrativeProvider: candidate?.generated.provider ?? null,
      narrativeGrounded: candidate?.grounded ?? null,
      paymentMentioned: candidate?.paymentMentioned ?? null,
      narrativeRetried,
    })
    const createdAt = new Date()
    const response = ForensicAuditResponseSchema.parse({
      auditId: randomUUID(), createdAt: createdAt.toISOString(), riskScore, verdictLevel,
      complexityTier, reasoningFindings,
      deterministicOverride: rules.deterministicOverride,
      claimedEntityName,
      entityLicense: rules.entityLicense,
      mathBreakdown, qrPayloads, findings, personalImpact, legalCitations,
      privacyProof: { sourceFilesPurgedAt: sourceFilesPurgedAt.toISOString(), rawTextMasked: evidence.rawText ? redact(evidence.rawText) : null },
      aiNarrative: narrative?.text ?? fallback.narrative,
      immediateActions: [...new Set([...fallback.immediateActions, ...actions])].slice(0, 6),
      intentSignals: evidence.intentSignals,
      handoffPayload: mathBreakdown?.termMonths ? {
        suggestedAmountVnd: mathBreakdown.principalNominalVnd, suggestedTermMonths: mathBreakdown.termMonths,
      } : null,
      meta: { llmProvider: narrative?.generated.provider ?? evidence.visionProvider, degradedMode, learningTrace,
        ...(degradedMode ? { errorCode: 'ERR_AI_DEGRADED_FALLBACK' } : {}) },
    })
    const apr = response.mathBreakdown?.effectiveAprPct
    await this.prisma.forensicAudit.create({
      data: {
        id: response.auditId, ...ownerFilter(session), sourceFilesPurgedAt, createdAt,
        profileId: profile?.id, sourceAlertId: sourceAlert?.id,
        claimedEntityName: response.claimedEntityName,
        inputChannels: evidence.channels,
        rawTextMasked: response.privacyProof.rawTextMasked,
        extractedClaimsJson: reportExtras.parse({
          mathBreakdown: response.mathBreakdown, handoffPayload: response.handoffPayload,
          immediateActions: response.immediateActions, intentSignals: response.intentSignals,
          entityLicense: response.entityLicense, meta: response.meta,
          complexityTier: response.complexityTier, reasoningFindings: response.reasoningFindings, personalImpact, legalCitations,
          repaymentMethod: evidence.conditionalLoan.spec?.repaymentMethod,
          qrMetadata: Object.fromEntries(savedQrs.map(({ id, metadata }) => [id, metadata])),
        }),
        principalNominalVnd: response.mathBreakdown?.principalNominalVnd,
        principalNetVnd: response.mathBreakdown?.principalNetVnd,
        quotedRatePct: response.mathBreakdown && !evidence.conditionalLoan.spec ? evidence.loan?.flatMonthlyRatePct : undefined,
        // The scalar column is Decimal(8,4). The report JSON retains the exact result.
        effectiveAprPct: apr && /^\d{1,4}\.\d{4}$/.test(apr) ? apr : undefined,
        verdictLevel, riskScore, deterministicOverride: response.deterministicOverride,
        aiExplanationText: response.aiNarrative, llmProvider: response.meta.llmProvider ?? 'deterministic',
        qrPayloads: { create: savedQrs.map(({ id, rawQrString, base }) => ({ id, rawQrString, ...base })) },
        findings: { createMany: { data: findings.map((finding) => ({ id: randomUUID(), ...finding })) } },
      },
    })
    if (verdictLevel === 'HIGH_RISK' && !degradedMode && iocs.length && this.threatMemory && this.communityQueue) {
      try {
        const proposal = await this.threatMemory.prepareProposal(session, iocs, redact(evidenceText))
        if (proposal.candidates.length) await this.communityQueue.add('propose', proposal, {
          jobId: response.auditId, attempts: 3, backoff: { type: 'exponential', delay: 1000 },
        })
      } catch {
        this.logger.warn({ event: 'forensic_community_enqueue_failed', auditId: response.auditId })
      }
    }
    stage('NARRATIVE', 'done')
    return { ...response, riskAssessment: buildForensicRiskAssessment(response, {
      sourceAlertVerified: Boolean(sourceAlert), threatCategory: sourceAlert?.threatCategory,
    }) }
  }

  private async loadFinancialProfile(session: SessionContext) {
    const profile = await this.prisma.financialProfile.findFirst({ where: ownerFilter(session), select: {
      id: true, monthlyIncomeVnd: true, monthlyExpenseVnd: true, existingDebtPaymentVnd: true, liquidSavingsVnd: true,
    } })
    return profile ? {
      id: profile.id,
      monthlyIncomeVnd: profile.monthlyIncomeVnd?.toFixed() ?? null,
      monthlyExpenseVnd: profile.monthlyExpenseVnd?.toFixed() ?? null,
      existingDebtPaymentVnd: profile.existingDebtPaymentVnd?.toFixed() ?? null,
      liquidSavingsVnd: profile.liquidSavingsVnd?.toFixed() ?? null,
    } : null
  }

  private async prepareReply(session: SessionContext, id: string, input: ForensicFollowUpRequest) {
    const audit = await this.read(session, id)
    const aliases = this.threatMemory?.cachedAliases()
    const profile = classifyFollowUpIntent(input.question, audit, aliases) === 'NEW_CONTEXT' ? await this.loadFinancialProfile(session) : null
    return prepareFollowUp(audit, input, profile, aliases)
  }

  async followUp(session: SessionContext, id: string, input: ForensicFollowUpRequest) {
    const reply = await this.prepareReply(session, id, input)
    if (reply.directAnswer) return { answer: reply.directAnswer, meta: { llmProvider: null, degradedMode: false, ...reply.meta } }

    const task = 'FORENSIC_VERDICT_NARRATIVE'
    const result = await this.ai.generateWithProvider(task, AI_TASK_SCHEMAS[task], reply.modelInput).catch(() => null)
    const narrative = result && screened(result.output.narrative, reply.guard)
    return ForensicFollowUpResponseSchema.parse({
      answer: [reply.prefix, narrative || reply.fallback].filter(Boolean).join('\n\n'),
      meta: { llmProvider: narrative ? result.provider : null, degradedMode: !narrative, ...reply.meta },
    })
  }

  async streamFollowUp(session: SessionContext, id: string, input: ForensicFollowUpRequest, signal: AbortSignal) {
    const reply = await this.prepareReply(session, id, input)
    return followUpEvents(this.ai, reply, signal)
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

  async recordFeedback(session: SessionContext, id: string, input: UserAuditFeedback) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException()
    const reporterSessionHash = feedbackReporter(session)
    const row = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${'audit-feedback:' + reporterSessionHash}, 0))`
      const audit = await tx.forensicAudit.findFirst({
        where: { id, ...ownerFilter(session) },
        select: { rawTextMasked: true, verdictLevel: true, findings: { take: 8, select: { title: true, description: true } } },
      })
      if (!audit) throw new NotFoundException()
      const feedback = tx.threatFeedbackExample
      if (await feedback.findFirst({ where: { auditId: id, reporterSessionHash }, select: { id: true } })) {
        throw new ConflictException({ errorCode: 'ERR_CONFLICT', message: 'Bạn đã gửi góp ý cho báo cáo này.' })
      }
      if (await feedback.count({ where: { reporterSessionHash, createdAt: { gte: new Date(Date.now() - 86400000) } } }) >= 10) {
        throw new HttpException({ errorCode: 'ERR_RATE_LIMITED', message: 'Bạn đã đạt giới hạn 10 góp ý trong 24 giờ.' }, 429)
      }
      const expectedVerdict = input.assessment === 'INCORRECT' ? input.suggestedVerdict ?? audit.verdictLevel : audit.verdictLevel
      let feedbackType = 'RND_PROPOSAL'
      if (input.assessment === 'INCORRECT' && input.suggestedVerdict === 'SAFE') feedbackType = 'FALSE_POSITIVE'
      if (input.assessment === 'INCORRECT' ? input.suggestedVerdict === 'HIGH_RISK' : audit.verdictLevel === 'HIGH_RISK') feedbackType = 'CONFIRMED_SCAM'
      const sample = audit.rawTextMasked?.trim() || audit.findings.map(item => item.title + '. ' + item.description).join('\n')
      return feedback.create({
        data: { id: randomUUID(), auditId: id, reporterSessionHash, assessment: input.assessment,
          sourceChannel: 'USER_REPORT', reviewStatus: 'PENDING', isActive: false, feedbackType, expectedVerdict,
          rndCategory: feedbackType === 'RND_PROPOSAL' ? 'RULE_GAP' : null,
          sampleTextMasked: maskForensicText(sample).slice(0, 4000), adminNote: maskForensicText(input.note ?? '') },
      })
    })
    return UserAuditFeedbackResponseSchema.parse({
      id: row.id, assessment: row.assessment, reviewStatus: row.reviewStatus, createdAt: row.createdAt.toISOString(),
    })
  }

  async read(session: SessionContext, id: string): Promise<ForensicAuditResponse> {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException()
    const row = await this.prisma.forensicAudit.findFirst({
      where: { id, ...ownerFilter(session) },
      include: {
        qrPayloads: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        sourceAlert: { select: { verificationStatus: true, publishedAt: true, threatCategory: true } },
        findings: { orderBy: [{ ruleCode: 'asc' }, { id: 'asc' }] },
        feedbackExamples: { where: { reporterSessionHash: feedbackReporter(session), sourceChannel: 'USER_REPORT' },
          select: { assessment: true, reviewStatus: true, createdAt: true }, take: 1, orderBy: { createdAt: 'desc' } },
      },
    })
    if (!row) throw new NotFoundException()
    const extras = reportExtras.safeParse(row.extractedClaimsJson)
    const defaults = deterministicNarrative({ verdictLevel: ForensicAuditResponseSchema.shape.verdictLevel.parse(row.verdictLevel), findingCount: row.findings.length })
    const feedback = row.feedbackExamples?.[0]
    const audit = ForensicAuditResponseSchema.parse({
      ...(feedback && { userFeedback: { ...feedback, createdAt: feedback.createdAt.toISOString() } }),
      auditId: row.id, createdAt: row.createdAt.toISOString(), verdictLevel: row.verdictLevel, riskScore: row.riskScore,
      deterministicOverride: row.deterministicOverride, claimedEntityName: row.claimedEntityName,
      qrPayloads: row.qrPayloads.map(({
        id: qrId, acqBin, bankName, accountNumberMasked, serviceCode, qrAmountVnd, purposeText,
        crcValid, visionBeneficiaryName, entityMismatchFlag,
      }) => ({
        acqBin, bankName, accountNumberMasked, serviceCode, qrAmountVnd: qrAmountVnd?.toFixed() ?? null,
        purposeText, crcValid, visionBeneficiaryName, entityMismatchFlag,
        ...(extras.success ? extras.data.qrMetadata?.[qrId] : {}),
      })),
      findings: row.findings.map(({ ruleCode, severity, scoreImpact, title, description, evidenceQuote, matchedIndicatorId }) => ({
        ruleCode, severity, scoreImpact, title, description, evidenceQuote, matchedIndicatorId,
      })),
      privacyProof: { sourceFilesPurgedAt: row.sourceFilesPurgedAt.toISOString(), rawTextMasked: row.rawTextMasked },
      aiNarrative: row.aiExplanationText,
      ...(extras.success ? reportFields(extras.data) : {
        mathBreakdown: null, handoffPayload: null, immediateActions: defaults.immediateActions,
        meta: { llmProvider: row.llmProvider === 'deterministic' ? null : row.llmProvider,
          degradedMode: row.llmProvider === 'deterministic' },
      }),
    })
    const currentCitations = selectLegalCitations(audit)
    const verifiedAlert = row.sourceAlert?.verificationStatus === 'VERIFIED' && row.sourceAlert.publishedAt
    const riskAssessment = buildForensicRiskAssessment(audit, {
      sourceAlertVerified: Boolean(verifiedAlert), threatCategory: verifiedAlert ? row.sourceAlert?.threatCategory : null,
    })
    return { ...audit, riskAssessment, legalCitations: audit.legalCitations?.map((item) => ({
      ...item, caseRelevance: item.caseRelevance ?? currentCitations.find(({ code }) => code === item.code)?.caseRelevance,
    })) ?? currentCitations }
  }
}

function reportFields({ qrMetadata: _qrMetadata, repaymentMethod: _repaymentMethod, ...fields }: z.infer<typeof reportExtras>) {
  return fields
}
