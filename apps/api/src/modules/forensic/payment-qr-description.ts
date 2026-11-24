import type { ParsedQr } from './vietqr-parser'

type Channel = Partial<Pick<ParsedQr, 'qrScheme' | 'providerLabel' | 'bankName' | 'walletNetwork'>>

export function describePaymentQr(qr: Channel) {
  switch (qr.qrScheme) {
    case 'VIETQR_NAPAS': return qr.bankName ? 'mã VietQR (' + qr.bankName + ')' : 'mã VietQR'
    case 'EWALLET_VN': return qr.providerLabel ? 'mã ví điện tử ' + qr.providerLabel : 'mã ví điện tử'
    case 'EMVCO_INTL': return 'mã QR thanh toán quốc tế (EMVCo)'
    case 'CRYPTO_WALLET': return qr.walletNetwork ? 'mã ví tiền mã hóa (' + qr.walletNetwork + ')' : 'mã ví tiền mã hóa'
    case 'URL_LINK': return 'đường dẫn trong mã QR'
    default: return 'mã QR thanh toán'
  }
}

export function formatCaseAmount(value: string, currency = 'VND') {
  const [whole, fraction] = value.split('.')
  const decimal = fraction?.replace(/0+$/, '')
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (decimal ? ',' + decimal : '') + ' ' + (currency === 'VND' ? 'đ' : currency)
}

export function describeCasePayment(qr: Channel & {
  qrAmountVnd?: string | null; amount?: string | null; currencyCode?: string | null; purposeText?: string | null
}) {
  const amount = qr.qrAmountVnd ?? qr.amount
  const currency = qr.qrAmountVnd != null ? 'VND' : qr.currencyCode
  return describePaymentQr(qr) + (amount && currency ? ', số tiền ' + formatCaseAmount(amount, currency) : '')
    + (qr.purposeText ? ', nội dung “' + qr.purposeText + '”' : '')
}
