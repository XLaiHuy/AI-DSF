'use client'

import { handoffRoutes, ROUTES } from '@fincopilot/shared-types'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CircleUserRound, ScanLine, ShieldAlert } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Button, buttonVariants, Card, Input, Label } from '@/components/ui'
import { auditHref, auditListQuery, dailyBriefQuery, formatVietnamTime, formatVnd, marketOverviewQuery,
  profileQuery, sessionQuery, surveyHistoryQuery, surveySessionHref, surveySessionLabel } from '@/lib/workspace-data'
import { cn } from '@/lib/utils'
import { MoneyInput, stripSpacedAmount } from '@/components/ui/money-input'
import { verdictLabels } from '@/components/forensic/verdict'
import { CategoryArtwork } from '@/components/radar/CategoryArtwork'

function ProfileStatus() {
  const session = useQuery(sessionQuery)
  const profile = useQuery(profileQuery)
  const savedProfile = profile.data?.profile
  const errored = session.isError || profile.isError

  return (
    <Card className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-4 sm:px-6">
      <div className="flex min-w-0 items-start gap-3">
        <CircleUserRound className="mt-0.5 shrink-0 text-primary" strokeWidth={1.7} size={21} aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Hồ sơ tài chính</h2>
          <div role="status" className="mt-1 text-sm text-muted-foreground">
            {errored ? 'Chưa tải được hồ sơ.'
              : profile.isPending ? 'Đang tải hồ sơ…'
              : savedProfile ? (
                <dl className="flex flex-wrap gap-x-4 gap-y-1">
                  <div className="flex flex-wrap gap-x-1.5">
                    <dt>Thu nhập</dt>
                    <dd className="font-numeric font-medium text-foreground">{formatVnd(savedProfile.monthlyIncomeVnd)}</dd>
                  </div>
                  <div className="flex flex-wrap gap-x-1.5">
                    <dt>Trả nợ hằng tháng</dt>
                    <dd className="font-numeric font-medium text-foreground">{formatVnd(savedProfile.existingDebtPaymentVnd)}</dd>
                  </div>
                </dl>
              ) : 'Thêm thu nhập và chi phí để ước tính sức trả nợ.'}
          </div>
        </div>
      </div>
      <Link href={ROUTES.profile} className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}>
        {savedProfile ? 'Cập nhật hồ sơ' : 'Thiết lập hồ sơ'}
      </Link>
    </Card>
  )
}

function QuickSurvey() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [loanAmount, setLoanAmount] = useState('50000000')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const amount = stripSpacedAmount(String(fields.get('amount')))
    const term = Number(fields.get('term'))

    if (!/^\d{1,16}$/.test(amount) || !/[1-9]/.test(amount) || !Number.isInteger(term) || term < 1 || term > 600) {
      setError('Nhập số tiền nguyên lớn hơn 0 và kỳ hạn từ 1 đến 600 tháng.')
      return
    }

    setError('')
    router.push(handoffRoutes.quickSurvey({ amount, term }))
  }

  return (
    <Card className="grid content-start gap-4 p-5 sm:p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Khảo sát nhanh khoản vay</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">Chọn số tiền và kỳ hạn để bắt đầu so sánh phương án vay.</p>
      </div>
      <form action={ROUTES.survey} className="grid gap-4" onSubmit={submit}>
        <input type="hidden" name="mode" value="loan" />
        <div className="grid gap-3 min-[440px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="grid gap-2">
            <Label htmlFor="quick-amount">Số tiền (VNĐ)</Label>
            <MoneyInput id="quick-amount" name="amount" className="font-numeric h-11" required integerOnly
              value={loanAmount} onAmountChange={setLoanAmount} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="quick-term">Kỳ hạn (tháng)</Label>
            <Input id="quick-term" name="term" className="font-numeric h-11" required type="number" min={1} max={600} defaultValue={24} />
          </div>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <Button type="submit" className="min-h-11 justify-self-start">
          Khảo sát khoản vay <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </form>
    </Card>
  )
}

export function OverviewWidgets({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-5">
      <MorningBrief />
      <ProfileStatus />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {children}
        <QuickSurvey />
      </div>
      <RecentActivity />
    </div>
  )
}

function articleImage(value: string | null | undefined) {
  const url = value ? URL.parse(value) : null
  return url?.protocol === 'https:' && !url.username && !url.password ? url.href : null
}

function HomeArticleThumb({ imageUrl, categories }: { imageUrl: string | null | undefined; categories?: string[] }) {
  const [failed, setFailed] = useState(false)
  const src = failed ? null : articleImage(imageUrl)
  if (!src) {
    return <div className="aspect-video w-full overflow-hidden rounded-md"><CategoryArtwork categories={categories ?? []} className="h-full w-full" /></div>
  }
  return <Image src={src} unoptimized alt="" width={400} height={224} referrerPolicy="no-referrer"
    onError={() => setFailed(true)} className="aspect-video w-full rounded-md object-cover" />
}

function MorningBrief() {
  const market = useQuery(marketOverviewQuery)
  const daily = useQuery(dailyBriefQuery)
  const alert = market.data?.alert
  const items = daily.data?.items ?? []
  if (!alert && !market.data?.articles.length && !items.length) return null
  return <div className="grid gap-4">
    {items.length > 0 && <Card className="gap-3 p-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Tóm tắt ngày {daily.data?.dateLabel ? `· ${daily.data.dateLabel}` : ''}</h2>
        <Link className="py-1 text-sm font-medium text-primary hover:underline" href={ROUTES.radar}>Xem đầy đủ trên Radar</Link>
      </div>
      <ul className="space-y-2 text-sm">
        {items.slice(0, 4).map((item) => {
          const citation = item.citations[0]
          const href = ROUTES.radarArticle(item.id) + (item.kind === 'ALERT' ? '?kind=alert' : '')
          return <li key={item.id} className="space-y-0.5 border-b border-border/60 pb-2 last:border-b-0 last:pb-0">
            <Link href={href} className="font-medium text-foreground hover:text-primary hover:underline">{item.summary}</Link>
            {item.interpretation && <p className="text-xs text-muted-foreground">{item.interpretation}</p>}
            {citation && <p className="text-xs text-muted-foreground">
              Nguồn: <a href={citation.url} target="_blank" rel="noreferrer" className="underline hover:text-primary">{citation.sourceName}</a>
            </p>}
          </li>
        })}
      </ul>
    </Card>}
    {alert && <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-verdict-danger/25 bg-verdict-danger-bg/40 p-4 sm:px-6" aria-labelledby="market-alert-title">
      <div className="flex min-w-0 items-start gap-2">
        <ShieldAlert size={21} className="shrink-0 text-verdict-danger" aria-hidden="true" />
        <div className="space-y-1">
          <h2 id="market-alert-title" className="text-sm font-semibold">Cảnh báo mới nhất</h2>
          <Link href={ROUTES.radarArticle(alert.id) + '?kind=alert'} className="break-words text-sm hover:underline">{alert.tacticSummary}</Link>
        </div>
      </div>
      <Link className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}
        href={handoffRoutes.radarAlertToForensic({ alertId: alert.id, summary: alert.tacticSummary.trim().slice(0, 500) || undefined })}>
        <ScanLine size={16} aria-hidden="true" /> Kiểm tra nhanh
      </Link>
    </section>}
    {market.data && market.data.articles.length > 0 && <section aria-labelledby="recent-radar-title" className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 id="recent-radar-title" className="text-base font-semibold">Tin Radar gần đây</h2>
        <Link className="py-2 text-sm font-medium text-primary hover:underline" href={ROUTES.radar}>Xem Radar</Link>
      </div>
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {market.data.articles.map((article) => (
          <li key={article.id} className="min-w-0">
            <Link href={ROUTES.radarArticle(article.id)} className="flex h-full flex-col gap-2 overflow-hidden rounded-lg border bg-card p-3 text-sm hover:border-primary/40">
              <HomeArticleThumb imageUrl={article.imageUrl} categories={article.categories} />
              <span className="line-clamp-3 font-medium">{article.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>}
  </div>
}

function RecentActivity() {
  const audits = useQuery(auditListQuery)
  const survey = useQuery(surveyHistoryQuery)
  const entries = [
    ...(audits.data?.audits ?? []).map((audit) => ({ id: audit.auditId, date: audit.createdAt, href: auditHref(audit.auditId),
      title: audit.claimedEntityName || 'Giám định tài chính', summary: verdictLabels[audit.verdictLevel] })),
    ...(survey.data?.sessions ?? []).map((item) => ({ id: item.id, date: item.createdAt, href: surveySessionHref(item.sessionMode),
      title: surveySessionLabel(item.sessionMode), summary: item.dtiRatioPct ? `DTI ${item.dtiRatioPct}%` : 'Khảo sát' })),
  ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 6)
  return <Card className="gap-2 p-4 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">Hoạt động gần đây</h2>
      <Link href={ROUTES.profile + '?returnTo=%2F'} className="py-1 text-sm font-medium text-primary hover:underline">Xem lịch sử</Link>
    </div>
    {entries.length > 0 ? <ul className="divide-y">
      {entries.map((entry) => <li key={entry.id}>
        <Link className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm hover:text-primary" href={entry.href}>
          <span className="break-words font-medium">{entry.title}</span>
          <span className="text-xs text-muted-foreground">{entry.summary} · <time dateTime={entry.date}>{formatVietnamTime(entry.date)}</time></span>
        </Link>
      </li>)}
    </ul> : <p className="text-sm text-muted-foreground" role="status">
      {audits.isPending || survey.isPending ? 'Đang tải hoạt động…'
        : audits.isError || survey.isError ? 'Chưa tải được lịch sử hoạt động.' : 'Các lần giám định và khảo sát đã lưu sẽ xuất hiện ở đây.'}
    </p>}
  </Card>
}
