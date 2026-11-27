import { createHash } from 'node:crypto'
import { type CanActivate, type ExecutionContext, HttpException, Injectable, ServiceUnavailableException, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { authCookie, guestCookie } from './guest-session.guard'
import { RedisService } from './redis.service'

const minute = 60_000
const scopes = {
  login: { limit: 10, windowMs: 15 * minute },
  register: { limit: 5, windowMs: 60 * minute },
  forensic: { limit: 20, windowMs: 10 * minute },
  avatar: { limit: 10, windowMs: 15 * minute },
} as const

const rateLimit = Symbol('rateLimit')
export const RateLimit = (scope: keyof typeof scopes) => SetMetadata(rateLimit, scope)

function signedSession(request: FastifyRequest) {
  for (const name of [authCookie, guestCookie]) {
    const cookie = request.cookies?.[name]
    if (!cookie) continue
    const verified = request.unsignCookie(cookie)
    if (verified.valid) return verified.value ?? undefined
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext) {
    const scope = this.reflector.get<keyof typeof scopes | undefined>(rateLimit, context.getHandler())
    if (!scope) return true
    const { limit, windowMs } = scopes[scope]
    const http = context.switchToHttp()
    const request = http.getRequest<FastifyRequest>()
    const ipKey = createHash('sha256').update('ip:' + request.ip).digest('hex')
    const identity = scope === 'forensic' || scope === 'avatar' ? signedSession(request) : undefined
    const key = identity ? createHash('sha256').update('session:' + identity).digest('hex') : ipKey
    let retry: number
    try {
      // A higher IP-wide ceiling also applies when a client holds many signed sessions.
      retry = await this.redis.retryAfter(`fincopilot:rate:${scope}:ip:${ipKey}`, limit * 10, windowMs)
      if (!retry) retry = await this.redis.retryAfter(`fincopilot:rate:${scope}:${key}`, limit, windowMs)
    } catch {
      throw new ServiceUnavailableException()
    }
    if (!retry) return true
    http.getResponse<FastifyReply>().header('Retry-After', retry.toString())
    throw new HttpException({ errorCode: 'ERR_RATE_LIMITED', message: 'Bạn thao tác quá nhanh. Vui lòng chờ rồi thử lại.' }, 429)
  }
}
