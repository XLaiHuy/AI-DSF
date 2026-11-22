import { z } from 'zod'
import { PrimaryGoal, RiskAppetite } from '../enums'
import { nonnegativeDecimal } from './decimal'

const financialProfileFields = z.strictObject({
  monthlyIncomeVnd: nonnegativeDecimal.nullable(),
  monthlyExpenseVnd: nonnegativeDecimal.nullable(),
  existingDebtPaymentVnd: nonnegativeDecimal.nullable(),
  liquidSavingsVnd: nonnegativeDecimal.nullable(),
  riskAppetite: RiskAppetite,
  primaryGoal: PrimaryGoal,
})

export const FinancialProfileUpdateSchema = financialProfileFields.partial()
export type FinancialProfileUpdate = z.infer<typeof FinancialProfileUpdateSchema>

export const FinancialProfileSchema = financialProfileFields.extend({
  id: z.uuid(),
  userId: z.uuid().nullable(),
})
export type FinancialProfileDto = z.infer<typeof FinancialProfileSchema>

export type SessionContext =
  | { kind: 'guest'; guestSessionId: string }
  | { kind: 'user'; userId: string }
