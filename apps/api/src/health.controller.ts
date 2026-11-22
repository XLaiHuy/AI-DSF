import { Controller, Get, HttpException, HttpStatus, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { PrismaService } from './common/prisma.service'

@Controller('health')
export class HealthController implements OnModuleDestroy {
  private readonly redis: Redis

  constructor(private readonly prisma: PrismaService, config: ConfigService) {
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      connectTimeout: 1500,
      commandTimeout: 1500,
      maxRetriesPerRequest: 0,
    })
    this.redis.on('error', () => {
      // The readiness response reports connection failures without leaking connection details.
    })
  }

  @Get()
  async check() {
    const [postgres, redis] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
    ])
    const services = {
      postgres: postgres.status === 'fulfilled' ? 'up' : 'down',
      redis: redis.status === 'fulfilled' && redis.value === 'PONG' ? 'up' : 'down',
    } as const

    if (services.postgres === 'down' || services.redis === 'down') {
      throw new HttpException({
        errorCode: 'ERR_SERVICE_UNAVAILABLE',
        message: 'Dịch vụ phụ thuộc chưa sẵn sàng.',
        details: services,
      }, HttpStatus.SERVICE_UNAVAILABLE)
    }

    return {
      status: 'ok',
      ...services,
      modules: ['ai-gateway', 'profile-auth', 'radar', 'survey-calc', 'forensic', 'admin'],
    }
  }

  onModuleDestroy() {
    this.redis.disconnect()
  }
}
