/// <reference lib="webworker" />
/**
 * Pixel post-processing worker.
 *
 * Keeps RGB -> RGBA expansion, canvas rescaling, JPEG encoding and OPFS writes
 * off the main thread. LibRaw itself is NOT run here: `new LibRaw()` spawns its
 * own worker, and nesting workers is fragile in Safari (SPEC 8.3).
 */
import { lanczosResize } from '@/engine/export/lanczos'
import { opfsWriteSync } from '@/storage/opfs'
import {
  PROXY_QUALITY,
  THUMB_LONG_EDGE,
  THUMB_QUALITY,
  type MediaRequest,
  type MediaResponse,
} from './decodeTypes'

/** `new ImageData(...)` needs RGBA; LibRaw hands back tightly packed RGB. */
function rgbToRgba(rgb: Uint8Array, width: number, height: number): ImageData {
  const count = width * height
  const out = new Uint8ClampedArray(count * 4)
  for (let i = 0, j = 0; i < count; i += 1, j += 3) {
    const o = i * 4
    out[o] = rgb[j]
    out[o + 1] = rgb[j + 1]
    out[o + 2] = rgb[j + 2]
    out[o + 3] = 255
  }
  return new ImageData(out, width, height)
}

function fit(width: number, height: number, longEdge: number): [number, number] {
  const scale = Math.min(1, longEdge / Math.max(width, height))
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
}

/**
 * `resizeWidth` alone preserves aspect ratio, so constrain whichever edge is
 * the long one — otherwise portrait thumbs come out 320px on the short edge.
 */
function resizeOptions(width: number, height: number, longEdge: number): ImageBitmapOptions {
  return width >= height
    ? { resizeWidth: longEdge, resizeQuality: 'high' }
    : { resizeHeight: longEdge, resizeQuality: 'high' }
}

async function drawToBlob(
  bitmap: ImageBitmap,
  targetWidth: number,
  targetHeight: number,
  mime: string,
  quality: number,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(targetWidth, targetHeight)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable')
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
  return canvas.convertToBlob({ type: mime, quality })
}

async function writeProxyAndThumb(
  source: ImageBitmap,
  maxLongEdge: number,
  proxyPath: string,
  thumbPath: string,
): Promise<{ proxyWidth: number; proxyHeight: number; bytes: number }> {
  const [pw, ph] = fit(source.width, source.height, maxLongEdge)
  const proxyBlob = await drawToBlob(source, pw, ph, 'image/jpeg', PROXY_QUALITY)
  const proxyBuffer = await proxyBlob.arrayBuffer()

  // The thumb is downscaled from the proxy — never decode the source twice.
  const proxyBitmap = await createImageBitmap(
    proxyBlob,
    resizeOptions(pw, ph, THUMB_LONG_EDGE),
  )
  const thumbBlob = await drawToBlob(
    proxyBitmap,
    proxyBitmap.width,
    proxyBitmap.height,
    'image/jpeg',
    THUMB_QUALITY,
  )
  proxyBitmap.close()
  const thumbBuffer = await thumbBlob.arrayBuffer()

  await opfsWriteSync(proxyPath, proxyBuffer)
  await opfsWriteSync(thumbPath, thumbBuffer)

  return { proxyWidth: pw, proxyHeight: ph, bytes: proxyBuffer.byteLength + thumbBuffer.byteLength }
}

function post(message: MediaResponse, transfer: Transferable[] = []): void {
  ;(self as unknown as Worker).postMessage(message, transfer)
}

self.onmessage = async (event: MessageEvent<MediaRequest>) => {
  const req = event.data
  try {
    switch (req.kind) {
      case 'proxy-rgb': {
        const image = rgbToRgba(new Uint8Array(req.rgb), req.width, req.height)
        const bitmap = await createImageBitmap(image)
        try {
          const result = await writeProxyAndThumb(
            bitmap,
            req.maxLongEdge,
            req.proxyPath,
            req.thumbPath,
          )
          post({
            id: req.id,
            ok: true,
            kind: 'proxy',
            ...result,
            sourceWidth: req.width,
            sourceHeight: req.height,
          })
        } finally {
          bitmap.close()
        }
        break
      }
      case 'proxy-blob': {
        const bitmap = await createImageBitmap(req.blob)
        try {
          const result = await writeProxyAndThumb(
            bitmap,
            req.maxLongEdge,
            req.proxyPath,
            req.thumbPath,
          )
          post({
            id: req.id,
            ok: true,
            kind: 'proxy',
            ...result,
            sourceWidth: bitmap.width,
            sourceHeight: bitmap.height,
          })
        } finally {
          bitmap.close()
        }
        break
      }
      case 'bitmap-rgb': {
        const image = rgbToRgba(new Uint8Array(req.rgb), req.width, req.height)
        const bitmap = await createImageBitmap(image)
        post(
          { id: req.id, ok: true, kind: 'bitmap', bitmap, width: req.width, height: req.height },
          [bitmap],
        )
        break
      }
      case 'encode': {
        let pixels = new Uint8ClampedArray(req.pixels)
        let width = req.width
        let height = req.height
        const upscaling = req.targetWidth > req.width || req.targetHeight > req.height
        if (upscaling) {
          // The browser's own resize is soft on the way up; Lanczos is not.
          pixels = lanczosResize(pixels, width, height, req.targetWidth, req.targetHeight)
          width = req.targetWidth
          height = req.targetHeight
        }
        const image = new ImageData(pixels, width, height)
        let bitmap = await createImageBitmap(image)
        if (req.targetWidth !== width || req.targetHeight !== height) {
          // Downscaling: the native high-quality path is good and much faster.
          const resized = await createImageBitmap(bitmap, {
            resizeWidth: req.targetWidth,
            resizeHeight: req.targetHeight,
            resizeQuality: 'high',
          })
          bitmap.close()
          bitmap = resized
        }
        try {
          const blob = await drawToBlob(
            bitmap,
            req.targetWidth,
            req.targetHeight,
            req.mime,
            req.quality,
          )
          post({ id: req.id, ok: true, kind: 'encode', blob })
        } finally {
          bitmap.close()
        }
        break
      }
    }
  } catch (error) {
    post({ id: req.id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
