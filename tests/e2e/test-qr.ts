import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const loadApi = createRequire(resolve('apps/api/package.json'))
const writer: {
  prepareZXingModule: (options: { overrides: { wasmBinary: ArrayBuffer } }) => void
  writeBarcode: (value: string, options: { format: 'QRCode'; scale: number }) => Promise<{ image: Blob | null }>
} = loadApi('zxing-wasm/writer')

export async function qrFile(value: string, name: string) {
  const wasm = readFileSync(loadApi.resolve('zxing-wasm/writer/zxing_writer.wasm'))
  writer.prepareZXingModule({ overrides: { wasmBinary: Uint8Array.from(wasm).buffer } })
  const { image } = await writer.writeBarcode(value, { format: 'QRCode', scale: 5 })
  if (!image) throw new Error('Could not render the test QR')
  return { name, mimeType: 'image/png', buffer: Buffer.from(await image.arrayBuffer()) }
}
