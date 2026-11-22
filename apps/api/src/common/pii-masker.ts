// Keep only the first and last three digits of contiguous Vietnamese phones and CCCDs.
export function maskPii(text: string): string {
  return text.replace(
    /(?<!\d)(\d{3})(\d{6}|\d{4})(\d{3})(?!\d)/g,
    (match: string, first: string, middle: string, last: string) => {
      if (match.length === 10 && !match.startsWith('0')) return match
      return first + '*'.repeat(middle.length) + last
    },
  )
}
