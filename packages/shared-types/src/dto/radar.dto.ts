import { z } from 'zod'
import { AnalysisMode, IndicatorType, VerificationStatus } from '../enums'
import { decimalString } from './decimal'

export const ThreatIndicatorSchema = z.strictObject({
  indicatorType: IndicatorType,
  indicatorText: z.string(),
})
export const RadarSourceStatusSchema = z.strictObject({
  sourceKey: z.string(),
  name: z.string(),
  lastFetchStatus: z.string().nullable(),
  lastAttemptAt: z.iso.datetime().nullable(),
  lastSuccessAt: z.iso.datetime().nullable(),
})

export const RadarArticleSchema = z.strictObject({
  id: z.uuid(),
  canonicalUrl: z.url(),
  title: z.string(),
  publishedAt: z.iso.datetime().nullable(),
  categories: z.array(z.string()),
})

export const RadarArticleListSchema = z.strictObject({
  articles: z.array(RadarArticleSchema),
  sources: z.array(RadarSourceStatusSchema),
})
export type RadarArticleListResponse = z.infer<typeof RadarArticleListSchema>

export const RadarArticleDetailSchema = RadarArticleSchema.extend({
  analysisMode: AnalysisMode,
  extractedFacts: z.array(z.string()),
  aiAssessment: z.string().nullable(),
  suggestedRateDelta: decimalString.nullable(),
})
export type RadarArticleDetailResponse = z.infer<typeof RadarArticleDetailSchema>

export const RadarAlertSchema = z.strictObject({
  id: z.uuid(),
  threatCategory: z.string(),
  tacticSummary: z.string(),
  preventionGuidance: z.string(),
  verificationStatus: VerificationStatus,
  issuedAt: z.iso.datetime().nullable(),
  indicators: z.array(ThreatIndicatorSchema),
})
export type RadarAlertResponse = z.infer<typeof RadarAlertSchema>

export const RadarDailyBriefRequestSchema = z.strictObject({
  personalizationEnabled: z.boolean().default(false),
  topics: z.array(z.enum(['INTEREST_RATE', 'BANKING', 'MARKET', 'POLICY', 'INFLATION', 'FINANCIAL_FRAUD'])).max(6).default([]),
  includeProfileGoal: z.boolean().default(false),
  includeSurveyTopics: z.boolean().default(false),
  includeForensicHistory: z.boolean().default(false),
}).refine((value) => value.personalizationEnabled || (!value.includeProfileGoal && !value.includeSurveyTopics && !value.includeForensicHistory), 'Tắt cá nhân hóa thì không gửi tín hiệu hồ sơ, Khảo sát hoặc Giám định.')

export type RadarDailyBriefRequest = z.infer<typeof RadarDailyBriefRequestSchema>

export const RadarDailyBriefResponseSchema = z.strictObject({
  date: z.iso.date(),
  dateLabel: z.string(),
  status: z.enum(['AI_SUMMARY', 'SOURCE_FALLBACK', 'EMPTY']),
  updatedAt: z.iso.datetime(),
  isStale: z.boolean(),
  personalization: z.strictObject({
    enabled: z.boolean(),
    usedSignals: z.array(z.strictObject({ categoryCode: z.string(), source: z.enum(['PROFILE_GOAL', 'SURVEY_TOPIC', 'FORENSIC_HISTORY']) })),
  }),
  items: z.strictObject({
    id: z.uuid(),
    kind: z.enum(['ARTICLE', 'ALERT']),
    summary: z.string(),
    interpretation: z.string().nullable(),
    generatedByAi: z.boolean(),
    category: z.string(),
    publishedAt: z.iso.datetime().nullable(),
    verificationStatus: z.string().nullable(),
    inclusionReason: z.string(),
    relevance: z.string().nullable(),
    citations: z.array(z.strictObject({ sourceName: z.string(), sourceTitle: z.string(), url: z.url(), publishedAt: z.iso.datetime().nullable() })),
  }).array().max(10),
})
export type RadarDailyBriefResponse = z.infer<typeof RadarDailyBriefResponseSchema>

export const TrendingArticleSchema = z.strictObject({
  rank: z.union([z.literal(1), z.literal(2)]),
  id: z.uuid(),
  title: z.string(),
  summary: z.string().nullable(),
  imageUrl: z.string().nullable(),
  proxyUrl: z.string().nullable(),
  sourceName: z.string().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  readMinutes: z.number().int().positive(),
  categories: z.array(z.string()),
  suggestedRateDelta: decimalString.nullable(),
  trendReason: z.string(),
})
export type TrendingArticle = z.infer<typeof TrendingArticleSchema>

export const ScamFinanceRailItemSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(['ALERT', 'SCAM_NEWS', 'FINANCE_NEWS']),
  title: z.string(),
  badge: z.string(),
  imageUrl: z.string().nullable(),
  proxyUrl: z.string().nullable(),
  sourceName: z.string().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  handoffHref: z.string(),
})
export type ScamFinanceRailItem = z.infer<typeof ScamFinanceRailItemSchema>

export const MarketRateBenchmarkSchema = z.strictObject({
  category: z.string(),
  label: z.string(),
  minRatePct: z.number(),
  medianRatePct: z.number(),
  maxRatePct: z.number(),
  sampleCount: z.number().int().nonnegative(),
})
export type MarketRateBenchmark = z.infer<typeof MarketRateBenchmarkSchema>

export const HomeMarketResponseSchema = z.strictObject({
  alert: z.object({ id: z.uuid(), tacticSummary: z.string(), preventionGuidance: z.string(), publishedAt: z.iso.datetime() }).nullable(),
  articles: z.array(z.object({
    id: z.uuid(),
    title: z.string(),
    imageUrl: z.string().nullish(),
    proxyUrl: z.string().nullish(),
    sourceName: z.string().nullish(),
    publishedAt: z.iso.datetime().nullable(),
    categories: z.array(z.string()).optional(),
  })),
  trending: z.array(TrendingArticleSchema).optional(),
  scamFinanceRail: z.array(ScamFinanceRailItemSchema).optional(),
  marketRates: z.array(MarketRateBenchmarkSchema).optional(),
})
export type HomeMarketResponse = z.infer<typeof HomeMarketResponseSchema>
