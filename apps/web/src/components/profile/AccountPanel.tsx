'use client'

import { AuthLoginSchema, AuthRegisterSchema, ROUTES, safeReturnTo, type AuthSessionResponse } from '@fincopilot/shared-types'
import Image from 'next/image'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, Github, LockKeyhole, LogIn, LogOut } from 'lucide-react'
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { z } from 'zod'
import { Badge, Button, buttonVariants, Card, Input, Label } from '@/components/ui'
import { apiClient } from '@/lib/api-client'
import { requestError, sessionQuery } from '@/lib/workspace-data'
import { cn } from '@/lib/utils'

const modes = ['login', 'register'] as const
type AuthMode = typeof modes[number]
type OAuthProvider = 'google' | 'github'
const oauthUrlResponse = z.strictObject({ url: z.url({ protocol: /^https$/ }) })

function EmailAuth({
  busy, changeBusy, reportError, returnTo,
}: {
  busy: boolean
  changeBusy: (busy: boolean) => void
  reportError: (error: string) => void
  returnTo: string
}) {
  const [mode, setMode] = useState<AuthMode>('login')
  const loginTab = useRef<HTMLButtonElement>(null)
  const registerTab = useRef<HTMLButtonElement>(null)
  const registering = mode === 'register'

  function select(next: AuthMode) {
    setMode(next)
    reportError('')
  }

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'login' : event.key === 'End' ? 'register' : registering ? 'login' : 'register'
    select(next)
    const tab = next === 'login' ? loginTab : registerTab
    tab.current?.focus()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const rawDisplayName = registering ? String(form.get('displayName') ?? '').trim() : ''
    const fields = {
      email: String(form.get('email')).trim(),
      password: String(form.get('password')),
      ...(registering && rawDisplayName ? { displayName: rawDisplayName } : {}),
    }
    const parsed = (registering ? AuthRegisterSchema : AuthLoginSchema).safeParse(fields)

    if (!parsed.success) {
      reportError('Kiểm tra email và mật khẩu rồi thử lại.')
      return
    }
    changeBusy(true)
    reportError('')
    try {
      await apiClient.post('/auth/' + mode, parsed.data)
      const destination = safeReturnTo(returnTo)
      window.location.replace(destination === ROUTES.profile ? ROUTES.profile + '?login=success' : destination)
    } catch (error) {
      reportError(requestError(error, 'Chưa thể xác thực tài khoản. Vui lòng thử lại.'))
      changeBusy(false)
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" aria-label="Xác thực qua email" role="tablist">
        {modes.map((value) => (
          <Button
            key={value}
            ref={value === 'login' ? loginTab : registerTab}
            role="tab"
            id={'auth-tab-' + value}
            aria-controls={'email-auth-' + value}
            aria-selected={mode === value}
            tabIndex={mode === value ? 0 : -1}
            disabled={busy}
            variant={mode === value ? 'outline' : 'ghost'}
            className={cn('min-h-11', value !== mode && 'text-muted-foreground')}
            onClick={() => select(value)}
            onKeyDown={navigateTabs}
          >
            {value === 'login' ? 'Đăng nhập' : 'Đăng ký'}
          </Button>
        ))}
      </div>
      {modes.map((value) => (
        <div key={value} id={'email-auth-' + value} role="tabpanel" aria-labelledby={'auth-tab-' + value} hidden={mode !== value}>
          {mode === value && (
            <form onSubmit={submit} className="grid gap-4">
              {registering && (
                <div className="grid gap-2">
                  <Label htmlFor="auth-display-name">Tên hiển thị (tùy chọn)</Label>
                  <Input id="auth-display-name" name="displayName" type="text" autoComplete="name" maxLength={100} disabled={busy} className="h-11" />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="auth-email">Email</Label>
                <Input id="auth-email" name="email" type="email" autoComplete="email" maxLength={254} required disabled={busy} className="h-11" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="auth-password">Mật khẩu</Label>
                <Input id="auth-password" name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'}
                  required minLength={registering ? 10 : undefined} maxLength={128} disabled={busy} className="h-11"
                  aria-describedby={registering ? 'auth-password-help' : undefined}
                />
                {registering && <p id="auth-password-help" className="text-xs text-muted-foreground">Dùng ít nhất 10 ký tự.</p>}
              </div>
              <Button type="submit" className="min-h-11 justify-self-start" disabled={busy}>
                <LogIn size={16} aria-hidden="true" />
                {busy ? 'Đang xử lý…' : registering ? 'Đăng ký bằng email' : 'Đăng nhập bằng email'}
              </Button>
            </form>
          )}
        </div>
      ))}
    </div>
  )
}

function AuthError({ error }: { error: string }) {
  return (
    <div role="alert">
      {error && <p className="mt-3 rounded-lg border border-verdict-danger-border bg-verdict-danger-bg p-3 text-sm text-verdict-danger">{error}</p>}
    </div>
  )
}

export function AccountStatus({ session }: { session: AuthSessionResponse }) {
  const avatarInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const queries = useQueryClient()
  async function changeAvatar(file?: File) {
    setError('')
    if (file && file.size > 5 * 1024 * 1024) { setError('Ảnh tối đa 5 MB.'); return }
    setBusy(true)
    try {
      if (file) {
        const form = new FormData()
        form.append('avatar', file)
        await apiClient.post('/profile/avatar', form)
      } else await apiClient.delete('/profile/avatar')
      await queries.invalidateQueries({ queryKey: sessionQuery.queryKey })
    } catch (cause) { setError(requestError(cause, 'Chưa thể cập nhật ảnh chân dung.')) }
    finally { setBusy(false) }
  }

  const user = session.kind === 'user' ? session.user : undefined
  const name = user?.displayName || user?.email || ''
  const initials = name.replace(/<[^>]*>/gu, '').trim().split(/\s+/u).flatMap(word => word.match(/\p{L}/u)?.[0] ?? [])
  const avatarAction = user?.avatarUrl ? 'Đổi ảnh' : 'Tải ảnh chân dung'
  const selectAvatar = () => avatarInput.current?.click()

  async function logout() {
    setBusy(true)
    setError('')
    try {
      await apiClient.post('/auth/logout')
      window.location.replace(ROUTES.profile + '?logout=success')
    } catch (cause) {
      setError(requestError(cause, 'Chưa thể đăng xuất. Vui lòng thử lại.'))
      setBusy(false)
    }
  }

  return (
    <Card className="bg-accent/60 p-5 sm:px-6">
      <section aria-labelledby="session-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <LockKeyhole className="mt-0.5 shrink-0 text-primary" size={20} aria-hidden="true" />
            <div className="min-w-0 space-y-1">
              <h2 id="session-heading" className="text-base font-semibold">{session.kind === 'guest' ? 'Bạn đang dùng phiên khách' : 'Tài khoản của bạn'}</h2>
              {session.kind === 'guest' ? (
                <p className="max-w-[65ch] text-sm leading-relaxed text-accent-foreground">Đăng nhập để gộp lịch sử giám định. Hồ sơ phiên khách được chuyển sang nếu tài khoản chưa có hồ sơ tài chính.</p>
              ) : (
                <p className="break-words text-sm text-accent-foreground [overflow-wrap:anywhere]">{name}</p>
              )}
            </div>
            {user && <div className="relative mr-1 shrink-0">
              <div className="grid size-14 place-items-center overflow-hidden rounded-full border border-border bg-card" data-testid="account-avatar">
                {user.avatarUrl ? <Image unoptimized width={56} height={56} className="h-full w-full object-cover" src={user.avatarUrl} alt="Ảnh chân dung của bạn" />
                  : <span className="font-semibold text-primary" aria-hidden="true">{(initials.length > 1 ? initials[0] + initials.at(-1) : initials[0])?.toLocaleUpperCase('vi-VN')}</span>}
              </div>
              <Button type="button" variant="outline" className="absolute -right-1 -bottom-1 size-7 rounded-full p-0" aria-label={avatarAction + ' từ khung ảnh'} aria-describedby="avatar-help" disabled={busy} onClick={selectAvatar}>
                <Camera size={14} aria-hidden="true" />
              </Button>
            </div>}
          </div>
          {session.kind === 'guest' ? (
            <a href="#account-sign-in" className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}>
              <LogIn size={16} aria-hidden="true" /> Đăng nhập hoặc đăng ký
            </a>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="safe">{({ EMAIL: 'Email', GOOGLE: 'Google', GITHUB: 'GitHub' })[session.user.authProvider]}</Badge>
              <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void logout()}>
                <LogOut size={16} aria-hidden="true" /> Đăng xuất
              </Button>
            </div>
          )}
        </div>
        {session.kind === 'guest' ? <p className="mt-3 text-sm">Đăng nhập để lưu ảnh chân dung.</p> :
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input ref={avatarInput} name="avatar" className="sr-only" hidden type="file" disabled={busy} accept="image/jpeg,image/png,image/webp" onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void changeAvatar(file)
            }} />
            <Button type="button" variant="outline" className="min-h-11" disabled={busy} aria-describedby="avatar-help" onClick={selectAvatar}>{avatarAction}</Button>
            {session.user.avatarUrl && <Button type="button" className="min-h-11" disabled={busy} variant="outline" onClick={() => void changeAvatar()}>Xóa ảnh</Button>}
            <p className="text-sm text-muted-foreground" id="avatar-help">JPG, PNG, WebP · tối đa 5 MB</p>
          </div>}
        <AuthError error={error} />
      </section>
    </Card>
  )
}

export function AccountPanel({ session, returnTo }: { session: Extract<AuthSessionResponse, { kind: 'guest' }>; returnTo: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function startOAuth(provider: OAuthProvider) {
    setBusy(true)
    setError('')
    try {
      const query = new URLSearchParams({ returnTo: safeReturnTo(returnTo) })
      const { url } = await apiClient.get('/auth/' + provider + '/url?' + query, { schema: oauthUrlResponse, cache: 'no-store' })
      window.location.assign(url)
    } catch (cause) {
      setError(requestError(cause, 'Chưa thể kết nối với nhà cung cấp đăng nhập. Vui lòng thử lại.'))
      setBusy(false)
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <section className="space-y-4" aria-labelledby="account-sign-in">
        <h2 id="account-sign-in" tabIndex={-1} className="scroll-mt-24 text-lg font-semibold tracking-tight">
          Đăng nhập tài khoản
        </h2>
        <EmailAuth busy={busy} changeBusy={setBusy} reportError={setError} returnTo={returnTo} />
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Đăng nhập bằng tài khoản có sẵn</h3>
          <div className="grid gap-3">
            {(['google', 'github'] as const).map((provider) => (
              <div className="space-y-1" key={provider}>
                <Button variant="outline" className="min-h-11 w-full justify-start" disabled={busy || !session.oauthProviders[provider]}
                  onClick={() => void startOAuth(provider)} aria-describedby={!session.oauthProviders[provider] ? provider + '-unavailable' : undefined}>
                  {provider === 'google' ? <LogIn size={16} aria-hidden="true" /> : <Github size={16} aria-hidden="true" />}
                  {provider === 'google' ? 'Tiếp tục với Google' : 'Tiếp tục với GitHub'}
                </Button>
                {!session.oauthProviders[provider] && (
                  <p id={provider + '-unavailable'} className="px-1 text-xs text-muted-foreground">
                    {provider === 'google' ? 'Google' : 'GitHub'} chưa được cấu hình.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
        <AuthError error={error} />
      </section>
    </Card>
  )
}
