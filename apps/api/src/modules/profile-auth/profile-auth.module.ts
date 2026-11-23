import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { GuestSessionGuard } from '../../common/guest-session.guard'
import { OAuthService } from './oauth.service'
import { ProfileAuthController } from './profile-auth.controller'
import { ProfileAuthService } from './profile-auth.service'

@Global()
@Module({
  imports: [JwtModule.registerAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRET') }),
  })],
  controllers: [ProfileAuthController],
  providers: [ProfileAuthService, OAuthService, GuestSessionGuard],
  exports: [ProfileAuthService, GuestSessionGuard, JwtModule],
})
export class ProfileAuthModule {}
