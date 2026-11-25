import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { APICallError, NoObjectGeneratedError, generateObject, streamText, type ImagePart, type LanguageModel } from 'ai'
import { z } from 'zod'
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

const embeddingVector = z.array(z.number().finite()).length(256)
const openAiEmbedding = z.object({ data: z.array(z.object({ embedding: embeddingVector })).min(1) })
const googleEmbedding = z.object({ embedding: z.object({ values: embeddingVector }) })

export async function requestEmbedding(route: ModelRoute, key: string, text: string, signal: AbortSignal) {
  const openai = route.provider === 'openai'
  const model = `models/${route.modelId}`
  const url = openai ? 'https://api.openai.com/v1/embeddings'
    : `https://generativelanguage.googleapis.com/v1beta/${model}:embedContent`
  const response = await fetch(url, {
    method: 'POST', signal,
    headers: openai ? { 'content-type': 'application/json', authorization: `Bearer ${key}` }
      : { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(openai ? { model: route.modelId, input: text, dimensions: 256 }
      : { model, content: { parts: [{ text }] }, outputDimensionality: 256 }),
  })
  if (!response.ok) {
    throw new APICallError({ message: 'Embedding request failed', url, requestBodyValues: {}, statusCode: response.status })
  }
  const data: unknown = await response.json()
  return openai ? openAiEmbedding.parse(data).data[0].embedding : googleEmbedding.parse(data).embedding.values
}

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
