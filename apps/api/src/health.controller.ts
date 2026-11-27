import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common'
import { PrismaService } from './common/prisma.service'
import { RedisService } from './common/redis.service'

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

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

}
