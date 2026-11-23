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
import { ProfileAuthService } from './profile-auth.service'

const userId = '3ad68bc9-30d7-4560-a2b0-45bffed1a07e'
const guestSessionId = '11520285-9e97-42a2-a8b6-c71356c05c09'

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
    expect(service.verifyState('google', params.get('state'), cookieValue)).toMatch(/^[\w-]{43}$/)
    expect(() => service.verifyState('github', params.get('state'), cookieValue)).toThrow(UnauthorizedException)
    expect(() => service.verifyState('google', 'mismatch', cookieValue)).toThrow(UnauthorizedException)
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
})

describe('session cookies', () => {
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
  const existingUser = { id: userId, email: 'test@example.com', authProvider: 'EMAIL', fullName: null }
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
      .resolves.toMatchObject({ id: userId })
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

  it('rejects provider login when its email belongs to a different login method', async () => {
    tx.user.findFirst.mockResolvedValue(null)
    tx.user.findUnique.mockResolvedValue(existingUser)
    await expect(service.oauthLogin({
      provider: 'GITHUB', subject: '123', email: existingUser.email, name: null,
    }, guestSessionId)).rejects.toThrow(ConflictException)
    expect(tx.user.create).not.toHaveBeenCalled()
    expect(tx.forensicAudit.updateMany).not.toHaveBeenCalled()
  })
})
