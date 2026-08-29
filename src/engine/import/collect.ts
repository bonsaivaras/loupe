import { isSupported } from '@/lib/files'

export interface CollectResult {
  files: File[]
  skipped: number
  /** Folder name when one could be determined, for the project title. */
  folderName: string | null
}

function partition(files: File[], folderName: string | null): CollectResult {
  const supported: File[] = []
  let skipped = 0
  for (const file of files) {
    if (isSupported(file.name)) supported.push(file)
    else skipped += 1
  }
  supported.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  return { files: supported, skipped, folderName }
}

/** Recursively walks a directory handle, returning every file it contains. */
async function walkDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  out: File[],
): Promise<void> {
  for await (const [, entry] of handle.entries()) {
    if (entry.kind === 'file') {
      try {
        out.push(await (entry as FileSystemFileHandle).getFile())
      } catch {
        /* unreadable entry */
      }
    } else {
      await walkDirectoryHandle(entry as FileSystemDirectoryHandle, out)
    }
  }
}

/** Entry point for `showDirectoryPicker()`. */
export async function collectFromDirectoryHandle(
  dir: FileSystemDirectoryHandle,
): Promise<CollectResult> {
  const files: File[] = []
  await walkDirectoryHandle(dir, files)
  return partition(files, dir.name)
}

export function collectFromFileList(list: FileList | File[]): CollectResult {
  const files = Array.from(list)
  const relative = files.find((f) => f.webkitRelativePath)?.webkitRelativePath
  const folderName = relative ? relative.split('/')[0] : null
  return partition(files, folderName)
}

/* --- drag and drop ------------------------------------------------------- */

interface LegacyEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
  file(onSuccess: (file: File) => void, onError: (error: unknown) => void): void
  createReader(): {
    readEntries(
      onSuccess: (entries: LegacyEntry[]) => void,
      onError: (error: unknown) => void,
    ): void
  }
}

async function readLegacyEntry(entry: LegacyEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) =>
      entry.file(resolve, () => resolve(null)),
    )
    if (file) out.push(file)
    return
  }
  if (!entry.isDirectory) return
  const reader = entry.createReader()
  // readEntries returns at most 100 entries per call and must be drained.
  for (;;) {
    const batch = await new Promise<LegacyEntry[]>((resolve) =>
      reader.readEntries(resolve, () => resolve([])),
    )
    if (batch.length === 0) break
    for (const child of batch) await readLegacyEntry(child, out)
  }
}

export async function collectFromDataTransfer(transfer: DataTransfer): Promise<CollectResult> {
  const items = Array.from(transfer.items).filter((i) => i.kind === 'file')
  const files: File[] = []
  let folderName: string | null = null

  // Chromium: real handles, so nested folders resolve cleanly.
  if (items.length > 0 && typeof items[0].getAsFileSystemHandle === 'function') {
    const handles = await Promise.all(
      items.map((item) => item.getAsFileSystemHandle?.().catch(() => null) ?? null),
    )
    let resolvedAny = false
    for (const handle of handles) {
      if (!handle) continue
      resolvedAny = true
      if (handle.kind === 'directory') {
        folderName = folderName ?? handle.name
        await walkDirectoryHandle(handle as FileSystemDirectoryHandle, files)
        continue
      }
      try {
        files.push(await (handle as FileSystemFileHandle).getFile())
      } catch {
        /* unreadable */
      }
    }
    if (resolvedAny) return partition(files, folderName)
  }

  // Firefox / Safari: the legacy entry API still walks dropped folders.
  const entries = items
    .map((item) => item.webkitGetAsEntry() as unknown as LegacyEntry | null)
    .filter((entry): entry is LegacyEntry => entry !== null)
  if (entries.length > 0) {
    for (const entry of entries) {
      if (entry.isDirectory) folderName = folderName ?? entry.name
      await readLegacyEntry(entry, files)
    }
    return partition(files, folderName)
  }

  return partition(Array.from(transfer.files), null)
}
