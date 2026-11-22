import { randomUUID } from 'node:crypto'
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { SessionContext } from '@fincopilot/shared-types'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionContext
  }
}

const guestCookie = 'guest_session_id'
const uuid = z.uuid()

@Injectable()
export class GuestSessionGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>()
    if (request.headers.authorization !== undefined) {
      const token = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization)?.[1]
      if (!token) throw new UnauthorizedException()

      try {
        const claims = await this.jwt.verifyAsync<{ sub?: unknown }>(token, { algorithms: ['HS256'] })
        request.session = { kind: 'user', userId: uuid.parse(claims.sub) }
      } catch {
        throw new UnauthorizedException()
      }
      return true
    }

    const cookie = request.cookies[guestCookie]
    const unsigned = cookie ? request.unsignCookie(cookie) : undefined
    const parsed = uuid.safeParse(unsigned?.valid ? unsigned.value : undefined)
    const guestSessionId = parsed.success ? parsed.data : randomUUID()
    request.session = { kind: 'guest', guestSessionId }

    if (!parsed.success || unsigned?.renew) {
      context.switchToHttp().getResponse<FastifyReply>().setCookie(guestCookie, guestSessionId, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        signed: true,
        maxAge: 60 * 60 * 24 * 30,
      })
    }

    return true
  }
}
