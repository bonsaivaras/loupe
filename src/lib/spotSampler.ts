import { loadProxy } from '@/lib/proxyCache'
import type { SamplePlane } from '@/lib/spots'

/**
 * A downscaled copy of the proxy, kept on the CPU so the source picker can read
 * pixels without a GPU readback. One per photo, small enough that holding a
 * couple costs nothing.
 */
const SAMPLE_LONG_EDGE = 512

const cache = new Map<string, SamplePlane>()
const inflight = new Map<string, Promise<SamplePlane | null>>()

export async function loadSamplePlane(
  projectId: string,
  photoId: string,
): Promise<SamplePlane | null> {
  const cached = cache.get(photoId)
  if (cached) return cached
  const pending = inflight.get(photoId)
  if (pending) return pending

  const task = (async () => {
    const bitmap = await loadProxy(projectId, photoId)
    if (!bitmap) return null
    const scale = SAMPLE_LONG_EDGE / Math.max(bitmap.width, bitmap.height)
    const width = Math.max(1, Math.round(bitmap.width * Math.min(1, scale)))
    const height = Math.max(1, Math.round(bitmap.height * Math.min(1, scale)))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, width, height)
    const plane: SamplePlane = { data: ctx.getImageData(0, 0, width, height).data, width, height }
    // Two is enough for the current photo and the one being previewed.
    if (cache.size > 2) cache.clear()
    cache.set(photoId, plane)
    return plane
  })().finally(() => inflight.delete(photoId))

  inflight.set(photoId, task)
  return task
}

export function dropSamplePlane(photoId: string): void {
  cache.delete(photoId)
}
