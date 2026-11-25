import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'

export const workspaceRoot = resolve(__dirname, '../../../../..')
export const providerKeys = {
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
} as const
export type Provider = keyof typeof providerKeys
export type ModelRoute = { provider: Provider; modelId: string }
export type AiEnvironment = (key: string) => string | undefined

const providerSchema = z.enum(['openai', 'google', 'anthropic', 'openrouter'])
const modelIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._:/-]{0,127}$/i)
const configSchema = z.object({
  routing: z.record(z.string(), z.object({
    primary: z.string(),
    fallbacks: z.array(z.string()),
    streamFallbacks: z.array(z.string()).optional(),
  })),
})
const overrides: Record<string, string> = {
  PROFILE_PARSE_NATURAL: 'AI_FAST_MODEL',
  PROFILE_HEALTH_COACH: 'AI_FAST_MODEL',
  FORENSIC_VISION_EXTRACT: 'AI_VISION_MODEL',
  FORENSIC_DEEP_REASONING: 'AI_VISION_MODEL',
  FORENSIC_VERDICT_NARRATIVE: 'AI_FAST_MODEL',
  FORENSIC_INTENT_SIGNAL: 'AI_JEV_MODEL',
  RADAR_CLASSIFY_IMPACT: 'AI_FAST_MODEL',
  THREAT_ARTICLE_EXTRACT: 'AI_FAST_MODEL',
  RADAR_DAILY_BRIEF: 'AI_FAST_MODEL',
  SURVEY_WEB_LOOKUP: 'AI_FAST_MODEL',
  SURVEY_EXPLAIN: 'AI_FAST_MODEL',
}

function configuredRoute(value: string): ModelRoute {
  const separator = value.indexOf(':')
  return {
    provider: providerSchema.parse(value.slice(0, separator)),
    modelId: modelIdSchema.parse(value.slice(separator + 1)),
  }
}

function overrideRoute(value: string, defaultProvider: Provider): ModelRoute {
  const match = /^(openai|google|anthropic|openrouter)[:/](.+)$/.exec(value)
  return match
    ? { provider: providerSchema.parse(match[1]), modelId: modelIdSchema.parse(match[2]) }
    : { provider: defaultProvider, modelId: modelIdSchema.parse(value) }
}

export function loadAiRouting() {
  return parse(readFileSync(resolve(workspaceRoot, 'config/ai-routing.yaml'), 'utf8')) as unknown
}

export function modelRoutes(task: string, configuration: unknown, env: AiEnvironment, stream = false): ModelRoute[] {
  const entry = configSchema.parse(configuration).routing[task]
  if (!entry) return []
  const primary = configuredRoute(entry.primary)
  const variable = overrides[task]
  const override = variable && env(variable)?.trim()
  const fallbacks = stream ? entry.streamFallbacks ?? entry.fallbacks : entry.fallbacks
  const routes = [primary, ...fallbacks.map(configuredRoute)]
  if (override) {
    const replacement = overrideRoute(override, primary.provider)
    // A direct OpenAI vision override should also apply through OpenRouter.
    if (task === 'FORENSIC_VISION_EXTRACT' && replacement.provider === 'openai') {
      const mirrored = routes.find((route) => route.provider === 'openrouter'
        && route.modelId === `openai/${primary.modelId}`)
      if (mirrored) mirrored.modelId = `openai/${replacement.modelId}`
    }
    routes[0] = replacement
  }
  return routes.filter((route, index) => routes.findIndex((other) =>
    other.provider === route.provider && other.modelId === route.modelId) === index)
}

export function enabledProviders(env: AiEnvironment): Set<Provider> {
  const chain = env('AI_PROVIDER_CHAIN') ?? Object.keys(providerKeys).join(',')
  return new Set(chain.split(',').flatMap((value) => {
    const provider = providerSchema.safeParse(value.trim().toLowerCase())
    return provider.success ? [provider.data] : []
  }))
}
