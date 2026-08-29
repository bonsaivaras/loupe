/**
 * Adobe Camera Raw / Lightroom preset interchange.
 *
 * Reads and writes the `crs:` namespace used by Lightroom Classic, Lightroom CC
 * and Camera Raw `.xmp` presets, and reads the older Lua-based `.lrtemplate`.
 * Settings this app has no slider for are recorded per preset so the UI can say
 * plainly what was dropped rather than pretending the look will match.
 */
import { DEFAULT_ADJUSTMENTS } from '@/lib/adjustments'
import type { PresetAdjustments } from '@/types'

export interface ParsedPreset {
  name: string
  group?: string
  adjustments: PresetAdjustments
  /** `crs:` keys we recognised as adjustments but cannot reproduce. */
  ignored: string[]
}

/* ------------------------------------------------------------------ *
 * Key mapping
 * ------------------------------------------------------------------ */

type SliderKey = keyof PresetAdjustments

/** Lightroom key -> our slider, for the settings that map one-to-one. */
const DIRECT: Record<string, SliderKey> = {
  Exposure2012: 'exposure',
  Contrast2012: 'contrast',
  Highlights2012: 'highlights',
  Shadows2012: 'shadows',
  Whites2012: 'whites',
  Blacks2012: 'blacks',
  Clarity2012: 'clarity',
  Vibrance: 'vibrance',
  Saturation: 'saturation',
}

/** Written back out with the same names, so a round trip is lossless. */
const REVERSE_DIRECT = Object.entries(DIRECT) as [string, SliderKey][]

/**
 * Keys Lightroom writes that carry a real look but that v1 cannot reproduce.
 * Anything not in this list (process version, UUIDs, camera profiles, flags) is
 * bookkeeping and is silently skipped.
 */
const MEANINGFUL_UNSUPPORTED = new Set([
  'Texture', 'Dehaze', 'ToneCurvePV2012', 'ToneCurvePV2012Red', 'ToneCurvePV2012Green',
  'ToneCurvePV2012Blue', 'ParametricShadows', 'ParametricDarks', 'ParametricLights',
  'ParametricHighlights', 'GrainAmount',
  'SharpenRadius', 'SharpenDetail', 'SharpenEdgeMasking', 'DefringeGreenAmount',
  'NoiseReductionDetail', 'NoiseReductionContrast', 'ColorNoiseReductionDetail',
  'DefringePurpleAmount', 'LensProfileEnable', 'AutoLateralCA', 'ConvertToGrayscale',
  'SplitToningShadowHue', 'SplitToningShadowSaturation', 'SplitToningHighlightHue',
  'SplitToningHighlightSaturation', 'ColorGradeMidtoneHue', 'ColorGradeMidtoneSat',
  'ColorGradeShadowLum', 'ColorGradeMidtoneLum', 'ColorGradeHighlightLum',
  'ColorGradeBlending', 'ColorGradeGlobalHue', 'ColorGradeGlobalSat', 'ColorGradeGlobalLum',
  'PostCropVignetteMidpoint', 'PostCropVignetteFeather', 'PostCropVignetteRoundness',
  'PostCropVignetteStyle', 'PostCropVignetteHighlightContrast',
  'ShadowTint', 'RedHue', 'RedSaturation', 'GreenHue', 'GreenSaturation',
  'BlueHue', 'BlueSaturation', 'Look', 'MaskGroupBasedCorrections',
  'CircularGradientBasedCorrections', 'GradientBasedCorrections', 'PaintBasedCorrections',
  'RetouchAreas', 'Clarity', 'Sharpness2012', 'Curve',
])

const HSL_PREFIXES = ['HueAdjustment', 'SaturationAdjustment', 'LuminanceAdjustment']

function isMeaningfulUnsupported(key: string): boolean {
  if (MEANINGFUL_UNSUPPORTED.has(key)) return true
  return HSL_PREFIXES.some((prefix) => key.startsWith(prefix))
}

/* ------------------------------------------------------------------ *
 * Value conversion
 * ------------------------------------------------------------------ */

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function round(v: number, decimals = 0): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

/**
 * Lightroom stores white balance as absolute Kelvin for raw files and as a
 * relative -100..100 offset for everything else. Ours is always relative, so an
 * absolute value is mapped around a 5500 K neutral. That is an approximation and
 * the import summary says so.
 */
export function temperatureToRelative(kelvin: number): number {
  if (Math.abs(kelvin) <= 100) return clamp(kelvin, -100, 100)
  return clamp(round((kelvin - 5500) / 45), -100, 100)
}

function tintToRelative(tint: number): number {
  // Absolute tint runs -150..+150; relative runs -100..+100.
  if (Math.abs(tint) <= 100) return clamp(tint, -100, 100)
  return clamp(round((tint / 150) * 100), -100, 100)
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/**
 * Strict: `parseFloat` happily turns a tone curve like "0, 0, 64, 80" into 0,
 * which would make a real curve look like a neutral setting.
 */
function toNumber(raw: string): number | null {
  const text = raw.trim().replace(/^\+/, '')
  if (text.length === 0 || !/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(text)) return null
  const value = Number.parseFloat(text)
  return Number.isFinite(value) ? value : null
}

/**
 * The identity tone curve, which Lightroom writes into nearly every preset.
 * Treating it as a lost setting would make the warning meaningless.
 */
const IDENTITY_CURVES = new Set(['0,0,255,255', '0,0,128,128,255,255'])

/** A setting explicitly switched off changes nothing, so it is not "lost". */
function isNeutral(raw: string): boolean {
  const text = raw.trim()
  if (/^(false|off|linear)$/i.test(text)) return true
  if (IDENTITY_CURVES.has(text.replace(/\s+/g, ''))) return true
  const value = toNumber(text)
  return value === 0
}

/** Collects every crs: setting, whether written as an attribute or an element. */
function collectCrsSettings(doc: Document): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (node: Element) => {
    for (const attr of Array.from(node.attributes)) {
      if (attr.name.startsWith('crs:')) out.set(attr.name.slice(4), attr.value)
    }
    for (const child of Array.from(node.children)) {
      if (child.nodeName.startsWith('crs:')) {
        const key = child.nodeName.slice(4)
        // Structured values (Name, Group, tone curves) are handled separately.
        if (child.children.length === 0 && child.textContent) {
          out.set(key, child.textContent.trim())
        } else if (!out.has(key)) {
          out.set(key, '__structured__')
        }
      }
      walk(child)
    }
  }
  if (doc.documentElement) walk(doc.documentElement)
  return out
}

/** `<crs:Name><rdf:Alt><rdf:li>…` — Lightroom wraps display strings in rdf:Alt. */
function readAltText(doc: Document, tag: string): string | null {
  const node = doc.getElementsByTagName(`crs:${tag}`)[0]
  if (!node) return null
  const li = node.getElementsByTagName('rdf:li')[0] ?? node.getElementsByTagName('li')[0]
  const text = (li?.textContent ?? node.textContent ?? '').trim()
  return text.length > 0 ? text : null
}

function settingsToAdjustments(settings: Map<string, string>): {
  adjustments: PresetAdjustments
  ignored: string[]
} {
  const adjustments: PresetAdjustments = {
    exposure: DEFAULT_ADJUSTMENTS.exposure,
    contrast: DEFAULT_ADJUSTMENTS.contrast,
    highlights: DEFAULT_ADJUSTMENTS.highlights,
    shadows: DEFAULT_ADJUSTMENTS.shadows,
    whites: DEFAULT_ADJUSTMENTS.whites,
    blacks: DEFAULT_ADJUSTMENTS.blacks,
    temp: DEFAULT_ADJUSTMENTS.temp,
    tint: DEFAULT_ADJUSTMENTS.tint,
    vibrance: DEFAULT_ADJUSTMENTS.vibrance,
    saturation: DEFAULT_ADJUSTMENTS.saturation,
    clarity: DEFAULT_ADJUSTMENTS.clarity,
    sharpen: DEFAULT_ADJUSTMENTS.sharpen,
    denoise: DEFAULT_ADJUSTMENTS.denoise,
    deblur: DEFAULT_ADJUSTMENTS.deblur,
    vignette: DEFAULT_ADJUSTMENTS.vignette,
  }
  const ignored: string[] = []

  for (const [key, raw] of settings) {
    const direct = DIRECT[key]
    if (direct) {
      const value = toNumber(raw)
      if (value === null) continue
      adjustments[direct] =
        direct === 'exposure' ? clamp(round(value, 2), -5, 5) : clamp(round(value), -100, 100)
      continue
    }

    switch (key) {
      case 'Temperature': {
        const value = toNumber(raw)
        if (value !== null) adjustments.temp = temperatureToRelative(value)
        break
      }
      case 'Tint': {
        const value = toNumber(raw)
        if (value !== null) adjustments.tint = tintToRelative(value)
        break
      }
      case 'LuminanceSmoothing':
      case 'ColorNoiseReduction': {
        // Lightroom splits luminance and colour noise; we have one slider, so
        // take whichever is stronger rather than letting the last one win.
        const value = toNumber(raw)
        if (value !== null) {
          adjustments.denoise = Math.max(adjustments.denoise, clamp(round(value), 0, 100))
        }
        break
      }
      case 'Sharpness': {
        // Lightroom's sharpening runs 0..150; ours stops at 100.
        const value = toNumber(raw)
        if (value !== null) adjustments.sharpen = clamp(round(value), 0, 100)
        break
      }
      case 'PostCropVignetteAmount': {
        // Lightroom: negative darkens the corners. Ours: positive darkens.
        const value = toNumber(raw)
        if (value !== null) adjustments.vignette = clamp(round(-value), -100, 100)
        break
      }
      default: {
        if (!isNeutral(raw) && isMeaningfulUnsupported(key)) ignored.push(key)
        break
      }
    }
  }

  return { adjustments, ignored: [...new Set(ignored)] }
}

export function parseXmpPreset(text: string, fallbackName: string): ParsedPreset | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return null
  const settings = collectCrsSettings(doc)
  if (settings.size === 0) return null

  const { adjustments, ignored } = settingsToAdjustments(settings)
  return {
    name: readAltText(doc, 'Name') ?? settings.get('Name') ?? fallbackName,
    group: readAltText(doc, 'Group') ?? undefined,
    adjustments,
    ignored,
  }
}

/** Older Lightroom Classic `.lrtemplate` files are Lua tables. */
export function parseLrTemplate(text: string, fallbackName: string): ParsedPreset | null {
  const settingsBlock = text.match(/settings\s*=\s*\{([\s\S]*?)\n\s*\}/)
  if (!settingsBlock) return null

  const settings = new Map<string, string>()
  for (const match of settingsBlock[1].matchAll(/([A-Za-z0-9_]+)\s*=\s*(-?[\d.]+|true|false)/g)) {
    settings.set(match[1], match[2])
  }
  if (settings.size === 0) return null

  const title = text.match(/title\s*=\s*"([^"]*)"/)?.[1]
  const internal = text.match(/internalName\s*=\s*"([^"]*)"/)?.[1]
  const { adjustments, ignored } = settingsToAdjustments(settings)
  return { name: title || internal || fallbackName, adjustments, ignored }
}

export function parsePresetFile(filename: string, text: string): ParsedPreset | null {
  const base = filename.replace(/\.[^.]+$/, '')
  if (/\.lrtemplate$/i.test(filename)) return parseLrTemplate(text, base)
  return parseXmpPreset(text, base)
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

function signed(value: number, decimals = 0): string {
  const fixed = value.toFixed(decimals)
  return value > 0 ? `+${fixed}` : fixed
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Emits a Camera Raw preset that Lightroom Classic and Lightroom CC both read. */
export function toXmpPreset(name: string, adjustments: PresetAdjustments, group = 'Loupe'): string {
  const uuid = crypto.randomUUID().replace(/-/g, '').toUpperCase()
  const direct = REVERSE_DIRECT.map(([crsKey, key]) => {
    const value = adjustments[key]
    return `   crs:${crsKey}="${signed(value, key === 'exposure' ? 2 : 0)}"`
  })

  return `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Loupe">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
   xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:PresetType="Normal"
   crs:Cluster=""
   crs:UUID="${uuid}"
   crs:SupportsAmount="False"
   crs:SupportsColor="True"
   crs:SupportsMonochrome="True"
   crs:SupportsHighDynamicRange="True"
   crs:SupportsNormalDynamicRange="True"
   crs:SupportsSceneReferred="True"
   crs:SupportsOutputReferred="True"
   crs:CameraModelRestriction=""
   crs:Version="15.0"
   crs:ProcessVersion="11.0"
${direct.join('\n')}
   crs:Temperature="${signed(adjustments.temp)}"
   crs:Tint="${signed(adjustments.tint)}"
   crs:Sharpness="${Math.round(adjustments.sharpen)}"
   crs:LuminanceSmoothing="${Math.round(adjustments.denoise)}"
   crs:ColorNoiseReduction="${Math.round(adjustments.denoise)}"
   crs:PostCropVignetteAmount="${signed(-adjustments.vignette)}"
   crs:HasSettings="True">
   <crs:Name>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${escapeXml(name)}</rdf:li>
    </rdf:Alt>
   </crs:Name>
   <crs:Group>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${escapeXml(group)}</rdf:li>
    </rdf:Alt>
   </crs:Group>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`
}

export function presetFilename(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, '-').trim()
  return `${safe.length > 0 ? safe : 'preset'}.xmp`
}
