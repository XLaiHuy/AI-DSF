import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { type ThreatDraft, type ThreatFeedback, type ThreatIndicatorInput, type ThreatPatch, type ThreatStatus,
  ThreatIndicatorInputSchema, ThreatRndEvalResultSchema, type ThreatRndEvalResult, VerdictLevel } from '@fincopilot/shared-types'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma.service'
import type { BenchmarkCase } from '../forensic/eval/benchmark-cases'
import { normalizeVietnamese } from '../forensic/data/trusted-institutions'
import { maskForensicText } from '../forensic/qr-evidence'
import { expandTeencode } from '../forensic/forensic-prompt-guard'
import { evaluateHardRules } from '../forensic/hard-rules.engine'
import { extractThreatIocs, matchesTrustedIdentity } from '../forensic/threat-iocs'
import { readThreatEmbedding, ThreatMemoryService } from '../forensic/threat-memory.service'
import { normalizeThreatIndicator, runSafetyShadowTest, safeCases } from './threat-safety'

function invalid(message: string) {
  return new BadRequestException({ errorCode: 'ERR_VALIDATION_FAILED', message })
}

function parseIndicators(indicators: readonly unknown[]) {
  return indicators.flatMap((indicator) => {
    if (!indicator || typeof indicator !== 'object' || !('indicatorType' in indicator) || !('indicatorText' in indicator)) return []
    const parsed = ThreatIndicatorInputSchema.safeParse({
      indicatorType: indicator.indicatorType === 'WALLET_ADDRESS' ? 'CRYPTO_WALLET' : indicator.indicatorType,
      indicatorText: indicator.indicatorText,
    })
    return parsed.success ? [parsed.data] : []
  })
}

function excerptFields(draft: Partial<Omit<ThreatDraft, 'indicators'>>) {
  return {
    threatCategory: draft.threatCategory,
    tacticSummary: draft.tacticSummary && maskForensicText(draft.tacticSummary),
    preventionGuidance: draft.preventionGuidance && maskForensicText(draft.preventionGuidance),
    sourceExcerpt: draft.sourceExcerpt === undefined ? undefined : maskForensicText(draft.sourceExcerpt),
  }
}

@Injectable()
export class ThreatReviewService {
  constructor(private readonly prisma: PrismaService, private readonly memory: ThreatMemoryService) {}

  async list(status?: ThreatStatus) {
    const [rows, snapshot] = await Promise.all([
      this.prisma.threatAlert.findMany({
        where: { verificationStatus: status ?? { in: ['UNVERIFIED', 'VERIFIED'] } },
        orderBy: [{ hitCount: 'desc' }, { updatedAt: 'desc' }], take: 150,
        include: {
          indicators: { select: { indicatorText: true, indicatorType: true } },
          evidence: { include: { articleSource: { include: {
            source: { select: { name: true } }, article: { select: { title: true, canonicalUrl: true } },
          } } } },
        },
      }),
      this.memory.get(),
    ])
    return rows.map(({ id, threatCategory, tacticSummary, preventionGuidance, originSource, hitCount, verificationStatus,
      sourceExcerpt, publishedAt, updatedAt, indicators, evidence }) => ({
      id, threatCategory, tacticSummary, preventionGuidance, originSource, hitCount, verificationStatus, sourceExcerpt, publishedAt, updatedAt,
      indicators: parseIndicators(indicators),
      sourceLinks: [...new Map(evidence.flatMap(({ articleSource: { source, article } }) => {
        const url = URL.parse(article.canonicalUrl)
        return url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
          ? [[article.canonicalUrl, { sourceName: source.name, url: article.canonicalUrl, title: article.title }] as const]
          : []
      })).values()],
      whitelistCollisions: indicators.filter(({ indicatorText }) => matchesTrustedIdentity(indicatorText, snapshot.trusted))
        .map(({ indicatorText }) => indicatorText),
    }))
  }

  private validate(indicators: readonly ThreatIndicatorInput[], allowedFingerprints: ReadonlySet<string>,
    publication?: Awaited<ReturnType<ThreatMemoryService['get']>>) {
    const unique = new Map<string, ThreatIndicatorInput>()
    for (const indicator of indicators) {
      const { indicatorType, indicatorText } = indicator
      const fingerprint = allowedFingerprints.has(`${indicatorType}:${indicatorText}`) && indicatorType !== 'KEYWORD' && indicatorType !== 'QR_PATTERN' &&
        /^sha256:[a-f0-9]{64}$/.test(indicatorText)
      const normalized = fingerprint ? indicator : normalizeThreatIndicator(indicator)
      if (!normalized) throw invalid('Có chỉ dấu không hợp lệ hoặc từ khóa quá chung.')
      if (publication && matchesTrustedIdentity(normalized.indicatorText, publication.trusted))
        throw invalid('Chỉ dấu trùng thông tin chính thức của một tổ chức được cấp phép.')
      if (publication && [normalized.indicatorText, normalizeVietnamese(normalized.indicatorText),
        this.memory.fingerprint(indicatorType, normalized.indicatorText)].some((value) => publication.exclusions.has(value)))
        throw invalid('Chỉ dấu đã nằm trong danh sách bỏ qua.')
      unique.set(`${indicatorType}:${normalized.indicatorText}`, normalized)
    }
    return [...unique.values()]
  }

  async create(draft: ThreatDraft) {
    const indicators = this.validate(draft.indicators, new Set())
    const row = await this.prisma.threatAlert.create({ data: {
      ...excerptFields(draft), id: randomUUID(), originSource: 'ADMIN_INGEST', threatCategory: draft.threatCategory,
      tacticSummary: maskForensicText(draft.tacticSummary),
      preventionGuidance: maskForensicText(draft.preventionGuidance),
      indicators: { create: indicators.map((indicator) => ({ id: randomUUID(), ...indicator })) },
    }, select: { id: true } })
    this.memory.invalidate()
    return row
  }

  async patch(id: string, patch: ThreatPatch) {
    const publication = patch.verificationStatus === 'UNVERIFIED' ? undefined : await this.memory.get()
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM threat_alert WHERE id = ${id}::uuid FOR UPDATE`
      const current = await tx.threatAlert.findUnique({ where: { id }, include: { indicators: true } })
      if (!current) throw new NotFoundException('Không tìm thấy cảnh báo.')
      const verificationStatus = patch.verificationStatus ?? current.verificationStatus
      const stored = parseIndicators(current.indicators)
      const indicators = patch.indicators ?? stored
      const published = verificationStatus === 'VERIFIED'
      if (published && !patch.indicators && current.indicators.length !== stored.length) throw invalid('Cần sửa loại chỉ dấu cũ trước khi công bố.')
      const normalized = patch.indicators || published
        ? this.validate(indicators, new Set(stored.map(({ indicatorType, indicatorText }) => `${indicatorType}:${indicatorText}`)),
          published ? publication : undefined)
        : indicators
      const fields = excerptFields(patch)
      const summary = fields.tacticSummary ?? current.tacticSummary ?? ''
      const guidance = fields.preventionGuidance ?? current.preventionGuidance ?? ''
      const excerpt = fields.sourceExcerpt ?? current.sourceExcerpt
      if (published && !normalized.length && (summary.trim().length < 20 || guidance.trim().length < 20)) {
        throw invalid('Cảnh báo chỉ có thủ đoạn cần mô tả và hướng dẫn phòng tránh, mỗi phần ít nhất 20 ký tự.')
      }
      if (published && normalized.length && !runSafetyShadowTest(normalized, undefined,
        (type, value) => this.memory.fingerprint(type, value)).passed) {
        throw invalid('Chỉ dấu phải vượt qua kiểm thử 12 câu sạch trước khi công bố.')
      }
      if (patch.indicators) {
        const pending = new Map(normalized.map((item) => [`${item.indicatorType}:${item.indicatorText}`, item]))
        const remove = current.indicators.filter((item) => !pending.delete(`${item.indicatorType}:${item.indicatorText}`)).map(({ id }) => id)
        if (remove.length) {
          await tx.forensicFinding.updateMany({ where: { matchedIndicatorId: { in: remove } }, data: { matchedIndicatorId: null } })
          await tx.threatIndicator.deleteMany({ where: { id: { in: remove } } })
        }
        if (pending.size) await tx.threatIndicator.createMany({ data: [...pending.values()].map((item) => ({ id: randomUUID(), threatAlertId: id, ...item })) })
      }
      const now = new Date()
      const reembed = published && (current.verificationStatus !== 'VERIFIED' || summary !== current.tacticSummary || excerpt !== current.sourceExcerpt)
      const embedding = reembed ? await this.memory.computeEmbedding([summary, excerpt].filter(Boolean).join('\n'), publication?.aliases) : null
      return tx.threatAlert.update({ where: { id }, data: {
        ...fields, verificationStatus, updatedAt: now,
        ...(reembed && { embeddingJson: embedding?.vector ?? Prisma.DbNull, embeddingModel: embedding?.model ?? null }),
        ...(patch.verificationStatus && { publishedAt: published ? current.publishedAt ?? now : null,
          verifiedAt: published ? current.verifiedAt ?? now : null }),
      }, select: { id: true } })
    })
    this.memory.invalidate()
    return row
  }

  async test(id: string, message?: string) {
    const row = await this.prisma.threatAlert.findUnique({ where: { id }, include: { indicators: true } })
    if (!row) throw new NotFoundException('Không tìm thấy cảnh báo.')
    return runSafetyShadowTest(parseIndicators(row.indicators), message, (type, value) => this.memory.fingerprint(type, value))
  }

  async recentAudits() {
    const rows = await this.prisma.forensicAudit.findMany({
      orderBy: { createdAt: 'desc' }, take: 30,
      select: { id: true, rawTextMasked: true, verdictLevel: true, riskScore: true, createdAt: true },
    })
    return rows.map((row) => ({ ...row, rawTextMasked: maskForensicText(row.rawTextMasked ?? '').slice(0, 800) }))
  }

  listFeedback() {
    return this.prisma.threatFeedbackExample.findMany({ orderBy: { createdAt: 'desc' }, take: 150 })
  }

  async saveFeedback(input: ThreatFeedback) {
    const { highlightedSpan } = input
    const [alert, audit] = await Promise.all([
      input.threatAlertId ? this.prisma.threatAlert.findUnique({
        where: { id: input.threatAlertId }, include: { indicators: true },
      }) : null,
      input.auditId ? this.prisma.forensicAudit.findUnique({ where: { id: input.auditId }, select: {
        id: true, findings: {
          where: { matchedIndicatorId: { not: null } },
          select: { matchedIndicator: { select: { indicatorText: true, indicatorType: true } } }, take: 1,
        },
      } }) : null,
    ])
    if (input.threatAlertId && !alert || input.auditId && !audit) throw new NotFoundException('Không tìm thấy nguồn phản hồi.')
    const ioc = alert?.indicators.find(({ indicatorText }) =>
      indicatorText === highlightedSpan || maskForensicText(indicatorText) === highlightedSpan) ??
      (!highlightedSpan && input.feedbackType === 'FALSE_POSITIVE' ? audit?.findings[0]?.matchedIndicator : null)
    const excluded = input.feedbackType === 'SAFE_IGNORE_IOC' || input.feedbackType === 'FALSE_POSITIVE'
    const span = excluded && ioc && ioc.indicatorType !== 'KEYWORD' && ioc.indicatorType !== 'QR_PATTERN'
      ? ioc.indicatorText.startsWith('sha256:') ? ioc.indicatorText : this.memory.fingerprint(ioc.indicatorType, ioc.indicatorText)
      : highlightedSpan && maskForensicText(highlightedSpan)
    const sampleTextMasked = maskForensicText(input.sampleTextMasked)
    const embedding = input.feedbackType === 'CONFIRMED_SCAM' || input.feedbackType === 'FALSE_POSITIVE'
      ? await this.memory.computeEmbedding(sampleTextMasked) : null
    const row = await this.prisma.threatFeedbackExample.create({ data: {
      ...input, id: randomUUID(), highlightedSpan: span, sampleTextMasked,
      embeddingJson: embedding?.vector, embeddingModel: embedding?.model,
      adminNote: maskForensicText(input.adminNote),
    } })
    this.memory.invalidate()
    return row
  }

  async setFeedback(id: string, isActive: boolean) {
    const result = await this.prisma.threatFeedbackExample.updateMany({ where: { id }, data: { isActive } })
    if (!result.count) throw new NotFoundException('Không tìm thấy phản hồi.')
    this.memory.invalidate()
    return { id, isActive }
  }

  async summary() {
    const rows = await this.prisma.threatFeedbackExample.groupBy({ by: ['rndCategory', 'feedbackType', 'isActive'], _count: true })
    const byCategory: Record<string, number> = {}
    let total = 0
    let active = 0
    for (const row of rows) {
      const category = row.rndCategory ?? row.feedbackType
      byCategory[category] = (byCategory[category] ?? 0) + row._count
      total += row._count
      if (row.isActive) active += row._count
    }
    return { total, active, byCategory }
  }

  async runEval() {
    const [snapshot, feedback] = await Promise.all([
      this.memory.get(),
      this.prisma.threatFeedbackExample.findMany({
        where: { isActive: true, feedbackType: { in: ['CONFIRMED_SCAM', 'FALSE_POSITIVE', 'TEENCODE_ALIAS'] } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ])
    type EvalCase = ThreatRndEvalResult['cases'][number]
    async function probe(memory: ThreatMemoryService, text: string, queryEmbeddings?: ReadonlyMap<string, number[]>) {
      const recalled = await memory.retrieve(text, extractThreatIocs(text), { shouldEmbed: Boolean(queryEmbeddings?.size), queryEmbeddings })
      const rules = evaluateHardRules({ evidence: [text], claimedEntityName: null, qrPayloads: [],
        institutions: [], indicators: recalled.indicators,
        normalizeEvidence: (value) => expandTeencode(value, snapshot.aliases).normalized })
      return { recalled, rules }
    }
    const clean = await Promise.all(safeCases.map(async (text, index): Promise<EvalCase> => {
      const { rules } = await probe(this.memory, text)
      return { id: `CLEAN-${index + 1}`, kind: 'CLEAN_BASELINE', expected: 'SAFE',
        actual: rules.verdictLevel, passed: rules.verdictLevel === 'SAFE', detail: rules.findings.map(({ ruleCode }) => ruleCode).join(', ') || text }
    }))
    const learned = await Promise.all(feedback.map(async (row): Promise<EvalCase> => {
      if (row.feedbackType === 'TEENCODE_ALIAS') {
        const alias = row.highlightedSpan ?? ''
        const expected = normalizeVietnamese(row.adminNote)
        const { normalized: actual } = expandTeencode(alias, snapshot.aliases)
        return { id: row.id, kind: 'TEENCODE_ALIAS', expected, actual, passed: Boolean(alias && expected && expected === actual), detail: alias }
      }
      const vector = readThreatEmbedding(row.embeddingJson)
      const cachedQuery = new Map(vector ? [[row.embeddingModel ?? 'text-embedding-3-small', vector]] : [])
      const { recalled, rules } = await probe(this.memory, row.sampleTextMasked, cachedQuery)
      const kind = row.feedbackType === 'CONFIRMED_SCAM' ? 'CONFIRMED_SCAM' : 'FALSE_POSITIVE'
      const match = recalled.examples.find(({ id }) => id === row.id) ??
        recalled.examples.find(({ feedbackType, expectedVerdict }) => feedbackType === kind && expectedVerdict === row.expectedVerdict)
      const actual = rules.verdictLevel === 'SAFE' ? match?.expectedVerdict ?? rules.verdictLevel : rules.verdictLevel
      return { id: row.id, kind, expected: row.expectedVerdict, actual,
        passed: actual === row.expectedVerdict && Boolean(match),
        detail: [recalled.learningTrace.retrievalMode, match ? 'Đã tìm thấy phản hồi cùng nhãn' : 'Thiếu phản hồi cùng nhãn',
          ...rules.findings.map(({ ruleCode }) => ruleCode)].join(' · ') }
    }))
    return ThreatRndEvalResultSchema.parse({
      ranAt: new Date().toISOString(),
      cleanPassed: clean.filter(({ passed }) => passed).length, cleanTotal: clean.length,
      feedbackPassed: learned.filter(({ passed }) => passed).length, feedbackTotal: learned.length, cases: [...clean, ...learned],
    })
  }

  async exportCases(): Promise<BenchmarkCase[]> {
    const rows = await this.prisma.threatFeedbackExample.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } })
    return rows.flatMap(({ id, feedbackType, sampleTextMasked, expectedVerdict }) => {
      const verdict = VerdictLevel.safeParse(expectedVerdict)
      return verdict.success ? [{
        id: `RND-${id}`, category: verdict.data === 'SAFE' ? 'clean' : 'phishing', difficulty: 'MEDIUM',
        title: feedbackType, fields: { rawText: maskForensicText(sampleTextMasked) },
        expectedVerdicts: [verdict.data], expectedRules: [],
        mustNotTriggerRules: feedbackType === 'FALSE_POSITIVE' || feedbackType === 'SAFE_IGNORE_IOC' ? ['RULE_05_NCSC_THREAT_MATCH'] : [],
      }] : []
    })
  }
}
