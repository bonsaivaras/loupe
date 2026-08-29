import { create } from 'zustand'
import { readUiPrefs, writeUiPrefs, type UiPrefs } from '@/storage/prefs'

interface UiState extends UiPrefs {
  /** Held while `B` is down; sticky while toggled with `\`. */
  beforeHeld: boolean
  beforeSticky: boolean
  exportOpen: boolean
  finishOpen: boolean
  shortcutsOpen: boolean
  quotaWarning: string | null
  /** Spot-removal mode: clicks on the photo place heals instead of doing nothing. */
  spotMode: boolean
  spotRadius: number
  selectedSpotId: string | null
  /** Viewer zoom and pan. Reset whenever the photo changes. */
  viewZoom: number
  viewCx: number
  viewCy: number
  /** Photo ids awaiting delete confirmation; null when no prompt is open. */
  pendingDelete: string[] | null
  fitToken: number
  /** Bumped when the GL source texture must be re-uploaded (e.g. after export). */
  sourceToken: number

  setPanelSizes: (filmstripPct: number, inspectorPct: number) => void
  setBeforeHeld: (held: boolean) => void
  toggleBeforeSticky: () => void
  setExportOpen: (open: boolean) => void
  setFinishOpen: (open: boolean) => void
  setShortcutsOpen: (open: boolean) => void
  setQuotaWarning: (message: string | null) => void
  setSpotMode: (on: boolean) => void
  setSpotRadius: (radius: number) => void
  selectSpot: (id: string | null) => void
  setView: (next: { zoom: number; cx: number; cy: number }) => void
  resetView: () => void
  requestDelete: (ids: string[]) => void
  cancelDelete: () => void
  requestFit: () => void
  invalidateSource: () => void
  anyDialogOpen: () => boolean
}

const initial = readUiPrefs()

export const useUiStore = create<UiState>((set, get) => ({
  ...initial,
  beforeHeld: false,
  beforeSticky: false,
  exportOpen: false,
  finishOpen: false,
  shortcutsOpen: false,
  quotaWarning: null,
  spotMode: false,
  spotRadius: 0.02,
  selectedSpotId: null,
  viewZoom: 1,
  viewCx: 0.5,
  viewCy: 0.5,
  pendingDelete: null,
  fitToken: 0,
  sourceToken: 0,

  setPanelSizes: (filmstripPct, inspectorPct) => {
    set({ filmstripPct, inspectorPct })
    const { filter } = get()
    writeUiPrefs({ filmstripPct, inspectorPct, filter })
  },

  setBeforeHeld: (beforeHeld) => set({ beforeHeld }),
  toggleBeforeSticky: () => set((state) => ({ beforeSticky: !state.beforeSticky })),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setFinishOpen: (finishOpen) => set({ finishOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setQuotaWarning: (quotaWarning) => set({ quotaWarning }),
  setSpotMode: (spotMode) => set({ spotMode, selectedSpotId: spotMode ? null : null }),
  setSpotRadius: (spotRadius) => set({ spotRadius }),
  selectSpot: (selectedSpotId) => set({ selectedSpotId }),
  setView: ({ zoom, cx, cy }) => set({ viewZoom: zoom, viewCx: cx, viewCy: cy }),
  resetView: () => set({ viewZoom: 1, viewCx: 0.5, viewCy: 0.5 }),
  requestDelete: (ids) => set({ pendingDelete: ids.length > 0 ? ids : null }),
  cancelDelete: () => set({ pendingDelete: null }),
  requestFit: () => set((state) => ({ fitToken: state.fitToken + 1 })),
  invalidateSource: () => set((state) => ({ sourceToken: state.sourceToken + 1 })),
  anyDialogOpen: () => {
    const s = get()
    return (
      s.exportOpen ||
      s.finishOpen ||
      s.shortcutsOpen ||
      s.quotaWarning !== null ||
      s.pendingDelete !== null
    )
  },
}))

/** Filter lives in the project store but is persisted alongside panel sizes. */
export function persistFilter(filter: UiPrefs['filter']): void {
  const { filmstripPct, inspectorPct } = useUiStore.getState()
  writeUiPrefs({ filmstripPct, inspectorPct, filter })
}

export const initialFilter = initial.filter
