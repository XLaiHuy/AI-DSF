export type ReadingEntry = { id: string; title: string; publishedAt: string | null; sourceName: string | null; seenAt: string }

const savedKey = 'fincopilot.radar.saved.v1'
const historyKey = 'fincopilot.radar.history.v1'
export const readingStoreEvent = 'fincopilot:reading-store'

function read(key: string): ReadingEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is ReadingEntry => Boolean(item) && typeof item === 'object' && typeof item.id === 'string' && typeof item.title === 'string').slice(0, 100)
  } catch { return [] }
}

function write(key: string, entries: ReadingEntry[]): boolean {
  if (typeof window === 'undefined') return false
  try {
    localStorage.setItem(key, JSON.stringify(entries.slice(0, 100)))
    window.dispatchEvent(new Event(readingStoreEvent))
    return true
  } catch {
    return false
  }
}

export const getSavedArticles = () => read(savedKey)
export const getReadingHistory = () => read(historyKey)

export function toggleSavedArticle(entry: Omit<ReadingEntry, 'seenAt'>): boolean {
  const items = read(savedKey)
  return write(savedKey, items.some((item) => item.id === entry.id) ? items.filter((item) => item.id !== entry.id) : [{ ...entry, seenAt: new Date().toISOString() }, ...items])
}

export function recordArticleRead(entry: Omit<ReadingEntry, 'seenAt'>): boolean {
  return write(historyKey, [{ ...entry, seenAt: new Date().toISOString() }, ...read(historyKey).filter((item) => item.id !== entry.id)])
}
