import { mediaPool } from '@/engine/decode/mediaPool'
import type { EncodeResponse } from '@/engine/decode/decodeTypes'

export type ExportFormat = 'jpeg' | 'png' | 'webp' | 'pdf'

export const FORMAT_MIME: Record<Exclude<ExportFormat, 'pdf'>, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

export const FORMAT_EXT: Record<ExportFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  pdf: 'pdf',
}

/** convertToBlob on a readback larger than this can exhaust memory. */
export const MAX_EXPORT_LONG_EDGE = 8192

export const RESIZE_OPTIONS = [
  { value: '2x', label: '2x larger (Lanczos)' },
  { value: '1.5x', label: '1.5x larger (Lanczos)' },
  { value: 'original', label: `Original (capped at ${MAX_EXPORT_LONG_EDGE} px)` },
  { value: '4096', label: '4096 px long edge' },
  { value: '2560', label: '2560 px long edge' },
  { value: '2048', label: '2048 px long edge' },
  { value: '1600', label: '1600 px long edge' },
  { value: '1024', label: '1024 px long edge' },
] as const

export type ResizeOption = (typeof RESIZE_OPTIONS)[number]['value']

export function targetSize(
  width: number,
  height: number,
  resize: ResizeOption,
): [number, number] {
  const longEdge = Math.max(width, height)

  // Multipliers enlarge; everything else is a cap the image is fitted inside.
  if (resize === '2x' || resize === '1.5x') {
    const factor = resize === '2x' ? 2 : 1.5
    const wanted = longEdge * factor
    const scale = (wanted > MAX_EXPORT_LONG_EDGE ? MAX_EXPORT_LONG_EDGE / longEdge : factor)
    return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
  }

  const cap = resize === 'original' ? MAX_EXPORT_LONG_EDGE : Number(resize)
  if (longEdge <= cap) return [width, height]
  const scale = cap / longEdge
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
}

export async function encodePixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
  mime: string,
  quality: number,
): Promise<Blob> {
  const buffer = pixels.buffer as ArrayBuffer
  const response = await mediaPool.run<EncodeResponse>(
    {
      kind: 'encode',
      pixels: buffer,
      width,
      height,
      targetWidth,
      targetHeight,
      mime,
      quality,
    },
    [buffer],
  )
  return response.blob
}
