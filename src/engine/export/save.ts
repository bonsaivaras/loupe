import { zip } from 'fflate'

export interface SaveTarget {
  write(filename: string, blob: Blob): Promise<void>
  finish(): Promise<void>
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoke late: Safari needs the URL alive until the download starts.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

class DirectorySaveTarget implements SaveTarget {
  private readonly dir: FileSystemDirectoryHandle

  constructor(dir: FileSystemDirectoryHandle) {
    this.dir = dir
  }

  async write(filename: string, blob: Blob): Promise<void> {
    const handle = await this.dir.getFileHandle(filename, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(blob)
    } finally {
      await writable.close()
    }
  }

  async finish(): Promise<void> {}
}

class ZipSaveTarget implements SaveTarget {
  private entries: Record<string, Uint8Array> = {}
  private readonly archiveName: string

  constructor(archiveName: string) {
    this.archiveName = archiveName
  }

  async write(filename: string, blob: Blob): Promise<void> {
    this.entries[filename] = new Uint8Array(await blob.arrayBuffer())
  }

  async finish(): Promise<void> {
    const names = Object.keys(this.entries)
    if (names.length === 0) return
    if (names.length === 1) {
      downloadBlob(names[0], new Blob([this.entries[names[0]] as unknown as BlobPart]))
      this.entries = {}
      return
    }
    const data = await new Promise<Uint8Array>((resolve, reject) => {
      // Level 0: JPEG/PNG/WebP are already compressed.
      zip(this.entries, { level: 0 }, (error, result) =>
        error ? reject(error) : resolve(result),
      )
    })
    downloadBlob(this.archiveName, new Blob([data as unknown as BlobPart], { type: 'application/zip' }))
    this.entries = {}
  }
}

class SingleFileSaveTarget implements SaveTarget {
  async write(filename: string, blob: Blob): Promise<void> {
    downloadBlob(filename, blob)
  }
  async finish(): Promise<void> {}
}

export type Destination = 'folder' | 'download'

/** Thrown when the user deliberately dismisses the folder picker. */
export class SaveCancelledError extends Error {
  constructor() {
    super('Save cancelled')
    this.name = 'SaveCancelledError'
  }
}

export function directoryPickerAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

function downloadTarget(fileCount: number, archiveName: string): SaveTarget {
  return fileCount > 1 ? new ZipSaveTarget(archiveName) : new SingleFileSaveTarget()
}

/**
 * Writes into a folder the user picks, or falls back to ordinary downloads.
 *
 * Chrome refuses write access to a long list of directories — anything it
 * considers to hold system files, which includes the home folder itself and
 * plenty of ordinary-looking places. That refusal must never dead-end the
 * export: downloading always works, so any failure other than a deliberate
 * cancel falls back to it.
 */
export async function chooseSaveTarget(
  fileCount: number,
  archiveName: string,
  destination: Destination = 'folder',
  onFallback?: (reason: string) => void,
): Promise<SaveTarget> {
  if (destination === 'download' || !directoryPickerAvailable()) {
    return downloadTarget(fileCount, archiveName)
  }

  try {
    const dir = await window.showDirectoryPicker?.({ id: 'll-export', mode: 'readwrite' })
    if (dir) return new DirectorySaveTarget(dir)
    return downloadTarget(fileCount, archiveName)
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    // AbortError is the user closing the dialog; anything else is the browser
    // saying no, and downloading is a better answer than failing.
    if (name === 'AbortError') throw new SaveCancelledError()
    onFallback?.(
      error instanceof Error && error.message ? error.message : 'That folder cannot be written to',
    )
    return downloadTarget(fileCount, archiveName)
  }
}
