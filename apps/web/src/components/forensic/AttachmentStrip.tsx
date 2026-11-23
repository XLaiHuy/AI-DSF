'use client'

import { FileText, X } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui'

const attachmentLimit = 6
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const imageExtensions = /\.(jpe?g|png|webp)$/i

function isImage(file: File) {
  return imageTypes.has(file.type) || (!file.type && imageExtensions.test(file.name))
}

export function attachmentKey(file: File) {
  return JSON.stringify([file.name, file.size, file.lastModified, file.type])
}

export function addAttachments(current: File[], incoming: Iterable<File>, uploadMaxMb: number) {
  const files = [...current]
  const errors = new Set<string>()
  for (const file of incoming) {
    if (!isImage(file) && file.type !== 'application/pdf' && (file.type || !/\.pdf$/i.test(file.name))) {
      errors.add('Chỉ chấp nhận tệp JPEG, PNG, WebP hoặc PDF.')
    } else if (!file.size || file.size > uploadMaxMb * 1024 * 1024) {
      errors.add('Mỗi tệp phải có dữ liệu và không quá ' + uploadMaxMb + ' MB.')
    } else if (files.some((previous) => attachmentKey(previous) === attachmentKey(file))) {
      errors.add('Tệp đã có trong danh sách.')
    } else if (files.length >= attachmentLimit) {
      errors.add('Mỗi lần giám định gửi được tối đa 6 tệp.')
    } else {
      files.push(file)
    }
  }
  return { files, error: [...errors].join(' ') }
}

const sizeFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 })
function formatSize(size: number) {
  if (size >= 1024 ** 2) return sizeFormat.format(size / 1024 ** 2) + ' MB'
  if (size >= 1024) return sizeFormat.format(size / 1024) + ' KB'
  return size + ' B'
}

function ImagePreview({ file }: { file: File }) {
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  return (
    <span className="relative block size-11 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
      {src && <Image src={src} alt="" fill unoptimized sizes="44px" className="object-contain" />}
    </span>
  )
}

export function AttachmentStrip({ files, onRemove, disabled }: {
  files: File[]
  onRemove?: (file: File) => void
  disabled?: boolean
}) {
  if (!files.length) return null
  return (
    <ul aria-label={onRemove ? 'Tệp đã chọn' : 'Tệp đã gửi'} className="flex flex-wrap gap-2">
      {files.map((file) => (
        <li key={attachmentKey(file)} className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-border bg-card p-1.5 text-sm">
          {isImage(file) ? <ImagePreview file={file} /> : (
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-muted text-primary">
              <FileText size={20} aria-hidden="true" />
            </span>
          )}
          <span className="min-w-0 leading-snug">
            <span className="block max-w-32 truncate font-medium" title={file.name}>{file.name}</span>
            <span className="block text-xs text-muted-foreground">{formatSize(file.size)}</span>
          </span>
          {onRemove && (
            <Button variant="ghost" size="icon" className="size-11 shrink-0" disabled={disabled}
              aria-label={'Bỏ tệp ' + file.name} onClick={() => onRemove(file)}>
              <X size={17} aria-hidden="true" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
