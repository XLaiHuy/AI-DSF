import type { extractAuditEvidence } from './forensic-extraction'
import { indicatorPhoneTokens, indicatorTextHosts, indicatorUrlHost, normalizeIndicatorPhone } from './hard-rules.engine'

type Evidence = Awaited<ReturnType<typeof extractAuditEvidence>>
const maxCandidatesPerType = 500

export function threatIndicatorFilters({ evidence, qrPayloads }: Pick<Evidence, 'evidence' | 'qrPayloads'>) {
  const accounts = new Set<string>()
  const phones = new Set<string>()
  const domains = new Set<string>()
  const wallets = new Set<string>()
  const add = (values: Set<string>, value: string) => {
    if (values.size < maxCandidatesPerType) values.add(value)
  }
  const addPhone = (token: string) => {
    const phone = normalizeIndicatorPhone(token)
    if (!/^0\d{9}$/.test(phone)) return
    add(phones, phone)
    add(phones, token)
    for (const prefix of ['+84', '84', '0084']) add(phones, prefix + phone.slice(1))
  }
  const addHost = (hostname: string | undefined) => {
    if (!hostname || hostname.length > 253 || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(hostname)) return
    // The rules also match indicators registered against a parent domain.
    for (let host = hostname; host.includes('.'); host = host.slice(host.indexOf('.') + 1)) add(domains, host)
  }

  for (const qr of qrPayloads) {
    if (qr.account && qr.qrScheme === 'CRYPTO_WALLET') add(wallets, qr.account)
    else if (qr.account && /^[a-z0-9]{7,32}$/i.test(qr.account)) add(accounts, qr.account.toUpperCase())
    if (qr.qrScheme === 'EWALLET_VN' && qr.account) addPhone(qr.account)
    if (qr.targetUrl) addHost(indicatorUrlHost(qr.targetUrl))
  }
  for (const quote of evidence) {
    for (const phone of indicatorPhoneTokens(quote)) addPhone(phone)
    for (const host of indicatorTextHosts(quote)) addHost(host)
    for (const account of quote.match(/(?<![a-z0-9])\d(?:[ .-]?\d){6,31}(?![a-z0-9])/gi) ?? []) {
      add(accounts, account.replace(/\D/g, ''))
    }
  }
  for (const quote of evidence) {
    for (const account of quote.match(/(?<![a-z0-9])[a-z0-9]{7,32}(?![a-z0-9])/gi) ?? []) {
      add(accounts, account.toUpperCase())
    }
  }

  return ([['BANK_ACCOUNT', accounts], ['PHONE', phones], ['DOMAIN', domains],
    ['BANK_ACCOUNT', wallets], ['CRYPTO_WALLET', wallets], ['WALLET_ADDRESS', wallets]] as const)
    .flatMap(([indicatorType, values]) => values.size
      ? [{ indicatorType, indicatorText: { in: [...values], mode: 'insensitive' as const } }]
      : [])
}
