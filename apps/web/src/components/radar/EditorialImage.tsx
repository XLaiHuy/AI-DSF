'use client'

import Image from 'next/image'
import type { StaticImageData } from 'next/image'
import { useEffect, useState } from 'react'
import { CategoryArtwork } from './CategoryArtwork'

type EditorialImageProps = {
  imageUrl?: string | null
  proxyUrl?: string | null
  alt: string
  categories: string[]
  credit?: string | null
  sourceUrl?: string | null
  fallbackIllustration?: StaticImageData
  priority?: boolean
  className?: string
}

export function EditorialImage({ imageUrl, proxyUrl, alt, categories, credit, sourceUrl, fallbackIllustration, priority = false, className = '' }: EditorialImageProps) {
  const validOriginal = imageUrl?.startsWith('https://') ? imageUrl : null
  const proxy = proxyUrl?.startsWith('/api/v1/radar/image-proxy?') ? proxyUrl : null
  const [failedSources, setFailedSources] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { setFailedSources([]); setLoaded(false) }, [proxy, validOriginal])
  const source = [proxy, validOriginal].find((value): value is string => Boolean(value && !failedSources.includes(value)))
  const src = source ?? fallbackIllustration ?? null
  const isSource = Boolean(source)
  const label = isSource ? `Ảnh: ${credit || 'nguồn bài viết'}` : 'Minh họa FinCopilot'

  return <div className={`editorial-image ${className}`} data-loading={Boolean(src) && !loaded}>
    {src ? <Image key={typeof src === 'string' ? src : src.src} unoptimized fill sizes="(max-width: 650px) 100vw, 50vw" priority={priority} src={src} alt={isSource ? alt : ''} referrerPolicy="no-referrer"
      onLoad={(event) => { if (source && (event.currentTarget.naturalWidth <= 2 || event.currentTarget.naturalHeight <= 2)) { setFailedSources((current) => [...current, source]); setLoaded(false) } else setLoaded(true) }}
      onError={() => { if (source) { setFailedSources((current) => [...current, source]); setLoaded(false) } else setLoaded(true) }} /> : <CategoryArtwork categories={categories} />}
    {src && <span className="editorial-image-credit">{isSource && sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">{label}</a> : label}</span>}
  </div>
}
