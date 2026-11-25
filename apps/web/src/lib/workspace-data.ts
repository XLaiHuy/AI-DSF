import {
  AuthSessionResponseSchema, FinancialProfileResponseSchema, ForensicAuditListResponseSchema,
  ForensicAuditResponseSchema, HomeMarketResponseSchema, RadarDailyBriefResponseSchema, ROUTES,
} from '@fincopilot/shared-types'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { ApiError, apiClient } from './api-client'

export const profileResponseSchema = FinancialProfileResponseSchema

export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: ({ signal }) => apiClient.get('/auth/session', { schema: AuthSessionResponseSchema, signal, cache: 'no-store' }),
  retry: false,
})

export const profileQuery = queryOptions({
  queryKey: ['financial-profile'],
  queryFn: ({ signal }) => apiClient.get('/profile', { schema: profileResponseSchema, signal, cache: 'no-store' }),
  retry: false,
})

export const auditListQuery = queryOptions({
  queryKey: ['forensic', 'audits'],
  queryFn: ({ signal }) => apiClient.get('/forensic/audits', { schema: ForensicAuditListResponseSchema, signal, cache: 'no-store' }),
  retry: false,
})

const surveyHistorySchema = z.object({ sessions: z.array(z.object({
  id: z.uuid(),
  sessionMode: z.string(),
  createdAt: z.iso.datetime(),
  dtiRatioPct: z.string().nullable(),
  dtiRiskBand: z.string().nullable(),
  rateShockDelta: z.string().nullable(),
})) })

export const surveyHistoryQuery = queryOptions({
  queryKey: ['survey', 'history'],
  queryFn: ({ signal }) => apiClient.get('/survey/history', { schema: surveyHistorySchema, signal, cache: 'no-store' }),
  retry: false,
})

export function surveySessionLabel(mode: string) {
  switch (mode) {
    case 'LOAN_SURVEY': return 'Khảo sát khoản vay'
    case 'INVESTMENT_SURVEY': return 'Khảo sát đầu tư'
    case 'MANUAL_COMPARE': return 'So sánh phương án'
    default: return 'Khảo sát tài chính'
  }
}

export function surveySessionHref(mode: string, sessionId?: string) {
  const tab = mode === 'INVESTMENT_SURVEY' ? 'invest' : mode === 'MANUAL_COMPARE' ? 'manual' : 'loan'
  const query = new URLSearchParams({ mode: tab })
  if (sessionId) query.set('sessionId', sessionId)
  return `${ROUTES.survey}?${query}`
}

export const marketOverviewQuery = queryOptions({
  queryKey: ['home', 'market'],
  queryFn: ({ signal }) => apiClient.get('/home/market', { schema: HomeMarketResponseSchema, signal }),
  retry: false,
})

export const dailyBriefQuery = queryOptions({
  queryKey: ['home', 'daily-brief'],
  queryFn: async ({ signal }) => {
    try {
      return await apiClient.post('/radar/daily-brief', {}, { schema: RadarDailyBriefResponseSchema, signal })
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
  },
  retry: false,
  staleTime: 10 * 60_000,
})

export function auditQuery(id: string) {
  return queryOptions({
    queryKey: ['forensic', 'audit', id],
    queryFn: ({ signal }) => apiClient.get('/forensic/audits/' + encodeURIComponent(id), {
      schema: ForensicAuditResponseSchema, signal, cache: 'no-store',
    }),
    retry: false,
  })
}

export const auditHref = (id: string) => ROUTES.forensic + '/' + encodeURIComponent(id)

const vnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 2 })
const vietnamTime = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh',
})
export const formatVietnamTime = (iso: string) => vietnamTime.format(new Date(iso))

function isDecimal(amount: string): amount is `${number}` {
  return /^-?\d+(?:\.\d+)?$/.test(amount)
}

export function formatVnd(amount: string | null | undefined) {
  // Intl accepts a decimal string and formats it without converting to a JavaScript Number.
  return amount != null && isDecimal(amount) ? vnd.format(amount) : '—'
}

export function requestError(error: unknown, fallback: string) {
  return error instanceof ApiError && error.status < 500 ? error.message : fallback
}
