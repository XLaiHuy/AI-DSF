import { z } from 'zod'
import { decimalString, nonnegativeDecimal, positiveDecimal } from './dto/decimal'
import { SurveyTermMonthsSchema } from './dto/survey.dto'

export const ROUTES = {
  home: '/',
  profile: '/profile',
  forensic: '/forensic',
  radar: '/radar',
  radarArticle: (id: string) => `/radar/${encodeURIComponent(id)}`,
  survey: '/survey',
  admin: '/admin',
} as const

export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 768 || !value.startsWith('/')) return ROUTES.profile
  const unsafe = /^(?:\/\/)|[\\\x00-\x1f\x7f]/u
  const origin = 'https://internal.invalid'
  let candidate = value
  // Check encoded path separators too, since proxies and routers can decode them.
  for (let iteration = 0; iteration < 4; iteration += 1) {
    if (unsafe.test(candidate)) return ROUTES.profile
    const url = new URL(candidate, origin)
    if (url.origin !== origin || url.pathname.startsWith('//')) return ROUTES.profile
    const path = candidate.split(/[?#]/u, 1)[0]
    if (!path.includes('%')) return value
    try {
      const decoded = decodeURIComponent(path)
      if (decoded === path) return value
      candidate = decoded
    } catch {
      return ROUTES.profile
    }
  }
  return ROUTES.profile
}

const termQuery = z.string().regex(/^[1-9]\d*$/).transform((term) => Number(term)).pipe(SurveyTermMonthsSchema)
const loanFields = { amount: positiveDecimal, term: SurveyTermMonthsSchema }
const radarHandoff = z.strictObject({ shockDelta: decimalString, articleId: z.string().min(1) })
const auditHandoff = z.strictObject({ ...loanFields, auditId: z.string().min(1) })
const refinanceHandoff = z.strictObject({ auditId: z.uuid() })
const trustFilterHandoff = z.strictObject({ claimedEntity: z.string().trim().min(1).max(200) })
const quickSurveyHandoff = z.strictObject(loanFields)
const investmentPrefill = z.strictObject({
  amount: nonnegativeDecimal, contribution: nonnegativeDecimal, term: SurveyTermMonthsSchema,
})
const radarAlertHandoff = z.strictObject({
  alertId: z.uuid(),
  indicator: z.string().trim().min(1).max(256).optional(),
  summary: z.string().trim().min(1).max(500).optional(),
})
const highAprHandoff = z.strictObject({
  ...loanFields,
  annualRatePct: positiveDecimal,
  label: z.string().trim().min(1).max(200).optional(),
})
const homeQuickForensicHandoff = z.strictObject({
  prefillText: z.string().trim().min(1).max(2000),
})
const surveySessionHandoff = z.strictObject({
  sessionId: z.uuid(),
  mode: z.enum(['loan', 'invest', 'manual', 'refinance']).optional(),
})

export type RouteHandoffParams = {
  radarToSurvey: z.infer<typeof radarHandoff>
  forensicToSurvey: z.infer<typeof auditHandoff>
  forensicToRefinance: z.infer<typeof refinanceHandoff>
  trustFilterToForensic: z.infer<typeof trustFilterHandoff>
  radarAlertToForensic: z.infer<typeof radarAlertHandoff>
  surveyHighAprToForensic: z.infer<typeof highAprHandoff>
  quickSurvey: z.infer<typeof quickSurveyHandoff>
  investmentPrefill: z.infer<typeof investmentPrefill>
  homeQuickForensic: z.infer<typeof homeQuickForensicHandoff>
  surveySession: z.infer<typeof surveySessionHandoff>
}

function withQuery(route: string, fields: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) query.set(key, String(value))
  }
  return `${route}?${query}`
}

export const handoffRoutes = {
  radarToSurvey: (params: RouteHandoffParams['radarToSurvey']) =>
    withQuery(ROUTES.survey, { mode: 'loan', ...radarHandoff.parse(params), from: 'radar' }),
  forensicToSurvey: (params: RouteHandoffParams['forensicToSurvey']) =>
    withQuery(ROUTES.survey, { mode: 'loan', ...auditHandoff.parse(params), from: 'forensic' }),
  forensicToRefinance: (params: RouteHandoffParams['forensicToRefinance']) =>
    withQuery(ROUTES.survey, { mode: 'refinance', ...refinanceHandoff.parse(params), from: 'forensic' }),
  trustFilterToForensic: (params: RouteHandoffParams['trustFilterToForensic']) =>
    withQuery(ROUTES.forensic, { ...trustFilterHandoff.parse(params), from: 'trust-filter' }),
  radarAlertToForensic: (params: RouteHandoffParams['radarAlertToForensic']) =>
    withQuery(ROUTES.forensic, { ...radarAlertHandoff.parse(params), from: 'radar' }),
  surveyHighAprToForensic: (params: RouteHandoffParams['surveyHighAprToForensic']) =>
    withQuery(ROUTES.forensic, { ...highAprHandoff.parse(params), from: 'survey-apr' }),
  quickSurvey: (params: RouteHandoffParams['quickSurvey']) =>
    withQuery(ROUTES.survey, { mode: 'loan', ...quickSurveyHandoff.parse(params) }),
  investmentPrefill: (params: RouteHandoffParams['investmentPrefill']) =>
    withQuery(ROUTES.survey, { mode: 'invest', ...investmentPrefill.parse(params) }),
  homeQuickForensic: (params: RouteHandoffParams['homeQuickForensic']) =>
    withQuery(ROUTES.forensic, { ...homeQuickForensicHandoff.parse(params), from: 'home-quick-check' }),
  surveySession: (params: RouteHandoffParams['surveySession']) => {
    const parsed = surveySessionHandoff.parse(params)
    return withQuery(ROUTES.survey, { mode: parsed.mode ?? 'loan', sessionId: parsed.sessionId })
  },
}

export type RouteSearchParams = Record<string, string | string[] | undefined>

const surveyQuerySchema = z.object({
  mode: z.enum(['loan', 'invest', 'manual', 'refinance']).optional().catch(undefined),
  amount: nonnegativeDecimal.optional().catch(undefined),
  term: termQuery.optional().catch(undefined),
  contribution: nonnegativeDecimal.optional().catch(undefined),
  shockDelta: decimalString.optional().catch(undefined),
  from: z.enum(['radar', 'forensic', 'profile']).optional().catch(undefined),
  articleId: z.uuid().optional().catch(undefined),
  auditId: z.uuid().optional().catch(undefined),
  sessionId: z.uuid().optional().catch(undefined),
}).transform(data => ({
  ...data, amount: data.mode === 'invest' ? data.amount : positiveDecimal.safeParse(data.amount).data,
}))

export const forensicQuerySchema = z.object({
  claimedEntity: trustFilterHandoff.shape.claimedEntity.optional().catch(undefined),
  from: z.enum(['trust-filter', 'radar', 'survey-apr', 'home-quick-check']).optional().catch(undefined),
  alertId: radarAlertHandoff.shape.alertId.optional().catch(undefined),
  indicator: radarAlertHandoff.shape.indicator.catch(undefined),
  summary: radarAlertHandoff.shape.summary.catch(undefined),
  amount: highAprHandoff.shape.amount.optional().catch(undefined),
  term: termQuery.optional().catch(undefined),
  annualRatePct: highAprHandoff.shape.annualRatePct.optional().catch(undefined),
  label: highAprHandoff.shape.label.catch(undefined),
  prefillText: homeQuickForensicHandoff.shape.prefillText.optional().catch(undefined),
})

export type ForensicHandoff = z.infer<typeof forensicQuerySchema>
export const parseSurveyHandoff = (params: RouteSearchParams) => surveyQuerySchema.parse(params)
export const parseForensicHandoff = (params: RouteSearchParams) => forensicQuerySchema.parse(params)
