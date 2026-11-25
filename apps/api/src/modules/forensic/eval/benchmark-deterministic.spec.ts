import { ConfigService } from '@nestjs/config'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SessionContext } from '@fincopilot/shared-types'
import type { PrismaService } from '../../../common/prisma.service'
import type { AiGatewayService } from '../../ai-gateway/ai-gateway.service'
import { prepareFollowUp } from '../forensic-follow-up'
import { ForensicService } from '../forensic.service'
import { benchmarkCases } from './benchmark-cases'
import { benchmarkFixtures, createFixture } from './synthetic-fixtures'

const session = { kind: 'guest', guestSessionId: 'c5739c03-5711-4e4d-9de7-a5522114a2c8' } satisfies SessionContext
const fakeNetwork = vi.fn(async () => { throw new Error('offline') })
const config = new ConfigService()
const ai = {
  generateWithProvider: async () => { throw new Error('offline') },
  classifyForensicIntent: async () => null,
} as unknown as AiGatewayService

describe('offline benchmark regression', () => {
  beforeAll(() => vi.stubGlobal('fetch', fakeNetwork))
  afterAll(() => vi.unstubAllGlobals())

  it('keeps 100 independent gold labels and exactly 20 distinct fixtures', () => {
    expect(benchmarkCases.length).toBe(100)
    expect(new Set(benchmarkCases.map((item) => item.id)).size).toBe(100)
    expect(benchmarkCases.reduce<Record<string, number>>((count, item) => ({
      ...count, [item.category]: (count[item.category] ?? 0) + 1,
    }), {})).toEqual({ clean: 15, fees: 12, loans: 15, crypto: 10, phishing: 12, ponzi: 8, emv: 8, profile: 6, adversarial: 8, followUp: 6 })
    const keys = benchmarkCases.flatMap((item) => item.fixtureKey ? [item.fixtureKey] : [])
    expect(new Set(keys)).toEqual(new Set(Object.keys(benchmarkFixtures)))
    expect(keys).toHaveLength(20)
  })

  it.concurrent.for(benchmarkCases)('$id $title', { timeout: 15_000 }, async (item, { expect }) => {
    const prisma = {
      forensicAudit: { create: async () => undefined },
      financialInstitution: { findMany: async () => [] },
      threatIndicator: { findMany: async () => [] },
      financialProfile: { findFirst: async () => item.profile ? Object.fromEntries(Object.entries(item.profile).map(([key, val]) =>
        [key, val === null ? null : { toFixed: () => val }])) : null },
    } as unknown as PrismaService
    const service = new ForensicService(prisma, ai, config)
    const buffer = item.fixtureKey ? await createFixture(item.fixtureKey) : undefined
    const audit = await service.audit(session, item.fields, buffer ? [{ buffer }] : [])
    if (buffer) expect(buffer.every((byte) => byte === 0)).toBe(true)
    if (item.fixtureKey) {
      const fixture = benchmarkFixtures[item.fixtureKey]
      expect(audit.qrPayloads.length).toBe('qrs' in fixture ? fixture.qrs.length : 0)
    }
    const followUps = item.followUp?.map((turn) => {
      const reply = prepareFollowUp(audit, { question: turn.question }, item.profile ?? null)
      expect(reply.meta.intent).toBe(turn.intent)
      expect(Boolean(reply.meta.suggestReaudit)).toBe(Boolean(turn.suggestReaudit))
      return reply.meta.intent
    })
    // Current offline behavior is versioned separately from the gold labels.
    // Known misses remain visible in the live benchmark without changing the rule engine to match the dataset.
    const tamperRule = 'RULE_17_PROMPT_INJECTION_TAMPER'
    const tamperFindings = audit.findings.filter(({ ruleCode }) => ruleCode === tamperRule)
    // Assert the additive finding independently while preserving the original benchmark projection.
    expect(tamperFindings).toEqual(item.id === 'G09-01'
      ? [expect.objectContaining({ ruleCode: tamperRule, severity: 'HIGH' })]
      : [])
    expect([
      audit.verdictLevel, audit.riskScore, audit.findings.map(({ ruleCode }) => ruleCode).filter((code) => code !== tamperRule).sort().join(','),
      audit.mathBreakdown?.effectiveAprPct ?? '', audit.personalImpact?.status ?? '',
      audit.qrPayloads.map(({ qrScheme, currencyCode }) => [qrScheme, currencyCode ?? ''].join(':')).sort().join(','),
      followUps?.join(',') ?? '',
    ].join(' | ')).toMatchSnapshot()
  })
})
