import { resolve } from 'node:path'
import sharp from 'sharp'
import { z } from 'zod'
import { failureStatus, requestObject } from '../modules/ai-gateway/ai-provider'
import { enabledProviders, loadAiRouting, modelRoutes, providerKeys, workspaceRoot } from '../modules/ai-gateway/ai-routing'
import { DecisionApiError, requestForensicIntent } from '../modules/ai-gateway/forensic-intent.adapter'

const tasks = {
  FORENSIC_VISION_EXTRACT: 'AI_VISION_MODEL',
  FORENSIC_VERDICT_NARRATIVE: 'AI_FAST_MODEL',
  FORENSIC_INTENT_SIGNAL: 'AI_JEV_MODEL',
}
const probe = z.strictObject({ ok: z.literal(true) })
const env = (key: string) => process.env[key]

async function main() {
  try {
    process.loadEnvFile(resolve(workspaceRoot, '.env'))
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  const config = loadAiRouting()
  const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#0F5C46' } })
    .png().toBuffer()
  const enabled = enabledProviders(env)
  for (const [provider, key] of Object.entries(providerKeys)) {
    console.log(`${provider}: ${env(key)?.trim() ? 'configured' : 'missing key'}`)
  }
  const results = await Promise.all(Object.entries(tasks).map(async ([task, label]) => {
    const lines: string[] = []
    const routes = modelRoutes(task, config, env)
    for (const [index, route] of routes.entries()) {
      const key = env(providerKeys[route.provider])?.trim()
      const modelId = Object.values(providerKeys).some((name) => env(name)?.trim() === route.modelId)
        ? '[redacted]' : route.modelId
      const name = `${label} ${route.provider}:${modelId}`
      if (!key || (task !== 'FORENSIC_INTENT_SIGNAL' && !enabled.has(route.provider))) {
        lines.push(`${name} SKIP (${key ? 'disabled in chain' : 'missing key'}, 0 ms)`)
        continue
      }
      const start = performance.now()
      const signal = AbortSignal.timeout(12_000)
      try {
        if (task === 'FORENSIC_INTENT_SIGNAL') {
          await requestForensicIntent(route.modelId, key, 'Synthetic payment verification example.', signal)
        } else {
          await requestObject(route, key, probe, 'Return a JSON object with ok set to true.',
            { text: 'Return {"ok":true}.', images: task === 'FORENSIC_VISION_EXTRACT' ? [image] : [] }, signal)
        }
        lines.push(`${name} ${index === 0 ? 'OK' : 'FALLBACK OK'} (${Math.round(performance.now() - start)} ms)`)
        return { lines, passed: true }
      } catch (error) {
        const status = error instanceof DecisionApiError ? `http_${error.status}` : failureStatus(error, signal)
        lines.push(`${name} ${status} (${Math.round(performance.now() - start)} ms)`)
      }
    }
    lines.push(`${label} UNAVAILABLE`)
    return { lines, passed: false }
  }))
  for (const { lines } of results) for (const line of lines) console.log(line)
  if (results.some(({ passed }) => !passed)) process.exitCode = 1
}

void main().catch(() => {
  console.error('AI smoke test configuration could not be loaded.')
  process.exitCode = 1
})
