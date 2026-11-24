import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { PrismaService } from '../../common/prisma.service'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { ForensicService } from './forensic.service'
import { calculateFlatRateApr } from './hard-rules.engine'
import { evaluatePersonalImpact } from './personal-impact.engine'

const profile = {
  monthlyIncomeVnd: '10000000', monthlyExpenseVnd: '4000000',
  existingDebtPaymentVnd: '0', liquidSavingsVnd: '50000000',
}
const loan = calculateFlatRateApr({
  principalNominalVnd: '50000000', upfrontFeeVnd: '5000000', flatMonthlyRatePct: '0.9',
  termMonths: 12, evidenceQuote: 'Lãi phẳng 0,9%/tháng',
})

describe('personal impact', () => {
  it('uses exact loan math with the financial profile', () => {
    expect(evaluatePersonalImpact(profile, loan, [])).toMatchObject({
      kind: 'LOAN_MONTHLY', status: 'OVER_CAPACITY', monthlyIncomeVnd: '10000000.00',
      currentDtiPct: '0.00', projectedDtiPct: '46.17', maxSafeEmiVnd: '3000000.00',
      proposedMonthlyPaymentVnd: '4616667.00', emiExcessVnd: '1616667.00',
      monthlySurplusAfterVnd: '1383333.00',
    })
  })

  it.each([
    ['2500000', 'WITHIN_BUDGET', '5.00', '25.00'],
    ['5000000', 'STRETCHED', '10.00', '50.00'],
    ['10000000', 'OVER_CAPACITY', '20.00', '100.00'],
  ])('compares a VND QR payment of %s with both balances', (qrAmountVnd, status, savings, income) => {
    const impact = evaluatePersonalImpact(profile, null, [{ qrAmountVnd }])
    expect(impact).toMatchObject({
      kind: 'ONE_TIME_PAYMENT', status, shareOfSavingsPct: savings,
      shareOfMonthlyIncomePct: income, proposedMonthlyPaymentVnd: null,
    })
  })

  it('handles savings only and missing data', () => {
    const savingsOnly = { ...profile, monthlyIncomeVnd: null }
    expect(evaluatePersonalImpact(savingsOnly, null, [{ qrAmountVnd: '15000000' }]))
      .toMatchObject({ status: 'STRETCHED', shareOfSavingsPct: '30.00', shareOfMonthlyIncomePct: null })
    expect(evaluatePersonalImpact(savingsOnly, null, [{ qrAmountVnd: '50000000.01' }]))
      .toMatchObject({ status: 'OVER_CAPACITY' })
    expect(evaluatePersonalImpact(savingsOnly, loan, [])).toBeNull()
    expect(evaluatePersonalImpact(null, loan, [])).toBeNull()
    expect(evaluatePersonalImpact(profile, null, [{ qrAmountVnd: null }])).toBeNull()
  })

  it('looks up only the owner, persists impact and preserves the fraud verdict and score', async () => {
    const prisma = new PrismaService()
    vi.spyOn(prisma.financialInstitution, 'findMany').mockResolvedValue([])
    vi.spyOn(prisma.threatIndicator, 'findMany').mockResolvedValue([])
    const owner = { kind: 'guest', guestSessionId: '6efaf59b-554d-4bd8-80e9-c864ad513ceb' } as const
    const findProfile = vi.spyOn(prisma.financialProfile, 'findFirst').mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: owner.guestSessionId, guestSessionId: owner.guestSessionId, userId: null,
      monthlyIncomeVnd: new Prisma.Decimal(profile.monthlyIncomeVnd),
      monthlyExpenseVnd: new Prisma.Decimal(profile.monthlyExpenseVnd),
      existingDebtPaymentVnd: new Prisma.Decimal(profile.existingDebtPaymentVnd),
      liquidSavingsVnd: new Prisma.Decimal(profile.liquidSavingsVnd),
      riskAppetite: 'BALANCED', primaryGoal: 'BORROW_SAFE', createdAt: new Date(), updatedAt: new Date(),
    })
    const create = vi.spyOn(prisma.forensicAudit, 'create').mockResolvedValue({} as Awaited<ReturnType<typeof prisma.forensicAudit.create>>)
    const config = new ConfigService()
    const ai = new AiGatewayService(config)
    vi.spyOn(ai, 'classifyForensicIntent').mockResolvedValue(null)
    vi.spyOn(ai, 'generateWithProvider').mockRejectedValue(new Error('offline'))
    const service = new ForensicService(prisma, ai, config)
    const fields = { rawText: 'Khoản vay 50 000 000 đồng. Kỳ hạn 12 tháng. Lãi phẳng 0,9%/tháng. Phí thu trước 5 000 000 đồng.' }
    const baseline = await service.audit(owner, fields, [])
    const audit = await service.audit(owner, fields, [])
    expect(findProfile).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: null, guestSessionId: owner.guestSessionId } }))
    expect(baseline.personalImpact).toBeNull()
    expect(audit).toMatchObject({
      verdictLevel: baseline.verdictLevel, riskScore: baseline.riskScore,
      personalImpact: { status: 'OVER_CAPACITY', projectedDtiPct: '46.17' },
    })
    expect(create.mock.lastCall?.[0].data.extractedClaimsJson).toMatchObject({ personalImpact: audit.personalImpact })
  })
})
