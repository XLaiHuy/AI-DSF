import { BadRequestException, PayloadTooLargeException } from '@nestjs/common'

export type FileKind = 'JPEG' | 'PNG' | 'WEBP' | 'PDF'
const jpeg = Buffer.from([0xff, 0xd8, 0xff])
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function fileKind(buffer: Buffer): FileKind {
  if (buffer.subarray(0, jpeg.length).equals(jpeg)) return 'JPEG'
  if (buffer.subarray(0, png.length).equals(png)) return 'PNG'
  if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'WEBP'
  if (/^%PDF-[12]\.\d/.test(buffer.toString('latin1', 0, 8))) return 'PDF'
  throw new BadRequestException({
    errorCode: 'ERR_INVALID_FILE_MAGIC', message: 'Chỉ chấp nhận tệp JPEG, PNG, WebP hoặc PDF hợp lệ.',
  })
}

export function validateFiles(files: readonly { buffer: Buffer }[], maxMb: number): FileKind[] {
  if (files.length > 6) throw new PayloadTooLargeException({
    errorCode: 'ERR_FILE_TOO_LARGE', message: 'Chỉ được gửi tối đa 6 tệp cho mỗi lượt giám định.',
  })
  if (files.some(({ buffer }) => buffer.length > maxMb * 1024 * 1024)) throw new PayloadTooLargeException({
    errorCode: 'ERR_FILE_TOO_LARGE', message: 'Mỗi tệp phải có dung lượng tối đa ' + maxMb + ' MB.',
  })
  return files.map(({ buffer }) => fileKind(buffer))
}
