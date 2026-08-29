import { create } from 'zustand'
import type { Adjustments } from '@/types'
import { adjustmentsEqual } from '@/lib/adjustments'
import { useProjectStore } from './projectStore'

const MAX_HISTORY = 50

interface History {
  past: Adjustments[]
  future: Adjustments[]
}

interface EditState {
  history: Record<string, History>
  /**
   * Value each photo had before the interaction currently in flight. Live
   * slider frames overwrite the photo long before the commit boundary fires,
   * so the undo entry has to be captured on the first preview.
   */
  baseline: Record<string, Adjustments>
  /** Bumped on every commit so components can re-read undo availability. */
  revision: number
  /** Live update while dragging or hovering a preset. Writes no history. */
  preview: (photoId: string, next: Adjustments) => void
  /** Abandons an in-flight preview, restoring the value it started from. */
  cancelPreview: (photoId: string) => void
  commit: (photoId: string, next: Adjustments) => void
  undo: (photoId: string) => void
  redo: (photoId: string) => void
  /** Drops history for photos that no longer exist. */
  forget: (photoIds: string[]) => void
  canUndo: (photoId: string) => boolean
  canRedo: (photoId: string) => boolean
  clear: () => void
}

export const useEditStore = create<EditState>((set, get) => ({
  history: {},
  baseline: {},
  revision: 0,

  preview: (photoId, next) => {
    const project = useProjectStore.getState()
    const photo = project.photos[photoId]
    if (!photo) return
    if (get().baseline[photoId] === undefined) {
      set((state) => ({ baseline: { ...state.baseline, [photoId]: photo.adjustments } }))
    }
    project.setAdjustments(photoId, next)
  },

  cancelPreview: (photoId) => {
    const baseline = get().baseline[photoId]
    if (baseline === undefined) return
    useProjectStore.getState().setAdjustments(photoId, baseline)
    set((state) => {
      const next = { ...state.baseline }
      delete next[photoId]
      return { baseline: next }
    })
  },

  /**
   * Pushes the pre-interaction value onto the undo stack. Called from the
   * commit boundary (pointer-up, keyboard, button) — never per animation frame.
   */
  commit: (photoId, next) => {
    const project = useProjectStore.getState()
    const photo = project.photos[photoId]
    if (!photo) return
    const previous = get().baseline[photoId] ?? photo.adjustments

    project.setAdjustments(photoId, next)
    set((state) => {
      const baseline = { ...state.baseline }
      delete baseline[photoId]
      if (adjustmentsEqual(previous, next)) return { baseline }
      const entry = state.history[photoId] ?? { past: [], future: [] }
      const past = [...entry.past, previous]
      if (past.length > MAX_HISTORY) past.shift()
      return {
        baseline,
        history: { ...state.history, [photoId]: { past, future: [] } },
        revision: state.revision + 1,
      }
    })
  },

  undo: (photoId) => {
    const entry = get().history[photoId]
    if (!entry || entry.past.length === 0) return
    const project = useProjectStore.getState()
    const photo = project.photos[photoId]
    if (!photo) return
    const past = [...entry.past]
    const restored = past.pop() as Adjustments
    project.setAdjustments(photoId, restored)
    set((state) => {
      const baseline = { ...state.baseline }
      delete baseline[photoId]
      return {
        baseline,
        history: {
          ...state.history,
          [photoId]: { past, future: [...entry.future, photo.adjustments] },
        },
        revision: state.revision + 1,
      }
    })
  },

  redo: (photoId) => {
    const entry = get().history[photoId]
    if (!entry || entry.future.length === 0) return
    const project = useProjectStore.getState()
    const photo = project.photos[photoId]
    if (!photo) return
    const future = [...entry.future]
    const restored = future.pop() as Adjustments
    project.setAdjustments(photoId, restored)
    set((state) => {
      const baseline = { ...state.baseline }
      delete baseline[photoId]
      return {
        baseline,
        history: {
          ...state.history,
          [photoId]: { past: [...entry.past, photo.adjustments], future },
        },
        revision: state.revision + 1,
      }
    })
  },

  forget: (photoIds) =>
    set((state) => {
      const history = { ...state.history }
      const baseline = { ...state.baseline }
      for (const id of photoIds) {
        delete history[id]
        delete baseline[id]
      }
      return { history, baseline }
    }),

  canUndo: (photoId) => (get().history[photoId]?.past.length ?? 0) > 0,
  canRedo: (photoId) => (get().history[photoId]?.future.length ?? 0) > 0,
  clear: () => set({ history: {}, baseline: {}, revision: 0 }),
}))
