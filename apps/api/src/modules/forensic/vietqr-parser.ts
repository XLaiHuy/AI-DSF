import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import type { QrServiceCode } from '@fincopilot/shared-types'
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

export function parseVietQr(raw: string): ParsedVietQr | null {
  const payload = raw.trim()
  if (payload.length > 4096 || !/6304[0-9a-f]{4}$/i.test(payload)) return null
  const fields = parseTlv(payload)
  if (!fields || fields.get('00') !== '01' || fields.get('53') !== '704' || fields.get('58') !== 'VN') return null
  if (!fields.has('63') || payload.includes('\0')) return null
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
  if (!extra || (amountVnd !== null && !/^\d{1,13}(?:\.\d{1,2})?$/.test(amountVnd))) return null

  return {
    raw: payload,
    acqBin,
    bankName: bankNameForBin(acqBin),
    account,
    serviceCode: service === 'QRIBFTTA' || service === 'QRIBFTTC' ? service : 'MERCHANT',
    amountVnd,
    purpose: extra.get('08') ?? null,
    crcValid: fields.get('63')?.toUpperCase() === crc16(payload.slice(0, -4)),
  }
}

let readerConfigured = false

export async function decodeVietQr(image: Buffer): Promise<ParsedVietQr | null> {
  if (!readerConfigured) {
    const wasm = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'))
    prepareZXingModule({ overrides: { wasmBinary: Uint8Array.from(wasm).buffer } })
    readerConfigured = true
  }
  const normalized = await sharp(image, { limitInputPixels: 25_000_000 })
    .rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .grayscale().normalize().png().toBuffer()
  try {
    const codes = await readBarcodes(normalized, { formats: ['QRCode'], maxNumberOfSymbols: 8 })
    const parsed = codes.map(({ text }) => parseVietQr(text)).filter((qr) => qr !== null)
    return parsed.find((qr) => qr.crcValid) ?? parsed[0] ?? null
  } finally {
    normalized.fill(0)
  }
}
