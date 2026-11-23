'use client'

import { handoffRoutes, ROUTES } from '@fincopilot/shared-types'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CircleUserRound } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Button, buttonVariants, Card, Input, Label } from '@/components/ui'
import { formatVnd, profileQuery, sessionQuery } from '@/lib/workspace-data'
import { cn } from '@/lib/utils'

function ProfileStatus() {
  const session = useQuery(sessionQuery)
  const profile = useQuery({ ...profileQuery, enabled: session.isSuccess })
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const amount = String(fields.get('amount')).trim()
    const term = Number(fields.get('term'))

    if (!/^\d{1,16}$/.test(amount) || !/[1-9]/.test(amount) || !Number.isSafeInteger(term) || term < 1) {
      setError('Nhập số tiền nguyên lớn hơn 0 và kỳ hạn tính theo tháng.')
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
      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-3 min-[440px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="grid gap-2">
            <Label htmlFor="quick-amount">Số tiền (VNĐ)</Label>
            <Input id="quick-amount" name="amount" className="font-numeric h-11" required inputMode="numeric" pattern="[0-9]{1,16}" maxLength={16} defaultValue="50000000" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="quick-term">Kỳ hạn (tháng)</Label>
            <Input id="quick-term" name="term" className="font-numeric h-11" required type="number" min={1} defaultValue={24} />
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
      <ProfileStatus />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {children}
        <QuickSurvey />
      </div>
    </div>
  )
}
