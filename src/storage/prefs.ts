import type { FilterMode } from '@/types'

const ACTIVE_PROJECT_KEY = 'll:activeProjectId'
const UI_PREFS_KEY = 'll:uiPrefs'

export interface UiPrefs {
  filmstripPct: number
  inspectorPct: number
  filter: FilterMode
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  filmstripPct: 15,
  inspectorPct: 22,
  filter: 'all',
}

export function readActiveProjectId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY)
  } catch {
    return null
  }
}

export function writeActiveProjectId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_PROJECT_KEY, id)
    else localStorage.removeItem(ACTIVE_PROJECT_KEY)
  } catch {
    /* storage disabled */
  }
}

export function readUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY)
    if (!raw) return DEFAULT_UI_PREFS
    const parsed = JSON.parse(raw) as Partial<UiPrefs>
    return {
      filmstripPct: clampPct(parsed.filmstripPct, DEFAULT_UI_PREFS.filmstripPct),
      inspectorPct: clampPct(parsed.inspectorPct, DEFAULT_UI_PREFS.inspectorPct),
      filter: (['all', 'pick', 'none', 'reject'] as const).includes(parsed.filter as FilterMode)
        ? (parsed.filter as FilterMode)
        : 'all',
    }
  } catch {
    return DEFAULT_UI_PREFS
  }
}

function clampPct(v: unknown, fallback: number): number {
  return typeof v === 'number' && v > 2 && v < 80 ? v : fallback
}

export function writeUiPrefs(prefs: UiPrefs): void {
  try {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* storage disabled */
  }
}

/* Panel drags fire continuously; persist at most once every 400 ms. */
let panelTimer: ReturnType<typeof setTimeout> | undefined
let panelSizes = { filmstripPct: DEFAULT_UI_PREFS.filmstripPct, inspectorPct: DEFAULT_UI_PREFS.inspectorPct }

export function persistPanelSizes(patch: Partial<typeof panelSizes>): void {
  panelSizes = { ...panelSizes, ...patch }
  if (panelTimer) clearTimeout(panelTimer)
  panelTimer = setTimeout(() => {
    const current = readUiPrefs()
    writeUiPrefs({ ...current, ...panelSizes })
  }, 400)
}
