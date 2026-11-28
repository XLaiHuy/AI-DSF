import { z } from 'zod'

export const ProductFreshnessSchema = z.enum(['FRESH', 'AGING', 'STALE'])
export type ProductFreshness = z.infer<typeof ProductFreshnessSchema>

export const VerificationReceiptSchema = z.strictObject({
  verified: z.boolean(),
  checksPassed: z.array(z.string().max(120)).max(8),
  dayCountNote: z.string().max(240),
})
export type VerificationReceipt = z.infer<typeof VerificationReceiptSchema>
