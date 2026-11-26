'use client'

import { CalcMethod, type ManualCompareRequest } from '@fincopilot/shared-types'
import { Button, Input, Label } from '@/components/ui'
import { MoneyInput, stripSpacedAmount } from '@/components/ui/money-input'

type ManualOffer = ManualCompareRequest['offers'][number]
export const methodLabels = {
  REDUCING_BALANCE: 'Dư nợ giảm dần',
  DECLINING_PRINCIPAL: 'Gốc đều',
  FLAT_RATE: 'Lãi phẳng',
} satisfies Record<NonNullable<ManualOffer['calcMethod']>, string>
export const fieldStyle = 'min-h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm'
export const decimal = (value: string) => value.trim().replace(',', '.')

export function Field({ id, label, value, onChange, term, optional, freeText }: {
  id: string; label: string; value: string; onChange: (value: string) => void; term?: boolean; optional?: boolean; freeText?: boolean
}) {
  return <div className="min-w-0 space-y-1.5"><Label htmlFor={id}>{label}</Label>
    <Input id={id} value={value} onChange={(event) => onChange(event.target.value)}
      type={term ? 'number' : 'text'} inputMode={term ? 'numeric' : freeText ? 'text' : 'decimal'}
      min={term ? 1 : undefined} max={term ? 600 : undefined} step={term ? 1 : undefined} required={term && !optional} />
  </div>
}

export function MoneyField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return <div className="min-w-0 space-y-1.5"><Label htmlFor={id}>{label}</Label>
    <MoneyInput id={id} value={value} onAmountChange={onChange} integerOnly />
  </div>
}

export function manualDraft(index: number, offer?: ManualOffer) {
  return {
    id: index,
    label: offer?.label ?? 'Gói ' + String.fromCharCode(65 + index),
    principalVnd: offer?.principalVnd ?? '50000000',
    annualRatePct: offer?.annualRatePct ?? (index === 0 ? '14.5' : '16'),
    termMonths: String(offer?.termMonths ?? 24),
    upfrontFeeVnd: offer?.upfrontFeeVnd ?? '',
    calcMethod: offer?.calcMethod ?? 'REDUCING_BALANCE',
    monthlyFeeVnd: offer?.monthlyFeeVnd ?? '',
    promoMonths: offer?.promoMonths == null ? '' : String(offer.promoMonths),
    floatingRatePct: offer?.floatingRatePct ?? '',
    earlySettlementMonth: offer?.earlySettlementMonth == null ? '' : String(offer.earlySettlementMonth),
    earlySettlementFeePct: offer?.earlySettlementFeePct ?? '',
  }
}

export type ManualDraft = ReturnType<typeof manualDraft>

export function manualInput(item: ManualDraft): ManualOffer {
  return {
    label: item.label, principalVnd: stripSpacedAmount(item.principalVnd), annualRatePct: decimal(item.annualRatePct),
    termMonths: Number(item.termMonths), calcMethod: item.calcMethod,
    upfrontFeeVnd: stripSpacedAmount(item.upfrontFeeVnd) || undefined,
    monthlyFeeVnd: stripSpacedAmount(item.monthlyFeeVnd) || undefined,
    promoMonths: item.promoMonths ? Number(item.promoMonths) : undefined,
    floatingRatePct: decimal(item.floatingRatePct) || undefined,
    earlySettlementMonth: item.earlySettlementMonth ? Number(item.earlySettlementMonth) : undefined,
    earlySettlementFeePct: decimal(item.earlySettlementFeePct) || undefined,
  }
}

export function ManualOfferFields({ item, onChange, onRemove }: {
  item: ManualDraft; onChange: (item: ManualDraft) => void; onRemove?: () => void
}) {
  const id = (field: string) => 'manual-' + item.id + '-' + field
  const label = (field: string) => item.label + ' · ' + field
  const edit = (key: keyof Omit<ManualDraft, 'id' | 'calcMethod'>) => (value: string) => onChange({ ...item, [key]: value })
  const hasAdvanced = Boolean(item.promoMonths || item.floatingRatePct || item.earlySettlementMonth || item.earlySettlementFeePct)
  return <fieldset className="min-w-0 space-y-3 rounded-xl border p-3">
    <legend className="max-w-full break-words px-1 font-semibold">{item.label}</legend>
    <MoneyField id={id('principal')} label={label('Số tiền (VNĐ)')} value={item.principalVnd} onChange={edit('principalVnd')} />
    <Field id={id('rate')} label={label('Lãi suất năm (%)')} value={item.annualRatePct} onChange={edit('annualRatePct')} />
    <Field id={id('term')} label={label('Kỳ hạn (tháng)')} value={item.termMonths} onChange={edit('termMonths')} term />
    <div className="space-y-1.5">
      <Label htmlFor={id('method')}>{label('Phương thức tính lãi')}</Label>
      <select id={id('method')} className={fieldStyle} value={item.calcMethod}
        onChange={({ currentTarget }) => {
          const method = CalcMethod.safeParse(currentTarget.value)
          if (method.success && method.data !== 'COMPOUND_DCA') onChange({ ...item, calcMethod: method.data })
        }}>
        {Object.entries(methodLabels).map(([method, title]) => <option key={method} value={method}>{title}</option>)}
      </select>
    </div>
    <MoneyField id={id('upfront-fee')} label={label('Phí trả trước (VNĐ)')} value={item.upfrontFeeVnd} onChange={edit('upfrontFeeVnd')} />
    <MoneyField id={id('monthly-fee')} label={label('Phí quản lý mỗi tháng (VNĐ)')} value={item.monthlyFeeVnd} onChange={edit('monthlyFeeVnd')} />
    <details open={hasAdvanced || undefined} className="space-y-3 border-t pt-3">
      <summary className="cursor-pointer text-sm font-semibold">{item.label} · Ưu đãi và tất toán</summary>
      <Field id={id('promo')} label={label('Số tháng ưu đãi')} value={item.promoMonths} onChange={edit('promoMonths')} term optional />
      <Field id={id('floating')} label={label('Lãi suất sau ưu đãi (%/năm)')} value={item.floatingRatePct} onChange={edit('floatingRatePct')} />
      <Field id={id('exit-month')} label={label('Tháng tất toán trước hạn')} value={item.earlySettlementMonth} onChange={edit('earlySettlementMonth')} term optional />
      <Field id={id('exit-fee')} label={label('Phí tất toán (% dư nợ)')} value={item.earlySettlementFeePct} onChange={edit('earlySettlementFeePct')} />
    </details>
    {onRemove && <Button type="button" variant="outline" size="sm" onClick={onRemove}>Xóa {item.label}</Button>}
  </fieldset>
}
