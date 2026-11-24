export function plainAuditText(text: string) {
  return text.replace(/\bRULE[\s_-]+\d+(?:[_-][A-Z0-9]+)*\b[ \t]*(?:[:–—][ \t]*)?/gi, '').trim()
}
