import { create } from 'zustand'
import type { Adjustments, FilterMode, FlagState, Photo, Project } from '@/types'
import { putPhoto, putProject } from '@/storage/db'
import { writeActiveProjectId } from '@/storage/prefs'

export interface ImportProgress {
  active: boolean
  total: number
  done: number
  failed: number
  bytesRead: number
  startedAt: number
  label: string
}

const IDLE_IMPORT: ImportProgress = {
  active: false,
  total: 0,
  done: 0,
  failed: 0,
  bytesRead: 0,
  startedAt: 0,
  label: '',
}

interface ProjectState {
  project: Project | null
  photos: Record<string, Photo>
  order: string[]
  selectedId: string | null
  filter: FilterMode
  importProgress: ImportProgress
  /** Photo ids exported during this session — drives the Finish warning. */
  exported: Set<string>
  booted: boolean

  setBooted: (booted: boolean) => void
  loadProject: (project: Project, photos: Photo[]) => void
  closeProject: () => void
  setFilter: (filter: FilterMode) => void
  select: (id: string | null) => void
  addPhotos: (photos: Photo[]) => void
  removePhotos: (ids: string[]) => void
  patchPhoto: (id: string, patch: Partial<Photo>, persist?: boolean) => void
  setAdjustments: (id: string, adjustments: Adjustments) => void
  /**
   * `advance` moves to the next photo after a decision, the way culling wants.
   * Independently of it, the selection never stays on a photo the active filter
   * has just hidden.
   */
  setFlag: (id: string, flag: FlagState, advance?: boolean) => void
  updateProject: (patch: Partial<Project>) => void
  setImportProgress: (patch: Partial<ImportProgress>) => void
  resetImportProgress: () => void
  markExported: (ids: string[]) => void
}

/** Adjustment writes are debounced per photo — never one write per slider frame. */
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>()
const WRITE_DEBOUNCE_MS = 400

function schedulePhotoWrite(photo: Photo): void {
  const existing = pendingWrites.get(photo.id)
  if (existing) clearTimeout(existing)
  pendingWrites.set(
    photo.id,
    setTimeout(() => {
      pendingWrites.delete(photo.id)
      const latest = useProjectStore.getState().photos[photo.id]
      if (latest) void putPhoto(latest)
    }, WRITE_DEBOUNCE_MS),
  )
}

export function flushPhotoWrites(): void {
  for (const [id, timer] of pendingWrites) {
    clearTimeout(timer)
    const latest = useProjectStore.getState().photos[id]
    if (latest) void putPhoto(latest)
  }
  pendingWrites.clear()
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  photos: {},
  order: [],
  selectedId: null,
  filter: 'all',
  importProgress: IDLE_IMPORT,
  exported: new Set<string>(),
  booted: false,

  setBooted: (booted) => set({ booted }),

  loadProject: (project, photos) => {
    const map: Record<string, Photo> = {}
    for (const p of photos) map[p.id] = p
    const order = photos.map((p) => p.id)
    writeActiveProjectId(project.id)
    set({
      project,
      photos: map,
      order,
      selectedId: order[0] ?? null,
      exported: new Set<string>(),
    })
  },

  closeProject: () => {
    writeActiveProjectId(null)
    set({
      project: null,
      photos: {},
      order: [],
      selectedId: null,
      importProgress: IDLE_IMPORT,
      exported: new Set<string>(),
    })
  },

  setFilter: (filter) => {
    set({ filter })
    // Keep the selection on something the user can actually see.
    const state = get()
    const visible = visibleIds(state)
    if (state.selectedId && !visible.includes(state.selectedId)) {
      set({ selectedId: visible[0] ?? null })
    }
  },

  select: (id) => set({ selectedId: id }),

  addPhotos: (incoming) =>
    set((state) => {
      const photos = { ...state.photos }
      const order = [...state.order]
      for (const p of incoming) {
        if (!photos[p.id]) order.push(p.id)
        photos[p.id] = p
      }
      return {
        photos,
        order,
        selectedId: state.selectedId ?? order[0] ?? null,
      }
    }),

  /**
   * Drops photos from the in-memory project and moves the selection to the
   * nearest survivor. Storage cleanup is handled by `deletePhotos`.
   */
  removePhotos: (ids) =>
    set((state) => {
      const doomed = new Set(ids)
      const photos = { ...state.photos }
      for (const id of doomed) delete photos[id]
      const order = state.order.filter((id) => !doomed.has(id))

      let selectedId = state.selectedId
      if (selectedId && doomed.has(selectedId)) {
        // Prefer the next photo that survived, then the previous one.
        const visible = visibleIds(state)
        const from = visible.indexOf(selectedId)
        const after = visible.slice(from + 1).find((id) => !doomed.has(id))
        const before = visible
          .slice(0, Math.max(0, from))
          .reverse()
          .find((id) => !doomed.has(id))
        selectedId = after ?? before ?? order[0] ?? null
      }

      const exported = new Set(state.exported)
      for (const id of doomed) exported.delete(id)

      return { photos, order, selectedId, exported }
    }),

  patchPhoto: (id, patch, persist = true) => {
    const current = get().photos[id]
    if (!current) return
    const next: Photo = { ...current, ...patch, updatedAt: Date.now() }
    set((state) => ({ photos: { ...state.photos, [id]: next } }))
    if (persist) void putPhoto(next)
  },

  setAdjustments: (id, adjustments) => {
    const current = get().photos[id]
    if (!current) return
    const next: Photo = { ...current, adjustments, updatedAt: Date.now() }
    set((state) => ({ photos: { ...state.photos, [id]: next } }))
    schedulePhotoWrite(next)
  },

  setFlag: (id, flag, advance = false) => {
    const state = get()
    const current = state.photos[id]
    if (!current || current.flag === flag) return

    // Capture the running order before the flag changes what the filter shows.
    const before = visibleIds(state)
    const index = before.indexOf(id)

    const next: Photo = { ...current, flag, updatedAt: Date.now() }
    set((s) => ({ photos: { ...s.photos, [id]: next } }))
    void putPhoto(next)

    if (state.selectedId !== id || index < 0) return
    const after = new Set(visibleIds(get()))
    // Staying put is only an option while the photo is still on screen.
    if (!advance && after.has(id)) return

    const forward = before.slice(index + 1).find((candidate) => after.has(candidate))
    const backward = before
      .slice(0, index)
      .reverse()
      .find((candidate) => after.has(candidate))
    set({ selectedId: forward ?? backward ?? null })
  },

  updateProject: (patch) => {
    const current = get().project
    if (!current) return
    const next: Project = { ...current, ...patch }
    set({ project: next })
    void putProject(next)
  },

  setImportProgress: (patch) =>
    set((state) => ({ importProgress: { ...state.importProgress, ...patch } })),

  resetImportProgress: () => set({ importProgress: IDLE_IMPORT }),

  markExported: (ids) =>
    set((state) => {
      const exported = new Set(state.exported)
      for (const id of ids) exported.add(id)
      return { exported }
    }),
}))

/* ------------------------------------------------------------------ *
 * Derived selectors
 * ------------------------------------------------------------------ */

export function matchesFilter(photo: Photo, filter: FilterMode): boolean {
  return filter === 'all' || photo.flag === filter
}

export function visibleIds(state: ProjectState): string[] {
  if (state.filter === 'all') return state.order
  return state.order.filter((id) => {
    const photo = state.photos[id]
    return photo ? matchesFilter(photo, state.filter) : false
  })
}

export function pickedIds(state: ProjectState): string[] {
  return state.order.filter((id) => state.photos[id]?.flag === 'pick')
}

export function selectedPhoto(state: ProjectState): Photo | null {
  return state.selectedId ? (state.photos[state.selectedId] ?? null) : null
}

export function flagCounts(state: ProjectState): {
  pick: number
  none: number
  reject: number
  total: number
} {
  let pick = 0
  let none = 0
  let reject = 0
  for (const id of state.order) {
    const photo = state.photos[id]
    if (!photo) continue
    if (photo.flag === 'pick') pick += 1
    else if (photo.flag === 'reject') reject += 1
    else none += 1
  }
  return { pick, none, reject, total: state.order.length }
}
