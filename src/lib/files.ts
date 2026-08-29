export const RAW_EXTENSIONS = [
  'cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'orf', 'raf',
  'rw2', 'pef', 'dng', '3fr', 'iiq', 'raw',
] as const

export const BITMAP_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff'] as const

const RAW_SET = new Set<string>(RAW_EXTENSIONS)
const BITMAP_SET = new Set<string>(BITMAP_EXTENSIONS)

/** exifr only parses these containers; everything else must be skipped, not caught. */
const EXIFR_SET = new Set(['jpg', 'jpeg', 'tif', 'tiff', 'png', 'heic', 'avif', 'iiq'])

export function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase()
}

export function baseNameOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot <= 0 ? filename : filename.slice(0, dot)
}

export function isSupported(filename: string): boolean {
  const e = extOf(filename)
  return RAW_SET.has(e) || BITMAP_SET.has(e)
}

export function isRawExt(ext: string): boolean {
  return RAW_SET.has(ext)
}

export function exifrSupports(ext: string): boolean {
  return EXIFR_SET.has(ext)
}

/**
 * Extension list for the file picker's `accept`. Without it macOS shows every
 * file as selectable, which makes it unclear that RAW is supported at all; with
 * it, .NEF and friends are the ones that stay enabled. Extension matching is
 * case-insensitive, so `DSC_0461.NEF` matches `.nef`.
 */
export const ACCEPT_ATTRIBUTE = [...RAW_EXTENSIONS, ...BITMAP_EXTENSIONS]
  .map((ext) => `.${ext}`)
  .join(',')

export const ACCEPTED_LABEL =
  'CR2 · CR3 · NEF · NRW · ARW · SRF · SR2 · ORF · RAF · RW2 · PEF · DNG · 3FR · IIQ · RAW · JPEG · PNG · WebP · TIFF'

export interface PatternContext {
  name: string
  index: number
  camera: string
}

/** Filename pattern tokens: {name} {n} {date} {camera} */
export function applyPattern(pattern: string, ctx: PatternContext): string {
  const now = new Date()
  const date =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0')
  const out = pattern
    .replace(/\{name\}/g, ctx.name)
    .replace(/\{n\}/g, String(ctx.index).padStart(3, '0'))
    .replace(/\{date\}/g, date)
    .replace(/\{camera\}/g, ctx.camera)
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim()
  return out.length > 0 ? out : ctx.name
}

export function uniqueName(taken: Set<string>, base: string, ext: string): string {
  let candidate = `${base}.${ext}`
  let n = 1
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base}-${n}.${ext}`
    n += 1
  }
  taken.add(candidate.toLowerCase())
  return candidate
}
