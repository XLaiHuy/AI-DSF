import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { APICallError, NoObjectGeneratedError, generateObject, streamText, type ImagePart, type LanguageModel } from 'ai'
import type { z } from 'zod'
import type { ModelRoute, Provider } from './ai-routing'

const adapters: Record<Provider, (key: string, id: string) => LanguageModel> = {
  openai: (apiKey, id) => createOpenAI({ apiKey })(id),
  google: (apiKey, id) => createGoogleGenerativeAI({ apiKey })(id),
  anthropic: (apiKey, id) => createAnthropic({ apiKey })(id),
  openrouter: (apiKey, id) => createOpenAICompatible({
    name: 'openrouter', baseURL: 'https://openrouter.ai/api/v1', apiKey, supportsStructuredOutputs: true,
  }).chatModel(id),
}

export type AiInput = {
  text: string
  images?: readonly (Uint8Array | string)[]
}

export type ThinkingLevel = 'low' | 'medium'

function thinkingOptions(route: ModelRoute, thinkingLevel?: ThinkingLevel) {
  return route.provider === 'google' && thinkingLevel ? { google: { thinkingConfig: { thinkingLevel } } } : undefined
}

function userContent(input: AiInput) {
  return [
    { type: 'text' as const, text: input.text },
    ...(input.images ?? []).map((image): ImagePart => ({ type: 'image', image })),
  ]
}

export async function requestObject<Output>(
  route: ModelRoute,
  key: string,
  schema: z.ZodType<Output>,
  system: string,
  input: AiInput,
  signal: AbortSignal,
  thinkingLevel?: ThinkingLevel,
): Promise<Output> {
  const result = await generateObject({
    model: adapters[route.provider](key, route.modelId),
    schema,
    system,
    maxRetries: 0,
    abortSignal: signal,
    providerOptions: thinkingOptions(route, thinkingLevel),
    messages: [{ role: 'user', content: userContent(input) }],
  })
  return result.object
}

export async function* requestTextStream(route: ModelRoute, key: string, system: string, input: AiInput, signal: AbortSignal, thinkingLevel?: ThinkingLevel) {
  const result = streamText({
    model: adapters[route.provider](key, route.modelId), system,
    messages: [{ role: 'user', content: userContent(input) }],
    maxRetries: 0, maxOutputTokens: 256, abortSignal: signal,
    providerOptions: thinkingOptions(route, thinkingLevel),
    // The gateway handles provider failures without logging untrusted output or request details.
    onError: () => undefined,
  })
  for await (const part of result.fullStream) {
    signal.throwIfAborted()
    if (part.type === 'text-delta' && part.text) yield part.text
    if (part.type === 'error') throw part.error
    if (part.type === 'abort' || part.type === 'finish' && ['error', 'content-filter', 'length'].includes(part.finishReason)) {
      throw new Error('Incomplete model stream')
    }
  }
  signal.throwIfAborted()
}

export function failureStatus(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) return 'timeout'
  if (APICallError.isInstance(error)) return error.statusCode ? `http_${error.statusCode}` : 'transport_error'
  if (NoObjectGeneratedError.isInstance(error)) return 'invalid_output'
  return 'unexpected_error'
}
