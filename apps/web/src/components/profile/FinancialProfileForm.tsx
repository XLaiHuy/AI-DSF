'use client'

import { FinancialProfileUpdateSchema, type FinancialProfileDto } from '@fincopilot/shared-types'
import { useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button, Card, Input, Label } from '@/components/ui'
import { apiClient } from '@/lib/api-client'
import { formatVnd, profileQuery, profileResponseSchema, requestError } from '@/lib/workspace-data'

const fields = [
  ['monthlyIncomeVnd', 'Thu nhập ròng hằng tháng'],
  ['monthlyExpenseVnd', 'Chi phí sinh hoạt hằng tháng'],
  ['existingDebtPaymentVnd', 'Trả nợ hằng tháng'],
  ['liquidSavingsVnd', 'Tiền nhàn rỗi'],
] as const
const riskOptions = { CONSERVATIVE: 'Thận trọng', BALANCED: 'Cân bằng', GROWTH: 'Tăng trưởng' }
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
  initial, saved, setSaved,
}: {
  initial: FinancialProfileDto | null
  saved: boolean
  setSaved: (saved: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [amounts, setAmounts] = useState(() => initialAmounts(initial))
  const [risk, setRisk] = useState(initial?.riskAppetite ?? 'BALANCED')
  const [goal, setGoal] = useState(initial?.primaryGoal ?? 'BORROW_SAFE')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const income = cents(amounts.monthlyIncomeVnd)
  const expense = cents(amounts.monthlyExpenseVnd)
  const debt = cents(amounts.existingDebtPaymentVnd)
  const disposable = income !== null && expense !== null && debt !== null ? fixedHundredths(income - expense - debt) : null
  const dti = income !== null && income > 0n && debt !== null
    ? fixedHundredths((debt * 10_000n + income / 2n) / income).replace('.', ',') + '%'
    : '—'

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaved(false)
    setError('')
    const parsed = FinancialProfileUpdateSchema.safeParse({
      monthlyIncomeVnd: amounts.monthlyIncomeVnd.replace(',', '.') || null,
      monthlyExpenseVnd: amounts.monthlyExpenseVnd.replace(',', '.') || null,
      existingDebtPaymentVnd: amounts.existingDebtPaymentVnd.replace(',', '.') || null,
      liquidSavingsVnd: amounts.liquidSavingsVnd.replace(',', '.') || null,
      riskAppetite: risk,
      primaryGoal: goal,
    })
    if (!parsed.success || Object.values(amounts).some((amount) => amount && !amountPattern.test(amount))) {
      setError('Nhập số tiền từ 0 trở lên, tối đa 16 chữ số nguyên và 2 chữ số thập phân.')
      return
    }

    setSaving(true)
    try {
      await queryClient.cancelQueries({ queryKey: profileQuery.queryKey })
      const result = await apiClient.put('/profile', parsed.data, { schema: profileResponseSchema })
      setAmounts(initialAmounts(result.profile))
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
        <form onSubmit={save} className="space-y-5">
          <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
            {fields.map(([key, title]) => (
              <div key={key} className="grid min-w-0 gap-2">
                <Label htmlFor={key}>{title} (VNĐ)</Label>
                <Input id={key} name={key} inputMode="decimal" className="font-numeric h-11" value={amounts[key]} maxLength={19}
                  onChange={(event) => setAmounts({ ...amounts, [key]: event.target.value })} />
              </div>
            ))}
            <div className="grid gap-2">
              <Label htmlFor="risk-appetite">Khẩu vị rủi ro</Label>
              <select id="risk-appetite" value={risk} className={selectStyle} onChange={(event) => setRisk(event.target.value as typeof risk)}>
                {Object.entries(riskOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="primary-goal">Mục tiêu chính</Label>
              <select id="primary-goal" value={goal} className={selectStyle} onChange={(event) => setGoal(event.target.value as typeof goal)}>
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
              <div>
                <dt className="text-sm text-muted-foreground">Tỷ lệ trả nợ / thu nhập (DTI)</dt>
                <dd className="font-numeric mt-0.5 text-lg font-semibold break-words">{dti}</dd>
              </div>
            </dl>
            {(disposable === null || dti === '—') && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Nhập đủ thu nhập, chi phí và khoản trả nợ. Nhập 0 khi không có chi phí hoặc khoản nợ.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" className="min-h-11" disabled={saving}>
              <Save size={16} aria-hidden="true" /> {saving ? 'Đang lưu…' : 'Lưu hồ sơ tài chính'}
            </Button>
            <p role="status" className="text-sm text-primary">{saved ? 'Đã lưu hồ sơ tài chính.' : ''}</p>
          </div>
          <p role="alert" className={error ? 'text-sm text-destructive' : 'sr-only'}>{error}</p>
        </form>
      </section>
    </Card>
  )
}
