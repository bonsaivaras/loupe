import { create } from 'zustand'
import { readPresets, writePresets } from '@/storage/presets'
import type { Preset, PresetAdjustments } from '@/types'

interface PresetState {
  presets: Preset[]
  create: (input: NewPreset) => Preset
  createMany: (inputs: NewPreset[]) => Preset[]
  rename: (id: string, name: string) => void
  update: (id: string, adjustments: PresetAdjustments) => void
  remove: (id: string) => void
  nameTaken: (name: string, exceptId?: string) => boolean
  /** Returns a name that does not collide, e.g. "Warm 2". */
  uniqueName: (name: string) => string
}

export interface NewPreset {
  name: string
  adjustments: PresetAdjustments
  group?: string
  ignored?: string[]
}

/** Alphabetical, numeric-aware — the order stays predictable as the list grows. */
function sortPresets(presets: Preset[]): Preset[] {
  return [...presets].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  )
}

function commit(presets: Preset[]): Preset[] {
  const sorted = sortPresets(presets)
  writePresets(sorted)
  return sorted
}

function build(input: NewPreset): Preset {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    createdAt: now,
    updatedAt: now,
    adjustments: input.adjustments,
    group: input.group,
    // Cap the list: it is shown as a warning, not used for anything else.
    ignored: input.ignored && input.ignored.length > 0 ? input.ignored.slice(0, 12) : undefined,
  }
}

export const usePresetStore = create<PresetState>((set, get) => ({
  presets: sortPresets(readPresets()),

  create: (input) => {
    const preset = build(input)
    set((state) => ({ presets: commit([...state.presets, preset]) }))
    return preset
  },

  createMany: (inputs) => {
    const built = inputs.map(build)
    set((state) => ({ presets: commit([...state.presets, ...built]) }))
    return built
  },

  rename: (id, name) =>
    set((state) => ({
      presets: commit(
        state.presets.map((p) =>
          p.id === id ? { ...p, name: name.trim(), updatedAt: Date.now() } : p,
        ),
      ),
    })),

  update: (id, adjustments) =>
    set((state) => ({
      presets: commit(
        state.presets.map((p) =>
          // Re-saving from the current sliders clears any "unsupported" note.
          p.id === id
            ? { ...p, adjustments, ignored: undefined, updatedAt: Date.now() }
            : p,
        ),
      ),
    })),

  remove: (id) =>
    set((state) => ({ presets: commit(state.presets.filter((p) => p.id !== id)) })),

  nameTaken: (name, exceptId) => {
    const target = name.trim().toLowerCase()
    return get().presets.some((p) => p.id !== exceptId && p.name.toLowerCase() === target)
  },

  uniqueName: (name) => {
    const base = name.trim() || 'Preset'
    if (!get().nameTaken(base)) return base
    for (let n = 2; n < 1000; n += 1) {
      const candidate = `${base} ${n}`
      if (!get().nameTaken(candidate)) return candidate
    }
    return `${base} ${Date.now()}`
  },
}))
