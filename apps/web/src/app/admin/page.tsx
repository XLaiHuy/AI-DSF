'use client'

import { AuthLoginSchema, AuthSessionResponseSchema, type AuthSessionResponse } from '@fincopilot/shared-types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LogIn, LogOut } from 'lucide-react'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Badge, Button, Card, Input, Label } from '@/components/ui'
import { ThreatReviewPanel } from '@/components/admin/ThreatReviewPanel'
import { DataCatalogPanel } from '@/components/admin/DataCatalogPanel'
import { type AdminCredentials } from '@/components/admin/admin-client'
import { apiClient } from '@/lib/api-client'
import { auditListQuery, profileQuery, requestError, sessionQuery, surveyHistoryQuery } from '@/lib/workspace-data'

const tabs = [
  { id: 'review', label: 'Kiểm duyệt, Góp ý & R&D' },
  { id: 'catalog', label: 'Nguồn dữ liệu & Kho sản phẩm' },
] as const

export default function AdminPage() {
  const session = useQuery(sessionQuery)
  const queryClient = useQueryClient()
  const [credentials, setCredentials] = useState({ key: '', revision: 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const email = session.data?.kind === 'user' ? session.data.user.email : undefined
  const isAdmin = session.data?.kind === 'user' && session.data.user.role === 'ADMIN'

  async function updateSession(next?: AuthSessionResponse) {
    await queryClient.cancelQueries({ queryKey: sessionQuery.queryKey })
    for (const { queryKey } of [profileQuery, auditListQuery, surveyHistoryQuery]) queryClient.removeQueries({ queryKey })
    queryClient.removeQueries({ queryKey: ['forensic', 'audit'] })
    if (next) queryClient.setQueryData(sessionQuery.queryKey, next)
    await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey })
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const parsed = AuthLoginSchema.safeParse(Object.fromEntries(new FormData(form)))
    if (!parsed.success) {
      setError('Nhập email hợp lệ và mật khẩu để đăng nhập.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await apiClient.post('/auth/login', parsed.data, { schema: AuthSessionResponseSchema })
      form.reset()
      await updateSession(result)
      if (result.kind !== 'user' || result.user.role !== 'ADMIN') setError('Tài khoản này không có quyền quản trị.')
    } catch (cause) {
      setError(requestError(cause, 'Chưa thể đăng nhập. Vui lòng thử lại.'))
    } finally {
      setBusy(false)
    }
  }

  function clearKey() {
    setCredentials((previous) => ({ key: '', revision: previous.revision + 1 }))
  }

  async function logout() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await apiClient.post('/auth/logout')
      clearKey()
      const providers = session.data?.oauthProviders ?? { google: false, github: false }
      await updateSession({ kind: 'guest', user: null, oauthProviders: providers })
    } catch (cause) {
      setError(requestError(cause, 'Chưa thể đăng xuất. Vui lòng thử lại.'))
    } finally {
      setBusy(false)
    }
  }

  const signOut = <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void logout()}>
    <LogOut size={15} aria-hidden="true" /> Đăng xuất
  </Button>

  if (isAdmin || credentials.key) {
    return <AdminWorkspace credentials={credentials} toolbar={isAdmin
      ? <><Badge variant="safe" className="max-w-full break-all whitespace-normal">{email}</Badge>{signOut}</>
      : <Button type="button" variant="outline" size="sm" onClick={clearKey}>Ngắt kết nối khóa API</Button>
    } error={error} />
  }

  if (session.isPending) return <p role="status" className="mx-auto max-w-sm py-16 text-center text-sm text-muted-foreground">Đang kiểm tra phiên đăng nhập…</p>

  return <div className="mx-auto grid w-full max-w-md gap-4 py-4 sm:py-12">
    <Card className="gap-5 p-5 sm:p-7">
      <h1 className="text-2xl font-bold tracking-tight">Đăng nhập Quản trị</h1>
      {email && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2">
        <span className="min-w-0 break-all text-sm">{email}</span>{signOut}
      </div>}
      <form className="grid gap-4" onSubmit={(event) => void login(event)} aria-busy={busy}>
        <div className="grid gap-2">
          <Label htmlFor="admin-login-email">Email</Label>
          <Input id="admin-login-email" name="email" type="email" autoComplete="username" spellCheck={false}
            enterKeyHint="next" maxLength={254} required disabled={busy} className="h-11" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="admin-login-password">Mật khẩu</Label>
          <Input id="admin-login-password" name="password" type="password" autoComplete="current-password"
            enterKeyHint="done" maxLength={128} required disabled={busy} className="h-11" />
        </div>
        <Button type="submit" disabled={busy} className="min-h-11">
          <LogIn size={16} aria-hidden="true" /> {busy ? 'Đang xử lý…' : 'Đăng nhập'}
        </Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>
    </Card>
    <details className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium">Hoặc dùng khóa API quản trị</summary>
      <form className="mt-3 grid gap-2" onSubmit={(event) => {
        event.preventDefault()
        const form = event.currentTarget
        const key = String(new FormData(form).get('key') ?? '').trim()
        if (!key) return
        setCredentials((previous) => ({ key, revision: previous.revision + 1 }))
        setError('')
        form.reset()
      }}>
        <Label htmlFor="admin-api-key">Khóa API</Label>
        <Input id="admin-api-key" name="key" type="password" autoComplete="off" required disabled={busy} />
        <Button type="submit" variant="outline" className="justify-self-start" disabled={busy}>Dùng khóa API</Button>
      </form>
    </details>
  </div>
}

function AdminWorkspace({ credentials, toolbar, error }: { credentials: AdminCredentials; toolbar: ReactNode; error: string }) {
  const [selected, setSelected] = useState(0)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  return <div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <h1 className="text-3xl font-bold tracking-tight">Vận hành FinCopilot</h1>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{toolbar}</div>
    </header>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div role="tablist" aria-label="Mục vận hành" className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted p-1 sm:w-fit">
      {tabs.map(({ id, label }, index) => <button type="button" role="tab" id={`admin-tab-${id}`} key={id}
        ref={(button) => { buttons.current[index] = button }} aria-selected={selected === index} tabIndex={selected === index ? 0 : -1}
        className="min-h-11 rounded-md px-2 py-2 text-center text-xs font-medium leading-snug text-muted-foreground aria-selected:bg-card aria-selected:text-foreground aria-selected:shadow-xs sm:px-4 sm:text-sm"
        onClick={() => setSelected(index)}
        onKeyDown={(event) => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? (index + 1) % tabs.length : -1
          if (next < 0) return
          event.preventDefault()
          setSelected(next)
          buttons.current[next]?.focus()
        }}>{label}</button>)}
    </div>
    <section role="tabpanel" aria-labelledby="admin-tab-review" hidden={selected !== 0}>
      {selected === 0 && <ThreatReviewPanel key={credentials.revision} credentials={credentials} />}
    </section>
    <section role="tabpanel" aria-labelledby="admin-tab-catalog" hidden={selected !== 1}>
      {selected === 1 && <DataCatalogPanel key={credentials.revision} credentials={credentials} />}
    </section>
  </div>
}
