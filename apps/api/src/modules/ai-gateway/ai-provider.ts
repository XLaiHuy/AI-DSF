import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { APICallError, NoObjectGeneratedError, generateObject, type ImagePart, type LanguageModel } from 'ai'
import type { z } from 'zod'
import type { ModelRoute, Provider } from './ai-routing'

const adapters: Record<Provider, (key: string, id: string) => LanguageModel> = {
  openai: (apiKey, id) => createOpenAI({ apiKey })(id),
  google: (apiKey, id) => createGoogleGenerativeAI({ apiKey })(id),
  anthropic: (apiKey, id) => createAnthropic({ apiKey })(id),
  openrouter: (apiKey, id) => createOpenAICompatible({
    name: 'openrouter', baseURL: 'https://openrouter.ai/api/v1', apiKey,
  }).chatModel(id),
}

export type AiInput = {
  text: string
  images?: readonly (Uint8Array | string)[]
}

export async function requestObject<Output>(
  route: ModelRoute,
  key: string,
  schema: z.ZodType<Output>,
  system: string,
  input: AiInput,
  signal: AbortSignal,
): Promise<Output> {
  const result = await generateObject({
    model: adapters[route.provider](key, route.modelId),
    schema,
    system,
    maxRetries: 0,
    abortSignal: signal,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: input.text },
        ...(input.images ?? []).map((image): ImagePart => ({ type: 'image', image })),
      ],
    }],
  })
  return result.object
}

export function failureStatus(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) return 'timeout'
  if (APICallError.isInstance(error)) return error.statusCode ? `http_${error.statusCode}` : 'transport_error'
  if (NoObjectGeneratedError.isInstance(error)) return 'invalid_output'
  return 'unexpected_error'
}
