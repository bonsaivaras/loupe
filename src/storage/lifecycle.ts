import { deleteProjectRecords, getAllProjects, getDb, getProject, putProject } from './db'
import { opfsDeleteDir, projectDir } from './opfs'
import { readActiveProjectId, writeActiveProjectId } from './prefs'
import type { Project } from '@/types'

export const TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Reserve headroom so an import never fills the origin quota to the brim. */
export const QUOTA_HEADROOM = 500 * 1024 * 1024

/** Original + proxy + thumbnail, as a multiple of the source file size. */
export const IMPORT_SIZE_FACTOR = 1.35

let persistedFlag: boolean | null = null

export async function requestPersistence(): Promise<boolean> {
  if (persistedFlag !== null) return persistedFlag
  try {
    persistedFlag = (await navigator.storage.persisted()) || (await navigator.storage.persist())
  } catch {
    persistedFlag = false
  }
  return persistedFlag
}

export function persistedState(): boolean | null {
  return persistedFlag
}

export interface StorageStatus {
  usage: number
  quota: number
}

export async function storageStatus(): Promise<StorageStatus> {
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota }
  } catch {
    return { usage: 0, quota: 0 }
  }
}

/** Called once at boot, before any UI renders. */
export async function sweepExpired(): Promise<string[]> {
  const now = Date.now()
  const db = await getDb()
  const expired = await db.getAllFromIndex('projects', 'expiresAt', IDBKeyRange.upperBound(now))
  for (const p of expired) await wipeProject(p.id)
  return expired.map((p) => p.id)
}

/** Deletes any OPFS project directory with no matching IndexedDB record. */
export async function sweepOrphans(): Promise<void> {
  try {
    const known = new Set((await getAllProjects()).map((p) => p.id))
    const rootDir = await navigator.storage.getDirectory()
    const projects = await rootDir.getDirectoryHandle('projects').catch(() => null)
    if (!projects) return
    const stale: string[] = []
    for await (const name of projects.keys()) {
      if (!known.has(name)) stale.push(name)
    }
    for (const name of stale) {
      await projects.removeEntry(name, { recursive: true }).catch(() => {})
    }
  } catch {
    /* OPFS unavailable */
  }
}

/** Refreshes the sliding 30-day window. */
export async function touchProject(id: string): Promise<Project | undefined> {
  const project = await getProject(id)
  if (!project) return undefined
  const now = Date.now()
  const next: Project = { ...project, lastOpenedAt: now, expiresAt: now + TTL_MS }
  await putProject(next)
  return next
}

/** OPFS directory + photo records + project record + localStorage pointer. */
export async function wipeProject(id: string): Promise<void> {
  await opfsDeleteDir(projectDir(id))
  await deleteProjectRecords(id)
  if (readActiveProjectId() === id) writeActiveProjectId(null)
}
