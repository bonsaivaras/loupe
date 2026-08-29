import { unzipSync, zipSync } from 'fflate'
import { parsePresetFile, presetFilename, toXmpPreset } from '@/lib/presetFormat'
import type { NewPreset } from '@/store/presetStore'
import type { Preset } from '@/types'

export const PRESET_ACCEPT = '.xmp,.lrtemplate,.zip'

export interface ImportSummary {
  presets: NewPreset[]
  /** Files that were not presets at all, or could not be parsed. */
  rejected: string[]
  /** True if any preset carried Lightroom settings we cannot reproduce. */
  lossy: boolean
}

function isPresetName(name: string): boolean {
  return /\.(xmp|lrtemplate)$/i.test(name) && !name.startsWith('__MACOSX')
}

/** Downloaded packs almost always arrive as a zip of .xmp files. */
function expandZip(name: string, bytes: Uint8Array): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = []
  try {
    const entries = unzipSync(bytes)
    const decoder = new TextDecoder()
    for (const [path, data] of Object.entries(entries)) {
      const base = path.split('/').pop() ?? path
      if (!isPresetName(base) || data.length === 0) continue
      out.push({ name: base, text: decoder.decode(data) })
    }
  } catch {
    // Not a readable archive — reported as a rejection by the caller.
  }
  if (out.length === 0) out.push({ name, text: '' })
  return out
}

export async function readPresetFiles(files: File[]): Promise<ImportSummary> {
  const presets: NewPreset[] = []
  const rejected: string[] = []
  let lossy = false

  for (const file of files) {
    const candidates: { name: string; text: string }[] = []
    if (/\.zip$/i.test(file.name)) {
      candidates.push(...expandZip(file.name, new Uint8Array(await file.arrayBuffer())))
    } else if (isPresetName(file.name)) {
      candidates.push({ name: file.name, text: await file.text() })
    } else {
      rejected.push(file.name)
      continue
    }

    for (const candidate of candidates) {
      const parsed = candidate.text ? parsePresetFile(candidate.name, candidate.text) : null
      if (!parsed) {
        rejected.push(candidate.name)
        continue
      }
      if (parsed.ignored.length > 0) lossy = true
      presets.push({
        name: parsed.name,
        adjustments: parsed.adjustments,
        group: parsed.group,
        ignored: parsed.ignored,
      })
    }
  }

  return { presets, rejected, lossy }
}

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function downloadPreset(preset: Preset): void {
  const xmp = toXmpPreset(preset.name, preset.adjustments, preset.group ?? 'Loupe')
  download(presetFilename(preset.name), new Blob([xmp], { type: 'application/rdf+xml' }))
}

export function downloadAllPresets(presets: Preset[]): void {
  if (presets.length === 0) return
  if (presets.length === 1) {
    downloadPreset(presets[0])
    return
  }
  const encoder = new TextEncoder()
  const taken = new Set<string>()
  const entries: Record<string, Uint8Array> = {}
  for (const preset of presets) {
    let name = presetFilename(preset.name)
    for (let n = 1; taken.has(name.toLowerCase()); n += 1) {
      name = presetFilename(`${preset.name}-${n}`)
    }
    taken.add(name.toLowerCase())
    entries[name] = encoder.encode(
      toXmpPreset(preset.name, preset.adjustments, preset.group ?? 'Loupe'),
    )
  }
  const zipped = zipSync(entries, { level: 6 })
  download('loupe-presets.zip', new Blob([zipped as unknown as BlobPart], { type: 'application/zip' }))
}
