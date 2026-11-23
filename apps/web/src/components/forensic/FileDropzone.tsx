'use client'

import { FileText, Upload, X } from 'lucide-react'
import { useId, useRef, useState, type DragEvent } from 'react'
import { Button, Label } from '@/components/ui'
import { cn } from '@/lib/utils'

const attachmentLimit = 6
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const allowedExtensions = /\.(jpe?g|png|webp|pdf)$/i

function allowed(file: File) {
  return allowedTypes.has(file.type) || (!file.type && allowedExtensions.test(file.name))
}

function fileKey(file: File) {
  return JSON.stringify([file.name, file.size, file.lastModified])
}

const sizeFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 })

function formatSize(size: number) {
  const kib = 1024
  return size >= kib * kib ? sizeFormat.format(size / (kib * kib)) + ' MB'
    : size >= kib ? sizeFormat.format(size / kib) + ' KB' : size + ' B'
}

export function FileDropzone({
  files, update, uploadMaxMb, pdfMaxPages, disabled,
}: {
  files: File[]
  update: (files: File[]) => void
  uploadMaxMb: number
  pdfMaxPages: number
  disabled: boolean
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')

  function add(list: FileList) {
    if (disabled) return
    const next = [...files]
    const errors = new Set<string>()
    for (const file of list) {
      if (!allowed(file)) {
        errors.add('Chỉ chấp nhận JPEG, PNG, WebP và PDF.')
      } else if (file.size === 0 || file.size > uploadMaxMb * 1024 * 1024) {
        errors.add('Tệp phải có dữ liệu và không quá ' + uploadMaxMb + ' MB.')
      } else if (next.some((previous) => fileKey(previous) === fileKey(file))) {
        errors.add('Tệp đã có trong danh sách.')
      } else if (next.length >= attachmentLimit) {
        errors.add('Chỉ có thể tải tối đa ' + attachmentLimit + ' tệp.')
      } else {
        next.push(file)
      }
    }
    update(next)
    setError([...errors].join(' '))
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    add(event.dataTransfer.files)
  }

  return (
    <fieldset className="min-w-0 space-y-3" disabled={disabled}>
      <legend className="mb-2 text-sm font-semibold">Tệp cần giám định</legend>
      <div
        className={cn('relative min-h-40 rounded-xl border border-dashed border-primary/35 bg-accent/30 text-center focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring',
          dragging && 'border-primary bg-accent', disabled && 'opacity-65')}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
          if (!disabled && event.dataTransfer.types.includes('Files')) setDragging(true)
        }}
        onDragLeave={(event) => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false)
        }}
        onDrop={drop}
      >
        <Label htmlFor={inputId} className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 p-5 leading-snug">
          <Upload className="text-primary" size={24} strokeWidth={1.65} aria-hidden="true" />
          <span className="font-semibold text-primary">Chọn tệp hoặc kéo thả vào đây</span>
          <span id={hintId} className="max-w-[38ch] text-xs font-normal leading-relaxed text-muted-foreground">
            JPEG, PNG, WebP, PDF · tối đa {attachmentLimit} tệp, {uploadMaxMb} MB mỗi tệp. PDF tối đa {pdfMaxPages} trang.
          </span>
        </Label>
        <input id={inputId} ref={inputRef} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
          aria-label="Chọn tệp giám định" aria-describedby={hintId} className="sr-only"
          onChange={(event) => {
            if (event.currentTarget.files) add(event.currentTarget.files)
            event.currentTarget.value = ''
          }}
        />
      </div>
      <p role="alert" className={error ? 'text-sm text-destructive' : 'sr-only'}>{error}</p>
      {files.length > 0 && (
        <ul aria-label="Tệp đã chọn" className="divide-y divide-border rounded-lg border border-border px-3">
          {files.map((file) => (
            <li className="flex items-center gap-2 py-1.5" key={fileKey(file)}>
              <FileText className="shrink-0 text-primary" size={17} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium [overflow-wrap:anywhere]">{file.name}</p>
                <p className="font-numeric text-xs text-muted-foreground">{formatSize(file.size)}</p>
              </div>
              <Button variant="ghost" className="size-11 shrink-0" size="icon" aria-label={'Bỏ tệp ' + file.name}
                onClick={() => {
                  update(files.filter((candidate) => candidate !== file))
                  setError('')
                  inputRef.current?.focus()
                }}>
                <X size={17} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
