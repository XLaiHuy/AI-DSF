import {
  AuthSessionResponseSchema, FinancialProfileSchema, ForensicAuditListResponseSchema,
  ForensicAuditResponseSchema, ROUTES,
} from '@fincopilot/shared-types'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { ApiError, apiClient } from './api-client'

export const profileResponseSchema = z.strictObject({ profile: FinancialProfileSchema.nullable() })

export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: ({ signal }) => apiClient.get('/auth/session', { schema: AuthSessionResponseSchema, signal, cache: 'no-store' }),
  staleTime: 60_000,
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
