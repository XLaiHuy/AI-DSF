import 'reflect-metadata'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { ConfigService } from '@nestjs/config'
import type { ForensicAuditStage, ForensicChatTurn, SessionContext } from '@fincopilot/shared-types'
import { PrismaService } from '../common/prisma.service'
import { AiGatewayService } from '../modules/ai-gateway/ai-gateway.service'
import { workspaceRoot } from '../modules/ai-gateway/ai-routing'
import { normalizeVietnamese } from '../modules/forensic/data/trusted-institutions'
import { benchmarkCases, type BenchmarkCase } from '../modules/forensic/eval/benchmark-cases'
import { benchmarkMarkdown, summarizeBenchmark, type CaseResult } from '../modules/forensic/eval/benchmark-report'
import { benchmarkFixtures, createFixture, type SyntheticFixture } from '../modules/forensic/eval/synthetic-fixtures'
import type { ForensicExtractionObservation } from '../modules/forensic/forensic-extraction'
import { ForensicService, type ForensicBenchmarkObservation } from '../modules/forensic/forensic.service'

type Guest = Extract<SessionContext, { kind: 'guest' }>
const concurrency = 2
const transport = new AsyncLocalStorage<Record<string, number>>()
const realFetch = globalThis.fetch

function instrumentedFetch(...args: Parameters<typeof fetch>) {
  const counters = transport.getStore()
  const [input] = args
  const url = URL.parse(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const route = url?.hostname.endsWith('googleapis.com') ? 'google'
    : url?.hostname === 'openrouter.ai' ? url.pathname.endsWith('/decisions') ? 'jev' : 'openrouter' : undefined
  return realFetch(...args).then((response) => {
    if (counters && route) {
      const key = route + ':' + response.status
      counters[key] = (counters[key] ?? 0) + 1
    }
    return response
  }, (error: unknown) => {
    if (counters && route) {
      const key = route + ':network'
      counters[key] = (counters[key] ?? 0) + 1
    }
    throw error
  })
}

function configuration() {
  try {
    process.loadEnvFile(resolve(workspaceRoot, '.env'))
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  Object.assign(process.env, {
    AI_PROVIDER_CHAIN: 'google,openrouter',
    AI_FAST_MODEL: 'google:gemini-3.5-flash-lite',
    AI_VISION_MODEL: 'google:gemini-3.8-flash',
    AI_JEV_MODEL: 'openrouter:typesafe/jev-1.13',
  })
  const gemini = { primary: 'google:gemini-3.8-flash', fallbacks: ['openrouter:google/gemini-3.8-flash', 'openrouter:openai/gpt-4.1-mini'] }
  return new ConfigService({ aiRouting: { routing: {
    FORENSIC_VISION_EXTRACT: gemini,
    FORENSIC_DEEP_REASONING: gemini,
    FORENSIC_VERDICT_NARRATIVE: {
      primary: 'google:gemini-3.5-flash-lite',
      fallbacks: ['openrouter:google/gemini-3.5-flash-lite', 'openrouter:google/gemini-3.8-flash', 'openrouter:openai/gpt-4.1-mini'],
    },
    FORENSIC_INTENT_SIGNAL: { primary: 'openrouter:typesafe/jev-1.13', fallbacks: [] },
  } } })
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(strings)
}

function appError(error: unknown) {
  // Provider/Prisma messages may include request or connection details.
  return error instanceof Error && /^(?:[a-zA-Z][a-zA-Z0-9_]{1,70})$/.test(error.name) ? error.name : 'PipelineError'
}

async function runCase(service: ForensicService, item: BenchmarkCase, session: Guest, counters: Record<string, number>) {
  const start = performance.now()
  const result: CaseResult = { case: item, attempts: 1, latencyMs: 0, stageMs: {}, transport: counters,
    verdict: null, rules: [], followUps: [], degradedMode: false, fallbacks: [] }
  const marks = new Map<ForensicAuditStage['step'], number>()
  function stage(entry: ForensicAuditStage) {
    if (entry.status === 'running') marks.set(entry.step, performance.now())
    else {
      const started = marks.get(entry.step)
      if (started !== undefined) result.stageMs[entry.step] = Math.round(performance.now() - started)
    }
  }

  let buffer: Buffer | undefined
  let extraction: ForensicExtractionObservation | undefined
  let report: ForensicBenchmarkObservation | undefined
  const fixture: SyntheticFixture | undefined = item.fixtureKey ? benchmarkFixtures[item.fixtureKey] : undefined
  try {
    if (item.fixtureKey) buffer = await createFixture(item.fixtureKey)
    const audit = await service.audit(session, item.fields, buffer ? [{ buffer }] : [], stage, {
      onExtraction: (details) => { extraction = details },
      onReport: (details) => { report = details },
    })
    result.verdict = audit.verdictLevel
    result.score = audit.riskScore
    result.rules = audit.findings.map(({ ruleCode }) => ruleCode)
    result.apr = audit.mathBreakdown?.effectiveAprPct ?? undefined
    result.impact = audit.personalImpact
    result.intentSignals = audit.intentSignals
    result.trace = report
    result.visionProvider = extraction?.visionProvider
    result.visionNeeded = extraction?.visionNeeded
    result.degradedMode = audit.meta.degradedMode
    if (extraction?.visionNeeded && !extraction.visionProvider) result.fallbacks.push('Vision không trả dữ liệu, dùng trích xuất xác định')
    if (!audit.intentSignals) result.fallbacks.push('JEV không trả tín hiệu')
    if (report && !report.reasoningProvider) result.fallbacks.push('Deep Reasoning không trả dữ liệu')
    if (!report?.narrativeProvider) result.fallbacks.push('Narrative không trả dữ liệu')
    else {
      if (report.narrativeGrounded === false) result.fallbacks.push('Narrative rớt grounding')
      if (report.paymentMentioned === false) result.fallbacks.push('Narrative thiếu cụm định danh giao dịch')
    }
    if (item.followUp) {
      const chatStart = performance.now()
      const history: ForensicChatTurn[] = []
      for (const turn of item.followUp) {
        const reply = await service.followUp(session, audit.auditId, { question: turn.question, history: history.slice(-6) })
        result.followUps.push({
          intent: reply.meta.intent, suggestReaudit: reply.meta.suggestReaudit, degradedMode: reply.meta.degradedMode,
          provider: reply.meta.llmProvider, containsRequiredText: !turn.mustMention || reply.answer.includes(turn.mustMention),
          unsafeReassurance: turn.intent === 'NEW_CONTEXT' && /\b(?:giao dich (?:nay )?(?:la )?an toan|khong co rui ro)\b/.test(normalizeVietnamese(reply.answer)),
        })
        history.push({ role: 'user', content: turn.question }, { role: 'assistant', content: reply.answer.slice(0, 4000) })
      }
      result.stageMs.FOLLOW_UP = Math.round(performance.now() - chatStart)
    }
  } catch (error) {
    result.error = appError(error)
  } finally {
    if (fixture) {
      const responseParts = strings(extraction?.vision).map(normalizeVietnamese)
      result.ocr = fixture.probes.map((probe) => ({
        probe, matched: responseParts.some((part) => part.includes(normalizeVietnamese(probe))),
      }))
      result.media = {
        imageCount: extraction?.imageCount ?? 0, pdfRasterCount: extraction?.pdfRasterCount ?? 0, decodedQrCount: extraction?.decodedQrCount ?? 0,
        expectedQrCount: fixture.qrs?.length ?? 0, purged: Boolean(buffer && buffer.every((byte) => byte === 0)),
      }
    }
    buffer?.fill(0)
    result.latencyMs = Math.round(performance.now() - start)
  }
  return result
}

async function cleanup(prisma: PrismaService, guestIds: string[]) {
  const owner = { guestSessionId: { in: guestIds }, userId: null }
  await prisma.$transaction([
    prisma.forensicFinding.deleteMany({ where: { audit: owner } }),
    prisma.forensicQrPayload.deleteMany({ where: { audit: owner } }),
    prisma.forensicAudit.deleteMany({ where: owner }),
    prisma.financialProfile.deleteMany({ where: owner }),
  ])
  const [audits, profiles] = await Promise.all([
    prisma.forensicAudit.count({ where: owner }), prisma.financialProfile.count({ where: owner }),
  ])
  return audits === 0 && profiles === 0
}

async function main() {
  if (benchmarkCases.length !== 100) throw new Error('Invalid benchmark size')
  const config = configuration()
  Object.assign(globalThis, { AI_SDK_LOG_WARNINGS: false })
  globalThis.fetch = instrumentedFetch
  const prisma = new PrismaService()
  const service = new ForensicService(prisma, new AiGatewayService(config), config)
  const queue = benchmarkCases.map((item) => ({ item, session: { kind: 'guest', guestSessionId: randomUUID() } satisfies Guest }))
  const rows: CaseResult[] = []
  const folder = resolve(workspaceRoot, 'test-results/benchmark')
  const start = performance.now()
  let cleaned = false
  let stop = false
  const onStop = () => { stop = true }
  process.on('SIGINT', onStop)
  process.on('SIGTERM', onStop)
  try {
    await prisma.$connect()
    let next = 0
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (!stop && next < queue.length) {
        const { item, session } = queue[next++]!
        const counters: Record<string, number> = {}
        let row: CaseResult
        try {
          if (item.profile) await prisma.financialProfile.create({
            data: { id: randomUUID(), guestSessionId: session.guestSessionId, ...item.profile },
          })
          row = await transport.run(counters, () => runCase(service, item, session, counters))
          const limited = Object.keys(counters).some((key) => key.endsWith(':429'))
          if (limited && !stop && (!row.verdict || row.degradedMode || !row.intentSignals)) {
            const retryStart = performance.now()
            const geminiLimited = Boolean(counters['google:429'] || counters['openrouter:429'])
            await pause(geminiLimited ? 61_000 : 2_000)
            if (!stop) {
              const retry = await transport.run(counters, () => runCase(service, item, session, counters))
              retry.attempts = 2
              retry.latencyMs = row.latencyMs + Math.round(performance.now() - retryStart)
              row = retry
            }
          }
        } catch (error) {
          row = { case: item, attempts: 1, stageMs: {}, transport: counters, latencyMs: 0, verdict: null,
            rules: [], degradedMode: false, fallbacks: [], followUps: [], error: appError(error) }
        }
        rows.push(row)
        console.log(rows.length + '/100 ' + item.id + ' ' + (row.error ?? row.verdict) + ' · ' + row.latencyMs + 'ms')
        await pause(175)
      }
    }))
  } finally {
    try {
      cleaned = await cleanup(prisma, queue.map(({ session }) => session.guestSessionId))
    } catch {
      console.error('Chưa xác minh được dọn dẹp dữ liệu benchmark.')
    } finally {
      await prisma.$disconnect()
      globalThis.fetch = realFetch
      process.off('SIGINT', onStop)
      process.off('SIGTERM', onStop)
    }
    rows.sort((left, right) => left.case.id.localeCompare(right.case.id))
    const summary = summarizeBenchmark(rows, { cleaned, durationMs: Math.round(performance.now() - start) })
    await mkdir(folder, { recursive: true })
    await writeFile(resolve(folder, 'forensic-100-results.json'), JSON.stringify({ summary, results: rows }, null, 2), 'utf8')
    await writeFile(resolve(folder, 'forensic-100-report.md'), benchmarkMarkdown(rows, summary), 'utf8')
    if (!cleaned || rows.length !== 100 || rows.some((row) => row.error || !row.verdict)) process.exitCode = 1
  }
}

void main().catch((error: unknown) => {
  console.error('Benchmark không hoàn tất (' + appError(error) + ').')
  process.exitCode = 1
})
