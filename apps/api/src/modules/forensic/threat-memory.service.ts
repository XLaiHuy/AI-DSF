import { createHash, createHmac, randomUUID } from 'node:crypto'
import { Injectable, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import type { LearningTraceSchema, SessionContext } from '@fincopilot/shared-types'
import type { z } from 'zod'
import { PrismaService } from '../../common/prisma.service'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { normalizeVietnamese } from './data/trusted-institutions'
import { expandTeencode } from './forensic-prompt-guard'
import type { Indicator } from './hard-rules.engine'
import { maskForensicText } from './qr-evidence'
import { canonicalIoc, matchesTrustedIdentity, type ThreatIoc } from './threat-iocs'

const ttlMs = 60_000
const termsToIgnore = new Set('toi ban ho minh cua la va co cho mot da se nay do can ve nhu khong'.split(' '))
const key = ({ indicatorType, indicatorText }: Indicator | ThreatIoc) =>
  canonicalIoc(indicatorType, indicatorText) ?? normalizeVietnamese(indicatorText)
type ThreatEmbedding = NonNullable<Awaited<ReturnType<AiGatewayService['embedTextWithModel']>>>

function features(text: string) {
  const words = text.split(' ').filter((word) => word.length > 1 && !termsToIgnore.has(word))
  return new Set(words.flatMap((word, i) => i ? [word, words[i - 1] + ' ' + word] : [word]))
}

const weight = (token: string) => token.includes(' ') ? 2 : 1

export function readThreatEmbedding(value: unknown): number[] | null {
  return Array.isArray(value) && value.length >= 32 &&
    value.every((component: unknown) => typeof component === 'number' && Number.isFinite(component)) ? value : null
}

export function embeddingCosine(a: readonly number[], b: readonly number[]) {
  if (a.length !== b.length) return 0
  const magnitude = Math.hypot(...a) * Math.hypot(...b)
  return magnitude ? a.reduce((sum, value, i) => sum + value * b[i], 0) / magnitude : 0
}

function buildIndex<T>(corpus: readonly { value: T; tokens: Set<string>; embedding: ThreatEmbedding | null }[]) {
  const postings = new Map<string, number[]>()
  const rows = corpus.map(({ value, tokens, embedding }, index) => {
    let size = 0
    for (const token of tokens) {
      const prior = postings.get(token)
      if (prior) prior.push(index)
      else postings.set(token, [index])
      size += weight(token)
    }
    return { value, size, embedding }
  })
  return { postings, rows }
}

function bestMatches<T>(query: Set<string>, { rows, postings }: ReturnType<typeof buildIndex<T>>, vectors: ReadonlyMap<string, number[]>) {
  const matches = new Map<number, number>()
  let size = 0
  for (const token of query) {
    const value = weight(token)
    size += value
    for (const index of postings.get(token) ?? []) matches.set(index, (matches.get(index) ?? 0) + value)
  }
  const lexical = [...matches].flatMap(([index, overlap]) => {
    const score = overlap / Math.sqrt(size * rows[index].size)
    return overlap >= 2 && score >= 0.16 ? [{ index, score }] : []
  }).sort((a, b) => b.score - a.score)
  const semantic = rows.flatMap(({ embedding }, index) => {
    const queryVector = embedding && vectors.get(embedding.model)
    const score = embedding && queryVector ? embeddingCosine(queryVector, embedding.vector) : 0
    return score >= 0.42 ? [{ index, score }] : []
  }).sort((a, b) => b.score - a.score)
  const fused = new Map<number, { rankScore: number; score: number }>()
  for (const ranking of [lexical, semantic]) {
    ranking.forEach(({ index, score }, rank) => {
      const prior = fused.get(index)
      fused.set(index, { rankScore: (prior?.rankScore ?? 0) + 1 / (61 + rank), score: Math.max(prior?.score ?? 0, score) })
    })
  }
  return [...fused].sort(([, a], [, b]) => b.rankScore - a.rankScore)
    .map(([index, { score }]) => ({ value: rows[index].value, score }))
}

@Injectable()
export class ThreatMemoryService {
  private snapshot?: { expiresAt: number; data: Awaited<ReturnType<ThreatMemoryService['load']>> }
  private refresh?: ReturnType<ThreatMemoryService['load']>
  private retryBackfillAt = 0
  private backfill?: Promise<void>

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService,
    @Optional() private readonly ai?: AiGatewayService) {}

  async computeEmbedding(text: string, aliases?: Awaited<ReturnType<ThreatMemoryService['get']>>['aliases'], model?: string) {
    if (!this.ai) return null
    const activeAliases = aliases ?? (await this.get()).aliases
    return this.ai.embedTextWithModel(expandTeencode(maskForensicText(text), activeAliases).normalized, model)
  }

  fingerprint(type: string, value: string) {
    const canonical = canonicalIoc(type, value) ?? normalizeVietnamese(value)
    const secret = this.config.get<string>('THREAT_FINGERPRINT_SECRET') || this.config.getOrThrow<string>('JWT_SECRET')
    return 'sha256:' + createHmac('sha256', secret).update(`threat-ioc:${type}:${canonical}`).digest('hex')
  }

  invalidate() {
    this.snapshot = undefined
    this.refresh = undefined
  }

  private async load() {
    const [alerts, examples, trusted] = await Promise.all([
      this.prisma.threatAlert.findMany({
        where: { verificationStatus: 'VERIFIED' },
        orderBy: { updatedAt: 'desc' }, take: 500,
        select: { id: true, updatedAt: true, tacticSummary: true, sourceExcerpt: true, embeddingJson: true, embeddingModel: true,
          indicators: { select: { id: true, indicatorType: true, indicatorText: true } } },
      }),
      this.prisma.threatFeedbackExample.findMany({ where: { isActive: true, reviewStatus: 'APPROVED' }, take: 500, orderBy: { createdAt: 'desc' } }),
      this.prisma.financialInstitution.findMany({
        where: { trustStatus: 'LICENSED' },
        select: { name: true, code: true, vietqrBin: true, officialWebsite: true },
      }),
    ])
    const exclusions = new Set(examples.flatMap(({ feedbackType, highlightedSpan }) =>
      (feedbackType === 'SAFE_IGNORE_IOC' || feedbackType === 'FALSE_POSITIVE') && highlightedSpan
        ? [highlightedSpan, normalizeVietnamese(highlightedSpan)] : []))
    const aliases = examples.filter(({ feedbackType }) => feedbackType === 'TEENCODE_ALIAS').slice(0, 200)
      .flatMap(({ highlightedSpan, adminNote }) => highlightedSpan ? [{ alias: highlightedSpan, expansion: adminNote }] : [])
    const indicators = alerts.flatMap((alert) => alert.indicators).map((indicator) =>
      indicator.indicatorType === 'WALLET_ADDRESS' ? { ...indicator, indicatorType: 'CRYPTO_WALLET' } : indicator).filter((indicator) =>
      !exclusions.has(indicator.indicatorText) && !exclusions.has(key(indicator)) &&
      !exclusions.has(this.fingerprint(indicator.indicatorType, key(indicator))) &&
      !matchesTrustedIdentity(indicator.indicatorText, trusted))
    const storedEmbedding = (json: unknown, model: string | null) => {
      const vector = readThreatEmbedding(json)
      return vector ? { vector, model: model ?? 'text-embedding-3-small' } : null
    }
    const tacticCorpus = alerts.map(({ tacticSummary, indicators: local, embeddingJson, embeddingModel }) => ({
      value: maskForensicText(tacticSummary).slice(0, 600),
      embedding: storedEmbedding(embeddingJson, embeddingModel),
      tokens: features(expandTeencode([tacticSummary, ...local.filter((ioc) =>
        ioc.indicatorType === 'KEYWORD' && !exclusions.has(key(ioc))).map((ioc) => ioc.indicatorText)].join(' '), aliases).normalized),
    }))
    const labeled = examples.filter(({ feedbackType }) => feedbackType === 'CONFIRMED_SCAM' || feedbackType === 'FALSE_POSITIVE')
    const exampleCorpus = labeled.map(({ id, feedbackType, sampleTextMasked, expectedVerdict, embeddingJson, embeddingModel }) => ({
        value: { id, feedbackType, sample: maskForensicText(sampleTextMasked).slice(0, 800), expectedVerdict },
        embedding: storedEmbedding(embeddingJson, embeddingModel),
        tokens: features(expandTeencode(sampleTextMasked, aliases).normalized),
      }))
    const verified = new Set(alerts.flatMap((alert) => alert.indicators.map((item) => `${item.indicatorType}:${key(item)}`)))
    const avoidanceRules = examples.filter(({ feedbackType, rndCategory }) =>
      feedbackType === 'SAFE_IGNORE_IOC' || feedbackType === 'EXTRACTION_FIX' || rndCategory === 'EXTRACTION_FIX')
      .slice(0, 5).map(({ feedbackType, adminNote }) => ({
        feedbackType: feedbackType === 'SAFE_IGNORE_IOC' ? feedbackType : 'EXTRACTION_FIX', note: maskForensicText(adminNote),
      }))
    if (this.ai && !this.backfill && Date.now() >= this.retryBackfillAt) {
      const jobs = [
        ...alerts.filter((row) => row.id && !readThreatEmbedding(row.embeddingJson)).map((row) => async () => {
          const embedding = await this.computeEmbedding([row.tacticSummary, row.sourceExcerpt].filter(Boolean).join('\n'), aliases)
          if (embedding) return this.prisma.threatAlert.updateMany({
            where: { id: row.id, updatedAt: row.updatedAt, verificationStatus: 'VERIFIED' },
            data: { embeddingJson: embedding.vector, embeddingModel: embedding.model },
          })
        }),
        ...labeled.filter((row) => row.id && !readThreatEmbedding(row.embeddingJson)).map((row) => async () => {
          const embedding = await this.computeEmbedding(row.sampleTextMasked, aliases)
          if (embedding) return this.prisma.threatFeedbackExample.updateMany({
            where: { id: row.id, isActive: true, reviewStatus: 'APPROVED' }, data: { embeddingJson: embedding.vector, embeddingModel: embedding.model },
          })
        }),
      ].slice(0, 10)
      if (jobs.length) this.backfill = Promise.allSettled(jobs.map((job) => job())).then(results => {
        if (results.some(result => result.status === 'rejected' || !result.value)) this.retryBackfillAt = Date.now() + 600000
        if (results.some(result => result.status === 'fulfilled' && result.value?.count)) this.invalidate()
        this.backfill = undefined
      })
    }
    return { exclusions, aliases, indicators, trusted, tactics: buildIndex(tacticCorpus), examples: buildIndex(exampleCorpus),
      verified, avoidanceRules }
  }

  get() {
    if (this.snapshot && this.snapshot.expiresAt > Date.now()) return Promise.resolve(this.snapshot.data)
    if (!this.refresh) {
      const refresh = this.load().then((data) => {
        if (this.refresh === refresh) this.snapshot = { expiresAt: Date.now() + ttlMs, data }
        return data
      }).finally(() => {
        if (this.refresh === refresh) this.refresh = undefined
      })
      this.refresh = refresh
    }
    return this.refresh
  }

  cachedAliases() {
    const cached = this.snapshot
    return cached && cached.expiresAt > Date.now() ? cached.data.aliases : []
  }

  async retrieve(text: string, iocs: readonly ThreatIoc[], options?: { shouldEmbed?: boolean; queryEmbeddings?: ReadonlyMap<string, number[]> }) {
    const snapshot = await this.get()
    const { normalized, glossary, expandedCount } = expandTeencode(text, snapshot.aliases)
    const tokens = features(normalized)
    const models = new Set([...snapshot.tactics.rows, ...snapshot.examples.rows].flatMap(({ embedding }) => embedding ? [embedding.model] : []))
    const queries = new Map(options?.queryEmbeddings)
    if (options?.shouldEmbed && !options.queryEmbeddings) {
      await Promise.all([...models].map(async (model) => {
        const result = await this.computeEmbedding(text, snapshot.aliases, model)
        if (result) queries.set(result.model, result.vector)
      }))
    }
    const tactics = bestMatches(tokens, snapshot.tactics, queries).slice(0, 3)
    const rankedExamples = bestMatches(tokens, snapshot.examples, queries)
    const scam = rankedExamples.filter(({ value }) => value.feedbackType === 'CONFIRMED_SCAM').slice(0, 2)
    const safe = rankedExamples.filter(({ value }) => value.feedbackType === 'FALSE_POSITIVE').slice(0, 2)
    const examples = [...scam, ...safe]
    const candidates = new Map(iocs.map((ioc) => [this.fingerprint(ioc.indicatorType, ioc.indicatorText), ioc.indicatorText]))
    const indicators = snapshot.indicators.flatMap((indicator) => {
      if (!indicator.indicatorText.startsWith('sha256:')) return [indicator]
      const indicatorText = candidates.get(indicator.indicatorText)
      return indicatorText && !matchesTrustedIdentity(indicatorText, snapshot.trusted) &&
        !snapshot.exclusions.has(indicatorText) && !snapshot.exclusions.has(normalizeVietnamese(indicatorText))
        ? [{ ...indicator, indicatorText }] : []
    })
    const exact = new Set(iocs.map((ioc) => `${ioc.indicatorType}:${key(ioc)}`))
    const learningTrace: z.infer<typeof LearningTraceSchema> = {
      retrievalMode: queries.size ? 'hybrid_rrf' : tactics.length || examples.length ? 'lexical' : 'exact_only',
      tier1ExactMatches: indicators.filter((ioc) => exact.has(`${ioc.indicatorType}:${key(ioc)}`)).length,
      matchedTacticsCount: tactics.length,
      matchedTacticSummaries: tactics.map(({ value }) => value.slice(0, 140)),
      fewShotScamCount: scam.length, fewShotSafeCount: safe.length,
      expandedTeencodeCount: expandedCount, zeroShotEscalated: false,
    }
    return { indicators, glossary, aliases: snapshot.aliases, tactics: tactics.map(({ value }) => value),
      examples: examples.map(({ value }) => value), learningTrace,
      topSimilarityScore: Math.max(tactics[0]?.score ?? 0, ...examples.map(({ score }) => score)) }
  }

  async prepareProposal(session: SessionContext, iocs: readonly ThreatIoc[], sourceExcerpt: string) {
    const owner = session.kind === 'guest' ? session.guestSessionId : session.userId
    const sessionHash = createHash('sha256').update(`${session.kind}:${owner}`).digest('hex')
    const memory = await this.get()
    const candidates = iocs.slice(0, 5).flatMap(({ indicatorType, indicatorText }) => {
      const fingerprint = this.fingerprint(indicatorType, indicatorText)
      if (memory.verified.has(`${indicatorType}:${indicatorText}`) ||
        indicatorType === 'CRYPTO_WALLET' && memory.verified.has(`WALLET_ADDRESS:${indicatorText}`)) return []
      if (memory.exclusions.has(fingerprint) || memory.exclusions.has(indicatorText) ||
          memory.exclusions.has(normalizeVietnamese(indicatorText)) || matchesTrustedIdentity(indicatorText, memory.trusted)) return []
      return [{ indicatorType, fingerprint,
        publicValue: indicatorType === 'DOMAIN' || indicatorType === 'CRYPTO_WALLET' ? indicatorText : undefined }]
    })
    return { sessionHash, candidates, sourceExcerpt: maskForensicText(sourceExcerpt).slice(0, 2000) }
  }

  async propose(session: SessionContext, iocs: readonly ThreatIoc[], sourceExcerpt: string) {
    return this.applyProposal(await this.prepareProposal(session, iocs, sourceExcerpt))
  }

  async applyProposal({ sessionHash, candidates, sourceExcerpt }: CommunityProposal) {
    const memory = await this.get()
    for (const { indicatorType, publicValue, fingerprint } of candidates) {
      if (memory.exclusions.has(fingerprint) || publicValue && (
        memory.exclusions.has(publicValue) || matchesTrustedIdentity(publicValue, memory.trusted))) continue
      for (let attempt = 0; ; attempt += 1) {
        try {
          await this.prisma.$transaction(async (tx) => {
            const existing = await tx.threatAlert.findFirst({
              where: { indicators: { some: { indicatorType, indicatorText: { in: publicValue ? [publicValue, fingerprint] : [fingerprint], mode: 'insensitive' } } } },
              orderBy: [{ verificationStatus: 'desc' }, { createdAt: 'asc' }],
              select: { id: true, verificationStatus: true, originSource: true, distinctSessionHashes: true },
            })
            if (existing?.verificationStatus === 'VERIFIED') return
            if (existing) {
              if (existing.originSource !== 'FORENSIC_COMMUNITY') return
              const previous = Array.isArray(existing.distinctSessionHashes) ? existing.distinctSessionHashes : []
              if (previous.includes(sessionHash) || previous.length >= 1_000) return
              await tx.threatAlert.update({ where: { id: existing.id }, data: {
                hitCount: { increment: 1 }, distinctSessionHashes: [...previous, sessionHash], updatedAt: new Date(),
              } })
              return
            }
            const recent = await tx.threatAlert.count({ where: {
              originSource: 'FORENSIC_COMMUNITY',
              createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
              distinctSessionHashes: { array_contains: [sessionHash] },
            } })
            if (recent >= 10) return
            await tx.threatAlert.create({ data: {
              id: randomUUID(), originSource: 'FORENSIC_COMMUNITY', threatCategory: 'PHISHING',
              tacticSummary: `Dấu hiệu ${indicatorType} từ một lượt giám định rủi ro cao`,
              preventionGuidance: 'Đối chiếu bằng chứng và xác minh qua kênh chính thức trước khi công bố.',
              distinctSessionHashes: [sessionHash], sourceExcerpt: maskForensicText(sourceExcerpt).slice(0, 2_000),
              indicators: { create: { id: randomUUID(), indicatorType, indicatorText: fingerprint } },
            } })
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
          break
        } catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt === 2) throw error
        }
      }
    }
  }
}

export type CommunityProposal = Awaited<ReturnType<ThreatMemoryService['prepareProposal']>>
