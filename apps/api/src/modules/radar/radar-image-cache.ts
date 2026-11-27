import type { fetchPublicImage } from '../admin/threat-safety'

type ImageResponse = Awaited<ReturnType<typeof fetchPublicImage>>
const maxEntries = 60
const maxBytes = 25 * 1024 * 1024
const ttlMs = 30 * 60_000

export class RadarImageCache {
  private readonly entries = new Map<string, { image: ImageResponse; expiresAt: number }>()
  private bytes = 0

  get(url: string) {
    const entry = this.entries.get(url)
    if (!entry) return undefined
    if (Date.now() >= entry.expiresAt) {
      this.remove(url)
      return undefined
    }
    this.entries.delete(url)
    this.entries.set(url, entry)
    return entry.image
  }

  set(url: string, image: ImageResponse) {
    this.remove(url)
    if (image.buffer.byteLength > maxBytes) return
    this.entries.set(url, { image, expiresAt: Date.now() + ttlMs })
    this.bytes += image.buffer.byteLength
    for (const key of this.entries.keys()) {
      if (this.entries.size <= maxEntries && this.bytes <= maxBytes) break
      this.remove(key)
    }
  }

  private remove(url: string) {
    const entry = this.entries.get(url)
    if (!entry) return
    this.bytes -= entry.image.buffer.byteLength
    this.entries.delete(url)
  }
}
