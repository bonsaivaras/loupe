import { opfsReadFile, proxyPath } from '@/storage/opfs'

/** Only a handful of decoded proxies stay resident; the rest are re-read. */
const MAX_ENTRIES = 4

const cache = new Map<string, ImageBitmap>()
const inflight = new Map<string, Promise<ImageBitmap | null>>()

function touch(photoId: string, bitmap: ImageBitmap): void {
  cache.delete(photoId)
  cache.set(photoId, bitmap)
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.get(oldest.value)?.close()
    cache.delete(oldest.value)
  }
}

export function peekProxy(photoId: string): ImageBitmap | undefined {
  return cache.get(photoId)
}

export function loadProxy(projectId: string, photoId: string): Promise<ImageBitmap | null> {
  const cached = cache.get(photoId)
  if (cached) {
    touch(photoId, cached)
    return Promise.resolve(cached)
  }
  const pending = inflight.get(photoId)
  if (pending) return pending

  const task = (async () => {
    const file = await opfsReadFile(proxyPath(projectId, photoId))
    if (!file) return null
    const bitmap = await createImageBitmap(file)
    touch(photoId, bitmap)
    return bitmap
  })().finally(() => inflight.delete(photoId))

  inflight.set(photoId, task)
  return task
}

export function dropProxy(photoId: string): void {
  cache.get(photoId)?.close()
  cache.delete(photoId)
  inflight.delete(photoId)
}

export function clearProxies(): void {
  for (const bitmap of cache.values()) bitmap.close()
  cache.clear()
  inflight.clear()
}
