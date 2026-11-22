import { Controller, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { GuestSessionGuard } from '../../common/guest-session.guard'
import { ProfileAuthService } from './profile-auth.service'

@Controller()
@UseGuards(GuestSessionGuard)
export class ProfileAuthController {
  constructor(private readonly profiles: ProfileAuthService) {}

  @Post('auth/session/guest')
  @HttpCode(200)
  guest(@Req() request: FastifyRequest) {
    return { kind: request.session.kind }
  }

  @Post('auth/login')
  login() {
    return this.profiles.pending()
  }

  @Post('auth/google')
  google() {
    return this.profiles.pending()
  }

  @Get('profile')
  getProfile(@Req() request: FastifyRequest) {
    return this.profiles.getActiveProfile(request.session).then((profile) => ({ profile }))
  }

  @Put('profile')
  updateProfile() {
    return this.profiles.pending()
  }
}
