export function hasInternalIdentifierLeak(texts: readonly string[]) {
  return texts.some(text => {
    const normalized = text.normalize('NFKC').replace(/[\p{Cf}]/gu, '')
      .replace(/\b(?:FinCopilot|VietQR|VNeID|MoMo)\b/g, '')
    return /`|[a-z][A-Z]|[A-Za-z][A-Za-z0-9]*_[A-Za-z][A-Za-z0-9_]*|\b(?:Vnd|Pct)\b/u.test(normalized)
  })
}

export function stripZeroWidthAndBidi(raw: string) {
  return raw.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
}

export function stripSpoofedBoundaryTags(raw: string) {
  return stripZeroWidthAndBidi(raw).replace(/<\s*\/?\s*(?:untrusted_data[\w-]*|system|developer)(?=[\s>"']|$)(?:[^\n<>"']*>|\s*)/gi, '')
}
