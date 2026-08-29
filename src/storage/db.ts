import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Photo, Project } from '@/types'
import { normalizeAdjustments } from '@/lib/adjustments'

interface LoupeDB extends DBSchema {
  projects: {
    key: string
    value: Project
    indexes: { expiresAt: number }
  }
  photos: {
    key: string
    value: Photo
    indexes: { projectId: string; 'projectId+createdAt': [string, number] }
  }
}

let dbPromise: Promise<IDBPDatabase<LoupeDB>> | null = null

export function getDb(): Promise<IDBPDatabase<LoupeDB>> {
  if (!dbPromise) {
    // The database name is deliberately NOT renamed with the app: changing it
    // would orphan every photo and project already stored on disk.
    dbPromise = openDB<LoupeDB>('lightroom-lite', 1, {
      upgrade(db) {
        const projects = db.createObjectStore('projects', { keyPath: 'id' })
        projects.createIndex('expiresAt', 'expiresAt')
        const photos = db.createObjectStore('photos', { keyPath: 'id' })
        photos.createIndex('projectId', 'projectId')
        photos.createIndex('projectId+createdAt', ['projectId', 'createdAt'])
      },
    })
  }
  return dbPromise
}

export async function putProject(project: Project): Promise<void> {
  const db = await getDb()
  await db.put('projects', project)
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await getDb()
  return db.get('projects', id)
}

export async function getAllProjects(): Promise<Project[]> {
  const db = await getDb()
  return db.getAll('projects')
}

export async function putPhoto(photo: Photo): Promise<void> {
  const db = await getDb()
  await db.put('photos', photo)
}

export async function putPhotos(photos: Photo[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('photos', 'readwrite')
  await Promise.all([...photos.map((p) => tx.store.put(p)), tx.done])
}

export async function getPhotosForProject(projectId: string): Promise<Photo[]> {
  const db = await getDb()
  const photos = await db.getAllFromIndex(
    'photos',
    'projectId+createdAt',
    IDBKeyRange.bound([projectId, -Infinity], [projectId, Infinity]),
  )
  // Records predate later sliders; fill in anything missing before the shader
  // ever sees them.
  return photos.map((photo) => ({
    ...photo,
    adjustments: normalizeAdjustments(photo.adjustments),
  }))
}

export async function deletePhotoRecords(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const db = await getDb()
  const tx = db.transaction('photos', 'readwrite')
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done])
}

export async function deleteProjectRecords(projectId: string): Promise<void> {
  const db = await getDb()
  const keys = await db.getAllKeysFromIndex('photos', 'projectId', projectId)
  const tx = db.transaction(['photos', 'projects'], 'readwrite')
  await Promise.all([
    ...keys.map((k) => tx.objectStore('photos').delete(k)),
    tx.objectStore('projects').delete(projectId),
    tx.done,
  ])
}
