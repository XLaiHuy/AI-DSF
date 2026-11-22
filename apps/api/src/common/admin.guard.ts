import { timingSafeEqual } from 'node:crypto'
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { FastifyRequest } from 'fastify'

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configuredKey = this.config.get<string>('ADMIN_API_KEY')?.trim() ?? ''

    if (configuredKey.length === 0) {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new ForbiddenException({
          errorCode: 'ERR_FORBIDDEN',
          message: 'Yêu cầu quyền quản trị hợp lệ.',
        })
      }
      // TODO(Phase 2 - Tài): enforce admin JWT role or ADMIN_API_KEY in all environments
      return true
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>()
    const headerValue = request.headers['x-admin-key']
    if (typeof headerValue !== 'string' || headerValue.length === 0) {
      throw new ForbiddenException({
        errorCode: 'ERR_FORBIDDEN',
        message: 'Yêu cầu quyền quản trị hợp lệ.',
      })
    }

    const providedBuf = Buffer.from(headerValue, 'utf8')
    const expectedBuf = Buffer.from(configuredKey, 'utf8')
    if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
      throw new ForbiddenException({
        errorCode: 'ERR_FORBIDDEN',
        message: 'Yêu cầu quyền quản trị hợp lệ.',
      })
    }

    return true
  }
}
