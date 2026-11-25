import { normalizeVietnamese } from './data/trusted-institutions'
import { indicatorPhoneTokens, indicatorTextHosts, indicatorUrlHost, normalizeIndicatorPhone } from './hard-rules.engine'
import type { extractAuditEvidence } from './forensic-extraction'

export type HardIocType = 'PHONE' | 'BANK_ACCOUNT' | 'DOMAIN' | 'CRYPTO_WALLET'
export type ThreatIoc = { indicatorType: HardIocType; indicatorText: string }
type ParsedQr = Awaited<ReturnType<typeof extractAuditEvidence>>['qrPayloads'][number]
const wallet = /(?<![a-z0-9])(?:0x[a-f0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|[13][1-9A-HJ-NP-Za-km-z]{25,34}|bc1[ac-hj-np-z02-9]{11,71})(?![a-z0-9])/gi
const account = /(?:stk|tk|số\s+tài\s+khoản|tài\s+khoản|account)\s*(?:số\s+)?[:=]?\s*(\d(?:[ .-]?\d){6,31})(?!\d)/giu

export function canonicalIoc(type: string, value: string): string | undefined {
  const text = value.trim()
  switch (type) {
    case 'PHONE': {
      const phone = normalizeIndicatorPhone(text)
      return /^0\d{9}$/.test(phone) ? phone : undefined
    }
    case 'BANK_ACCOUNT': {
      const number = text.replace(/[ .-]/g, '')
      return /^\d{7,32}$/.test(number) ? number : undefined
    }
    case 'DOMAIN': {
      const url = URL.parse(text.includes('://') ? text : `https://${text}`)
      const host = url?.hostname.replace(/\.$/, '')
      return host && /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z][a-z\d-]{1,62}$/i.test(host) && host.length <= 253 ? host : undefined
    }
    case 'WALLET_ADDRESS':
    case 'CRYPTO_WALLET':
      return text.match(wallet)?.[0] === text ? (/^(?:0x|bc1)/i.test(text) ? text.toLowerCase() : text) : undefined
  }
}

export function extractThreatIocs(text: string, qrs: readonly ParsedQr[] = []): ThreatIoc[] {
  const iocs = new Map<string, ThreatIoc>()
  const add = (indicatorType: HardIocType, raw: string) => {
    const indicatorText = canonicalIoc(indicatorType, raw)
    if (indicatorText) iocs.set(`${indicatorType}:${indicatorText}`, { indicatorType, indicatorText })
  }
  for (const phone of indicatorPhoneTokens(text)) add('PHONE', phone)
  for (const [, number] of text.matchAll(account)) add('BANK_ACCOUNT', number)
  for (const host of indicatorTextHosts(text)) {
    if (!/\.(?:apk|pdf|png|jpg|jpeg|docx|zip)$/i.test(host)) add('DOMAIN', host)
  }
  for (const address of text.match(wallet) ?? []) add('CRYPTO_WALLET', address)
  for (const qr of qrs) {
    if (qr.targetUrl) add('DOMAIN', indicatorUrlHost(qr.targetUrl) ?? '')
    if (!qr.account) continue
    if (qr.qrScheme === 'CRYPTO_WALLET') add('CRYPTO_WALLET', qr.account)
    if (qr.qrScheme === 'EWALLET_VN') add('PHONE', qr.account)
    if (qr.qrScheme === 'VIETQR_NAPAS' && qr.crcValid) add('BANK_ACCOUNT', qr.account)
  }
  return [...iocs.values()].slice(0, 40)
}

export type TrustedIdentity = { name: string; code: string; vietqrBin: string | null; officialWebsite: string | null }

export function matchesTrustedIdentity(value: string, trusted: readonly TrustedIdentity[]) {
  const plain = normalizeVietnamese(value)
  const host = canonicalIoc('DOMAIN', value)
  return trusted.some(({ code, name, officialWebsite, vietqrBin }) => {
    if (plain === normalizeVietnamese(code) || plain === normalizeVietnamese(name) || value === vietqrBin) return true
    const official = officialWebsite && canonicalIoc('DOMAIN', officialWebsite)?.replace(/^www\./, '')
    return Boolean(host && official && (host === official || host.endsWith('.' + official)))
  })
}
