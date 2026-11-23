import {
  Body, Controller, Get, HttpCode, Param, Post, Put, Query,
  Req, Res, UnauthorizedException, UseGuards,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import {
  AuthLoginSchema, AuthRegisterSchema, AuthSessionResponseSchema, FinancialProfileUpdateSchema,
  type AuthLogin, type AuthRegister, type AuthSessionResponse, type FinancialProfileUpdate,
} from '@fincopilot/shared-types'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authCookie, guestCookie, GuestSessionGuard, sessionCookieOptions } from '../../common/guest-session.guard'
import { ZodValidationPipe } from '../../common/zod-validation.pipe'
import { oauthCallbackPath, oauthLifetimeSeconds, OAuthProviderSchema, OAuthService, type OAuthProvider } from './oauth.service'
import { ProfileAuthService } from './profile-auth.service'

const oauthCookie = 'oauth_state'
const authLifetimeSeconds = 24 * 60 * 60
const oauthCode = z.string().min(1).max(2048)
type SessionUser = Extract<AuthSessionResponse, { kind: 'user' }>['user']

@Controller()
@UseGuards(GuestSessionGuard)
export class ProfileAuthController {
  constructor(
    private readonly profiles: ProfileAuthService,
    private readonly oauth: OAuthService,
    private readonly jwt: JwtService,
  ) {}

  @Post('auth/session/guest')
  @HttpCode(200)
  guest(@Req() request: FastifyRequest) {
    return { kind: request.session.kind }
  }

  @Get('auth/session')
  async session(@Req() request: FastifyRequest): Promise<AuthSessionResponse> {
    const user = request.session.kind === 'user' ? await this.profiles.getUser(request.session.userId) : null
    return this.describeSession(user)
  }

  @Post('auth/register')
  async register(
    @Body(new ZodValidationPipe(AuthRegisterSchema)) input: AuthRegister,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const user = await this.profiles.register(input, request.guestSessionId)
    await this.setAuthCookie(reply, user)
    return this.describeSession(user)
  }

  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(AuthLoginSchema)) input: AuthLogin,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const user = await this.profiles.login(input, request.guestSessionId)
    await this.setAuthCookie(reply, user)
    return this.describeSession(user)
  }

  @Post('auth/logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.clearCookie(authCookie, sessionCookieOptions)
  }

  @Get('auth/:provider/url')
  oauthUrl(
    @Param('provider', new ZodValidationPipe(OAuthProviderSchema)) provider: OAuthProvider,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { url, cookieValue } = this.oauth.start(provider)
    reply.setCookie(oauthCookie, cookieValue, {
      ...sessionCookieOptions, path: oauthCallbackPath(provider), maxAge: oauthLifetimeSeconds,
    })
    return { url }
  }

  @Get('auth/:provider/callback')
  async oauthCallback(
    @Param('provider', new ZodValidationPipe(OAuthProviderSchema)) provider: OAuthProvider,
    @Query('code') queryCode: unknown,
    @Query('state') state: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    reply.header('Referrer-Policy', 'no-referrer')
    const cookie = request.cookies[oauthCookie]
    const unsigned = cookie ? request.unsignCookie(cookie) : null
    const verifier = this.oauth.verifyState(provider, state, unsigned?.valid ? unsigned.value : null)
    reply.clearCookie(oauthCookie, { ...sessionCookieOptions, path: oauthCallbackPath(provider) })

    const code = oauthCode.safeParse(queryCode)
    if (!code.success) throw new UnauthorizedException()
    const identity = await this.oauth.exchange(provider, code.data, verifier)
    const user = await this.profiles.oauthLogin(identity, request.guestSessionId)
    await this.setAuthCookie(reply, user)
    return reply.redirect(new URL('/profile?login=success', this.oauth.appOrigin).toString())
  }

  @Get('profile')
  async getProfile(@Req() request: FastifyRequest) {
    return { profile: await this.profiles.getActiveProfile(request.session) }
  }

  @Put('profile')
  async updateProfile(
    @Body(new ZodValidationPipe(FinancialProfileUpdateSchema)) input: FinancialProfileUpdate,
    @Req() request: FastifyRequest,
  ) {
    return { profile: await this.profiles.updateProfile(request.session, input) }
  }

  private describeSession(user: SessionUser | null) {
    return AuthSessionResponseSchema.parse({
      kind: user ? 'user' : 'guest', user, oauthProviders: this.oauth.availableProviders,
    })
  }

  private async setAuthCookie(reply: FastifyReply, user: SessionUser) {
    const token = await this.jwt.signAsync({}, { subject: user.id, algorithm: 'HS256', expiresIn: authLifetimeSeconds })
    reply.setCookie(authCookie, token, { ...sessionCookieOptions, maxAge: authLifetimeSeconds })
    reply.clearCookie(guestCookie, sessionCookieOptions)
  }
}
