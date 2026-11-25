export function stripZeroWidthAndBidi(raw: string) {
  return raw.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
}

export function stripSpoofedBoundaryTags(raw: string) {
  return stripZeroWidthAndBidi(raw).replace(/<\s*\/?\s*(?:untrusted_data[\w-]*|system|developer)(?=[\s>"']|$)(?:[^\n<>"']*>|\s*)/gi, '')
}
