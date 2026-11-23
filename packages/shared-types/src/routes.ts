import { z } from 'zod'
import { decimalString, positiveDecimal } from './dto/decimal'

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

const termQuery = z.string().regex(/^[1-9]\d*$/).transform((term) => Number(term)).pipe(z.number().int().positive())
const loanFields = { amount: positiveDecimal, term: z.number().int().positive() }
const radarHandoff = z.strictObject({ shockDelta: decimalString, articleId: z.string().min(1) })
const auditHandoff = z.strictObject({ ...loanFields, auditId: z.string().min(1) })
const trustFilterHandoff = z.strictObject({ claimedEntity: z.string().trim().min(1).max(200) })
const quickSurveyHandoff = z.strictObject(loanFields)

export type RouteHandoffParams = {
  radarToSurvey: z.infer<typeof radarHandoff>
  forensicToSurvey: z.infer<typeof auditHandoff>
  trustFilterToForensic: z.infer<typeof trustFilterHandoff>
  quickSurvey: z.infer<typeof quickSurveyHandoff>
}

function withQuery(route: string, fields: Record<string, string | number>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) query.set(key, String(value))
  return `${route}?${query}`
}

export const handoffRoutes = {
  radarToSurvey: (params: RouteHandoffParams['radarToSurvey']) =>
    withQuery(ROUTES.survey, { mode: 'loan', ...radarHandoff.parse(params), from: 'radar' }),
  forensicToSurvey: (params: RouteHandoffParams['forensicToSurvey']) =>
    withQuery(ROUTES.survey, { mode: 'loan', ...auditHandoff.parse(params), from: 'forensic' }),
  trustFilterToForensic: (params: RouteHandoffParams['trustFilterToForensic']) =>
    withQuery(ROUTES.forensic, { ...trustFilterHandoff.parse(params), from: 'trust-filter' }),
  quickSurvey: (params: RouteHandoffParams['quickSurvey']) =>
    withQuery(ROUTES.survey, { mode: 'loan', ...quickSurveyHandoff.parse(params) }),
}

export type RouteSearchParams = Record<string, string | string[] | undefined>

const surveyQuerySchema = z.object({
  mode: z.literal('loan').optional().catch(undefined),
  amount: positiveDecimal.optional().catch(undefined),
  term: termQuery.optional().catch(undefined),
  shockDelta: decimalString.optional().catch(undefined),
  from: z.enum(['radar', 'forensic']).optional().catch(undefined),
  articleId: z.string().min(1).optional().catch(undefined),
  auditId: z.string().min(1).optional().catch(undefined),
})

const forensicQuerySchema = z.object({
  claimedEntity: trustFilterHandoff.shape.claimedEntity.optional().catch(undefined),
  from: z.literal('trust-filter').optional().catch(undefined),
})

export const parseSurveyHandoff = (params: RouteSearchParams) => surveyQuerySchema.parse(params)
export const parseForensicHandoff = (params: RouteSearchParams) => forensicQuerySchema.parse(params)
