import { normalizeAdjustments, toPresetAdjustments } from '@/lib/adjustments'
import type { Preset } from '@/types'

/**
 * Presets live in localStorage, not IndexedDB or OPFS. They are a few hundred
 * bytes each, they must survive a project wipe and the 30-day sweep, and a
 * synchronous read means the list is on screen the moment the app boots.
 */
const PRESETS_KEY = 'll:presets'

/** Well under the ~5 MiB origin cap, but enough for a large downloaded pack. */
const MAX_PRESETS = 500

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** localStorage is user-editable and shared with older builds — validate it. */
function isPreset(value: unknown): value is Preset {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  if (typeof p.id !== 'string' || typeof p.name !== 'string') return false
  const a = p.adjustments as Record<string, unknown> | undefined
  if (typeof a !== 'object' || a === null) return false
  return (
    isNumber(a.exposure) &&
    isNumber(a.contrast) &&
    isNumber(a.highlights) &&
    isNumber(a.shadows) &&
    isNumber(a.whites) &&
    isNumber(a.blacks) &&
    isNumber(a.temp) &&
    isNumber(a.tint) &&
    isNumber(a.vibrance) &&
    isNumber(a.saturation) &&
    isNumber(a.clarity) &&
    isNumber(a.sharpen) &&
    isNumber(a.vignette)
  )
}

export function readPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isPreset).map((preset) => ({
      ...preset,
      // A preset saved by an older build has no field for a newer slider.
      adjustments: toPresetAdjustments(normalizeAdjustments(preset.adjustments)),
    }))
  } catch {
    return []
  }
}

export class PresetStorageFullError extends Error {
  constructor() {
    super('No room left for more presets')
    this.name = 'PresetStorageFullError'
  }
}

export function writePresets(presets: Preset[]): void {
  if (presets.length > MAX_PRESETS) throw new PresetStorageFullError()
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets))
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'QuotaExceededError' || /quota/i.test(String(error))) {
      throw new PresetStorageFullError()
    }
    throw error
  }
}

export { MAX_PRESETS }
