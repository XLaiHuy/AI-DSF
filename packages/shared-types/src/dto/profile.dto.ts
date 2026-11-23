import { z } from 'zod'
import { AuthProvider, PrimaryGoal, RiskAppetite } from '../enums'
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

const email = z.email().trim().max(254).toLowerCase()
export const AuthLoginSchema = z.strictObject({ email, password: z.string().min(1).max(128) })
export const AuthRegisterSchema = AuthLoginSchema.extend({
  password: z.string().min(10).max(128),
  displayName: z.string().trim().min(1).max(100).optional(),
})
const oauthProviders = z.strictObject({ google: z.boolean(), github: z.boolean() })
export const AuthSessionResponseSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('guest'), user: z.null(), oauthProviders }),
  z.strictObject({
    kind: z.literal('user'),
    user: z.strictObject({
      id: z.uuid(),
      email: z.email(),
      displayName: z.string().nullable(),
      authProvider: AuthProvider,
    }),
    oauthProviders,
  }),
])
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>
export type AuthLogin = z.infer<typeof AuthLoginSchema>
export type AuthRegister = z.infer<typeof AuthRegisterSchema>
