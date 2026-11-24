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
}).refine((value) => value.personalizationEnabled || (!value.includeProfileGoal && !value.includeSurveyTopics), 'Tắt cá nhân hóa thì không gửi tín hiệu hồ sơ hoặc Khảo sát.')

export type RadarDailyBriefRequest = z.infer<typeof RadarDailyBriefRequestSchema>

export const RadarDailyBriefResponseSchema = z.strictObject({
  date: z.iso.date(),
  dateLabel: z.string(),
  status: z.enum(['AI_SUMMARY', 'SOURCE_FALLBACK', 'EMPTY']),
  updatedAt: z.iso.datetime(),
  isStale: z.boolean(),
  personalization: z.strictObject({
    enabled: z.boolean(),
    usedSignals: z.array(z.strictObject({ categoryCode: z.string(), source: z.enum(['PROFILE_GOAL', 'SURVEY_TOPIC']) })),
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
