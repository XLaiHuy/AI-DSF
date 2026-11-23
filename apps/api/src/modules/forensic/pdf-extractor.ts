import { BadRequestException } from '@nestjs/common'

function invalidPdf() {
  return new BadRequestException({
    errorCode: 'ERR_INVALID_FILE_MAGIC', message: 'Không thể đọc tệp PDF. Hãy kiểm tra định dạng và bỏ mật khẩu nếu có.',
  })
}

export async function extractPdf(buffer: Buffer, maxPages: number): Promise<{ text: string; images: Buffer[] }> {
  const { extractText, getDocumentProxy, renderPageAsImage } = await import('unpdf')
  const bytes = Uint8Array.from(buffer)
  const images: Buffer[] = []
  let doc: Awaited<ReturnType<typeof getDocumentProxy>> | undefined
  try {
    doc = await getDocumentProxy(bytes, { stopAtErrors: true, maxImageSize: 25_000_000, enableXfa: false, verbosity: 0 })
    if (doc.numPages > maxPages) throw new BadRequestException({
      errorCode: 'ERR_PDF_PAGE_LIMIT', message: 'Mỗi tệp PDF phải có tối đa ' + maxPages + ' trang.',
    })
    const extracted = await extractText(doc)
    const text = extracted.text.join('\n').trim()
    if (text.replace(/\s/g, '').length / doc.numPages < 80) {
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const page = await doc.getPage(pageNumber)
        const { width, height } = page.getViewport({ scale: 1 })
        const scale = Math.min(2, 1800 / Math.max(width, height))
        const raster = await renderPageAsImage(doc, pageNumber, { scale, canvasImport: () => import('@napi-rs/canvas') })
        images.push(Buffer.from(raster.buffer, raster.byteOffset, raster.byteLength))
      }
    }
    return { text, images }
  } catch (error) {
    for (const image of images) image.fill(0)
    if (error instanceof BadRequestException) throw error
    throw invalidPdf()
  } finally {
    try {
      await doc?.loadingTask.destroy()
    } catch {
      for (const image of images) image.fill(0)
      throw invalidPdf()
    } finally {
      // PDF.js can transfer and detach its input view.
      if (bytes.byteLength > 0) bytes.fill(0)
    }
  }
}
