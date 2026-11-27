import { z } from 'zod'
import { AuthProvider, PrimaryGoal, RiskAppetite, UserRole } from '../enums'
import { decimalString, nonnegativeDecimal } from './decimal'

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

const profileAmount = z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).nullable()
export const FinancialHealthRequestSchema = z.strictObject({
  monthlyIncomeVnd: profileAmount,
  monthlyExpenseVnd: profileAmount,
  existingDebtPaymentVnd: profileAmount,
  liquidSavingsVnd: profileAmount,
})
export type FinancialHealthRequest = z.infer<typeof FinancialHealthRequestSchema>
export const ProfileCoachRequestSchema = FinancialHealthRequestSchema.extend({
  riskAppetite: RiskAppetite.optional(),
  primaryGoal: PrimaryGoal.optional(),
})
export type ProfileCoachRequest = z.infer<typeof ProfileCoachRequestSchema>

export const FinancialHealthSchema = z.strictObject({
  score: z.number().int().min(0).max(100).nullable(),
  emergencyMonths: nonnegativeDecimal.nullable(),
  savingsRatePct: decimalString.nullable(),
  maxSafeEmiVnd: nonnegativeDecimal.nullable(),
  dtiPct: nonnegativeDecimal.nullable(),
  budget: z.strictObject({
    needsVnd: nonnegativeDecimal,
    wantsVnd: nonnegativeDecimal,
    savingsAndDebtVnd: nonnegativeDecimal,
  }).nullable(),
})
export type FinancialHealth = z.infer<typeof FinancialHealthSchema>
export const FinancialProfileResponseSchema = z.strictObject({
  profile: FinancialProfileSchema.nullable(),
  health: FinancialHealthSchema.nullable().optional(),
})

export const ProfileNaturalRequestSchema = z.strictObject({ text: z.string().trim().min(1).max(1000) })
export type ProfileNaturalRequest = z.infer<typeof ProfileNaturalRequestSchema>
const profileCoachText = (max: number) => z.string().trim().min(1).max(max)
export const ProfileCoachAdviceSchema = z.strictObject({
  summary: profileCoachText(600),
  actions: z.array(profileCoachText(240)).length(3),
})
const coachSource = z.enum(['AI', 'DETERMINISTIC'])
export const ProfileNaturalResponseSchema = z.strictObject({ values: FinancialHealthRequestSchema, source: coachSource })
export const ProfileCoachResponseSchema = ProfileCoachAdviceSchema.extend({
  health: FinancialHealthSchema,
  source: coachSource,
})
export type ProfileCoachResponse = z.infer<typeof ProfileCoachResponseSchema>

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
      avatarUrl: z.string().nullable().optional(),
      authProvider: AuthProvider,
      role: UserRole,
    }),
    oauthProviders,
  }),
])
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>
export type AuthLogin = z.infer<typeof AuthLoginSchema>
export type AuthRegister = z.infer<typeof AuthRegisterSchema>
