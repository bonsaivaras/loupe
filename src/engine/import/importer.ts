import exifr from 'exifr'
import { extOf, exifrSupports, isRawExt } from '@/lib/files'
import { DEFAULT_ADJUSTMENTS } from '@/lib/adjustments'
import { putPhotos, putProject } from '@/storage/db'
import { opfsDelete, opfsWrite, origPath, proxyPath, thumbPath } from '@/storage/opfs'
import {
  IMPORT_SIZE_FACTOR,
  QUOTA_HEADROOM,
  requestPersistence,
  storageStatus,
  TTL_MS,
} from '@/storage/lifecycle'
import { decoderPool, CancelledError, POOL_SIZE } from '@/engine/decode/decoderPool'
import { mediaPool } from '@/engine/decode/mediaPool'
import { toTransferable } from '@/engine/decode/rawDecoder'
import { PROXY_LONG_EDGE, type ProxyResponse } from '@/engine/decode/decodeTypes'
import { useProjectStore } from '@/store/projectStore'
import { useUiStore } from '@/store/uiStore'
import type { Photo, PhotoExif, Project } from '@/types'

export class QuotaError extends Error {
  readonly needed: number
  readonly available: number
  constructor(needed: number, available: number) {
    super('Not enough storage for this import')
    this.name = 'QuotaError'
    this.needed = needed
    this.available = available
  }
}

export interface QuotaEstimate {
  /** Bytes this import would add: originals plus proxies and thumbnails. */
  needed: number
  /** Bytes available before the reserved headroom. */
  available: number
  fits: boolean
}

export function estimateImportBytes(files: File[]): number {
  return Math.round(files.reduce((sum, f) => sum + f.size, 0) * IMPORT_SIZE_FACTOR)
}

/** Read-only pre-check, so the UI can offer a subset before anything is written. */
export async function checkQuota(files: File[]): Promise<QuotaEstimate> {
  const needed = estimateImportBytes(files)
  const { usage, quota } = await storageStatus()
  // A zero quota means the browser would not tell us; do not block on that.
  const available = quota > 0 ? Math.max(0, quota - usage - QUOTA_HEADROOM) : Number.POSITIVE_INFINITY
  return { needed, available, fits: needed <= available }
}

let aborted = false

export function abortImport(): void {
  aborted = true
  decoderPool.cancelAll()
}

function newProject(name: string): Project {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    lastOpenedAt: now,
    expiresAt: now + TTL_MS,
    photoCount: 0,
    bytesUsed: 0,
  }
}

function makePhoto(projectId: string, file: File, createdAt: number): Photo {
  const ext = extOf(file.name)
  const now = createdAt
  return {
    id: crypto.randomUUID(),
    projectId,
    filename: file.name,
    ext,
    isRaw: isRawExt(ext),
    bytes: file.size,
    width: 0,
    height: 0,
    proxyWidth: 0,
    proxyHeight: 0,
    exif: {},
    flag: 'none',
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    decodeState: 'pending',
    createdAt: now,
    updatedAt: now,
  }
}

async function readBitmapExif(file: File, ext: string): Promise<PhotoExif> {
  if (!exifrSupports(ext)) return {}
  try {
    const parsed = (await exifr.parse(file, [
      'Make',
      'Model',
      'LensModel',
      'ISO',
      'FNumber',
      'ExposureTime',
      'FocalLength',
      'DateTimeOriginal',
    ])) as Record<string, unknown> | undefined
    if (!parsed) return {}
    const make = typeof parsed.Make === 'string' ? parsed.Make.trim() : ''
    const model = typeof parsed.Model === 'string' ? parsed.Model.trim() : ''
    const date = parsed.DateTimeOriginal
    return {
      camera: `${make} ${model}`.trim() || undefined,
      lens: typeof parsed.LensModel === 'string' ? parsed.LensModel : undefined,
      iso: typeof parsed.ISO === 'number' ? parsed.ISO : undefined,
      fNumber: typeof parsed.FNumber === 'number' ? parsed.FNumber : undefined,
      exposureTime: typeof parsed.ExposureTime === 'number' ? parsed.ExposureTime : undefined,
      focalLength: typeof parsed.FocalLength === 'number' ? parsed.FocalLength : undefined,
      dateTaken: date instanceof Date ? date.getTime() : undefined,
    }
  } catch {
    // A null or failed parse must never abort an import.
    return {}
  }
}

async function importOne(photo: Photo, file: File): Promise<number> {
  const store = useProjectStore.getState()
  store.patchPhoto(photo.id, { decodeState: 'decoding' }, false)

  // Stream the original into OPFS first: `open()` detaches the decode buffer,
  // and the full-resolution export path re-reads these bytes later.
  await opfsWrite(origPath(photo.projectId, photo.id), file)

  const paths = {
    proxyPath: proxyPath(photo.projectId, photo.id),
    thumbPath: thumbPath(photo.projectId, photo.id),
  }

  let result: ProxyResponse
  let exif: PhotoExif
  let fullWidth: number
  let fullHeight: number

  if (photo.isRaw) {
    const buffer = await file.arrayBuffer()
    const decoded = await decoderPool.decode(photo.id, buffer, 'proxy')
    exif = decoded.exif
    fullWidth = decoded.fullWidth
    fullHeight = decoded.fullHeight
    const rgb = toTransferable(decoded.rgb)
    result = await mediaPool.run<ProxyResponse>(
      {
        kind: 'proxy-rgb',
        rgb,
        width: decoded.width,
        height: decoded.height,
        maxLongEdge: PROXY_LONG_EDGE,
        ...paths,
      },
      [rgb],
    )
  } else {
    exif = await readBitmapExif(file, photo.ext)
    result = await mediaPool.run<ProxyResponse>({
      kind: 'proxy-blob',
      blob: file,
      maxLongEdge: PROXY_LONG_EDGE,
      ...paths,
    })
    fullWidth = result.sourceWidth
    fullHeight = result.sourceHeight
  }

  // The user can remove a photo while its proxy is still being written; if so,
  // clean up the files the worker just produced instead of leaving them orphaned.
  if (!useProjectStore.getState().photos[photo.id]) {
    await Promise.all([
      opfsDelete(origPath(photo.projectId, photo.id)),
      opfsDelete(paths.proxyPath),
      opfsDelete(paths.thumbPath),
    ])
    return 0
  }

  useProjectStore.getState().patchPhoto(photo.id, {
    decodeState: 'ready',
    decodeError: undefined,
    width: fullWidth,
    height: fullHeight,
    proxyWidth: result.proxyWidth,
    proxyHeight: result.proxyHeight,
    exif,
  })

  return file.size + result.bytes
}

export interface ImportOptions {
  files: File[]
  skipped: number
  folderName: string | null
}

export interface ImportOutcome {
  imported: number
  failed: number
  skipped: number
}

export async function runImport(options: ImportOptions): Promise<ImportOutcome> {
  const { files, skipped } = options
  aborted = false
  const store = useProjectStore.getState()

  await requestPersistence()

  // ---- quota pre-check ----------------------------------------------------
  const { needed, available, fits } = await checkQuota(files)
  if (!fits) throw new QuotaError(needed, available)

  // ---- project ------------------------------------------------------------
  let project = store.project
  if (!project) {
    const name =
      options.folderName ??
      `Import ${new Date().toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })}`
    project = newProject(name)
    await putProject(project)
    store.loadProject(project, [])
  }

  // ---- records ------------------------------------------------------------
  // A whole batch lands inside one millisecond, so stamp a strictly increasing
  // createdAt: that index is what orders the filmstrip after a reload.
  const existing = useProjectStore.getState()
  const lastCreatedAt = existing.order.reduce(
    (max, id) => Math.max(max, existing.photos[id]?.createdAt ?? 0),
    0,
  )
  const base = Math.max(Date.now(), lastCreatedAt + 1)
  const photos = files.map((file, index) => makePhoto(project.id, file, base + index))
  await putPhotos(photos)
  useProjectStore.getState().addPhotos(photos)
  useProjectStore.getState().setImportProgress({
    active: true,
    total: files.length,
    done: 0,
    failed: 0,
    bytesRead: 0,
    startedAt: performance.now(),
    label: 'Reading files',
  })

  // ---- decode, bounded by the LibRaw pool size ----------------------------
  let cursor = 0
  let done = 0
  let failed = 0
  let bytesUsed = 0
  let bytesRead = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      if (aborted) return
      const index = cursor
      cursor += 1
      if (index >= photos.length) return
      const photo = photos[index]
      const file = files[index]
      try {
        bytesUsed += await importOne(photo, file)
      } catch (error) {
        if (error instanceof CancelledError) return
        failed += 1
        const message = error instanceof Error ? error.message : String(error)
        useProjectStore
          .getState()
          .patchPhoto(photo.id, { decodeState: 'error', decodeError: message })
        // Out of space mid-import: stop, keep what succeeded, tell the user.
        const name = error instanceof Error ? error.name : ''
        if (name === 'QuotaExceededError' || /quota/i.test(message)) {
          aborted = true
          useUiStore
            .getState()
            .setQuotaWarning(
              'Your browser ran out of storage part-way through this import. ' +
                'The photos that already landed are safe — finish or wipe this project to free space.',
            )
          return
        }
      } finally {
        done += 1
        bytesRead += file.size
        useProjectStore.getState().setImportProgress({
          done,
          failed,
          bytesRead,
          label: photo.filename,
        })
      }
    }
  }

  const lanes = Math.max(1, Math.min(POOL_SIZE, photos.length))
  await Promise.all(Array.from({ length: lanes }, () => worker()))

  const finalStore = useProjectStore.getState()
  finalStore.updateProject({
    photoCount: finalStore.order.length,
    bytesUsed: (finalStore.project?.bytesUsed ?? 0) + bytesUsed,
  })
  finalStore.resetImportProgress()

  return { imported: done - failed, failed, skipped }
}
