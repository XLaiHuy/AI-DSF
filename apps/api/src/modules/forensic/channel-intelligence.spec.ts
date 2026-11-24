import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChannelIntelligenceService } from './channel-intelligence.service'
import { evaluateHardRules } from './hard-rules.engine'
import { parseAnyQr } from './vietqr-parser'

const tron = 'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL'
const eth = '0x0000000000000000000000000000000000000001'
const btc = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'
const inspect = async (raw: string) => {
  const qr = parseAnyQr(raw)!
  const [enriched] = await new ChannelIntelligenceService().inspect([qr], [])
  return enriched!
}
const rules = (qr: Awaited<ReturnType<typeof inspect>>) =>
  evaluateHardRules({ qrPayloads: [qr], claimedEntityName: null, evidence: [], indicators: [], institutions: [] })

describe('channel intelligence', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([[tron, 'tron'], [eth, '1']])('elevates a flagged GoPlus wallet', async (address, chain) => {
    const fetch = vi.fn(async (url: string) => url.startsWith('https://api.gopluslabs.io/')
      ? Response.json({ code: 1, result: { phishing_activities: '1' } })
      : Response.json({ is_scam: false, is_contract: false, coin_balance: '0' }))
    vi.stubGlobal('fetch', fetch)
    const qr = await inspect(address)
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('chain_id=' + chain), expect.objectContaining({ redirect: 'error' }))
    expect(qr.channelIntelligence).toMatchObject({ reputationStatus: 'FLAGGED_SCAM', checkedLive: true })
    expect(rules(qr)).toMatchObject({ verdictLevel: 'HIGH_RISK', findings: [expect.objectContaining({ severity: 'CRITICAL' })] })
  })

  it.each([[0, 0, 0, 'chưa ghi nhận giao dịch'], [10, 1000, 960, '96%']])('uses confirmed BTC activity', async (tx_count, funded_txo_sum, spent_txo_sum, phrase) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ chain_stats: { tx_count, funded_txo_sum, spent_txo_sum } })))
    const qr = await inspect(btc)
    expect(qr.channelIntelligence?.activitySummary).toContain(phrase)
    expect(qr.channelIntelligence?.riskFlags.length).toBeGreaterThan(0)
  })

  it('matches a URL against the public feed without contacting the URL', async () => {
    const url = 'https://example.test/auth?private=secret'
    const fetch = vi.fn(async () => new Response(url + '\n'))
    vi.stubGlobal('fetch', fetch)
    const qr = await inspect(url)
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('raw.githubusercontent.com/openphish/'), expect.anything())
    expect(qr.channelIntelligence).toMatchObject({ reputationStatus: 'FLAGGED_SCAM', checkedLive: true })
    expect(JSON.stringify(qr.channelIntelligence)).not.toContain('secret')
    expect(rules(qr).findings).toContainEqual(expect.objectContaining({ severity: 'CRITICAL' }))
  })

  it.each(['7995', '6051'])('reports MCC %s and foreign currency', async (merchantCategoryCode) => {
    const qr = { ...parseAnyQr('x')!, qrScheme: 'EMVCO_INTL' as const, crcValid: true, currencyCode: 'USD', countryCode: 'US', merchantCategoryCode }
    const [result] = await new ChannelIntelligenceService().inspect([qr], [])
    expect(result?.channelIntelligence?.reputationStatus).toBe('HIGH_RISK_ANONYMOUS')
    expect(result?.channelIntelligence?.riskFlags).toEqual(expect.arrayContaining([
      expect.stringContaining(merchantCategoryCode), expect.stringContaining('USD'), expect.stringContaining('US'),
    ]))
  })

  it.each(['VIETQR_NAPAS', 'EWALLET_VN'] as const)('explains private channel limits for %s', async (qrScheme) => {
    const qr = { ...parseAnyQr('x')!, qrScheme, crcValid: true, amountVnd: '10000000', serviceCode: 'QRIBFTTA' as const }
    const [result] = await new ChannelIntelligenceService().inspect([qr], [])
    expect(result?.channelIntelligence).toMatchObject({
      reputationStatus: 'UNVERIFIABLE_PRIVATE_BANK', checkedLive: false, activitySummary: expect.stringContaining('117/2018/NĐ-CP'),
    })
    expect(result?.channelIntelligence?.riskFlags[0]).toContain('sinh trắc học')
  })

  it('keeps a crypto warning when the public lookup is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError')))
    const qr = await inspect(tron)
    expect(qr.channelIntelligence).toMatchObject({
      reputationStatus: 'HIGH_RISK_ANONYMOUS', checkedLive: false, legalNotice: expect.stringContaining('52/2024/NĐ-CP'),
    })
    expect(rules(qr).verdictLevel).toBe('CAUTION')
  })
})
