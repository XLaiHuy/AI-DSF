import { ConfigService } from '@nestjs/config'
import { AI_TASK_SCHEMAS } from '@fincopilot/shared-types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestObject } from './ai-provider'
import { AiGatewayService } from './ai-gateway.service'
import { modelRoutes } from './ai-routing'
import { requestForensicIntent } from './forensic-intent.adapter'

vi.mock('./ai-provider', () => ({
  requestObject: vi.fn(),
  failureStatus: () => 'http_429',
}))
vi.mock('./forensic-intent.adapter', () => ({ requestForensicIntent: vi.fn() }))

const task = 'FORENSIC_VERDICT_NARRATIVE'
const routing = { routing: {
  [task]: { primary: 'openai:primary', fallbacks: ['google:secondary', 'anthropic:tertiary'] },
  FORENSIC_VISION_EXTRACT: { primary: 'openai:vision', fallbacks: ['openrouter:openai/vision'] },
  FORENSIC_INTENT_SIGNAL: { primary: 'openrouter:typesafe/decision', fallbacks: [] },
} }
const payload = { text: 'Synthetic evidence' }
const sample = { narrative: 'Synthetic report', immediateActions: [] }
const mockedRequest = vi.mocked(requestObject)

function gateway(env: Record<string, string>) {
  return new AiGatewayService(new ConfigService({ aiRouting: routing, AI_PROVIDER_CHAIN: 'openai,google,anthropic', ...env }))
}

afterEach(() => vi.resetAllMocks())

describe('AI gateway', () => {
  it('skips missing keys immediately and returns the selected provider', async () => {
    mockedRequest.mockResolvedValue(sample)
    const service = gateway({ OPENAI_API_KEY: ' ', GOOGLE_GENERATIVE_AI_API_KEY: 'fixture' })
    await expect(service.generateWithProvider(task, AI_TASK_SCHEMAS[task], payload))
      .resolves.toEqual({ output: sample, provider: 'google' })
    expect(mockedRequest).toHaveBeenCalledTimes(1)
    expect(mockedRequest.mock.calls[0]?.[0]).toEqual({ provider: 'google', modelId: 'secondary' })
  })

  it('falls through on provider failure and opens a circuit for the failed route', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('fixture')).mockResolvedValue(sample)
    const service = gateway({ OPENAI_API_KEY: 'fixture', GOOGLE_GENERATIVE_AI_API_KEY: 'fixture' })
    await service.generateWithProvider(task, AI_TASK_SCHEMAS[task], payload)
    await service.generateWithProvider(task, AI_TASK_SCHEMAS[task], payload)
    expect(mockedRequest.mock.calls.map(([route]) => route.provider)).toEqual(['openai', 'google', 'google'])
  })

  it('signals degraded output with no outbound call when all keys are missing', async () => {
    await expect(gateway({ OPENAI_API_KEY: '', GOOGLE_GENERATIVE_AI_API_KEY: '', ANTHROPIC_API_KEY: '' })
      .generateWithProvider(task, AI_TASK_SCHEMAS[task], payload)).rejects.toMatchObject({
      response: { errorCode: 'ERR_AI_DEGRADED_FALLBACK' },
    })
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('applies OpenAI vision overrides to direct and OpenRouter routes', () => {
    expect(modelRoutes('FORENSIC_VISION_EXTRACT', routing, () => 'openai/custom-vision')).toEqual([
      { provider: 'openai', modelId: 'custom-vision' },
      { provider: 'openrouter', modelId: 'openai/custom-vision' },
    ])
  })

  it('preserves multimodal input and PDF text on the public gateway contract', async () => {
    mockedRequest.mockResolvedValue(sample)
    const images = [Buffer.from([1, 2]), 'data:image/png;base64,AA==']
    await gateway({ OPENAI_API_KEY: 'fixture' }).generateStructured(task, AI_TASK_SCHEMAS[task], {
      ...payload, images, pdfText: 'Extracted text',
    })
    expect(mockedRequest.mock.calls[0]?.[4]).toEqual({ text: 'Synthetic evidence\n\nExtracted text', images })
  })

  it('keeps intent optional when the Decisions endpoint fails', async () => {
    vi.mocked(requestForensicIntent).mockRejectedValue(new Error('fixture'))
    await expect(gateway({ OPENROUTER_API_KEY: 'fixture' }).classifyForensicIntent(payload.text)).resolves.toBeNull()
    expect(requestForensicIntent).toHaveBeenCalledWith(
      'typesafe/decision', 'fixture', payload.text, expect.any(AbortSignal),
    )
  })
})
