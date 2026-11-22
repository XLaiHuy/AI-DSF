import { z } from 'zod'

export const decimalString = z.string().regex(/^-?\d+(?:\.\d+)?$/)
export const nonnegativeDecimal = z.string().regex(/^\d+(?:\.\d+)?$/)
export const positiveDecimal = nonnegativeDecimal.refine((amount) => /[1-9]/.test(amount), {
  message: 'Expected a positive decimal amount',
})
