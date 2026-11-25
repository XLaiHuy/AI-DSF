import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { parse } from 'yaml'
import { PrismaModule } from './common/prisma.module'
import { HealthController } from './health.controller'
import { AdminModule } from './modules/admin/admin.module'
import { AiGatewayModule } from './modules/ai-gateway/ai-gateway.module'
import { ForensicModule } from './modules/forensic/forensic.module'
import { HomeController } from './modules/home/home.controller'
import { ProfileAuthModule } from './modules/profile-auth/profile-auth.module'
import { RadarModule } from './modules/radar/radar.module'
import { SurveyCalcModule } from './modules/survey-calc/survey-calc.module'

const workspaceRoot = resolve(__dirname, '../../..')

function loadYaml(name: string): unknown {
  return parse(readFileSync(resolve(workspaceRoot, 'config', name), 'utf8'))
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(workspaceRoot, '.env'),
      load: [() => ({
        radarSources: loadYaml('sources.yaml'),
        aiRouting: loadYaml('ai-routing.yaml'),
      })],
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.getOrThrow<string>('REDIS_URL'))
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || '6379'),
            username: decodeURIComponent(url.username) || undefined,
            password: decodeURIComponent(url.password) || undefined,
            db: Number(url.pathname.slice(1) || '0'),
            tls: url.protocol === 'rediss:' ? {} : undefined,
          },
        }
      },
    }),
    PrismaModule,
    AiGatewayModule,
    ProfileAuthModule,
    RadarModule,
    SurveyCalcModule,
    ForensicModule,
    AdminModule,
  ],
  controllers: [HealthController, HomeController],
})
export class AppModule {}
