import { deletePhotoRecords } from '@/storage/db'
import { opfsDelete, opfsSize, origPath, proxyPath, thumbPath } from '@/storage/opfs'
import { decoderPool } from '@/engine/decode/decoderPool'
import { useProjectStore } from '@/store/projectStore'
import { useEditStore } from '@/store/editStore'
import { dropThumb } from '@/lib/thumbCache'
import { dropProxy } from '@/lib/proxyCache'
import type { Photo } from '@/types'

export interface DeleteOutcome {
  deleted: number
  bytesFreed: number
}

/**
 * Permanently removes photos from this browser: OPFS bytes, IndexedDB records,
 * in-memory state and caches. The files on the card are untouched.
 */
export async function deletePhotos(ids: string[]): Promise<DeleteOutcome> {
  const state = useProjectStore.getState()
  const project = state.project
  if (!project || ids.length === 0) return { deleted: 0, bytesFreed: 0 }

  const photos = ids
    .map((id) => state.photos[id])
    .filter((photo): photo is Photo => photo !== undefined)

  // Drop the UI reference first so nothing tries to read a file mid-delete.
  useProjectStore.getState().removePhotos(ids)
  useEditStore.getState().forget(ids)

  let bytesFreed = 0
  for (const photo of photos) {
    // A decode still in flight would resurrect files we are about to remove.
    decoderPool.cancel(photo.id)
    dropThumb(photo.id)
    dropProxy(photo.id)
    const paths = [
      origPath(project.id, photo.id),
      proxyPath(project.id, photo.id),
      thumbPath(project.id, photo.id),
    ]
    // Measure before deleting so the reported figure — and the project's
    // bytesUsed — match what import actually added (original + proxy + thumb).
    const sizes = await Promise.all(paths.map(opfsSize))
    bytesFreed += sizes.reduce((sum, size) => sum + size, 0)
    for (const path of paths) await opfsDelete(path)
  }

  await deletePhotoRecords(ids)

  const after = useProjectStore.getState()
  after.updateProject({
    photoCount: after.order.length,
    bytesUsed: Math.max(0, (after.project?.bytesUsed ?? 0) - bytesFreed),
  })

  return { deleted: photos.length, bytesFreed }
}
