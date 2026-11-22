import { z } from 'zod'

export const ApiErrorCode = z.enum([
  'ERR_INVALID_FILE_MAGIC',
  'ERR_FILE_TOO_LARGE',
  'ERR_PDF_PAGE_LIMIT',
  'ERR_VALIDATION_FAILED',
  'ERR_TRUST_FILTER_BLOCKED',
  'ERR_AI_DEGRADED_FALLBACK',
  'ERR_UNAUTHORIZED',
  'ERR_FORBIDDEN',
  'ERR_NOT_FOUND',
  'ERR_NOT_IMPLEMENTED',
  'ERR_SERVICE_UNAVAILABLE',
  'ERR_INTERNAL_SERVER',
])
export type ApiErrorCode = z.infer<typeof ApiErrorCode>

export const ApiErrorSchema = z.strictObject({
  statusCode: z.number().int(),
  errorCode: ApiErrorCode,
  message: z.string(),
  details: z.unknown().optional(),
})
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>
