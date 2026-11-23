import { ForensicIntentSignalsSchema } from '@fincopilot/shared-types'
import { z } from 'zod'

const answer = z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) })
const responseSchema = z.object({
  answers: z.object({
    recoveryScamProb: answer,
    biometricPhishingProb: answer,
    urgentCoercionProb: answer,
  }),
})

function question(instructions: string, criteria: { true: string; false: string }) {
  return { type: 'noul', instructions, criteria }
}

const questions = {
  recoveryScamProb: question('Does this contain a recovery scam pattern?', {
    true: 'Promises to recover previously lost funds in exchange for a new payment or credential.',
    false: 'No conditional lost-funds recovery offer.',
  }),
  biometricPhishingProb: question('Does this contain credential phishing disguised as verification?', {
    true: 'Requests OTP, identity scans, voice, or face verification through an unsolicited or unofficial channel.',
    false: 'No request for credentials or biometrics on an unverified channel.',
  }),
  urgentCoercionProb: question('Does this use impersonation to pressure an immediate transfer?', {
    true: 'Claims to be an authority or relative and uses urgency to coerce a payment or block independent checks.',
    false: 'No coercive transfer request via impersonation.',
  }),
}

export class DecisionApiError extends Error {
  constructor(readonly status: number) {
    super('OpenRouter Decisions request failed.')
  }
}

export async function requestForensicIntent(model: string, key: string, text: string, signal: AbortSignal) {
  // Jev is a typed decision model and uses the Decisions endpoint.
  const response = await fetch('https://openrouter.ai/api/alpha/decisions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, state: { evidence: text }, questions }),
    redirect: 'error',
    signal,
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new DecisionApiError(response.status)
  }
  const { answers } = responseSchema.parse(await response.json())
  return ForensicIntentSignalsSchema.parse({
    provider: 'openrouter',
    recoveryScamProb: answers.recoveryScamProb.noul,
    biometricPhishingProb: answers.biometricPhishingProb.noul,
    urgentCoercionProb: answers.urgentCoercionProb.noul,
  })
}
