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
