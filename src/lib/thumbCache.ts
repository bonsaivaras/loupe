import { opfsReadFile, thumbPath } from '@/storage/opfs'

const urls = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()
const MAX_URLS = 600

export function loadThumbUrl(projectId: string, photoId: string): Promise<string | null> {
  const cached = urls.get(photoId)
  if (cached) return Promise.resolve(cached)
  const pending = inflight.get(photoId)
  if (pending) return pending

  const task = (async () => {
    const file = await opfsReadFile(thumbPath(projectId, photoId))
    if (!file) return null
    const url = URL.createObjectURL(file)
    urls.set(photoId, url)
    if (urls.size > MAX_URLS) {
      const oldest = urls.keys().next()
      if (!oldest.done && oldest.value !== photoId) {
        URL.revokeObjectURL(urls.get(oldest.value) as string)
        urls.delete(oldest.value)
      }
    }
    return url
  })().finally(() => inflight.delete(photoId))

  inflight.set(photoId, task)
  return task
}

export function peekThumbUrl(photoId: string): string | undefined {
  return urls.get(photoId)
}

export function dropThumb(photoId: string): void {
  const url = urls.get(photoId)
  if (url) URL.revokeObjectURL(url)
  urls.delete(photoId)
}

export function clearThumbs(): void {
  for (const url of urls.values()) URL.revokeObjectURL(url)
  urls.clear()
  inflight.clear()
}
