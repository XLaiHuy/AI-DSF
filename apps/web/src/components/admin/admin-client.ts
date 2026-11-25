import { apiClient } from '@/lib/api-client'
import type { ZodType } from 'zod'

export type AdminCredentials = { key: string; revision: number }

export function adminClient({ key }: AdminCredentials) {
  const headers = key ? { 'x-admin-key': key } : undefined
  const options = { headers, cache: 'no-store' as const }
  return {
    get: <T>(path: string, schema?: ZodType<T>) => apiClient.get<T>('/admin' + path, { ...options, schema }),
    post: <T>(path: string, body: unknown, schema?: ZodType<T>) => apiClient.post<T>('/admin' + path, body, { ...options, schema }),
    patch: <T>(path: string, body: unknown, schema?: ZodType<T>) => apiClient.patch<T>('/admin' + path, body, { ...options, schema }),
  }
}

export const adminField = 'min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
