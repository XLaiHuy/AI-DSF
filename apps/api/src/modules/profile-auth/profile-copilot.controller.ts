import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common'
import {
  AI_TASK_SCHEMAS, ProfileCoachRequestSchema, ProfileCoachResponseSchema,
  ProfileNaturalRequestSchema, ProfileNaturalResponseSchema,
  type FinancialHealthRequest, type ProfileCoachRequest, type ProfileNaturalRequest,
} from '@fincopilot/shared-types'
import Decimal from 'decimal.js'
import { GuestSessionGuard } from '../../common/guest-session.guard'
import { maskPii } from '../../common/pii-masker'
import { ZodValidationPipe } from '../../common/zod-validation.pipe'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { calculateFinancialHealth } from './financial-health.engine'
import { coachContext, fallbackAdvice, hasGroundedNumbers } from './coach-guidance'
import { parseNaturalProfile, statedProfileAmounts } from './profile-natural'

@Controller('profile')
@UseGuards(GuestSessionGuard)
export class ProfileCopilotController {
  constructor(private readonly ai: AiGatewayService) {}

  @Post('parse-natural')
  @HttpCode(200)
  async parseNatural(@Body(new ZodValidationPipe(ProfileNaturalRequestSchema)) { text }: ProfileNaturalRequest) {
    const values = parseNaturalProfile(text)
    const safeText = maskPii(text)
    const stated = statedProfileAmounts(safeText)
    if (!stated.size) return ProfileNaturalResponseSchema.parse({ values, source: 'DETERMINISTIC' })

    const task = 'PROFILE_PARSE_NATURAL'
    const ai = await this.ai.generateStructured(task, AI_TASK_SCHEMAS[task], { text: safeText }).catch(() => null)
    let usedAi = false
    for (const key of Object.keys(values) as (keyof FinancialHealthRequest)[]) {
      const suggestion = ai?.[key]
      if (suggestion == null) continue
      const canonical = new Decimal(suggestion).toFixed()
      if ((values[key] === null || values[key] === canonical) && stated.has(canonical)) {
        values[key] = canonical
        usedAi = true
      }
    }
    return ProfileNaturalResponseSchema.parse({ values, source: usedAi ? 'AI' : 'DETERMINISTIC' })
  }

  @Post('coach')
  @HttpCode(200)
  async coach(@Body(new ZodValidationPipe(ProfileCoachRequestSchema)) amounts: ProfileCoachRequest) {
    const health = calculateFinancialHealth(amounts)
    const context = coachContext(amounts, health)
    const task = 'PROFILE_HEALTH_COACH'
    const advice = health.score === null ? null : await this.ai.generateStructured(task, AI_TASK_SCHEMAS[task], context).catch(() => null)
    const supported = advice && hasGroundedNumbers([advice.summary, ...advice.actions], context) &&
      new Set(advice.actions).size === 3
    return ProfileCoachResponseSchema.parse({
      ...(supported ? advice : fallbackAdvice(context)), health, source: supported ? 'AI' : 'DETERMINISTIC',
    })
  }
}
