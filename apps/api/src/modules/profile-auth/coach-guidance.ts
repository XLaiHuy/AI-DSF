import Decimal from 'decimal.js'
import type { FinancialHealth, ProfileCoachRequest } from '@fincopilot/shared-types'

const Precise = Decimal.clone({ precision: 48 })

export function coachContext({ primaryGoal, riskAppetite, ...input }: ProfileCoachRequest, rawHealth: FinancialHealth) {
  const clean = (value: string | null) => value === null ? null : new Precise(value).toFixed()
  const amounts = { monthlyIncomeVnd: clean(input.monthlyIncomeVnd), monthlyExpenseVnd: clean(input.monthlyExpenseVnd),
    existingDebtPaymentVnd: clean(input.existingDebtPaymentVnd), liquidSavingsVnd: clean(input.liquidSavingsVnd) }
  const health = { ...rawHealth, maxSafeEmiVnd: clean(rawHealth.maxSafeEmiVnd), budget: rawHealth.budget && {
    needsVnd: new Precise(rawHealth.budget.needsVnd).toFixed(), wantsVnd: new Precise(rawHealth.budget.wantsVnd).toFixed(),
    savingsAndDebtVnd: new Precise(rawHealth.budget.savingsAndDebtVnd).toFixed(),
  } }
  const { monthlyIncomeVnd: income, monthlyExpenseVnd: expense, existingDebtPaymentVnd: debt, liquidSavingsVnd: savings } = amounts
  const expenses = expense !== null && debt !== null ? new Precise(expense).plus(debt) : null
  const reserveTarget = expenses?.gt(0) ? expenses.mul(6) : null
  const surplus = income !== null && expenses ? new Precise(income).minus(expenses) : null
  const reserveDifference = reserveTarget && savings !== null ? new Precise(savings).minus(reserveTarget) : null
  return {
    availableForNewEmiVnd: health.maxSafeEmiVnd, savingsRatePct: health.savingsRatePct,
    dtiBand: health.dtiPct === null ? null : new Precise(health.dtiPct).lte(30) ? 'WITHIN_TARGET' : 'ABOVE_TARGET',
    emergencyStatus: savings === null || !expenses?.gt(0) ? null : new Precise(savings).lt(expenses.mul(3))
      ? 'BELOW_3M' : new Precise(savings).lte(expenses.mul(6)) ? 'BUILDING_3_6M' : 'SURPLUS_OVER_6M',
    amounts, primaryGoal, riskAppetite, health, dtiBasis: 'thu nhập thực nhận',
    monthlySurplusVnd: surplus?.toFixed() ?? null,
    reserveTargetVnd: reserveTarget?.toFixed() ?? null,
    reserveAboveTargetVnd: reserveDifference?.gte(0) ? reserveDifference.toFixed() : null,
    reserveGapVnd: reserveDifference?.lt(0) ? reserveDifference.abs().toFixed() : null,
  }
}

type Context = ReturnType<typeof coachContext>
const bands = /(?<![\p{L}\p{N}])([+−-]?\d+(?:[.,]\d+|[\u00a0\u202f ]\d{3}(?!\d))*)(?:[\t\u00a0\u202f ]*(tỷ|tỉ|triệu|nghìn|ngàn|đồng|vnđ|vnd|đ|₫|tháng|điểm|%)(?![\p{L}]))?/giu
const multipliers: Record<string, string> = { tỷ: '1000000000', tỉ: '1000000000', triệu: '1000000', nghìn: '1000', ngàn: '1000' }

function matchesNumber(token: string, set: ReadonlySet<string>, factor = '1') {
  const compact = token.replace(/[\u00a0\u202f ]/gu, '').replace('−', '-')
  const candidates = [compact.replace(',', '.')]
  if (/^[+-]?\d{1,3}(?:[.,]\d{3})+(?:,\d+)?$/.test(compact)) {
    candidates.push(compact.replace(/\.(?=\d{3})/g, '').replaceAll(',', compact.includes('.') ? '.' : ''))
  }
  return candidates.some((value) => /^[-+]?\d+(?:\.\d+)?$/.test(value) && set.has(new Precise(value).mul(factor).toFixed()))
}

export function hasGroundedNumbers(texts: readonly string[], context: Context) {
  const { health } = context
  const values = (items: (string | number | null)[]) => new Set(items.flatMap((value) => value === null ? [] : [new Precise(value).toFixed()]))
  const money = values([...Object.values(context.amounts), ...Object.values(health.budget ?? {}), health.maxSafeEmiVnd,
    context.monthlySurplusVnd, context.reserveTargetVnd, context.reserveGapVnd, context.reserveAboveTargetVnd])
  const months = values([3, 6, health.emergencyMonths])
  const rates = values([health.dtiPct, health.savingsRatePct])
  const scores = values([health.score])
  return texts.every((text) => {
    const input = text.normalize('NFKC').toLowerCase()
      .replace(/\b50\s*[/:–-]\s*30\s*[/:–-]\s*20\b/g, '')
      .replace(/\b3\s*[–-]\s*6(?=\s+tháng)/g, '6')
      .replace(/\b(\d+)\s*\/\s*100\b/g, '$1 điểm')
      .replace(/\b(?:dti|tỷ lệ trả nợ)(?:\s+(?:tham khảo|không quá|tối đa|dưới))*\s*[:(]?\s*30\s*%|\b30\s*%\s*(?:dti|thu nhập thực nhận)\b/gu, '')
    const remaining = input.replace(bands, (_match, token: string, unit?: string) => {
      const allowed = unit === 'tháng' ? matchesNumber(token, months)
        : unit === '%' ? matchesNumber(token, rates)
          : unit === 'điểm' ? matchesNumber(token, scores)
            : matchesNumber(token, money, multipliers[unit ?? ''] ?? '1')
      return allowed ? '' : '0'
    })
    return !/\p{N}/u.test(remaining)
  })
}

const moneyText = (value: string) => {
  const [whole, fraction] = value.split('.')
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${fraction ? ',' + fraction : ''} đ`
}

export function formatCoachAdviceNumbers(text: string) {
  return text.replace(/(?<![\p{L}\d.,])(\d{1,3}(?:[., \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?|\d{4,}(?:[.,]\d{1,2})?)\s*(?:đồng|vnđ|vnd|đ|₫)(?!\p{L})/giu,
    (_, value: string) => {
      const compact = value.replace(/[ \u00a0\u202f]/gu, '').replace(/[.,](?=\d{3}(?:\D|$))/g, '').replace(',', '.')
      return moneyText(new Precise(compact).toFixed())
    })
    .replace(/(?<![\d.,])(\d+)\.(\d{1,2})(?=\s*tháng(?!\p{L}))/gu, '$1,$2')
}

export function fallbackAdvice(context: Context) {
  const { health, monthlySurplusVnd: surplus, reserveTargetVnd: target, reserveAboveTargetVnd: extra, reserveGapVnd: gap,
    primaryGoal: goal, riskAppetite: risk } = context
  if (health.score === null) return {
    summary: 'Chưa đủ số liệu để tính phần dư và quỹ dự phòng của bạn.',
    actions: ['Đối chiếu thu nhập thực nhận với sao kê gần nhất.', 'Tách chi phí cố định và tiền trả nợ hằng tháng.', 'Nhập số đang để dành và có thể rút khi cần.'],
  }
  if (surplus === null || new Precise(surplus).lte(0)) return {
    summary: surplus === null ? 'Cần đủ số liệu để tính phần tiền còn lại.' : `Dòng tiền tháng hiện còn ${moneyText(surplus)} sau các khoản bắt buộc.`,
    actions: ['Xếp các hóa đơn thiết yếu và kỳ trả nợ theo ngày đến hạn.', 'Hoãn chi tiêu linh hoạt cho đến khi ngân sách có phần dư.', 'Nếu có nguy cơ trễ hạn, hỏi bên cho vay về phương án xử lý trước ngày đến hạn.'],
  }
  const surplusText = `Bạn còn ${moneyText(surplus)}/tháng sau các khoản bắt buộc.`
  const headroom = context.availableForNewEmiVnd === null ? '' : ' Mức trả góp thêm an toàn tối đa là ' + moneyText(context.availableForNewEmiVnd) + '/tháng.'
  const allocation = goal === 'OPTIMIZE_DEBT'
    ? 'So sánh lãi và phí trả trước hạn của từng khoản nợ rồi ưu tiên khoản tốn kém nhất nếu có.'
    : goal === 'BORROW_SAFE'
      ? 'Tính thử khoản vay rồi đối chiếu số tiền trả thêm mỗi tháng với khoản còn dư trước khi quyết định.'
      : risk === 'CONSERVATIVE'
        ? 'Ưu tiên mục tiêu ngắn hạn và giữ phần chưa cần đầu tư ở nơi dễ rút, ít biến động.'
        : risk === 'GROWTH'
          ? 'Chỉ dành phần chưa cần dùng lâu dài cho phương án tăng trưởng mà bạn hiểu và chịu được biến động.'
          : 'Cân bằng phần dành cho mục tiêu ngắn hạn với phần có thể để lâu hơn và chịu được biến động.'

  const purpose = allocation + (goal === 'SAVE_INVEST' || !risk ? '' :
    risk === 'CONSERVATIVE' ? ' Giữ phần dư dễ rút trước khi cam kết trả thêm.' :
      risk === 'GROWTH' ? ' Tách phần chấp nhận biến động khỏi tiền dành cho kỳ trả nợ.' :
        ' Chia phần dư giữa dự phòng thanh khoản và mục tiêu dài hạn.')
  if (extra !== null && target !== null && health.emergencyMonths !== null) return {
    summary: `Quỹ dự phòng hiện đủ ${health.emergencyMonths.replace('.', ',')} tháng, đạt mốc tham khảo 6 tháng. ${surplusText}`,
    actions: [
      `Giữ riêng ${moneyText(target)} ở nơi dễ rút để bảo vệ chi phí thiết yếu và các khoản phải trả.`,
      `Lập kế hoạch cho ${moneyText(surplus)}/tháng còn dư${new Precise(extra).gt(0) ? ` và ${moneyText(extra)} tiết kiệm nằm ngoài phần dự phòng` : ''}.` + headroom, purpose,
    ],
  }

  return {
    summary: (gap && health.emergencyMonths !== null ? `Quỹ dự phòng hiện đủ ${health.emergencyMonths.replace('.', ',')} tháng. ` : '') + surplusText,
    actions: [gap ? `Còn thiếu ${moneyText(gap)} để đạt mốc tham khảo 6 tháng. Dành một phần tiền dư để bù dần.`
      : 'Kiểm tra lại các khoản chi thiết yếu để xác định mức dự phòng phù hợp.',
    surplusText + headroom, purpose],
  }
}
