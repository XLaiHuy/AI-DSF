export function maskAccount(account: string): string {
  if (account.length <= 6) return '*'.repeat(account.length)
  return account.slice(0, 3) + '*'.repeat(account.length - 6) + account.slice(-3)
}

export function maskPii(text: string): string {
  return text
    .replace(/([\p{L}\p{N}._%+'-]+)@([\p{L}\p{N}.-]+\.[\p{L}]{2,})/gu,
      (_match, local: string, domain: string) => Array.from(local)[0] + '***@' + domain)
    .replace(/((?:CCCD|CMND|căn\s+cước(?:\s+công\s+dân)?|STK|số\s+tài\s+khoản|tài\s+khoản(?:\s+ngân\s+hàng)?)\s*[:#]?\s*)(\d(?:[ .-]?\d){7,22})(?!\d)/giu,
      (_match, label: string, digits: string) => label + maskAccount(digits.replace(/[ .-]/g, '')))
    .replace(/((?:STK|số\s+tài\s+khoản|tài\s+khoản)\s*[:#]?\s*)([a-z]{1,8}\d{5,24})(?![\da-z])/giu,
      (_match, label: string, account: string) => label + maskAccount(account))
    .replace(/(?<![\d+])(?:\+84|0084)[ .-]?[35789](?:[ .-]?\d){8}(?!\d)/g, (match) => {
      const digits = match.replace(/[ .-]/g, '')
      const prefix = digits.startsWith('+84') ? '+84' : '0084'
      const national = digits.slice(prefix.length)
      return prefix + national.slice(0, 2) + '****' + national.slice(-3)
    })
    .replace(/(?<![\d+])0[ .-]?[35789](?:[ .-]?\d){8}(?![ .-]?\d)/g,
      (match) => maskAccount(match.replace(/[ .-]/g, '')))
    .replace(/(?<!\d)\d{10,23}(?!\d)/g, maskAccount)
}
