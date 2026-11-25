import { z } from 'zod'

export const ThreatStatusSchema = z.enum(['UNVERIFIED', 'VERIFIED'])
export const ThreatOriginSchema = z.enum(['RADAR_AUTO', 'ADMIN_INGEST', 'FORENSIC_COMMUNITY'])
export const ThreatIndicatorInputSchema = z.strictObject({
  indicatorType: z.enum(['PHONE', 'BANK_ACCOUNT', 'DOMAIN', 'CRYPTO_WALLET', 'KEYWORD', 'QR_PATTERN']),
  indicatorText: z.string().trim().min(1).max(256),
})
export const ThreatDraftSchema = z.strictObject({
  threatCategory: z.string().trim().min(1).max(40),
  tacticSummary: z.string().trim().min(1).max(800),
  preventionGuidance: z.string().trim().min(1).max(2000),
  sourceExcerpt: z.string().trim().max(8000).optional(),
  indicators: z.array(ThreatIndicatorInputSchema).max(40),
})
export const ThreatPatchSchema = ThreatDraftSchema.partial().extend({ verificationStatus: ThreatStatusSchema.optional() })
export const ThreatExtractSchema = z.union([
  z.strictObject({ rawText: z.string().trim().min(1).max(30_000) }),
  z.strictObject({ sourceUrl: z.url({ protocol: /^https?$/ }).max(2_000) }),
])
export const ThreatCrawlSchema = z.strictObject({ sourceKey: z.string().trim().min(1).max(160).optional() })
export const ThreatTestSchema = z.strictObject({ message: z.string().trim().min(1).max(2000).optional() })
export const ThreatFeedbackType = z.enum(['FALSE_POSITIVE', 'CONFIRMED_SCAM', 'SAFE_IGNORE_IOC', 'TEENCODE_ALIAS', 'RND_PROPOSAL'])
export const ThreatFeedbackSchema = z.strictObject({
  threatAlertId: z.uuid().optional(),
  auditId: z.uuid().optional(),
  feedbackType: ThreatFeedbackType,
  highlightedSpan: z.string().trim().min(1).max(256).optional(),
  sampleTextMasked: z.string().trim().min(1).max(8000),
  expectedVerdict: z.enum(['SAFE', 'CAUTION', 'HIGH_RISK']),
  adminNote: z.string().trim().max(2000),
  rndCategory: z.enum(['RULE_GAP', 'TEENCODE', 'FALSE_POSITIVE_FIX', 'EXTRACTION_FIX']).optional(),
}).superRefine((value, ctx) => {
  if (['SAFE_IGNORE_IOC', 'TEENCODE_ALIAS'].includes(value.feedbackType) && !value.highlightedSpan)
    ctx.addIssue({ code: 'custom', path: ['highlightedSpan'], message: 'Chọn chỉ dấu hoặc cụm từ cần góp ý.' })
  if (value.feedbackType === 'TEENCODE_ALIAS' && (!value.adminNote || value.adminNote.length > 120))
    ctx.addIssue({ code: 'custom', path: ['adminNote'], message: 'Nhập cách viết đầy đủ, tối đa 120 ký tự.' })
  if (value.feedbackType === 'RND_PROPOSAL' && !value.rndCategory)
    ctx.addIssue({ code: 'custom', path: ['rndCategory'], message: 'Chọn nhóm đề xuất R&D.' })
})
export const ThreatFeedbackPatchSchema = z.strictObject({ isActive: z.boolean() })

export type ThreatIndicatorInput = z.infer<typeof ThreatIndicatorInputSchema>
export type ThreatDraft = z.infer<typeof ThreatDraftSchema>
export type ThreatPatch = z.infer<typeof ThreatPatchSchema>
export type ThreatExtract = z.infer<typeof ThreatExtractSchema>
export type ThreatFeedback = z.infer<typeof ThreatFeedbackSchema>
export type ThreatStatus = z.infer<typeof ThreatStatusSchema>

export const ThreatAlertReviewSchema = ThreatDraftSchema.extend({
  id: z.uuid(), originSource: ThreatOriginSchema, hitCount: z.number().int().positive(),
  verificationStatus: ThreatStatusSchema, sourceExcerpt: z.string().nullable(),
  publishedAt: z.string().nullable(), updatedAt: z.string(),
  whitelistCollisions: z.array(z.string()),
  sourceLinks: z.array(z.strictObject({ sourceName: z.string(), url: z.string(), title: z.string() })).optional(),
})
export const ThreatCrawlStatsSchema = z.object({
  sourcesScanned: z.number(), newArticles: z.number(), newProposals: z.number(), newIocsAttached: z.number(), skippedDuplicates: z.number(),
})
export const ThreatShadowResultSchema = z.object({
  passed: z.boolean(), safeCases: z.number(), hits: z.array(z.object({ text: z.string(), indicators: z.array(z.string()) })),
  custom: z.object({ text: z.string(), indicators: z.array(z.string()) }).nullable(),
})
export const ThreatFeedbackRecordSchema = z.object({
  id: z.uuid(), feedbackType: ThreatFeedbackType, highlightedSpan: z.string().nullable(), sampleTextMasked: z.string(),
  expectedVerdict: z.string(), adminNote: z.string(), rndCategory: z.string().nullable(), isActive: z.boolean(),
  threatAlertId: z.uuid().nullable(), auditId: z.uuid().nullable(), createdAt: z.string(),
})
export const ThreatRecentAuditSchema = z.object({
  id: z.uuid(), rawTextMasked: z.string(), verdictLevel: z.enum(['SAFE', 'CAUTION', 'HIGH_RISK']),
  riskScore: z.number(), createdAt: z.string(),
})
export const ThreatRndSummarySchema = z.object({ total: z.number(), active: z.number(), byCategory: z.record(z.string(), z.number()) })
export const ThreatRndEvalResultSchema = z.strictObject({
  ranAt: z.iso.datetime(),
  cleanPassed: z.number().int(), cleanTotal: z.number().int(),
  feedbackPassed: z.number().int(), feedbackTotal: z.number().int(),
  cases: z.array(z.strictObject({
    id: z.string(),
    kind: z.enum(['CLEAN_BASELINE', 'CONFIRMED_SCAM', 'FALSE_POSITIVE', 'TEENCODE_ALIAS']),
    expected: z.string(), actual: z.string(), passed: z.boolean(), detail: z.string(),
  })),
})
export type ThreatRndEvalResult = z.infer<typeof ThreatRndEvalResultSchema>
export type ThreatAlertReview = z.infer<typeof ThreatAlertReviewSchema>
