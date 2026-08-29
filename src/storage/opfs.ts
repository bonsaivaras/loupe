/**
 * OPFS binary store.
 *
 *   /projects/{projectId}/orig/{photoId}        original bytes, verbatim
 *   /projects/{projectId}/proxy/{photoId}.jpg   editing proxy
 *   /projects/{projectId}/thumb/{photoId}.jpg   filmstrip thumbnail
 */

export function opfsSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory
}

async function root(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

function splitPath(path: string): { dirs: string[]; name: string } {
  const parts = path.split('/').filter(Boolean)
  const name = parts.pop()
  if (!name) throw new Error(`Invalid OPFS path: ${path}`)
  return { dirs: parts, name }
}

async function dirFor(dirs: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
  let handle = await root()
  for (const d of dirs) {
    try {
      handle = await handle.getDirectoryHandle(d, { create })
    } catch {
      return null
    }
  }
  return handle
}

export async function opfsFileHandle(
  path: string,
  create: boolean,
): Promise<FileSystemFileHandle | null> {
  const { dirs, name } = splitPath(path)
  const dir = await dirFor(dirs, create)
  if (!dir) return null
  try {
    return await dir.getFileHandle(name, { create })
  } catch {
    return null
  }
}

/** Main-thread write. Workers should use opfsWriteSync instead (much faster). */
export async function opfsWrite(path: string, data: ArrayBuffer | Blob): Promise<void> {
  const handle = await opfsFileHandle(path, true)
  if (!handle) throw new Error(`Cannot create ${path}`)
  const writable = await handle.createWritable()
  try {
    await writable.write(data)
  } finally {
    await writable.close()
  }
}

/** Dedicated-worker-only: synchronous access handles are far faster than streams. */
export async function opfsWriteSync(path: string, data: ArrayBuffer): Promise<void> {
  const handle = await opfsFileHandle(path, true)
  if (!handle) throw new Error(`Cannot create ${path}`)
  const access = await handle.createSyncAccessHandle()
  try {
    access.truncate(0)
    access.write(new Uint8Array(data), { at: 0 })
    access.flush()
  } finally {
    access.close()
  }
}

export async function opfsReadFile(path: string): Promise<File | null> {
  const handle = await opfsFileHandle(path, false)
  if (!handle) return null
  try {
    return await handle.getFile()
  } catch {
    return null
  }
}

export async function opfsSize(path: string): Promise<number> {
  const handle = await opfsFileHandle(path, false)
  if (!handle) return 0
  try {
    return (await handle.getFile()).size
  } catch {
    return 0
  }
}

export async function opfsDelete(path: string): Promise<void> {
  const { dirs, name } = splitPath(path)
  const dir = await dirFor(dirs, false)
  if (!dir) return
  try {
    await dir.removeEntry(name)
  } catch {
    /* already gone */
  }
}

export async function opfsDeleteDir(path: string): Promise<void> {
  const { dirs, name } = splitPath(path)
  const dir = await dirFor(dirs, false)
  if (!dir) return
  try {
    await dir.removeEntry(name, { recursive: true })
  } catch {
    /* already gone */
  }
}

export async function opfsUsage(path: string): Promise<number> {
  const parts = path.split('/').filter(Boolean)
  const dir = await dirFor(parts, false)
  if (!dir) return 0
  let total = 0
  const walk = async (d: FileSystemDirectoryHandle): Promise<void> => {
    for await (const [, entry] of d.entries()) {
      if (entry.kind === 'file') {
        try {
          total += (await (entry as FileSystemFileHandle).getFile()).size
        } catch {
          /* skip */
        }
      } else {
        await walk(entry as FileSystemDirectoryHandle)
      }
    }
  }
  await walk(dir)
  return total
}

export const origPath = (projectId: string, photoId: string) =>
  `projects/${projectId}/orig/${photoId}`
export const proxyPath = (projectId: string, photoId: string) =>
  `projects/${projectId}/proxy/${photoId}.jpg`
export const thumbPath = (projectId: string, photoId: string) =>
  `projects/${projectId}/thumb/${photoId}.jpg`
export const projectDir = (projectId: string) => `projects/${projectId}`
