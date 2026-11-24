import { randomUUID } from 'node:crypto'
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { SessionContext } from '@fincopilot/shared-types'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionContext
    guestSessionId?: string
  }
}

export const guestCookie = 'guest_session_id'
export const authCookie = 'auth_token'
export const sessionCookieOptions = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  signed: true,
} as const
const uuid = z.uuid()

@Injectable()
export class GuestSessionGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>()
    const reply = context.switchToHttp().getResponse<FastifyReply>()
    reply.header('Cache-Control', 'no-store')

    const cookie = request.cookies[guestCookie]
    const unsigned = cookie ? request.unsignCookie(cookie) : undefined
    const parsed = uuid.safeParse(unsigned?.valid ? unsigned.value : undefined)
    request.guestSessionId = parsed.success ? parsed.data : undefined

    const signedAuth = request.cookies[authCookie]
    if (signedAuth) {
      const auth = request.unsignCookie(signedAuth)
      const userId = auth.valid ? await this.readUserId(auth.value) : null
      if (userId) {
        request.session = { kind: 'user', userId }
        return true
      }
      reply.clearCookie(authCookie, sessionCookieOptions)
    }

    if (request.headers.authorization !== undefined) {
      const token = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization)?.[1]
      const userId = token ? await this.readUserId(token) : null
      if (!userId) throw new UnauthorizedException()
      request.session = { kind: 'user', userId }
      return true
    }

    const guestSessionId = request.guestSessionId ?? randomUUID()
    request.guestSessionId = guestSessionId
    request.session = { kind: 'guest', guestSessionId }

    // Parallel reads can use an ephemeral guest ID. Only writes establish a new guest cookie.
    if ((!parsed.success && request.method !== 'GET' && request.method !== 'HEAD') || unsigned?.renew) {
      reply.setCookie(guestCookie, guestSessionId, {
        ...sessionCookieOptions,
        maxAge: 60 * 60 * 24 * 30,
      })
    }

    return true
  }

  private async readUserId(token: string): Promise<string | null> {
    try {
      const claims = await this.jwt.verifyAsync<{ sub?: unknown }>(token, { algorithms: ['HS256'] })
      return uuid.parse(claims.sub)
    } catch {
      return null
    }
  }
}
