import {
  Body, ConflictException, Controller, Get, HttpCode, Param, Post, Put, Query,
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
import { calculateFinancialHealth } from './financial-health.engine'
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
  async session(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionResponse> {
    if (request.session.kind !== 'user') return this.describeSession(null)
    try {
      return this.describeSession(await this.profiles.getUser(request.session.userId))
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        reply.clearCookie(authCookie, sessionCookieOptions)
        return this.describeSession(null)
      }
      throw error
    }
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
    @Query('returnTo') returnTo: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { url, cookieValue } = this.oauth.start(provider, returnTo)
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
    reply.clearCookie(oauthCookie, { ...sessionCookieOptions, path: oauthCallbackPath(provider) })
    const pending = this.oauth.readStateCookie(provider, unsigned?.valid ? unsigned.value : null)
    const returnTo = pending?.returnTo ?? '/profile'

    try {
      const verifier = this.oauth.verifyState(state, pending)
      const code = oauthCode.safeParse(queryCode)
      if (!code.success) throw new UnauthorizedException()
      const identity = await this.oauth.exchange(provider, code.data, verifier)
      const user = await this.profiles.oauthLogin(identity, request.guestSessionId)
      await this.setAuthCookie(reply, user)
      const target = new URL(returnTo, this.oauth.appOrigin)
      target.searchParams.set('login', 'success')
      return reply.redirect(target.toString(), 302)
    } catch (error) {
      const status = error instanceof ConflictException ? 'conflict' : 'error'
      const target = new URL('/profile', this.oauth.appOrigin)
      target.searchParams.set('login', status)
      if (returnTo !== '/profile') target.searchParams.set('returnTo', returnTo)
      return reply.redirect(target.toString(), 302)
    }
  }

  @Get('profile')
  async getProfile(@Req() request: FastifyRequest) {
    const profile = await this.profiles.getActiveProfile(request.session)
    return { profile, health: profile ? calculateFinancialHealth(profile) : null }
  }

  @Put('profile')
  async updateProfile(
    @Body(new ZodValidationPipe(FinancialProfileUpdateSchema)) input: FinancialProfileUpdate,
    @Req() request: FastifyRequest,
  ) {
    const profile = await this.profiles.updateProfile(request.session, input)
    return { profile, health: calculateFinancialHealth(profile) }
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
