import { ApiErrorSchema, type ApiErrorCode } from '@fincopilot/shared-types'
import type { ZodType } from 'zod'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type ApiOptions<T> = Omit<RequestInit, 'method' | 'body' | 'credentials'> & { schema?: ZodType<T> }

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  data?: unknown,
  options: ApiOptions<T> = {},
): Promise<T> {
  const { schema, ...init } = options
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')

  let body: BodyInit | undefined
  if (data instanceof FormData) {
    body = data
    headers.delete('Content-Type')
  } else if (data !== undefined) {
    body = JSON.stringify(data)
    headers.set('Content-Type', 'application/json')
  }

  const pathname = path.startsWith('/') ? path : `/${path}`
  const response = await fetch(`/api/v1${pathname}`, {
    ...init,
    method,
    credentials: 'include',
    headers,
    body,
  })
  const isJson = (response.headers.get('Content-Type') ?? '').includes('json')
  if (!response.ok) {
    const payload: unknown = isJson ? await response.json().catch(() => null) : null
    const error = ApiErrorSchema.safeParse(payload)
    if (error.success) {
      throw new ApiError(response.status, error.data.errorCode, error.data.message, error.data.details)
    }
    throw new ApiError(response.status, 'ERR_INTERNAL_SERVER', `Yêu cầu thất bại (${response.status}).`)
  }

  const payload: unknown = response.status === 204
    ? undefined
    : isJson ? await response.json() : await response.text()
  return schema ? schema.parse(payload) : payload as T
}

export const apiClient = {
  get: <T = unknown>(path: string, options?: ApiOptions<T>) => request('GET', path, undefined, options),
  post: <T = unknown>(path: string, data?: unknown, options?: ApiOptions<T>) => request('POST', path, data, options),
  put: <T = unknown>(path: string, data?: unknown, options?: ApiOptions<T>) => request('PUT', path, data, options),
  patch: <T = unknown>(path: string, data?: unknown, options?: ApiOptions<T>) => request('PATCH', path, data, options),
  delete: <T = unknown>(path: string, options?: ApiOptions<T>) => request('DELETE', path, undefined, options),
}
