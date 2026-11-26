import Decimal from 'decimal.js'
import { FinancialHealthRequestSchema, type FinancialHealthRequest } from '@fincopilot/shared-types'
import { stripSpoofedBoundaryTags } from '../../common/untrusted-text'

const Precise = Decimal.clone({ precision: 32 })
const labels = {
  monthlyIncomeVnd: 'thu nhap(?: thuc nhan)?|luong(?: thuc nhan)?',
  monthlyExpenseVnd: 'chi tieu(?: co dinh)?|chi phi(?: sinh hoat)?|sinh hoat|tien nha',
  existingDebtPaymentVnd: 'tra gop|tra no|tien no hang thang|tien no moi thang',
  liquidSavingsVnd: 'tiet kiem|du phong|tien de danh|de danh',
} as const
const keys = Object.keys(labels) as (keyof typeof labels)[]
const labelPattern = new RegExp('\\b(?:' + Object.values(labels).join('|') + ')\\b', 'g')
const valuePattern = /(?<![\w+.,-])(\d{1,16}(?:[.,]\d{1,16})*)\s*(ty|ti|trieu|tr|nghin|ngan|k|vnd|dong|d)?\b/g
const multiplier: Record<string, string> = {
  ty: '1000000000', ti: '1000000000', trieu: '1000000', tr: '1000000',
  nghin: '1000', ngan: '1000', k: '1000',
}

function normalize(text: string) {
  return stripSpoofedBoundaryTags(text).normalize('NFKC').normalize('NFD')
    .replace(/\p{M}/gu, '').toLowerCase().replaceAll('đ', 'd')
}

function parseAmounts(text: string) {
  const values: string[] = []
  for (const match of text.matchAll(valuePattern)) {
    const [, number, unit] = match
    const suffix = text.slice(match.index + match[0].length)
    if (/^\s*(?:%|thang\b|nam\b)/.test(suffix) && !unit) continue
    const factor = multiplier[unit] ?? '1'
    const canonical = factor === '1' && /^\d{1,3}(?:[.,]\d{3})+$/.test(number)
      ? number.replace(/[.,]/g, '') : number.replace(',', '.')
    if (!/^\d+(?:\.\d+)?$/.test(canonical)) continue
    const amount = new Precise(canonical).mul(factor).toFixed()
    if (FinancialHealthRequestSchema.shape.monthlyIncomeVnd.safeParse(amount).success) values.push(amount)
  }
  return values
}

export function parseNaturalProfile(text: string): FinancialHealthRequest {
  const input = normalize(text)
  const matches = [...input.matchAll(labelPattern)]
  const values = new Map<keyof FinancialHealthRequest, Set<string>>()
  for (const [index, match] of matches.entries()) {
    const key = keys.find((key) => new RegExp('^(?:' + labels[key] + ')$').test(match[0]))
    if (!key) continue
    const segment = input.slice(match.index + match[0].length, matches[index + 1]?.index)
      .split(/\n|;|,(?!\d)/, 1)[0]
    const [value, ...others] = parseAmounts(segment)
    if (!value || others.length) continue
    const candidates = values.get(key) ?? new Set<string>()
    candidates.add(value)
    values.set(key, candidates)
  }
  const unique = (key: keyof FinancialHealthRequest) => {
    const candidates = values.get(key)
    return candidates?.size === 1 ? [...candidates][0] : null
  }
  // Amount-before-label is common for savings, e.g. “có 30 triệu tiết kiệm”.
  const savings = /\b(?:co|con|da co)\s+((?:[^;\n,]|,(?=\d))+?)\s+(?:tiet kiem|du phong|de danh)\b/g
  if (!values.has('liquidSavingsVnd')) {
    const candidates = new Set([...input.matchAll(savings)].flatMap((match) => parseAmounts(match[1])))
    if (candidates.size) values.set('liquidSavingsVnd', candidates)
  }
  return {
    monthlyIncomeVnd: unique('monthlyIncomeVnd'), monthlyExpenseVnd: unique('monthlyExpenseVnd'),
    existingDebtPaymentVnd: unique('existingDebtPaymentVnd'), liquidSavingsVnd: unique('liquidSavingsVnd'),
  }
}

export function statedProfileAmounts(text: string) {
  return new Set(parseAmounts(normalize(text)))
}
