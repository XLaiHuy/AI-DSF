import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { GuestSessionGuard } from '../../common/guest-session.guard'
import { OAuthService } from './oauth.service'
import { ProfileAuthController, PublicAvatarController } from './profile-auth.controller'
import { ProfileAuthService } from './profile-auth.service'
import { ProfileCopilotController } from './profile-copilot.controller'

@Global()
@Module({
  imports: [JwtModule.registerAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRET') }),
  })],
  controllers: [PublicAvatarController, ProfileAuthController, ProfileCopilotController],
  providers: [ProfileAuthService, OAuthService, GuestSessionGuard],
  exports: [ProfileAuthService, GuestSessionGuard, JwtModule],
})
export class ProfileAuthModule {}
