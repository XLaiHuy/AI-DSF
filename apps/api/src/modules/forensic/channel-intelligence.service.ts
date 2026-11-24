import Decimal from 'decimal.js'
import { z } from 'zod'
import type { ChannelIntelligence } from '@fincopilot/shared-types'
import { matchIndicator, type Indicator } from './hard-rules.engine'
import { suspiciousQrLink } from './qr-evidence'
import type { ParsedQr } from './vietqr-parser'
import { cryptoPaymentNotice } from './data/vn-legal-registry'
const privateNotice = 'Thông tin tài khoản được bảo mật theo Điều 13 Luật Các tổ chức tín dụng 2024 và Nghị định 117/2018/NĐ-CP. FinCopilot đối chiếu cơ sở dữ liệu cảnh báo đã xác minh, dữ liệu định tuyến có trong mã và hành vi yêu cầu giao dịch. Bên thứ ba không có API sao kê công khai.'
const verifiedSource = 'CSDL cảnh báo đã xác minh (chuẩn SIMO / NCSC)'
const mccRisks = new Map([
  ['7995', 'Cờ bạc hoặc cá cược trực tuyến'], ['6051', 'Nạp tiền mã hóa hoặc giao dịch tương đương tiền mặt'],
  ['4829', 'Dịch vụ chuyển tiền'], ['6211', 'Môi giới chứng khoán hoặc đầu tư'], ['5967', 'Dịch vụ nội dung trực tiếp cần kiểm tra'],
])
const cryptoFlags = {
  phishing_activities: 'Lừa đảo lấy thông tin', money_laundering: 'Rửa tiền', cybercrime: 'Tội phạm mạng',
  stealing_attack: 'Chiếm đoạt tài sản', sanctioned: 'Danh sách trừng phạt', blackmail_activities: 'Tống tiền',
  financial_crime: 'Tội phạm tài chính', darkweb_transactions: 'Giao dịch trên mạng tối', fake_kyc: 'Xác minh danh tính giả',
}
const goPlus = z.object({ code: z.literal(1), result: z.record(z.string(), z.unknown()) })
const mempool = z.object({ chain_stats: z.object({
  tx_count: z.number().int().nonnegative(), funded_txo_sum: z.number().int().nonnegative(), spent_txo_sum: z.number().int().nonnegative(),
}) })
const blockscout = z.object({
  is_scam: z.boolean().optional(), is_contract: z.boolean(), coin_balance: z.string().regex(/^\d+$/).nullable(),
})
const openPhish = 'https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt'
const officialDomains = ['vietcombank.com.vn', 'vietinbank.vn', 'agribank.com.vn', 'bidv.com.vn', 'techcombank.com',
  'mbbank.com.vn', 'vpbank.com.vn', 'acb.com.vn', 'momo.vn', 'zalopay.vn', 'vnpay.vn', 'sbv.gov.vn', 'chinhphu.vn',
  'dichvucong.gov.vn', 'bocongan.gov.vn', 'vneid.gov.vn']

function suspiciousBrand(url: URL) {
  const host = url.hostname.replace(/\.$/, '')
  return !officialDomains.some((domain) => host === domain || host.endsWith('.' + domain)) &&
    /(?:vietcombank|vietinbank|agribank|bidv|techcombank|mbbank|vpbank|zalopay|vnpay|momo|dichvucong|bocongan|vneid|chinhphu)/i.test(host)
}

async function fetchSource<T>(url: string, read: (response: Response) => Promise<T>): Promise<T | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3500), redirect: 'error' })
    if (!response.ok) {
      await response.body?.cancel()
      return null
    }
    return await read(response)
  } catch {
    return null
  }
}

type PublicCheck = { source: string; summary: string; flags: string[]; flagged: boolean }

async function checkGoPlus(account: string, tron: boolean): Promise<PublicCheck | null> {
  const data = await fetchSource(
    'https://api.gopluslabs.io/api/v1/address_security/' + encodeURIComponent(account) + '?chain_id=' + (tron ? 'tron' : '1'),
    async (response) => goPlus.parse(await response.json()).result,
  )
  if (!data) return null
  const entries = Object.entries(cryptoFlags).filter(([key]) => data[key] === '1' || data[key] === 1)
  if (!Object.keys(cryptoFlags).some((key) => data[key] === '0' || data[key] === '1' || data[key] === 0 || data[key] === 1)) return null
  return { source: 'GoPlus', summary: entries.length ? 'GoPlus ghi nhận cờ rủi ro đối với địa chỉ ví.' : 'GoPlus chưa ghi nhận các cờ rủi ro được đối chiếu.',
    flags: entries.map(([, label]) => 'GoPlus: ' + label), flagged: entries.length > 0 }
}

async function checkBitcoin(account: string): Promise<PublicCheck | null> {
  const stats = await fetchSource('https://mempool.space/api/address/' + encodeURIComponent(account),
    async (response) => mempool.parse(await response.json()).chain_stats)
  if (!stats) return null
  const { tx_count, funded_txo_sum, spent_txo_sum } = stats
  const spentPercent = funded_txo_sum > 0 ? new Decimal(spent_txo_sum).div(funded_txo_sum).mul(100) : null
  const flag = tx_count === 0 ? 'Ví chưa có lịch sử giao dịch đã xác nhận.'
    : spentPercent?.gte(95) ? 'Đã chi ít nhất 95% số BTC nhận vào. Kiểm tra lịch sử trước khi giao dịch.'
      : null
  const summary = tx_count === 0 ? 'Mempool.space chưa ghi nhận giao dịch đã xác nhận.'
    : 'Mempool.space ghi nhận ' + tx_count.toLocaleString('vi-VN') + ' giao dịch đã xác nhận.' +
      (spentPercent ? ' Tỷ lệ đã chi trên tổng BTC nhận vào là ' + spentPercent.toDecimalPlaces(2).toFixed().replace('.', ',') + '%.' : '')
  return { source: 'Mempool.space', summary, flags: flag ? [flag] : [], flagged: false }
}

async function checkEthereum(account: string): Promise<PublicCheck | null> {
  const data = await fetchSource('https://eth.blockscout.com/api/v2/addresses/' + encodeURIComponent(account),
    async (response) => blockscout.parse(await response.json()))
  if (!data) return null
  const balance = data.coin_balance === null ? 'Chưa có dữ liệu số dư.'
    : 'Số dư ' + new Decimal(data.coin_balance).div('1000000000000000000').toFixed() + ' ETH.'
  return { source: 'Blockscout', summary: (data.is_contract ? 'Blockscout nhận diện địa chỉ hợp đồng. ' : 'Blockscout ghi nhận địa chỉ Ethereum. ') + balance,
    flags: data.is_scam ? ['Blockscout gắn cờ lừa đảo.'] : [], flagged: data.is_scam === true }
}

function urlKey(raw: string) {
  const url = URL.parse(raw)
  if (!url || !['https:', 'http:'].includes(url.protocol)) return null
  url.hash = ''
  url.username = ''
  url.password = ''
  return url.href
}

export type EnrichedQr<T extends ParsedQr> = T & { channelIntelligence: ChannelIntelligence; channelIndicatorId: string | null }

export class ChannelIntelligenceService {
  private readonly wallets = new Map<string, { expiresAt: number; value: Promise<PublicCheck[]> }>()
  private feed?: { expiresAt: number; value: Promise<Set<string> | null> }

  async inspect<T extends ParsedQr>(qrs: readonly T[], indicators: readonly Indicator[]): Promise<EnrichedQr<T>[]> {
    return Promise.all(qrs.map(async (qr) => {
      const indicator = indicators.find((item) => item.indicatorType !== 'KEYWORD' && matchIndicator(item, [qr], []))
      const intelligence = await this.channel(qr, Boolean(indicator))
      if (indicator) {
        intelligence.reputationStatus = 'FLAGGED_SCAM'
        intelligence.riskFlags.unshift('Trùng chỉ dấu trong cơ sở dữ liệu cảnh báo đã xác minh.')
      }
      return { ...qr, channelIntelligence: intelligence, channelIndicatorId: indicator?.id ?? null }
    }))
  }

  private walletChecks(account: string, network: string) {
    const key = network + ':' + account
    const cached = this.wallets.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.value
    const requests = network === 'BTC' ? [checkBitcoin(account)]
      : network === 'TRC20' ? [checkGoPlus(account, true)]
        : [checkGoPlus(account, false), checkEthereum(account)]
    const value = Promise.all(requests).then((results) => results.filter((result) => result !== null))
    this.wallets.delete(key)
    if (this.wallets.size >= 512) {
      const oldest = this.wallets.keys().next().value
      if (oldest) this.wallets.delete(oldest)
    }
    this.wallets.set(key, { expiresAt: Date.now() + 10 * 60_000, value })
    void value.then((results) => {
      if (!results.length && this.wallets.get(key)?.value === value) this.wallets.delete(key)
    })
    return value
  }

  private openPhishFeed() {
    if (this.feed && this.feed.expiresAt > Date.now()) return this.feed.value
    const value = fetchSource(openPhish, async (response) => {
      const entries = new Set((await response.text()).split(/\r?\n/).map((line) => urlKey(line.trim())).filter((url) => url !== null))
      return entries.size ? entries : null
    })
    this.feed = { expiresAt: Date.now() + 30 * 60_000, value }
    void value.then((entries) => { if (!entries && this.feed?.value === value) this.feed = undefined })
    return value
  }

  private async channel(qr: ParsedQr, matchedDatabase: boolean): Promise<ChannelIntelligence> {
    if (qr.qrScheme === 'CRYPTO_WALLET') {
      const checks = qr.account && qr.walletNetwork ? await this.walletChecks(qr.account, qr.walletNetwork) : []
      return {
        channelGroup: 'CRYPTO_WALLET', reputationStatus: checks.some(({ flagged }) => flagged) ? 'FLAGGED_SCAM' : 'HIGH_RISK_ANONYMOUS',
        sourceName: [...checks.map(({ source }) => source), ...(matchedDatabase ? [verifiedSource] : [])].join(' · ') || 'Nguồn dữ liệu blockchain công khai',
        checkedLive: checks.length > 0,
        activitySummary: checks.map(({ summary }) => summary).join(' ') || 'Chưa lấy được dữ liệu công khai của ví. Cần xác minh bên nhận trước khi cân nhắc giao dịch.',
        riskFlags: ['Địa chỉ ví không xác nhận người nhận. Khoản chuyển đã xác nhận thường khó thu hồi.', ...checks.flatMap(({ flags }) => flags)],
        legalNotice: cryptoPaymentNotice,
      }
    }
    if (qr.qrScheme === 'URL_LINK') {
      const url = qr.targetUrl && URL.parse(qr.targetUrl)
      const key = qr.targetUrl && urlKey(qr.targetUrl)
      const feed = key ? await this.openPhishFeed() : null
      const listed = Boolean(key && feed?.has(key))
      const flags = [
        listed ? 'URL trùng danh sách lừa đảo OpenPhish.' : '',
        url && suspiciousQrLink(qr.raw, '') ? 'Liên kết chứa tệp APK hoặc thông tin đăng nhập cài trong địa chỉ.' : '',
        url && suspiciousBrand(url) ? 'Tên miền có dấu hiệu mượn tên ngân hàng, ví điện tử hoặc cơ quan nhà nước.' : '',
      ].filter(Boolean)
      return {
        channelGroup: 'URL_LINK', reputationStatus: listed ? 'FLAGGED_SCAM' : flags.length || !feed ? 'HIGH_RISK_ANONYMOUS' : 'CLEAN_PUBLIC',
        sourceName: 'OpenPhish · ' + verifiedSource, checkedLive: feed !== null, riskFlags: flags,
        activitySummary: listed ? 'Liên kết có trong feed cảnh báo công khai.'
          : feed ? 'Chưa thấy liên kết trong feed OpenPhish. Kết quả có thể thay đổi theo thời điểm cập nhật.'
            : 'Chưa truy cập được feed OpenPhish. Hãy kiểm tra tên miền qua kênh chính thức.',
      }
    }
    if (qr.qrScheme === 'VIETQR_NAPAS' || qr.qrScheme === 'EWALLET_VN') {
      const riskFlags = qr.serviceCode === 'QRIBFTTA' && qr.amountVnd && new Decimal(qr.amountVnd).gte(10_000_000)
        ? ['Từ mốc 10 000 000 đ, hãy kiểm tra hạn mức và yêu cầu xác thực sinh trắc học trong ứng dụng chính thức theo hướng dẫn NHNN (QĐ 2345 và Thông tư 17–18/2024).'] : []
      return { channelGroup: qr.qrScheme === 'VIETQR_NAPAS' ? 'VIETQR_BANK' : 'EWALLET_VN', reputationStatus: 'UNVERIFIABLE_PRIVATE_BANK',
        sourceName: verifiedSource, checkedLive: false, activitySummary: privateNotice, riskFlags }
    }
    if (qr.qrScheme === 'EMVCO_INTL') {
      const mcc = qr.merchantCategoryCode && mccRisks.get(qr.merchantCategoryCode)
      return { channelGroup: 'EMVCO_CARD', reputationStatus: mcc ? 'HIGH_RISK_ANONYMOUS' : 'CLEAN_PUBLIC', sourceName: 'Dữ liệu EMVCo trong mã QR', checkedLive: false,
        activitySummary: 'Đối chiếu ngành nghề, tiền tệ và quốc gia khai báo trong mã. Danh tính và lịch sử giao dịch của đơn vị chấp nhận thanh toán cần được xác minh riêng.',
        riskFlags: [
          mcc ? 'MCC ' + qr.merchantCategoryCode + ': ' + mcc + '.' : '',
          qr.currencyCode !== 'VND' ? 'Kiểm tra tiền tệ và tỷ giá (' + (qr.currencyCode ?? 'chưa xác định') + ').' : '',
          qr.countryCode !== 'VN' ? 'Kiểm tra quốc gia của người nhận (' + (qr.countryCode ?? 'chưa xác định') + ').' : '',
        ].filter(Boolean) }
    }
    return { channelGroup: 'UNKNOWN', reputationStatus: 'HIGH_RISK_ANONYMOUS', sourceName: 'Phân loại mã QR', checkedLive: false,
      activitySummary: 'Chưa xác định được kênh giao dịch từ mã.', riskFlags: [] }
  }
}
