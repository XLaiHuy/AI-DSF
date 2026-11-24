import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import type { QrScheme, QrServiceCode } from '@fincopilot/shared-types'
import { bankNameForBin } from './data/trusted-institutions'

export interface ParsedVietQr {
  acqBin: string | null
  bankName: string | null
  account: string | null
  serviceCode: QrServiceCode
  amountVnd: string | null
  purpose: string | null
  crcValid: boolean
  raw: string
}

export interface ParsedQr extends Omit<ParsedVietQr, 'serviceCode'> {
  serviceCode: QrServiceCode | null
  qrScheme: QrScheme
  providerLabel: string | null
  currencyCode: string | null
  countryCode: string | null
  targetUrl: string | null
  walletNetwork: string | null
  merchantName: string | null
  merchantCategoryCode?: string | null
  amount: string | null
}

// Wallet GUIDs live in merchant account templates, sometimes alongside bank routing.
const walletIdentifiers = new Map([
  ['VN.MOMO', 'MoMo'], ['VN.ZALOPAY', 'ZaloPay'], ['A000000775', 'VNPAY'],
  ['VN.SHOPEEPAY', 'ShopeePay'],
])
const walletHosts = new Map([
  ['me.momo.vn', 'MoMo'], ['payment.momo.vn', 'MoMo'],
  ['social.zalopay.vn', 'ZaloPay'], ['qcgateway.zalopay.vn', 'ZaloPay'],
  ['pay.shopeepay.vn', 'ShopeePay'], ['shopeepay.vn', 'ShopeePay'],
  ['pay.vnpay.vn', 'VNPAY'], ['pay.vnpayqr.vn', 'VNPAY'],
])
const walletProtocols = new Map([['momo:', 'MoMo'], ['zalopay:', 'ZaloPay']])
const internationalIdentifiers = new Map([
  ['A000000677010111', 'PromptPay'], ['A000000677010112', 'PromptPay'],
  ['SG.PAYNOW', 'PayNow'], ['A0000006150001', 'DuitNow'],
])
const cardTags = new Map([
  ['02', 'Visa'], ['03', 'Visa'], ['04', 'Mastercard'], ['05', 'Mastercard'],
  ['06', 'Discover'], ['07', 'Discover'], ['08', 'Discover'],
  ['13', 'JCB'], ['14', 'JCB'], ['15', 'UnionPay'], ['16', 'UnionPay'],
])
const currencies = new Map([
  ['704', 'VND'], ['840', 'USD'], ['978', 'EUR'], ['702', 'SGD'], ['764', 'THB'],
  ['826', 'GBP'], ['392', 'JPY'], ['458', 'MYR'], ['036', 'AUD'], ['344', 'HKD'],
])

function parseTlv(payload: string): Map<string, string> | null {
  const chars = Array.from(payload)
  const tags = new Map<string, string>()
  for (let offset = 0; offset < chars.length;) {
    const header = chars.slice(offset, offset + 4).join('')
    if (!/^\d{4}$/.test(header)) return null
    const tag = header.slice(0, 2)
    const length = Number(header.slice(2))
    const start = offset + 4
    if (length === 0 || start + length > chars.length || tags.has(tag)) return null
    tags.set(tag, chars.slice(start, start + length).join(''))
    offset = start + length
  }
  return tags
}

function crc16(payload: string): string {
  let crc = 0xffff
  for (const byte of Buffer.from(payload, 'utf8')) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff
    }
  }
  return crc.toString(16).padStart(4, '0').toUpperCase()
}

function parseEmv(payload: string) {
  if (payload.length > 4096 || payload.includes('\0') || !/6304[0-9a-f]{4}$/i.test(payload)) return null
  const fields = parseTlv(payload)
  if (fields?.get('00') !== '01' || !fields.has('63')) return null
  return { fields, crcValid: fields.get('63')?.toUpperCase() === crc16(payload.slice(0, -4)) }
}

function parseNapas(payload: string, fields: Map<string, string>, crcValid: boolean): ParsedVietQr | null {
  if (fields.get('53') !== '704' || fields.get('58') !== 'VN') return null
  const maInfo = parseTlv(fields.get('38') ?? '')
  const recipient = parseTlv(maInfo?.get('01') ?? '')
  const service = maInfo?.get('02')
  if (maInfo?.get('00') !== 'A000000727' || !recipient) return null
  if (service !== 'QRIBFTTA' && service !== 'QRIBFTTC' && service !== 'QRPUSH' && service !== 'MERCHANT') return null
  const acqBin = recipient.get('00') ?? ''
  const account = recipient.get('01') ?? ''
  if (!/^\d{6}$/.test(acqBin) || !/^[A-Z0-9]{1,32}$/i.test(account)) return null
  const extra = parseTlv(fields.get('62') ?? '')
  const amountVnd = fields.get('54') ?? null
  if (amountVnd !== null && !/^\d{1,13}(?:\.\d{1,2})?$/.test(amountVnd)) return null

  return {
    raw: payload,
    acqBin,
    bankName: bankNameForBin(acqBin),
    account,
    serviceCode: service === 'QRIBFTTA' || service === 'QRIBFTTC' ? service : 'MERCHANT',
    amountVnd,
    purpose: extra?.get('08') ?? null,
    crcValid,
  }
}

export function parseVietQr(raw: string): ParsedVietQr | null {
  const payload = raw.trim()
  const emv = parseEmv(payload)
  return emv ? parseNapas(payload, emv.fields, emv.crcValid) : null
}

function emptyQr(raw: string): ParsedQr {
  return {
    raw, qrScheme: 'UNKNOWN', acqBin: null, bankName: null, account: null, serviceCode: null, amountVnd: null,
    purpose: null, crcValid: false, providerLabel: null, currencyCode: null, countryCode: null,
    targetUrl: null, walletNetwork: null, merchantName: null, amount: null,
  }
}

function walletQr(qr: ParsedQr, providerLabel: string): ParsedQr {
  return { ...qr, qrScheme: 'EWALLET_VN', providerLabel, currencyCode: 'VND', countryCode: 'VN' }
}

function parseEmvQr(qr: ParsedQr, fields: Map<string, string>, crcValid: boolean): ParsedQr {
  const mcc = fields.get('52') ?? ''
  qr = { ...qr, merchantCategoryCode: /^\d{4}$/.test(mcc) ? mcc : null }
  const napas = parseNapas(qr.raw, fields, crcValid)
  const napasQr: ParsedQr | null = napas ? {
    ...qr, ...napas, qrScheme: 'VIETQR_NAPAS', providerLabel: napas.bankName ?? 'VietQR NAPAS',
    currencyCode: 'VND', countryCode: 'VN', amount: napas.amountVnd, merchantName: fields.get('59') ?? null,
  } : null
  if (!crcValid) return napasQr ?? qr

  const templates = [...fields].flatMap(([tag, value]) => {
    if (tag < '26' || tag > '51') return []
    const template = parseTlv(value)
    const identifier = template?.get('00')
    return identifier && template ? [{ identifier: identifier.toUpperCase(), template }] : []
  })
  const wallet = templates.find(({ identifier }) => walletIdentifiers.has(identifier))
  const walletLabel = wallet && walletIdentifiers.get(wallet.identifier)
  if (!walletLabel && napasQr) return napasQr

  const currencyCode = currencies.get(fields.get('53') ?? '') ?? null
  const country = fields.get('58') ?? ''
  const rawAmount = fields.get('54') ?? ''
  const amount = /^\d{1,13}(?:\.\d{1,2})?$/.test(rawAmount) ? rawAmount : null
  const payment: ParsedQr = {
    ...qr, crcValid, currencyCode, countryCode: /^[A-Z]{2}$/.test(country) ? country : null,
    merchantName: fields.get('59') ?? null, amount, amountVnd: currencyCode === 'VND' ? amount : null,
    purpose: parseTlv(fields.get('62') ?? '')?.get('08') ?? null,
  }
  if (wallet && walletLabel && country === 'VN' && currencyCode === 'VND') {
    const id = wallet.template.get('01')
    return walletQr({
      ...payment,
      acqBin: napas?.acqBin ?? null,
      bankName: napas?.bankName ?? null,
      serviceCode: napas?.serviceCode ?? null,
      account: napas?.account ?? (id && /^[A-Z0-9_-]{1,64}$/i.test(id) ? id : null),
    }, walletLabel)
  }
  if (napasQr) return napasQr

  const networks = new Set([
    ...templates.map(({ identifier }) => internationalIdentifiers.get(identifier)),
    ...[...fields.keys()].map((tag) => cardTags.get(tag)),
  ].filter((label) => label !== undefined))
  return { ...payment, qrScheme: 'EMVCO_INTL', providerLabel: [...networks].join(' / ') || 'EMVCo' }
}

function parseWalletPipe(qr: ParsedQr): ParsedQr | null {
  if (!qr.raw.startsWith('2|99|')) return null
  const parts = qr.raw.split('|')
  const [, , phone, name] = parts
  if (parts.length < 5 || parts.at(-1)?.toLowerCase() !== 'transfer_myqr'
    || !/^(?:0|\+?84)[35789]\d{8}$/.test(phone ?? '')) return null
  return walletQr({ ...qr, account: phone, merchantName: name.trim().slice(0, 100) || null }, 'MoMo')
}

function parseQrUrl(qr: ParsedQr): ParsedQr | null {
  const raw = qr.raw
  if (/[\\\s\p{Cc}\p{Cf}]/u.test(raw) || !/^[A-Z][A-Z0-9+.-]*:\/\//i.test(raw)) return null
  const url = URL.parse(raw)
  if (!url?.hostname) return null
  const protocolProvider = walletProtocols.get(url.protocol)
  const hasCredentials = Boolean(url.username || url.password)
  if (protocolProvider && !hasCredentials) return walletQr(qr, protocolProvider)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const hostname = url.hostname.replace(/\.$/, '')
  const provider = url.protocol === 'https:' && !hasCredentials && !url.port ? walletHosts.get(hostname) : undefined
  url.username = ''
  url.password = ''
  const target = { ...qr, targetUrl: url.href }
  return provider ? walletQr(target, provider) : { ...target, qrScheme: 'URL_LINK', providerLabel: hostname }
}

const base58Alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function isValidBitcoinLegacy(address: string): boolean {
  let value = 0n
  for (const char of address) {
    const digit = base58Alphabet.indexOf(char)
    if (digit < 0) return false
    value = value * 58n + BigInt(digit)
  }
  const decoded: number[] = []
  while (value > 0n) {
    decoded.push(Number(value & 255n))
    value >>= 8n
  }
  for (const char of address) {
    if (char === '1') decoded.push(0)
    else break
  }
  decoded.reverse()
  if (decoded.length !== 25 || (decoded[0] !== 0x00 && decoded[0] !== 0x05)) return false
  const bytes = Uint8Array.from(decoded)
  const first = createHash('sha256').update(bytes.subarray(0, 21)).digest()
  const checksum = createHash('sha256').update(first).digest()
  return checksum.subarray(0, 4).every((byte, index) => byte === bytes[21 + index])
}

function parseCryptoQr(qr: ParsedQr): ParsedQr | null {
  const uri = /^(tron|ethereum|bitcoin|usdt):(?:\/\/)?([^?]+)(?:\?([^#]*))?$/i.exec(qr.raw)
  const scheme = uri?.[1].toLowerCase()
  let account = uri?.[2] ?? qr.raw
  const networkPrefix = scheme === 'usdt' ? /^(trc20|erc20)[:/]/i.exec(account) : null
  const network = networkPrefix?.[1].toLowerCase()
  if (networkPrefix) account = account.slice(networkPrefix[0].length)
  if ((!scheme || scheme === 'tron' || scheme === 'usdt' && network !== 'erc20') && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(account)) {
    return { ...qr, qrScheme: 'CRYPTO_WALLET', account, walletNetwork: 'TRC20', providerLabel: scheme === 'usdt' ? 'USDT TRC20' : 'TRON' }
  }
  if (scheme === 'ethereum') {
    const target = /^((?:pay-)?0x[a-f0-9]{40})(?:@\d+)?(\/transfer)?$/i.exec(account)
    if (!target) return null
    account = target[2] ? new URLSearchParams(uri?.[3]).get('address') ?? '' : target[1].replace(/^pay-/i, '')
  }
  if ((!scheme || scheme === 'ethereum' || scheme === 'usdt' && network !== 'trc20') && /^0x[a-f0-9]{40}$/i.test(account)) {
    return { ...qr, qrScheme: 'CRYPTO_WALLET', account, walletNetwork: 'ERC20', providerLabel: scheme === 'usdt' ? 'USDT ERC20' : 'Ethereum' }
  }
  const legacyBitcoin = /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(account) && isValidBitcoinLegacy(account)
  const segwit = /^bc1[ac-hj-np-z02-9]{11,71}$/i.test(account)
    && (account === account.toLowerCase() || account === account.toUpperCase())
  if ((!scheme || scheme === 'bitcoin') && (legacyBitcoin || segwit)) {
    return { ...qr, qrScheme: 'CRYPTO_WALLET', account, walletNetwork: 'BTC', providerLabel: 'Bitcoin' }
  }
  return null
}

export function parseAnyQr(raw: string): ParsedQr | null {
  const payload = raw.trim()
  if (!payload || payload.length > 4096 || payload.includes('\0')) return null
  const qr = emptyQr(payload)
  const emv = parseEmv(payload)
  if (emv) return parseEmvQr(qr, emv.fields, emv.crcValid)
  return parseWalletPipe(qr) ?? parseQrUrl(qr) ?? parseCryptoQr(qr) ?? qr
}

export function findCryptoWallets(text: string): ParsedQr[] {
  const context = text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd')
  if (!/\b(?:chuyen|gui|nap|thanh toan|dia chi vi|crypto|usdt|trc.?20|erc.?20|btc|bitcoin|eth|ethereum|tron)\b/i.test(context)) return []
  const tokens = text.match(/(?<![\p{L}\p{N}])(?:(?:bitcoin|ethereum|tron|usdt):[^\s<>"'()[\],;]+|(?:0x[a-f0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|[13][1-9A-HJ-NP-Za-km-z]{25,34}|bc1[ac-hj-np-z02-9]{11,71}))(?![\p{L}\p{N}])/giu) ?? []
  return tokens.map((token) => parseCryptoQr(emptyQr(token.replace(/[.!?]+$/u, '')))).filter((qr) => qr !== null)
}

let readerConfigured = false

async function readQrTexts(image: Buffer): Promise<string[]> {
  if (!readerConfigured) {
    const wasm = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'))
    prepareZXingModule({ overrides: { wasmBinary: Uint8Array.from(wasm).buffer } })
    readerConfigured = true
  }
  const normalized = await sharp(image, { limitInputPixels: 25_000_000 })
    .rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .grayscale().normalize().png().toBuffer()
  try {
    const codes = await readBarcodes(normalized, { formats: ['QRCode'], maxNumberOfSymbols: 0, textMode: 'Plain' })
    return [...new Set(codes.map(({ text }) => text))]
  } finally {
    normalized.fill(0)
  }
}

export async function decodeVietQr(image: Buffer): Promise<ParsedVietQr | null> {
  const parsed = (await readQrTexts(image)).map(parseVietQr).filter((qr) => qr !== null)
  return parsed.find((qr) => qr.crcValid) ?? parsed[0] ?? null
}

export async function decodeAnyQrs(image: Buffer): Promise<ParsedQr[]> {
  return (await readQrTexts(image)).map(parseAnyQr).filter((qr) => qr !== null)
}
