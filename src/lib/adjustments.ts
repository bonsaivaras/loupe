import type { Adjustments, PresetAdjustments, Spot } from '@/types'

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temp: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  clarity: 0,
  sharpen: 0,
  denoise: 0,
  deblur: 0,
  vignette: 0,
  rotate: 0,
  flipH: false,
  spots: [],
}

export type SliderKey =
  | 'exposure'
  | 'contrast'
  | 'highlights'
  | 'shadows'
  | 'whites'
  | 'blacks'
  | 'temp'
  | 'tint'
  | 'vibrance'
  | 'saturation'
  | 'clarity'
  | 'sharpen'
  | 'denoise'
  | 'deblur'
  | 'vignette'

export interface SliderDef {
  key: SliderKey
  label: string
  min: number
  max: number
  step: number
  precision: number
}

export const LIGHT_SLIDERS: SliderDef[] = [
  { key: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.05, precision: 2 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, precision: 0 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1, precision: 0 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1, precision: 0 },
  { key: 'whites', label: 'Whites', min: -100, max: 100, step: 1, precision: 0 },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100, step: 1, precision: 0 },
]

export const COLOR_SLIDERS: SliderDef[] = [
  { key: 'temp', label: 'Temperature', min: -100, max: 100, step: 1, precision: 0 },
  { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1, precision: 0 },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, step: 1, precision: 0 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, precision: 0 },
]

export const EFFECT_SLIDERS: SliderDef[] = [
  { key: 'clarity', label: 'Clarity', min: -100, max: 100, step: 1, precision: 0 },
  { key: 'sharpen', label: 'Sharpness', min: 0, max: 100, step: 1, precision: 0 },
  { key: 'denoise', label: 'Noise reduction', min: 0, max: 100, step: 1, precision: 0 },
  { key: 'deblur', label: 'Deconvolve', min: 0, max: 100, step: 1, precision: 0 },
  { key: 'vignette', label: 'Vignette', min: -100, max: 100, step: 1, precision: 0 },
]

export const ALL_SLIDERS: SliderDef[] = [...LIGHT_SLIDERS, ...COLOR_SLIDERS, ...EFFECT_SLIDERS]

/**
 * Fills in fields added after a photo or preset was written. Records on disk
 * predate later sliders, and an undefined uniform is a NaN in the shader.
 */
export function normalizeAdjustments(a: Partial<Adjustments> | undefined): Adjustments {
  return { ...DEFAULT_ADJUSTMENTS, ...a, spots: a?.spots ?? [] }
}

export function spotsEqual(a: Spot[], b: Spot[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((spot, i) => {
    const other = b[i]
    return (
      spot.id === other.id &&
      spot.x === other.x &&
      spot.y === other.y &&
      spot.sx === other.sx &&
      spot.sy === other.sy &&
      spot.radius === other.radius
    )
  })
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/** Snap to the slider's step grid so typed and dragged values compare equal. */
export function snap(v: number, def: SliderDef): number {
  const stepped = Math.round(v / def.step) * def.step
  return clamp(Number(stepped.toFixed(6)), def.min, def.max)
}

export function isDefault(a: Adjustments): boolean {
  return ALL_SLIDERS.every((d) => a[d.key] === DEFAULT_ADJUSTMENTS[d.key])
}

/**
 * Whether a photo carries any edit at all. Unlike `isDefault`, which drives the
 * reset controls and covers sliders only, this counts rotation and flip — they
 * change the exported file just as much.
 */
export function hasEdits(a: Adjustments): boolean {
  return !isDefault(a) || a.rotate !== 0 || a.flipH || a.spots.length > 0
}

export function sectionIsDefault(a: Adjustments, defs: SliderDef[]): boolean {
  return defs.every((d) => a[d.key] === DEFAULT_ADJUSTMENTS[d.key])
}

export function resetSection(a: Adjustments, defs: SliderDef[]): Adjustments {
  const next = { ...a }
  for (const d of defs) next[d.key] = DEFAULT_ADJUSTMENTS[d.key]
  return next
}

export function adjustmentsEqual(a: Adjustments, b: Adjustments): boolean {
  return (
    a.rotate === b.rotate &&
    a.flipH === b.flipH &&
    spotsEqual(a.spots, b.spots) &&
    ALL_SLIDERS.every((d) => a[d.key] === b[d.key])
  )
}

/** Geometry is preserved when showing the "before" state, matching Lightroom. */
export function toBefore(a: Adjustments): Adjustments {
  // Spots are an edit, so "before" shows the blemishes back in place.
  return { ...DEFAULT_ADJUSTMENTS, rotate: a.rotate, flipH: a.flipH, spots: [] }
}

/** Everything a preset stores — the slider set, without geometry. */
export function toPresetAdjustments(a: Adjustments): PresetAdjustments {
  const { rotate: _rotate, flipH: _flipH, spots: _spots, ...rest } = a
  return rest
}

/** Applies a preset over a photo, keeping that photo's own rotation and flip. */
export function applyPresetAdjustments(
  a: Adjustments,
  preset: PresetAdjustments,
): Adjustments {
  // Geometry and spots belong to the photo, never to the preset.
  return { ...preset, rotate: a.rotate, flipH: a.flipH, spots: a.spots }
}

/** Human-readable list of what a preset actually changes, for the UI. */
export function describePreset(preset: PresetAdjustments): string {
  const touched = ALL_SLIDERS.filter((d) => preset[d.key] !== DEFAULT_ADJUSTMENTS[d.key])
  if (touched.length === 0) return 'No adjustments'
  return touched
    .map((d) => {
      const value = preset[d.key]
      const text = d.precision > 0 ? value.toFixed(d.precision) : String(Math.round(value))
      return `${d.label} ${value > 0 ? '+' : ''}${text}`
    })
    .join(' · ')
}

/** What has been changed on a photo, for the filmstrip's edited badge. */
export function describeAdjustments(a: Adjustments): string {
  const parts: string[] = []
  const sliders = describePreset(toPresetAdjustments(a))
  if (sliders !== 'No adjustments') parts.push(sliders)
  if (a.rotate !== 0) parts.push(`Rotated ${a.rotate}\u00b0`)
  if (a.flipH) parts.push('Flipped')
  if (a.spots.length > 0) {
    parts.push(`${a.spots.length} spot${a.spots.length === 1 ? '' : 's'} removed`)
  }
  return parts.length > 0 ? parts.join(' \u00b7 ') : 'No adjustments'
}
