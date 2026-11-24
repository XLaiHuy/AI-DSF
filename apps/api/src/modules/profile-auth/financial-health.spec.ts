import { ConfigService } from '@nestjs/config'
import { describe, expect, it, vi } from 'vitest'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { coachContext, hasGroundedNumbers } from './coach-guidance'
import { calculateFinancialHealth } from './financial-health.engine'
import { ProfileCopilotController } from './profile-copilot.controller'

const profile = {
  monthlyIncomeVnd: '18000000', monthlyExpenseVnd: '8000000',
  existingDebtPaymentVnd: '2000000', liquidSavingsVnd: '30000000',
}

describe('financial health', () => {
  it('computes the score, net DTI, reserve runway, additional EMI, and budget exactly', () => {
    expect(calculateFinancialHealth(profile)).toEqual({
      score: 91, emergencyMonths: '3.0', savingsRatePct: '44.44',
      maxSafeEmiVnd: '3400000.00', dtiPct: '11.11',
      budget: { needsVnd: '9000000.00', wantsVnd: '5400000.00', savingsAndDebtVnd: '3600000.00' },
    })
  })

  it('exposes negative cash flow and clamps the additional repayment to zero', () => {
    expect(calculateFinancialHealth({ ...profile, monthlyExpenseVnd: '20000000' })).toMatchObject({
      savingsRatePct: '-22.22', maxSafeEmiVnd: '0.00',
    })
    expect(calculateFinancialHealth({ ...profile, monthlyIncomeVnd: '0' })).toMatchObject({
      score: 0, dtiPct: null, savingsRatePct: null, maxSafeEmiVnd: '0.00',
    })
    expect(calculateFinancialHealth({ ...profile, monthlyExpenseVnd: null })).toMatchObject({
      score: null, emergencyMonths: null, maxSafeEmiVnd: null, dtiPct: '11.11',
    })
  })

  it('keeps cents above the JavaScript safe integer range and never rounds the EMI up', () => {
    expect(calculateFinancialHealth({ ...profile, monthlyIncomeVnd: '9999999999999999.99', existingDebtPaymentVnd: '0' }))
      .toMatchObject({ maxSafeEmiVnd: '2999999999999999.99', budget: {
        needsVnd: '4999999999999999.99', wantsVnd: '2999999999999999.99', savingsAndDebtVnd: '2000000000000000.01',
      } })
  })
})

describe('profile Copilot endpoints', () => {
  it('parses a Vietnamese sentence when the AI provider is offline', async () => {
    const ai = new AiGatewayService(new ConfigService())
    vi.spyOn(ai, 'generateStructured').mockRejectedValue(new Error('offline'))
    const controller = new ProfileCopilotController(ai)
    await expect(controller.parseNatural({ text: 'Lương 18 triệu, sinh hoạt 8 triệu, trả góp 2 triệu, có 30 triệu tiết kiệm' }))
      .resolves.toEqual({ values: profile, source: 'DETERMINISTIC' })
    await expect(controller.parseNatural({ text: 'Thu nhập 18,5 triệu, chi tiêu 8.000.500 đồng' })).resolves.toMatchObject({
      values: { monthlyIncomeVnd: '18500000', monthlyExpenseVnd: '8000500', existingDebtPaymentVnd: null },
    })
  })

  it('uses supported AI extraction and drops invented values', async () => {
    const ai = new AiGatewayService(new ConfigService())
    vi.spyOn(ai, 'generateStructured').mockResolvedValue({
      monthlyIncomeVnd: '18000000', monthlyExpenseVnd: '9000000', existingDebtPaymentVnd: null, liquidSavingsVnd: null,
    })
    await expect(new ProfileCopilotController(ai).parseNatural({ text: 'Mỗi tháng nhận 18 triệu vào ví.' })).resolves.toEqual({
      source: 'AI', values: { monthlyIncomeVnd: '18000000', monthlyExpenseVnd: null, existingDebtPaymentVnd: null, liquidSavingsVnd: null },
    })
  })

  it('gives AI the server metrics and returns exactly three steps with the original numbers', async () => {
    const ai = new AiGatewayService(new ConfigService())
    const advice = { summary: 'Bạn còn 8 triệu đồng sau các khoản cố định.', actions: ['Gom hóa đơn.', 'Soát sổ thu chi.', 'Lên lịch tiết kiệm.'] }
    const generate = vi.spyOn(ai, 'generateStructured').mockResolvedValueOnce(advice)
      .mockResolvedValueOnce({ ...advice, summary: 'Điểm của bạn là 100.' })
      .mockRejectedValueOnce(new Error('offline'))
    const controller = new ProfileCopilotController(ai)
    const health = calculateFinancialHealth(profile)
    await expect(controller.coach(profile)).resolves.toEqual({ ...advice, health, source: 'AI' })
    expect(generate).toHaveBeenCalledWith('PROFILE_HEALTH_COACH', expect.anything(), expect.objectContaining({
      health, dtiBasis: 'thu nhập thực nhận', monthlySurplusVnd: '8000000',
    }))
    for (let attempt = 0; attempt < 2; attempt++) {
      const fallback = await controller.coach(profile)
      expect(fallback).toMatchObject({ health, source: 'DETERMINISTIC' })
      expect(fallback.actions).toHaveLength(3)
    }
  })

  it('keeps grounded numbers and personalizes the fallback for a funded reserve', async () => {
    const request = {
      monthlyIncomeVnd: '10000000', monthlyExpenseVnd: '4000000',
      existingDebtPaymentVnd: '0', liquidSavingsVnd: '50000000',
      primaryGoal: 'SAVE_INVEST', riskAppetite: 'BALANCED',
    } as const
    const health = calculateFinancialHealth(request)
    const context = coachContext(request, health)
    expect(hasGroundedNumbers([
      'Quỹ đủ 12,5 tháng, giữ 24 000 000 đ làm dự phòng.',
      'Bạn còn 6.000.000 VND mỗi tháng và 26 triệu đồng ngoài quỹ.',
      'Tham khảo quy tắc 50/30/20, mốc 3–6 tháng và DTI 30%.',
    ], context)).toBe(true)
    for (const claim of ['Còn 7 triệu đồng.', 'Quỹ đủ 13 tháng.', 'Lợi suất 30%.', 'Tiền dư 12,5 triệu đồng.']) {
      expect(hasGroundedNumbers([claim], context)).toBe(false)
    }
    const ai = new AiGatewayService(new ConfigService())
    const generate = vi.spyOn(ai, 'generateStructured').mockRejectedValue(new Error('offline'))
    const reply = await new ProfileCopilotController(ai).coach(request)
    expect(generate).toHaveBeenCalledWith('PROFILE_HEALTH_COACH', expect.anything(), context)
    expect(reply.source).toBe('DETERMINISTIC')
    expect(reply.summary).toContain('12,5 tháng')
    expect(reply.actions).toEqual([
      expect.stringContaining('24 000 000 đ'),
      expect.stringMatching(/6 000 000 đ\/tháng.*26 000 000 đ/u),
      expect.stringContaining('Cân bằng'),
    ])
  })
})
