import { BlockList, isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { ThreatIndicatorInput } from '@fincopilot/shared-types'
import { normalizeVietnamese } from '../forensic/data/trusted-institutions'
import { matchIndicator } from '../forensic/hard-rules.engine'
import { canonicalIoc, extractThreatIocs } from '../forensic/threat-iocs'
import { parseAnyQr } from '../forensic/vietqr-parser'

const genericKeywords = new Set(['chuyen khoan', 'ngan hang', 'momo', 'vay tien', 'otp', 'tai khoan', 'lai suat', 'tin dung', 'bao hiem'])
export const safeCases = [
  'Tôi muốn hỏi ngân hàng về biểu phí thẻ và hạn mức chuyển khoản.',
  'Tôi trả tiền ăn cho bạn qua VietQR bằng ứng dụng ngân hàng.',
  'Tôi đang xem lãi suất tiết kiệm kỳ hạn sáu tháng.',
  'Tôi muốn chuyển khoản giữa hai tài khoản của mình. Tài khoản gửi trong ví dụ là 1234567890123.',
  'Tôi cần sao kê để đối chiếu khoản thanh toán tiền điện.',
  'Tôi muốn biết phí trả nợ trước hạn của khoản vay mua nhà.',
  'Tôi khóa thẻ trên ứng dụng chính thức khi làm mất ví.',
  'Ngân hàng nhắc tôi không chia sẻ mã OTP.',
  'Tôi đăng ký nhận lương qua tài khoản tại ngân hàng.',
  'Tôi thanh toán dư nợ thẻ theo thông tin trên sao kê.',
  'Tôi kiểm tra số dư ví MoMo trước khi mua vé.',
  'Tôi muốn hỏi tổng đài chính thức về quy trình giải ngân và tham khảo vietcombank.com.vn.',
]

export function normalizeThreatIndicator(input: ThreatIndicatorInput): ThreatIndicatorInput | undefined {
  const { indicatorType, indicatorText } = input
  if (indicatorType === 'KEYWORD') {
    const normalized = normalizeVietnamese(indicatorText)
    if (normalized.length < 8 || !normalized.includes(' ') || genericKeywords.has(normalized)) return undefined
    return { indicatorType, indicatorText: indicatorText.trim() }
  }
  if (indicatorType === 'QR_PATTERN') {
    return indicatorText.trim().length >= 12 ? { indicatorType, indicatorText: indicatorText.trim() } : undefined
  }
  const normalized = canonicalIoc(indicatorType, indicatorText)
  return normalized ? { indicatorType, indicatorText: normalized } : undefined
}

export function runSafetyShadowTest(indicators: readonly ThreatIndicatorInput[], message?: string,
  fingerprint?: (type: string, value: string) => string) {
  function probe(text: string) {
    const normalized = ' ' + normalizeVietnamese(text) + ' '
    const qr = indicators.some(({ indicatorType }) => indicatorType === 'QR_PATTERN' || indicatorType === 'CRYPTO_WALLET')
      ? parseAnyQr(text.trim()) : null
    const hashed = fingerprint && indicators.some(({ indicatorText }) => indicatorText.startsWith('sha256:'))
      ? new Set(extractThreatIocs(text, qr ? [{ ...qr, visionBeneficiaryName: null }] : [])
        .map(({ indicatorType, indicatorText }) => fingerprint(indicatorType, indicatorText)))
      : new Set<string>()
    return { text, indicators: indicators.filter((indicator) => indicator.indicatorType === 'KEYWORD'
      ? normalized.includes(' ' + normalizeVietnamese(indicator.indicatorText) + ' ')
      : hashed.has(indicator.indicatorText) || Boolean(matchIndicator({ id: '', ...indicator }, qr ? [qr] : [], [text]))).map(({ indicatorText }) => indicatorText) }
  }
  const hits = safeCases.map(probe).filter((result) => result.indicators.length > 0)
  return { passed: hits.length === 0, safeCases: safeCases.length, hits, custom: message ? probe(message) : null }
}

const blocked = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) blocked.addSubnet(network, prefix)
for (const [network, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16]] as const) {
  blocked.addSubnet(network, prefix, 'ipv6')
}
const globalIpv6 = new BlockList()
globalIpv6.addSubnet('2000::', 3, 'ipv6')

function isPublicAddress(address: string) {
  const family = isIP(address)
  return family === 4 ? !blocked.check(address) :
    family === 6 && globalIpv6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
}

type ResolveAddresses = (host: string, options: { all: true }) => Promise<{ address: string; family: number }[]>
export async function resolvePublicTarget(url: URL, resolve: ResolveAddresses = lookup) {
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !host ||
      (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) ||
      /(?:^|\.)(?:localhost|local|internal|home|test|invalid)$/i.test(host)) throw new Error('URL không được phép.')
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host, { all: true })
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('Địa chỉ mạng không được phép.')
  return addresses.find(({ family }) => family === 4) ?? addresses[0]
}

export async function fetchPublicDocument(raw: string) {
  let url = new URL(raw)
  const signal = AbortSignal.timeout(10_000)
  for (let hop = 0; hop < 4; hop += 1) {
    const { address, family } = await resolvePublicTarget(url)
    signal.throwIfAborted()
    const next = await new Promise<{ redirect: string } | { text: string }>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        agent: false, signal, family,
        // Use the validated address for the connection while preserving the original TLS hostname.
        lookup: (_host, _options, callback) => callback(null, address, family),
        headers: {
          accept: 'text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml,text/xml,text/plain',
          'accept-language': 'vi-VN,vi;q=0.9',
          'user-agent': 'Mozilla/5.0 (compatible; FinCopilotThreatReview/1.0)',
        },
      }, (response) => {
        response.on('error', reject)
        const status = response.statusCode ?? 0
        if (status >= 300 && status < 400 && response.headers.location) {
          response.destroy()
          resolve({ redirect: response.headers.location })
          return
        }
        const contentType = response.headers['content-type'] ?? ''
        if (status !== 200 || !/^(?:text\/|application\/(?:xml|rss\+xml|atom\+xml|xhtml\+xml))/i.test(contentType)) {
          response.destroy()
          reject(new Error('Nguồn không trả về nội dung văn bản hợp lệ.'))
          return
        }
        const chunks: Buffer[] = []
        let bytes = 0
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > 1_000_000) response.destroy(new Error('Nội dung nguồn vượt quá giới hạn.'))
          else chunks.push(chunk)
        })
        response.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8') }))
      })
      request.on('error', reject)
      request.end()
    })
    if ('text' in next) return { text: next.text, url: url.toString() }
    url = new URL(next.redirect, url)
  }
  throw new Error('Nguồn chuyển hướng quá nhiều lần.')
}

export function stripDocument(value: string) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d{1,7}|#x[\da-f]{1,6});/gi, (entity) => {
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
      const token = entity.slice(1, -1).toLowerCase()
      if (!token.startsWith('#')) return named[token] ?? ' '
      const point = token.startsWith('#x') ? parseInt(token.slice(2), 16) : parseInt(token.slice(1), 10)
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' '
    }).replace(/\s+/g, ' ').trim()
}

export function articleBody(html: string) {
  const clean = html.replace(/<(header|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
  const article = /<article\b[^>]*>([\s\S]*?)<\/article\s*>/i.exec(clean)?.[1]
  const main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(clean)?.[1]
  return stripDocument(article ?? main ?? clean).slice(0, 12_000)
}
