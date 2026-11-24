import { readFileSync } from 'node:fs'
import { loadImage, PDFDocument, type SKRSContext2D } from '@napi-rs/canvas'
import sharp from 'sharp'
import { prepareZXingModule, writeBarcode } from 'zxing-wasm/writer'

const tlv = (tag: string, value: string) => tag + String([...value].length).padStart(2, '0') + value
function withCrc(value: string) {
  const raw = value + '6304'
  let crc = 0xffff
  for (const byte of Buffer.from(raw)) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff
  }
  return raw + crc.toString(16).toUpperCase().padStart(4, '0')
}

export function vietQr(purpose: string, amount?: string) {
  const bank = tlv('00', 'A000000727') + tlv('01', tlv('00', '970436') + tlv('01', 'TEST0001')) + tlv('02', 'QRIBFTTA')
  return withCrc(tlv('00', '01') + tlv('38', bank) + tlv('53', '704') + (amount ? tlv('54', amount) : '') +
    tlv('58', 'VN') + tlv('62', tlv('08', purpose)))
}

export function emvQr(mcc: string, currency: string, country: string, scheme: string) {
  return withCrc(tlv('00', '01') + (/^\d{2}$/.test(scheme) ? tlv(scheme, 'TEST0001') : tlv('26', tlv('00', scheme))) +
    tlv('52', mcc) + tlv('53', currency) + tlv('54', '30') + tlv('58', country) + tlv('59', 'BENCHMARK DEMO'))
}

export function walletQr(provider: string, dual = false) {
  const wallet = tlv('26', tlv('00', provider) + tlv('01', 'DEMOONLY'))
  const bank = tlv('00', 'A000000727') + tlv('01', tlv('00', '970436') + tlv('01', 'TEST0001')) + tlv('02', 'QRIBFTTA')
  return withCrc(tlv('00', '01') + wallet + (dual ? tlv('38', bank) : '') + tlv('53', '704') + tlv('58', 'VN'))
}

export const addresses = {
  tron: 'tron:TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL',
  ethereum: 'ethereum:0x0000000000000000000000000000000000000001',
  legacy: 'bitcoin:1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
  segwit: 'bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
}
export const apk = 'https://vneid-kiemtra.example/xac-minh.apk'
export const loanLines = {
  flat: ['Khoản vay 50 000 000 đồng', 'Kỳ hạn 12 tháng', 'Lãi phẳng 0,9%/tháng', 'Phí thu trước 5 000 000 đồng'],
  steps: ['Khoản vay 50 000 000 đồng', 'Kỳ hạn 12 tháng', 'Lãi phẳng trên dư nợ ban đầu',
    '3 tháng đầu 0,8%/tháng', '9 tháng sau 2,2%/tháng', 'Phí quản lý 200 000 đồng/tháng'],
  retro: 'Nếu trễ hạn dù 1 ngày sẽ mất ưu đãi, áp dụng 2,2%/tháng cho cả 12 tháng.',
  declining: ['Khoản vay 30 000 000 đồng', 'Kỳ hạn 12 tháng', 'Lãi trên dư nợ giảm dần 1%/tháng', 'Phí quản lý 250 000 đồng/tháng'],
  floating: ['Khoản vay 45 000 000 đồng', 'Kỳ hạn 24 tháng', 'Lãi suất thả nổi theo biểu từng thời kỳ, không ghi trần lãi suất.'],
  insurance: ['Khoản vay 20 000 000 đồng', 'Kỳ hạn 12 tháng', 'Lãi phẳng 1%/tháng', 'Bắt buộc mua bảo hiểm kèm khoản vay.'],
  daily: ['Khoản vay 10 000 000 đồng', 'Kỳ hạn 30 ngày', 'Trả góp 400 000 đồng mỗi ngày', 'Tổng phải trả 12 000 000 đồng'],
}

export interface SyntheticFixture {
  format: 'png' | 'pdf' | 'scan'
  lines: string[]
  probes: string[]
  qrs?: string[]
  pageBreak?: number
}
export const benchmarkFixtures = {
  'flat-png': { format: 'png', lines: loanLines.flat, probes: ['50 000 000', '12 tháng', '0,9%', '5 000 000'] },
  'steps-png': { format: 'png', lines: loanLines.steps, probes: ['50 000 000', '3 tháng', '0,8%', '2,2%', '200 000'] },
  'retro-png': { format: 'png', lines: [...loanLines.steps, loanLines.retro], probes: ['trễ hạn', '1 ngày', 'mất ưu đãi', '2,2%'] },
  'fee-png': { format: 'png', lines: loanLines.declining, probes: ['30 000 000', 'dư nợ giảm dần', '250 000'] },
  'float-png': { format: 'png', lines: loanLines.floating, probes: ['45 000 000', '24 tháng', 'thả nổi', 'trần lãi suất'] },
  'insurance-png': { format: 'png', lines: loanLines.insurance, probes: ['20 000 000', '12 tháng', 'bắt buộc mua bảo hiểm'] },
  'flat-pdf': { format: 'pdf', lines: loanLines.flat, probes: ['50 000 000', '12 tháng', '0,9%', '5 000 000'] },
  'retro-pdf': { format: 'pdf', lines: [...loanLines.steps, loanLines.retro], pageBreak: 4, probes: ['200 000', '2,2%', 'mất ưu đãi'] },
  'daily-pdf': { format: 'pdf', lines: loanLines.daily, probes: ['10 000 000', '400 000', '30 ngày', '12 000 000'] },
  'floating-pdf': { format: 'pdf', lines: loanLines.floating, probes: ['45 000 000', '24 tháng', 'thả nổi'] },
  'mixed-pdf': { format: 'pdf', lines: [...loanLines.steps, 'Cam kết không thu phí giải ngân.', loanLines.retro], pageBreak: 7,
    probes: ['50 000 000', '200 000', 'không thu phí giải ngân', 'mất ưu đãi'] },
  'scan-pdf': { format: 'scan', lines: loanLines.insurance, probes: ['20 000 000', '12 tháng', 'bắt buộc mua bảo hiểm'] },
  'tron-png': { format: 'png', lines: ['Yêu cầu nạp USDT để mở khóa rút lãi'], probes: ['USDT', 'mở khóa rút lãi'], qrs: [addresses.tron] },
  'eth-png': { format: 'png', lines: ['Địa chỉ ví Ethereum, mạng ERC-20'], probes: ['Ethereum', 'ERC-20'], qrs: [addresses.ethereum] },
  'legacy-png': { format: 'png', lines: ['Địa chỉ nhận Bitcoin'], probes: ['địa chỉ nhận', 'Bitcoin'], qrs: [addresses.legacy] },
  'segwit-png': { format: 'png', lines: ['Địa chỉ ví SegWit Bitcoin'], probes: ['SegWit', 'Bitcoin'], qrs: [addresses.segwit] },
  'apk-png': { format: 'png', lines: ['Trang giả lập yêu cầu cài đặt ứng dụng'], probes: ['cài đặt', 'ứng dụng'], qrs: [apk] },
  'visa-png': { format: 'png', lines: ['Visa · 30 USD · MCC 7995'], probes: ['Visa', '30 USD', '7995'], qrs: [emvQr('7995', '840', 'US', '02')] },
  'multi-png': { format: 'png', lines: ['Ba mã VietQR, Visa và PromptPay'], probes: ['VietQR', 'Visa', 'PromptPay'],
    qrs: [vietQr('TIEN AN'), emvQr('6051', '840', 'US', '02'), emvQr('5812', '764', 'TH', 'A000000677010111')] },
  'zalo-png': { format: 'png', lines: ['ZaloPay · mã nhận tiền cá nhân'], probes: ['ZaloPay', 'cá nhân'], qrs: [walletQr('VN.ZALOPAY', true)] },
} satisfies Record<string, SyntheticFixture>
export type FixtureKey = keyof typeof benchmarkFixtures

const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
let writerReady = false
async function png(fixture: SyntheticFixture) {
  const codes = fixture.qrs ?? []
  const height = 104 + fixture.lines.length * 45 + (codes.length ? 290 : 35)
  const lines = fixture.lines.map((line, index) =>
    '<text x="40" y="' + (92 + index * 45) + '">' + xml(line) + '</text>').join('')
  const base = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="' + height + '">' +
    '<rect width="1100" height="' + height + '" fill="white"/><g fill="#151b19" font-family="Arial, DejaVu Sans, sans-serif" font-size="27">' +
    '<text x="40" y="43" font-weight="bold">HỒ SƠ MẪU · BENCHMARK</text>' + lines + '</g></svg>')
  const keyed = sharp(base)
  if (!codes.length) return keyed.png().toBuffer()
  if (!writerReady) {
    const bytes = readFileSync(require.resolve('zxing-wasm/writer/zxing_writer.wasm'))
    prepareZXingModule({ overrides: { wasmBinary: Uint8Array.from(bytes).buffer } })
    writerReady = true
  }
  const images = await Promise.all(codes.map(async (data, index) => {
    const result = await writeBarcode(data, { format: 'QRCode', scale: 5, addQuietZones: true })
    if (!result.image) throw new Error('ZXing could not render the fixture QR')
    const image = Buffer.from(await result.image.arrayBuffer())
    return { input: image, left: 40 + index * 350, top: 108 + fixture.lines.length * 45 }
  }))
  return keyed.composite(images).png().toBuffer()
}

export async function createFixture(key: FixtureKey): Promise<Buffer> {
  const fixture: SyntheticFixture = benchmarkFixtures[key]
  if (fixture.format === 'png') return png(fixture)
  const pdf = new PDFDocument({ title: 'Hồ sơ giám định tổng hợp' })
  if (fixture.format === 'scan') {
    const source = await png(fixture)
    try {
      const image = await loadImage(source)
      // The native PDF canvas supports image drawing even though beginPage's declaration omits it.
      const page = pdf.beginPage(595, 842) as SKRSContext2D
      page.drawImage(image, 18, 40, 559, image.height * 559 / image.width)
      pdf.endPage()
    } finally {
      source.fill(0)
    }
  } else {
    const pages = fixture.pageBreak ? [fixture.lines.slice(0, fixture.pageBreak), fixture.lines.slice(fixture.pageBreak)] : [fixture.lines]
    for (const lines of pages) {
      const page = pdf.beginPage(595, 842)
      page.font = '15px Arial, DejaVu Sans, sans-serif'
      page.fillText('HỒ SƠ MẪU — BỘ ĐÁNH GIÁ GIÁM ĐỊNH', 34, 56)
      lines.forEach((line, index) => page.fillText(line, 34, 98 + index * 33, 527))
      pdf.endPage()
    }
  }
  return pdf.close()
}
