import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigService } from '@nestjs/config'
import { ConflictException, UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import cookie from '@fastify/cookie'
import Fastify from 'fastify'
import { authCookie, guestCookie, GuestSessionGuard, sessionCookieOptions } from '../../common/guest-session.guard'
import type { PrismaService } from '../../common/prisma.service'
import { OAuthService } from './oauth.service'
import { hashPassword, verifyPassword } from './password'
import { ProfileAuthController } from './profile-auth.controller'
import { ProfileAuthService } from './profile-auth.service'

const userId = '3ad68bc9-30d7-4560-a2b0-45bffed1a07e'
const guestSessionId = '11520285-9e97-42a2-a8b6-c71356c05c09'

describe('profile avatars', () => {
  it('stores a 256px WebP and wipes input on success and rejection', async () => {
    const update = vi.fn().mockResolvedValue({ id: userId, authProvider: 'EMAIL', role: 'USER', avatarUpdatedAt: new Date(1234) })
    const service = new ProfileAuthService({ user: { update } } as unknown as PrismaService)
    const input = await sharp({ create: { width: 8, height: 4, channels: 3, background: '#ef9378' } }).png().toBuffer()
    await expect(service.saveAvatar(userId, input)).resolves.toEqual({ avatarUrl: '/api/v1/profile/avatar/' + userId + '?v=1234' })
    expect(input.every(byte => byte === 0)).toBe(true)
    expect(update.mock.calls[0][0].select).not.toHaveProperty('avatarData')
    const stored = update.mock.calls[0][0].data.avatarData
    expect(await sharp(Buffer.from(stored, 'base64')).metadata()).toMatchObject({ format: 'webp', width: 256, height: 256 })
    const invalid = Buffer.from('this is text')
    await expect(service.saveAvatar(userId, invalid)).rejects.toThrow()
    expect(invalid.every(byte => byte === 0)).toBe(true)
    expect(update).toHaveBeenCalledTimes(1)
  })
})

describe('password hashing', () => {
  it('uses a random salt and verifies only the matching password', async () => {
    const password = 'một mật khẩu đủ dài'
    const [first, second] = await Promise.all([hashPassword(password), hashPassword(password)])
    expect(first).toMatch(/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/)
    expect(first).not.toBe(second)
    await expect(verifyPassword(password, first)).resolves.toBe(true)
    await expect(verifyPassword('wrong password', first)).resolves.toBe(false)
    await expect(verifyPassword(password, null)).resolves.toBe(false)
  })
})

describe('OAuth state', () => {
  const service = new OAuthService(new ConfigService({
    APP_BASE_URL: 'http://localhost:3000',
    GOOGLE_CLIENT_ID: 'fake-google-id',
    GOOGLE_CLIENT_SECRET: 'fake-google-secret',
    GITHUB_CLIENT_ID: 'fake-github-id',
    GITHUB_CLIENT_SECRET: 'fake-github-secret',
  }))

  it('binds the state and PKCE challenge to the callback provider', () => {
    const { url, cookieValue } = service.start('google')
    const params = new URL(url).searchParams
    expect(params.get('redirect_uri')).toBe('http://localhost:3000/api/v1/auth/google/callback')
    expect(params.get('code_challenge_method')).toBe('S256')
    expect(params.get('code_challenge')).toMatch(/^[\w-]{43}$/)
    const pending = service.readStateCookie('google', cookieValue)
    expect(service.verifyState(params.get('state'), pending)).toMatch(/^[\w-]{43}$/)
    expect(service.readStateCookie('github', cookieValue)).toBeNull()
    expect(() => service.verifyState('mismatch', pending)).toThrow(UnauthorizedException)
  })

  it('sends a 302 error redirect through Fastify even when the route starts at 200', async () => {
    const app = Fastify()
    const jwt = new JwtService({ secret: 'test-signing-secret' })
    const profiles = { oauthLogin: vi.fn() } as unknown as ProfileAuthService
    const controller = new ProfileAuthController(profiles, service, jwt)
    try {
      await app.register(cookie, { secret: 'test-signing-secret' })
      app.get<{ Querystring: { state?: string; code?: string } }>('/api/v1/auth/google/callback', (request, reply) => {
        return controller.oauthCallback('google', request.query.code, request.query.state, request, reply.code(200))
      })
      const response = await app.inject('/api/v1/auth/google/callback?state=bad&code=bad')
      expect(response.statusCode).toBe(302)
      expect(response.headers.location).toBe('http://localhost:3000/profile?login=error')
      expect(response.headers['referrer-policy']).toBe('no-referrer')
    } finally {
      await app.close()
    }
  })

  it.each(['//example.invalid', 'https://example.invalid', '/\\example.invalid', '/bad\r\npath'])(
    'defaults unsafe OAuth destinations to /profile (%s)',
    (returnTo) => {
      const { cookieValue } = service.start('google', returnTo)
      expect(service.readStateCookie('google', cookieValue)?.returnTo).toBe('/profile')
    },
  )

  it.each(['success', 'conflict', 'error'] as const)('preserves the signed destination on OAuth %s', async (outcome) => {
    const secret = 'test-signing-secret'
    const app = Fastify()
    const jwt = new JwtService({ secret })
    const exchange = vi.spyOn(service, 'exchange').mockResolvedValue({
      provider: 'GOOGLE', subject: '42', email: 'test@example.test', name: null,
    })
    const oauthLogin = vi.fn()
    if (outcome === 'conflict') oauthLogin.mockRejectedValue(new ConflictException())
    else oauthLogin.mockResolvedValue({ id: userId })
    const controller = new ProfileAuthController({ oauthLogin } as unknown as ProfileAuthService, service, jwt)
    try {
      await app.register(cookie, { secret })
      app.get<{ Querystring: { returnTo?: string } }>('/api/v1/auth/google/url', (request, reply) => {
        return controller.oauthUrl('google', request.query.returnTo, reply)
      })
      app.get<{ Querystring: { state?: string; code?: string } }>('/api/v1/auth/google/callback', (request, reply) => {
        return controller.oauthCallback('google', request.query.code, request.query.state, request, reply.code(200))
      })

      const returnTo = '/forensic?claimedEntity=MB#report'
      const issued = await app.inject('/api/v1/auth/google/url?' + new URLSearchParams({ returnTo }))
      const stateCookie = issued.cookies.find(({ name }) => name === 'oauth_state')
      expect(stateCookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/api/v1/auth/google/callback' })
      const params = new URL(issued.json<{ url: string }>().url).searchParams
      const state = outcome === 'error' ? 'invalid' : params.get('state') ?? ''
      const response = await app.inject({
        url: '/api/v1/auth/google/callback?' + new URLSearchParams({ state, code: 'synthetic-code' }),
        cookies: { oauth_state: stateCookie?.value ?? '' },
      })
      expect(response.statusCode).toBe(302)
      expect(response.headers.location).toBe(outcome === 'success'
        ? 'http://localhost:3000/forensic?claimedEntity=MB&login=success#report'
        : 'http://localhost:3000/profile?' + new URLSearchParams({ login: outcome, returnTo }))
      expect(response.cookies.find(({ name }) => name === 'oauth_state')?.maxAge).toBe(0)
      if (outcome === 'error') expect(exchange).not.toHaveBeenCalled()
    } finally {
      exchange.mockRestore()
      await app.close()
    }
  })

  afterEach(() => vi.unstubAllGlobals())

  it('uses the verified primary GitHub email for an account with a private address', async () => {
    const fetch = vi.fn(async (url: string) => {
      switch (url) {
        case 'https://github.com/login/oauth/access_token':
          return Response.json({ access_token: 'fake-access-token' })
        case 'https://api.github.com/user':
          return Response.json({ id: 42, name: 'Ngọc', email: null })
        case 'https://api.github.com/user/emails':
          return Response.json([
            { email: 'other@example.com', verified: true, primary: false },
            { email: 'verified@example.com', verified: true, primary: true },
          ])
        default:
          throw new Error('Unexpected URL')
      }
    })
    vi.stubGlobal('fetch', fetch)
    await expect(service.exchange('github', 'fake-code', 'fake-verifier')).resolves.toEqual({
      provider: 'GITHUB', subject: '42', email: 'verified@example.com', name: 'Ngọc',
    })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('requires a verified Google email', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'fake-access-token' }))
      .mockResolvedValueOnce(Response.json({ sub: 'user', email: 'unverified@example.com', email_verified: false })))
    await expect(service.exchange('google', 'fake-code', 'fake-verifier')).rejects.toThrow(UnauthorizedException)
  })

  it('rejects an unverified primary GitHub address even when a secondary address is verified', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'fake-access-token' }))
      .mockResolvedValueOnce(Response.json({ id: 42 }))
      .mockResolvedValueOnce(Response.json([
        { email: 'primary@example.com', verified: false, primary: true },
        { email: 'secondary@example.com', verified: true, primary: false },
      ])))
    await expect(service.exchange('github', 'fake-code', 'fake-verifier')).rejects.toThrow(UnauthorizedException)
  })
})

describe('session cookies', () => {
  it('lets parallel reads stay cookie-free and creates the guest cookie on the first write', async () => {
    const secret = 'generated-for-this-test-only'
    const guard = new GuestSessionGuard(new JwtService({ secret }))
    const app = Fastify()
    await app.register(cookie, { secret })
    app.route({
      method: ['GET', 'POST'], url: '/profile', handler: async (request, response) => {
        const context = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) }
        await guard.canActivate(context as unknown as ExecutionContext)
        return request.session
      },
    })
    try {
      const reads = await Promise.all([app.inject('/profile'), app.inject('/profile')])
      for (const read of reads) {
        expect(read.json()).toMatchObject({ kind: 'guest' })
        expect(read.cookies).toEqual([])
      }
      const write = await app.inject({ url: '/profile', method: 'POST' })
      const cookie = write.cookies.find(({ name }) => name === guestCookie)
      expect(cookie).toBeDefined()
      const owned = await app.inject({ url: '/profile', cookies: { [guestCookie]: cookie?.value ?? '' } })
      expect(owned.json()).toEqual(write.json())
    } finally {
      await app.close()
    }
  })

  it('uses the signed auth cookie first and keeps the signed guest ID for merging', async () => {
    const secret = 'generated-for-this-test-only'
    const jwt = new JwtService({ secret })
    const guard = new GuestSessionGuard(jwt)
    const app = Fastify()
    await app.register(cookie, { secret })
    const authToken = jwt.sign({}, { subject: userId, algorithm: 'HS256', expiresIn: 60 })
    const bearerToken = jwt.sign({}, { subject: guestSessionId, algorithm: 'HS256', expiresIn: 60 })
    app.get('/issue', async (_request, reply) => {
      reply.setCookie(authCookie, authToken, sessionCookieOptions)
      reply.setCookie(guestCookie, guestSessionId, sessionCookieOptions)
      return {}
    })
    app.get('/session', async (request, response) => {
      const context = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) }
      await guard.canActivate(context as unknown as ExecutionContext)
      return { session: request.session, guestSessionId: request.guestSessionId }
    })
    try {
      const issued = await app.inject({ url: '/issue' })
      const auth = issued.cookies.find((item) => item.name === authCookie)
      const guest = issued.cookies.find((item) => item.name === guestCookie)
      expect(auth).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' })
      expect(auth?.value).not.toBe(authToken)
      expect(guest?.value).not.toBe(guestSessionId)
      const authenticated = await app.inject({
        url: '/session',
        cookies: { [authCookie]: auth?.value ?? '', [guestCookie]: guest?.value ?? '' },
        headers: { authorization: `Bearer ${bearerToken}` },
      })
      expect(authenticated.json()).toEqual({ session: { kind: 'user', userId }, guestSessionId })
      const guestFallback = await app.inject({
        url: '/session',
        cookies: { [authCookie]: authToken, [guestCookie]: guest?.value ?? '' },
      })
      expect(guestFallback.json()).toEqual({ session: { kind: 'guest', guestSessionId }, guestSessionId })
    } finally {
      await app.close()
    }
  })
})

describe('guest account merge', () => {
  const existingUser = { id: userId, email: 'test@example.com', authProvider: 'EMAIL', fullName: null, role: 'USER' }
  const tx = {
    user: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    financialProfile: { findUnique: vi.fn(), updateMany: vi.fn() },
    forensicAudit: { updateMany: vi.fn() },
    calculationSession: { updateMany: vi.fn() },
  }
  const transaction = vi.fn((fn: (client: typeof tx) => unknown) => fn(tx))
  const service = new ProfileAuthService({
    $transaction: transaction,
  } as unknown as PrismaService)

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('transfers the guest profile and both histories in the registration transaction', async () => {
    tx.user.create.mockResolvedValue(existingUser)
    tx.financialProfile.findUnique.mockResolvedValue(null)
    await expect(service.register({ email: existingUser.email, password: 'long-test-password' }, guestSessionId))
      .resolves.toMatchObject({ id: userId, role: 'USER' })
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'USER' }),
    }))
    expect(transaction).toHaveBeenCalledOnce()
    const transfer = { where: { guestSessionId, userId: null }, data: { guestSessionId: null, userId } }
    expect(tx.financialProfile.updateMany).toHaveBeenCalledWith(transfer)
    expect(tx.forensicAudit.updateMany).toHaveBeenCalledWith(transfer)
    expect(tx.calculationSession.updateMany).toHaveBeenCalledWith(transfer)
  })

  it('keeps an existing user profile and still transfers both histories', async () => {
    tx.user.findFirst.mockResolvedValue({ ...existingUser, authProvider: 'GOOGLE' })
    tx.financialProfile.findUnique.mockResolvedValue({ id: 'existing' })
    await service.oauthLogin({ provider: 'GOOGLE', subject: '123', email: existingUser.email, name: null }, guestSessionId)
    expect(tx.financialProfile.updateMany).toHaveBeenCalledWith({
      where: { guestSessionId, userId: null }, data: { guestSessionId: null, userId: null },
    })
    expect(tx.forensicAudit.updateMany).toHaveBeenCalledOnce()
    expect(tx.calculationSession.updateMany).toHaveBeenCalledOnce()
  })

  it.each(['GOOGLE', 'GITHUB'] as const)('merges a verified %s email into the existing account', async (provider) => {
    tx.user.findFirst.mockResolvedValue(null)
    tx.user.findUnique.mockResolvedValue(existingUser)
    await expect(service.oauthLogin({
      provider, subject: '123', email: existingUser.email, name: 'Provider display name',
    }, guestSessionId)).resolves.toMatchObject({ id: userId, authProvider: 'EMAIL' })
    expect(tx.user.create).not.toHaveBeenCalled()
    const transfer = { where: { guestSessionId, userId: null }, data: { guestSessionId: null, userId } }
    expect(tx.financialProfile.updateMany).toHaveBeenCalledWith(transfer)
    expect(tx.forensicAudit.updateMany).toHaveBeenCalledWith(transfer)
    expect(tx.calculationSession.updateMany).toHaveBeenCalledWith(transfer)
  })

  it.each(['GOOGLE', 'GITHUB'] as const)('rejects an implicit %s email match to an admin account', async (provider) => {
    tx.user.findFirst.mockResolvedValue(null)
    tx.user.findUnique.mockResolvedValue({ ...existingUser, role: 'ADMIN' })
    await expect(service.oauthLogin({
      provider, subject: '123', email: existingUser.email, name: null,
    }, guestSessionId)).rejects.toBeInstanceOf(ConflictException)
    expect(tx.user.create).not.toHaveBeenCalled()
    expect(tx.forensicAudit.updateMany).not.toHaveBeenCalled()
  })
})
