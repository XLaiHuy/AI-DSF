'use client'

import {
  FinancialHealthRequestSchema, ProfileCoachResponseSchema, ProfileNaturalRequestSchema, ProfileNaturalResponseSchema,
  type FinancialHealth, type FinancialProfileDto, type ProfileCoachResponse,
} from '@fincopilot/shared-types'
import { useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button, Card, Label, TermInfo } from '@/components/ui'
import { apiClient } from '@/lib/api-client'
import { formatVnd, profileQuery, profileResponseSchema, requestError } from '@/lib/workspace-data'
import { FinancialHealthPanel } from './FinancialHealthPanel'
import { MoneyInput } from '@/components/ui/money-input'

const fields = [
  ['monthlyIncomeVnd', 'Thu nhập thực nhận mỗi tháng'],
  ['monthlyExpenseVnd', 'Chi tiêu cố định mỗi tháng'],
  ['existingDebtPaymentVnd', 'Trả nợ hằng tháng'],
  ['liquidSavingsVnd', 'Khoản tiết kiệm / dự phòng hiện có'],
] as const
const riskOptions = {
  CONSERVATIVE: 'Ưu tiên giữ tiền an toàn',
  BALANCED: 'Cân bằng an toàn & sinh lời',
  GROWTH: 'Chấp nhận biến động để tăng trưởng',
}
const goals = { BORROW_SAFE: 'Vay an toàn', OPTIMIZE_DEBT: 'Tối ưu nợ', SAVE_INVEST: 'Tích lũy và đầu tư' }

function initialAmounts(profile: FinancialProfileDto | null) {
  return {
    monthlyIncomeVnd: profile?.monthlyIncomeVnd ?? '',
    monthlyExpenseVnd: profile?.monthlyExpenseVnd ?? '',
    existingDebtPaymentVnd: profile?.existingDebtPaymentVnd ?? '',
    liquidSavingsVnd: profile?.liquidSavingsVnd ?? '',
  }
}

const amountPattern = /^[0-9]{1,16}(?:[.,][0-9]{1,2})?$/
const selectStyle = 'h-11 w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

// Convert decimal currency strings to integer hundredths for exact arithmetic.
function cents(amount: string) {
  if (!amountPattern.test(amount)) return null
  const [whole, fraction = ''] = amount.split(/[.,]/)
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
}

function fixedHundredths(value: bigint) {
  const absolute = value < 0n ? -value : value
  return (value < 0n ? '-' : '') + String(absolute / 100n) + '.' + String(absolute % 100n).padStart(2, '0')
}

export function FinancialProfileForm({
  initial, initialHealth, saved, setSaved,
}: {
  initial: FinancialProfileDto | null
  initialHealth: FinancialHealth | null
  saved: boolean
  setSaved: (saved: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [amounts, setAmounts] = useState(() => initialAmounts(initial))
  const [risk, setRisk] = useState(initial?.riskAppetite ?? 'BALANCED')
  const [goal, setGoal] = useState(initial?.primaryGoal ?? 'BORROW_SAFE')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [naturalText, setNaturalText] = useState('')
  const [naturalStatus, setNaturalStatus] = useState('')
  const [naturalError, setNaturalError] = useState('')
  const [parsing, setParsing] = useState(false)
  const [coaching, setCoaching] = useState(false)
  const [coachError, setCoachError] = useState('')
  const [health, setHealth] = useState(initialHealth)
  const [coach, setCoach] = useState<ProfileCoachResponse | null>(null)
  const [coachRevision, setCoachRevision] = useState(0)
  const busy = saving || parsing || coaching

  const income = cents(amounts.monthlyIncomeVnd)
  const expense = cents(amounts.monthlyExpenseVnd)
  const debt = cents(amounts.existingDebtPaymentVnd)
  const disposable = income !== null && expense !== null && debt !== null ? fixedHundredths(income - expense - debt) : null
  const draftDti = income !== null && income > 0n && debt !== null
    ? fixedHundredths((debt * 10_000n + income / 2n) / income).replace('.', ',') + '%' : '—'
  function parseDraftAmounts() {
    return FinancialHealthRequestSchema.safeParse({
      monthlyIncomeVnd: amounts.monthlyIncomeVnd.replace(',', '.') || null,
      monthlyExpenseVnd: amounts.monthlyExpenseVnd.replace(',', '.') || null,
      existingDebtPaymentVnd: amounts.existingDebtPaymentVnd.replace(',', '.') || null,
      liquidSavingsVnd: amounts.liquidSavingsVnd.replace(',', '.') || null,
    })
  }

  function changeAmounts(next: typeof amounts) {
    setAmounts(next)
    setHealth(null)
    setCoach(null)
    setSaved(false)
  }

  async function autoFill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setNaturalError('')
    setNaturalStatus('')
    const input = ProfileNaturalRequestSchema.safeParse({ text: naturalText })
    if (!input.success) {
      setNaturalError('Nhập mô tả có số tiền, tối đa 1.000 ký tự.')
      return
    }
    setParsing(true)
    try {
      const { values } = await apiClient.post('/profile/parse-natural', input.data, { schema: ProfileNaturalResponseSchema })
      const next = { ...amounts }
      for (const [key] of fields) {
        if (values[key] !== null) next[key] = values[key]
      }
      if (Object.values(values).every((value) => value === null)) {
        setNaturalError('Chưa nhận ra số tiền. Thử ghi rõ từng khoản hoặc điền vào các ô bên dưới.')
        return
      }
      changeAmounts(next)
      setNaturalStatus('Đã điền vào các ô. Kiểm tra lại số tiền trước khi lưu.')
    } catch (cause) {
      setNaturalError(requestError(cause, 'Chưa điền tự động được. Bạn có thể thử lại hoặc nhập thủ công.'))
    } finally {
      setParsing(false)
    }
  }

  async function requestCoach() {
    if (busy) return
    setCoachError('')
    const parsed = parseDraftAmounts()
    if (!parsed.success) {
      setCoachError('Kiểm tra số tiền trong các ô trước khi xem gợi ý.')
      return
    }
    setCoaching(true)
    try {
      const result = await apiClient.post('/profile/coach', { ...parsed.data, riskAppetite: risk, primaryGoal: goal }, { schema: ProfileCoachResponseSchema })
      setHealth(result.health)
      setCoach(result)
      setCoachRevision((revision) => revision + 1)
    } catch (cause) {
      setCoachError(requestError(cause, 'Chưa tải được gợi ý. Vui lòng thử lại.'))
    } finally {
      setCoaching(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setSaved(false)
    setError('')
    const parsed = parseDraftAmounts()
    if (!parsed.success) {
      setError('Nhập số tiền từ 0 trở lên, tối đa 16 chữ số nguyên và 2 chữ số thập phân.')
      return
    }

    setSaving(true)
    try {
      await queryClient.cancelQueries({ queryKey: profileQuery.queryKey })
      const result = await apiClient.put('/profile', { ...parsed.data, riskAppetite: risk, primaryGoal: goal }, { schema: profileResponseSchema })
      setAmounts(initialAmounts(result.profile))
      setHealth(result.health ?? null)
      queryClient.setQueryData(profileQuery.queryKey, result)
      setSaved(true)
    } catch (cause) {
      setError(requestError(cause, 'Chưa lưu được hồ sơ. Vui lòng thử lại.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="space-y-5 p-5 sm:p-6">
      <section aria-labelledby="financial-details-heading" className="space-y-5">
        <div className="space-y-1">
          <h2 id="financial-details-heading" className="text-lg font-semibold tracking-tight">Thu nhập và chi phí</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">Thông tin này giúp ước tính sức trả nợ và cá nhân hóa nội dung Radar.</p>
        </div>
        <form onSubmit={autoFill} aria-labelledby="profile-autofill-heading" className="space-y-2 rounded-lg bg-muted p-4">
          <div className="space-y-1">
            <Label id="profile-autofill-heading" htmlFor="profile-natural">Điền nhanh bằng một câu</Label>
            <p id="profile-natural-help" className="text-xs leading-relaxed text-muted-foreground">
              Ví dụ «Lương 18 triệu, sinh hoạt 8 triệu, trả góp 2 triệu, có 30 triệu tiết kiệm».
            </p>
          </div>
          <textarea id="profile-natural" value={naturalText} onChange={(event) => setNaturalText(event.target.value)}
            aria-describedby="profile-natural-help" required disabled={busy} rows={2} maxLength={1000}
            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
          <Button type="submit" variant="outline" className="min-h-11" disabled={busy}>
            {parsing ? 'Đang đọc…' : 'Tự điền vào hồ sơ'}
          </Button>
          <p role="status" className={naturalStatus ? 'text-sm text-primary' : 'sr-only'}>{naturalStatus}</p>
          <p role="alert" className={naturalError ? 'text-sm text-destructive' : 'sr-only'}>{naturalError}</p>
        </form>
        <form onSubmit={save} aria-labelledby="financial-details-heading" className="space-y-5">
          <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            {fields.map(([key, title]) => (
              <div key={key} className="grid min-w-0 gap-2">
                <Label htmlFor={key}>{title} (VNĐ)</Label>
                <MoneyInput id={key} name={key} className="font-numeric h-11" value={amounts[key]}
                  onAmountChange={(value) => changeAmounts({ ...amounts, [key]: value })} />
              </div>
            ))}
            <div className="grid gap-2">
              <Label htmlFor="risk-appetite">Mức ưu tiên an toàn tài chính</Label>
              <select id="risk-appetite" value={risk} className={selectStyle} onChange={(event) => {
                setRisk(event.target.value as typeof risk)
                setCoach(null)
                setSaved(false)
              }}>
                {Object.entries(riskOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="primary-goal">Mục tiêu chính</Label>
              <select id="primary-goal" value={goal} className={selectStyle} onChange={(event) => {
                setGoal(event.target.value as typeof goal)
                setCoach(null)
                setSaved(false)
              }}>
                {Object.entries(goals).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </fieldset>

          <div className="rounded-lg bg-muted p-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">Thu nhập còn lại mỗi tháng</dt>
                <dd className="font-numeric mt-0.5 text-lg font-semibold break-words">{formatVnd(disposable)}</dd>
              </div>
              {!health && (
                <div>
                  <dt className="text-sm text-muted-foreground">Trả nợ / thu nhập thực nhận (DTI) <TermInfo term="DTI" /></dt>
                  <dd className="font-numeric mt-0.5 text-lg font-semibold break-words">{draftDti}</dd>
                </div>
              )}
            </dl>
            {disposable === null && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Nhập đủ thu nhập, chi phí và khoản trả nợ. Nhập 0 khi không có chi phí hoặc khoản nợ.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" className="min-h-11" disabled={busy}>
              <Save size={16} aria-hidden="true" /> {saving ? 'Đang lưu…' : 'Lưu hồ sơ tài chính'}
            </Button>
            <p role="status" className="text-sm text-primary">{saved ? 'Đã lưu hồ sơ tài chính.' : ''}</p>
          </div>
          <p role="alert" className={error ? 'text-sm text-destructive' : 'sr-only'}>{error}</p>
        </form>
      </section>
      <FinancialHealthPanel health={health} coach={coach} coachRevision={coachRevision} goalLabel={goals[goal]} riskLabel={riskOptions[risk]}
        busy={busy} coaching={coaching} onCoach={() => void requestCoach()} />
      <p role="alert" className={coachError ? 'text-sm text-destructive' : 'sr-only'}>{coachError}</p>
    </Card>
  )
}
