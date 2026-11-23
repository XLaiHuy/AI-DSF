import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { prepareZXingModule, writeBarcode } from 'zxing-wasm/writer'
import { decodeAnyQrs, decodeVietQr, parseAnyQr, parseVietQr } from './vietqr-parser'

const qr1 = '00020101021238540010A00000072701240006970422011009876543210208QRIBFTTA5303704540725000005802VN62250821PHI GIAI NGAN LOI 1026304CA92'
const qr2 = '00020101021138540010A00000072701240006970436011010123456780208QRIBFTTA53037045802VN62230819COC HO SO VAY NHANH630415DB'
const momo = '2|99|0901000001|Nguyen Thanh|fixture@example.test|0|0|transfer_myqr'
const apkUrl = 'https://financial-check.example.test/setup/update.apk'
const tron = 'T' + 'Ab7'.repeat(11)

function tlv(tag: string, value: string): string {
  return tag + String(Array.from(value).length).padStart(2, '0') + value
}

function emv(...fields: string[]): string {
  const body = '000201' + fields.join('') + '6304'
  let checksum = 0xffff
  for (const byte of Buffer.from(body)) {
    checksum ^= byte << 8
    for (let bit = 0; bit < 8; bit++) checksum = ((checksum << 1) ^ ((checksum & 0x8000) ? 0x1021 : 0)) & 0xffff
  }
  return body + checksum.toString(16).toUpperCase().padStart(4, '0')
}

describe('universal QR parsing', () => {
  it.each([
    [qr1, 'MBBank', '2500000'],
    [qr2, 'Vietcombank', null],
  ])('preserves legacy VietQR and adds NAPAS metadata', (raw, bankName, amount) => {
    expect(parseVietQr(raw)).toMatchObject({ bankName, crcValid: true, amountVnd: amount })
    expect(parseAnyQr(raw)).toMatchObject({
      qrScheme: 'VIETQR_NAPAS', providerLabel: bankName, crcValid: true, currencyCode: 'VND', countryCode: 'VN', amount,
    })
  })

  it('retains the legacy invalid CRC result', () => {
    const corrupted = qr1.slice(0, -1) + '0'
    expect(parseVietQr(corrupted)?.crcValid).toBe(false)
    expect(parseAnyQr(corrupted)).toMatchObject({ qrScheme: 'VIETQR_NAPAS', crcValid: false })
  })

  it.each(['0800', '0805ABC'])('accepts VietQR with malformed additional data %s', (extra) => {
    const raw = emv(qr1.slice(6, qr1.indexOf('6225')), tlv('62', extra))
    const expected = { account: '0987654321', amountVnd: '2500000', purpose: null, crcValid: true }
    expect(parseVietQr(raw)).toMatchObject(expected)
    expect(parseAnyQr(raw)).toMatchObject({ ...expected, qrScheme: 'VIETQR_NAPAS' })

    const tampered = raw.slice(0, -1) + (raw.endsWith('0') ? '1' : '0')
    expect(parseVietQr(tampered)).toMatchObject({ ...expected, crcValid: false })
    expect(parseAnyQr(tampered)).toMatchObject({ qrScheme: 'VIETQR_NAPAS', purpose: null, crcValid: false })
  })

  it('identifies the native MoMo transfer and extracts its recipient', () => {
    expect(parseAnyQr(momo)).toMatchObject({
      qrScheme: 'EWALLET_VN', providerLabel: 'MoMo', account: '0901000001',
      merchantName: 'Nguyen Thanh', currencyCode: 'VND', countryCode: 'VN',
    })
  })

  it.each([
    ['momo://app?action=payWithApp', 'MoMo'],
    ['https://me.momo.vn/fixture', 'MoMo'],
    ['zalopay://app/transfer', 'ZaloPay'],
    ['https://social.zalopay.vn/fixture', 'ZaloPay'],
    ['https://pay.shopeepay.vn/fixture', 'ShopeePay'],
  ])('identifies wallet deep links and official domains', (payload, providerLabel) => {
    expect(parseAnyQr(payload)).toMatchObject({ qrScheme: 'EWALLET_VN', providerLabel })
    expect(parseAnyQr('https://me.momo.vn.example.test/pay')).toMatchObject({ qrScheme: 'URL_LINK' })
  })

  it.each([
    ['vn.momo', 'MoMo'], ['vn.zalopay', 'ZaloPay'], ['A000000775', 'VNPAY'], ['vn.shopeepay', 'ShopeePay'],
  ])('recognizes wallet identifiers in EMV merchant account templates', (aid, providerLabel) => {
    const raw = emv(tlv('38', tlv('00', aid) + tlv('01', 'MERCHANT1')), '5303704', '5802VN')
    expect(parseAnyQr(raw)).toMatchObject({ qrScheme: 'EWALLET_VN', providerLabel, crcValid: true })
    const badCrc = raw.slice(0, -1) + (raw.endsWith('0') ? '1' : '0')
    expect(parseAnyQr(badCrc)).toMatchObject({ qrScheme: 'UNKNOWN', providerLabel: null, crcValid: false })
  })

  it('keeps bank routing on ZaloPay merchant codes with a parallel NAPAS template', () => {
    const bankRouting = tlv('00', '970454') + tlv('01', 'ZPDEMO1')
    const raw = emv(
      tlv('26', tlv('00', 'vn.zalopay')),
      tlv('38', tlv('00', 'A000000727') + tlv('01', bankRouting) + tlv('02', 'QRIBFTTA')),
      '5303704', '540569000', '5802VN',
    )
    expect(parseAnyQr(raw)).toMatchObject({
      qrScheme: 'EWALLET_VN', providerLabel: 'ZaloPay', acqBin: '970454', account: 'ZPDEMO1',
      crcValid: true, amountVnd: '69000', serviceCode: 'QRIBFTTA',
    })
  })

  it.each([
    ['02', 'Visa'], ['04', 'Mastercard'], ['13', 'JCB'], ['15', 'UnionPay'], ['06', 'Discover'],
  ])('extracts international card network and exact USD amount', (id, providerLabel) => {
    const raw = emv(tlv(id, '123456789'), '5303840', '540512.34', '5802US', tlv('59', 'Demo Merchant'), tlv('62', tlv('08', 'Order 1')))
    expect(parseAnyQr(raw)).toMatchObject({
      qrScheme: 'EMVCO_INTL', providerLabel, currencyCode: 'USD', countryCode: 'US', crcValid: true,
      merchantName: 'Demo Merchant', purpose: 'Order 1', amount: '12.34', amountVnd: null,
    })
  })

  it.each([
    ['A000000677010111', 'PromptPay', '764', 'THB', 'TH'],
    ['SG.PAYNOW', 'PayNow', '702', 'SGD', 'SG'],
    ['A0000006150001', 'DuitNow', '458', 'MYR', 'MY'],
  ])('identifies international merchant template schemes', (aid, providerLabel, numeric, currencyCode, countryCode) => {
    const raw = emv(tlv('29', tlv('00', aid)), tlv('53', numeric), tlv('58', countryCode))
    expect(parseAnyQr(raw)).toMatchObject({ qrScheme: 'EMVCO_INTL', providerLabel, currencyCode, countryCode })
  })

  it('keeps URLs as data and removes URL user information from the target', () => {
    expect(parseAnyQr(apkUrl)).toMatchObject({
      qrScheme: 'URL_LINK', providerLabel: 'financial-check.example.test', targetUrl: apkUrl, crcValid: false,
    })
    expect(parseAnyQr('https://alice:secret@target.example.test/a')).toMatchObject({
      qrScheme: 'URL_LINK', targetUrl: 'https://target.example.test/a', providerLabel: 'target.example.test',
    })
    expect(parseAnyQr('javascript:alert(1)')).toMatchObject({ qrScheme: 'UNKNOWN', targetUrl: null })
    expect(parseAnyQr('https://a.example.test\\@b.example.test')).toMatchObject({ qrScheme: 'UNKNOWN', targetUrl: null })
  })

  it.each([
    ['usdt:trc20:' + tron, 'USDT TRC20', 'TRC20', tron],
    ['tron:' + tron, 'TRON', 'TRC20', tron],
    [tron, 'TRON', 'TRC20', tron],
    ['ethereum:0x' + 'a'.repeat(40) + '@1', 'Ethereum', 'ERC20', '0x' + 'a'.repeat(40)],
    ['bitcoin:1BoatSLRHtKNngkdXEeobR76b53LETtpyT?amount=0.02', 'Bitcoin', 'BTC', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'],
  ])('recognizes crypto wallet syntax without attempting transactions', (payload, providerLabel, walletNetwork, account) => {
    expect(parseAnyQr(payload)).toMatchObject({ qrScheme: 'CRYPTO_WALLET', providerLabel, walletNetwork, account })
  })

  it('rejects invalid payload bounds and avoids assigning an unknown format to a network', () => {
    expect(parseAnyQr(' ')).toBeNull()
    expect(parseAnyQr('x'.repeat(4097))).toBeNull()
    expect(parseAnyQr('https://example.test/\x00')).toBeNull()
    expect(parseAnyQr('usdt:invalid')).toMatchObject({ qrScheme: 'UNKNOWN', account: null })
    expect(parseAnyQr('usdt:erc20:' + tron)).toMatchObject({ qrScheme: 'UNKNOWN', account: null })
  })

  it('decodes multiple QR formats in one image while retaining the legacy single-code reader', async () => {
    const wasm = readFileSync(require.resolve('zxing-wasm/writer/zxing_writer.wasm'))
    prepareZXingModule({ overrides: { wasmBinary: Uint8Array.from(wasm).buffer } })
    const payloads = [
      qr1, momo, apkUrl, tron, qr2, 'https://me.momo.vn/fixture',
      'https://social.zalopay.vn/fixture', 'https://pay.shopeepay.vn/fixture', 'https://example.test/qr',
    ]
    const images = await Promise.all(payloads.map(async (payload, index) => {
      const { image } = await writeBarcode(payload, { format: 'QRCode', scale: 5 })
      if (!image) throw new Error('Fixture QR was not generated')
      return { input: Buffer.from(await image.arrayBuffer()), left: 16 + index % 3 * 250, top: 16 + Math.floor(index / 3) * 250 }
    }))
    const png = await sharp({ create: { width: 750, height: 750, channels: 3, background: 'white' } })
      .composite(images).png().toBuffer()
    const all = await decodeAnyQrs(png)
    expect(all.map(({ raw }) => raw).sort()).toEqual([...payloads].sort())
    const legacy = await decodeVietQr(png)
    expect(legacy?.crcValid).toBe(true)
    expect([qr1, qr2]).toContain(legacy?.raw)
  })
})
