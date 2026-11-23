import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { z } from 'zod'

const providers = {
  google: {
    provider: 'GOOGLE',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
  },
  github: {
    provider: 'GITHUB',
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
  },
} as const

export const OAuthProviderSchema = z.enum(['google', 'github'])
export type OAuthProvider = z.infer<typeof OAuthProviderSchema>
export const oauthLifetimeSeconds = 10 * 60
export type OAuthIdentity = {
  provider: 'GOOGLE' | 'GITHUB'
  subject: string
  email: string
  name: string | null
}

const nonce = z.string().regex(/^[\w-]{43}$/)
const email = z.string().trim().toLowerCase().pipe(z.email().max(254))
const name = z.string().transform((text) => text.trim().slice(0, 150) || null).nullish()
const tokenResponse = z.object({ access_token: z.string().min(1) })
const googleUser = z.object({ sub: z.string().min(1).max(255), email, email_verified: z.literal(true), name })
const githubUser = z.object({ id: z.number().int().positive(), name })
const githubEmails = z.array(z.object({ email, primary: z.boolean(), verified: z.boolean() }))

export function oauthCallbackPath(provider: OAuthProvider): string {
  return `/api/v1/auth/${provider}/callback`
}

@Injectable()
export class OAuthService {
  constructor(private readonly config: ConfigService) {}

  get appOrigin() {
    return new URL(this.config.get('APP_BASE_URL', `http://localhost:${this.config.get('WEB_PORT', '3000')}`)).origin
  }

  get availableProviders() {
    return { google: Boolean(this.credentials('google')), github: Boolean(this.credentials('github')) }
  }

  start(provider: OAuthProvider) {
    const credentials = this.credentials(provider)
    if (!credentials) throw new ServiceUnavailableException()
    const state = randomBytes(32).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    const url = new URL(providers[provider].authorize)
    url.search = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: this.redirectUri(provider),
      response_type: 'code',
      scope: providers[provider].scope,
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString()
    return { url: url.toString(), cookieValue: `${provider}.${state}.${verifier}.${Date.now()}` }
  }

  verifyState(provider: OAuthProvider, suppliedState: unknown, cookieValue: string | null): string {
    const [cookieProvider, state, verifier, timestamp] = cookieValue?.split('.') ?? []
    const parsedState = nonce.safeParse(suppliedState)
    const age = Date.now() - Number(timestamp)
    if (cookieProvider !== provider || !nonce.safeParse(state).success || !nonce.safeParse(verifier).success
      || !parsedState.success || !Number.isFinite(age) || age < 0 || age > oauthLifetimeSeconds * 1000
      || !timingSafeEqual(Buffer.from(state), Buffer.from(parsedState.data))) {
      throw new UnauthorizedException()
    }
    return verifier
  }

  async exchange(provider: OAuthProvider, code: string, verifier: string): Promise<OAuthIdentity> {
    const credentials = this.credentials(provider)
    if (!credentials) throw new ServiceUnavailableException()
    const { access_token: token } = await this.fetchJson(providers[provider].token, tokenResponse, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri(provider),
        code_verifier: verifier,
      }),
    })

    if (provider === 'google') {
      const user = await this.fetchJson('https://openidconnect.googleapis.com/v1/userinfo', googleUser, {
        headers: { Authorization: `Bearer ${token}` },
      })
      return { provider: 'GOOGLE', subject: user.sub, email: user.email, name: user.name ?? null }
    }

    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
    const [user, emails] = await Promise.all([
      this.fetchJson('https://api.github.com/user', githubUser, { headers }),
      this.fetchJson('https://api.github.com/user/emails', githubEmails, { headers }),
    ])
    const primary = emails.find((candidate) => candidate.primary && candidate.verified)
    if (!primary) throw new UnauthorizedException()
    return { provider: 'GITHUB', subject: String(user.id), email: primary.email, name: user.name ?? null }
  }

  private credentials(provider: OAuthProvider) {
    const key = providers[provider].provider
    const clientId = this.config.get<string>(`${key}_CLIENT_ID`)?.trim()
    const clientSecret = this.config.get<string>(`${key}_CLIENT_SECRET`)?.trim()
    return clientId && clientSecret ? { clientId, clientSecret } : null
  }

  private redirectUri(provider: OAuthProvider): string {
    return new URL(oauthCallbackPath(provider), this.appOrigin).toString()
  }

  private async fetchJson<T>(url: string, schema: z.ZodType<T>, init: RequestInit): Promise<T> {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000), redirect: 'error' })
      if (!response.ok) {
        if (response.status >= 500 || response.status === 429) throw new ServiceUnavailableException()
        throw new UnauthorizedException()
      }
      const result = schema.safeParse(await response.json())
      if (!result.success) throw new UnauthorizedException()
      return result.data
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ServiceUnavailableException) throw error
      throw new ServiceUnavailableException()
    }
  }
}
