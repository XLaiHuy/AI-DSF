import { timingSafeEqual } from 'node:crypto'
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { FastifyRequest } from 'fastify'
import { authCookie, verifySessionUserId } from './guest-session.guard'
import { PrismaService } from './prisma.service'

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>()
    const signed = request.cookies[authCookie]
    const cookie = signed ? request.unsignCookie(signed) : undefined
    const bearer = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '')?.[1]
    const checked = new Set<string>()
    for (const token of [cookie?.valid ? cookie.value : undefined, bearer]) {
      if (!token) continue
      const userId = await verifySessionUserId(this.jwt, token)
      if (!userId || checked.has(userId)) continue
      checked.add(userId)
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
      if (user?.role === 'ADMIN') return true
    }

    const configuredKey = this.config.get<string>('ADMIN_API_KEY')?.trim()
    const headerValue = request.headers['x-admin-key']
    if (configuredKey && typeof headerValue === 'string') {
      const provided = Buffer.from(headerValue, 'utf8')
      const expected = Buffer.from(configuredKey, 'utf8')
      if (provided.length === expected.length && timingSafeEqual(provided, expected)) return true
    }

    throw new ForbiddenException({
      errorCode: 'ERR_FORBIDDEN',
      message: 'Yêu cầu tài khoản quản trị hợp lệ.',
    })
  }
}
