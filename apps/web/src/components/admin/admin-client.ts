import { apiClient } from '@/lib/api-client'
import { z, type ZodType } from 'zod'

const schedules = z.array(z.object({
  name: z.string(), scheduled: z.boolean(), intervalLabel: z.string(), nextAt: z.iso.datetime().nullable(),
}))
const crawlResults = z.array(z.object({ name: z.string(), summary: z.string().nullable(), status: z.enum(['SUCCESS', 'QUEUED', 'ERROR']) }))

export type AdminCredentials = { key: string; revision: number }

export function adminClient({ key }: AdminCredentials) {
  const headers = key ? { 'x-admin-key': key } : undefined
  const options = { headers, cache: 'no-store' as const }
  return {
    schedulers: () => apiClient.get('/admin/schedulers', { ...options, schema: schedules }),
    hotCrawlAll: () => apiClient.post('/admin/hot-crawl-all', {}, { ...options, schema: crawlResults }),
    get: <T>(path: string, schema?: ZodType<T>) => apiClient.get<T>('/admin' + path, { ...options, schema }),
    post: <T>(path: string, body: unknown, schema?: ZodType<T>) => apiClient.post<T>('/admin' + path, body, { ...options, schema }),
    patch: <T>(path: string, body: unknown, schema?: ZodType<T>) => apiClient.patch<T>('/admin' + path, body, { ...options, schema }),
  }
}

export const adminField = 'min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
