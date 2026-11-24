import { maskAccount, maskPii } from '../../common/pii-masker'

const knownSegments = /^(?:login|log-in|signin|sign-in|otp|kyc|verify|verification|install|download|auth|xac-minh|dang-nhap|payment|pay)$/i
const httpLink = /https?:\/\/[^\s<>"'()[\]]+/giu

function decodedPath(url: URL) {
  let path = url.pathname
  for (let step = 0; step < 3 && path.includes('%'); step += 1) {
    try {
      const decoded = decodeURIComponent(path)
      if (path === decoded) break
      path = decoded
    } catch {
      break
    }
  }
  return path
}

export function isApkLink(url: URL): boolean {
  const path = decodedPath(url)
  return /\.apk(?:$|[/;?#])/i.test(path) || [...url.searchParams.values()].some((value) =>
    /\.apk(?:$|[/;?#])/i.test(value))
}

export function suspiciousQrLink(value: string, context: string): boolean {
  const url = URL.parse(value)
  if (!url || !['https:', 'http:'].includes(url.protocol)) return false
  if (isApkLink(url) || url.username || url.password) return true
  const authOrInstall = /(?:^|[/.=_-])(?:login|signin|otp|kyc|verify|xac-minh|dang-nhap|download|install)(?:$|[/.=_-])/i
  return authOrInstall.test(url.hostname + decodedPath(url)) &&
    /\b(?:otp|cccd|sinh trac hoc|mat khau|cai dat|tai ung dung|mo khoa)\b/i.test(context)
}

// Keep host and useful route hints, without query values, credentials or opaque identifiers.
export function maskedQrLink(value: string): string {
  const url = URL.parse(value)
  if (!url || !['https:', 'http:'].includes(url.protocol)) return '[đường dẫn đã che]'
  const path = decodedPath(url).split('/').map((part) => {
    if (!part || knownSegments.test(part)) return part
    return /\.apk$/i.test(part) ? '….apk' : '…'
  }).join('/')
  return url.origin + path + (url.search ? '?…' : '') + (url.hash ? '#…' : '')
}

export function maskForensicText(value: string): string {
  return maskPii(value.replaceAll('\0', '').replace(httpLink, maskedQrLink)
    .replace(/(?<![a-z0-9])(?:0x[a-f0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|[13][1-9A-HJ-NP-Za-km-z]{25,34}|bc1[ac-hj-np-z02-9]{11,71})(?![a-z0-9])/gi, maskAccount))
    .replace(/\b((?:OTP|PIN|CVV|CVC)\s*(?:là\s+|[:=]\s*)?)\d{3,8}\b/giu, '$1***')
}
