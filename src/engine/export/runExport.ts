import { decoderPool, CancelledError } from '@/engine/decode/decoderPool'
import { mediaPool } from '@/engine/decode/mediaPool'
import { toTransferable } from '@/engine/decode/rawDecoder'
import type { BitmapResponse } from '@/engine/decode/decodeTypes'
import { orientedSize, type Renderer } from '@/engine/gl/renderer'
import { opfsReadFile, origPath } from '@/storage/opfs'
import { applyPattern, baseNameOf, uniqueName } from '@/lib/files'
import {
  encodePixels,
  FORMAT_EXT,
  FORMAT_MIME,
  MAX_EXPORT_LONG_EDGE,
  targetSize,
  type ExportFormat,
  type ResizeOption,
} from './encode'
import { buildPdf, type PdfPage } from './pdf'
import { toast } from 'sonner'
import { chooseSaveTarget, SaveCancelledError, type Destination } from './save'
import type { Photo } from '@/types'

export interface ExportSettings {
  format: ExportFormat
  quality: number
  resize: ResizeOption
  pattern: string
  destination: Destination
}

export interface ExportProgressUpdate {
  index: number
  total: number
  filename: string
  phase: 'decoding' | 'rendering' | 'encoding' | 'saving' | 'done'
}

export interface ExportResult {
  written: number
  failed: { filename: string; error: string }[]
  cancelled: boolean
}

let cancelled = false

export function cancelExport(): void {
  cancelled = true
  decoderPool.cancelAll()
}

function fitLongEdge(width: number, height: number, cap: number): [number, number] {
  const longEdge = Math.max(width, height)
  if (longEdge <= cap) return [width, height]
  const scale = cap / longEdge
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
}

/** Full-resolution decode of one photo, ready to upload as a GL texture. */
export async function loadFullBitmap(photo: Photo): Promise<ImageBitmap> {
  const file = await opfsReadFile(origPath(photo.projectId, photo.id))
  if (!file) throw new Error('Original file is no longer in storage')
  if (!photo.isRaw) return createImageBitmap(file)

  const buffer = await file.arrayBuffer()
  const decoded = await decoderPool.decode(photo.id, buffer, 'full')
  const rgb = toTransferable(decoded.rgb)
  const response = await mediaPool.run<BitmapResponse>(
    { kind: 'bitmap-rgb', rgb, width: decoded.width, height: decoded.height },
    [rgb],
  )
  return response.bitmap
}

export async function runExport(
  photos: Photo[],
  settings: ExportSettings,
  renderer: Renderer,
  projectName: string,
  onProgress: (update: ExportProgressUpdate) => void,
): Promise<ExportResult> {
  cancelled = false
  const failed: ExportResult['failed'] = []
  const isPdf = settings.format === 'pdf'
  const ext = FORMAT_EXT[settings.format]
  const mime = isPdf ? FORMAT_MIME.jpeg : FORMAT_MIME[settings.format as 'jpeg' | 'png' | 'webp']
  const quality = isPdf ? 0.92 : settings.quality

  const target = await chooseSaveTarget(
    isPdf ? 1 : photos.length,
    `${projectName}.zip`,
    settings.destination,
    (reason) =>
      toast.warning('Saving to that folder was refused — downloading instead', {
        description: reason,
      }),
  )
  const taken = new Set<string>()
  const pdfPages: PdfPage[] = []
  let written = 0

  try {
    for (let i = 0; i < photos.length; i += 1) {
      if (cancelled) break
      const photo = photos[i]
      const report = (phase: ExportProgressUpdate['phase']) =>
        onProgress({ index: i, total: photos.length, filename: photo.filename, phase })

      try {
        report('decoding')
        const bitmap = await loadFullBitmap(photo)
        if (cancelled) {
          bitmap.close()
          break
        }

        report('rendering')
        renderer.setSource(bitmap)
        bitmap.close()

        const [srcW, srcH] = renderer.sourceSize
        const [fullW, fullH] = orientedSize(srcW, srcH, photo.adjustments.rotate)
        const [renderW, renderH] = fitLongEdge(fullW, fullH, MAX_EXPORT_LONG_EDGE)
        const [outW, outH] = targetSize(fullW, fullH, settings.resize)
        const pixels = renderer.renderToPixels(photo.adjustments, renderW, renderH)

        report('encoding')
        const blob = await encodePixels(pixels, renderW, renderH, outW, outH, mime, quality)

        const base = applyPattern(settings.pattern, {
          name: baseNameOf(photo.filename),
          index: i + 1,
          camera: photo.exif.camera ?? 'camera',
        })

        if (isPdf) {
          pdfPages.push({ jpeg: blob, width: outW, height: outH })
        } else {
          report('saving')
          await target.write(uniqueName(taken, base, ext), blob)
        }
        written += 1
      } catch (error) {
        if (error instanceof CancelledError) break
        failed.push({
          filename: photo.filename,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (isPdf && pdfPages.length > 0 && !cancelled) {
      onProgress({
        index: photos.length,
        total: photos.length,
        filename: `${projectName}.pdf`,
        phase: 'saving',
      })
      const pdf = await buildPdf(pdfPages)
      await target.write(uniqueName(taken, projectName || 'export', 'pdf'), pdf)
    }

    await target.finish()
  } finally {
    // The full-resolution texture must not stay resident behind the preview.
    renderer.clearSource()
    renderer.releaseIntermediates()
  }

  onProgress({
    index: photos.length,
    total: photos.length,
    filename: '',
    phase: 'done',
  })
  return { written, failed, cancelled }
}

export { SaveCancelledError }
