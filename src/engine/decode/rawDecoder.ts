import LibRaw from 'libraw-wasm'
import type { PhotoExif } from '@/types'
import type { RawDecodeResult } from './decodeTypes'

const PROXY_SETTINGS = {
  useCameraWb: true,
  halfSize: true,
  outputBps: 8,
  outputColor: 1, // sRGB
  noAutoBright: true, // must match the full decode or preview != export
  bright: 1.0,
} as const

const FULL_SETTINGS = {
  useCameraWb: true,
  halfSize: false,
  userQual: 3, // AHD
  outputBps: 8,
  outputColor: 1,
  noAutoBright: true,
  bright: 1.0,
} as const

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function readExif(meta: Record<string, unknown> | undefined): PhotoExif {
  if (!meta) return {}
  const lens = meta.lens as { Lens?: string; makernotes?: { Lens?: string } } | undefined
  const camera = `${text(meta.camera_make)} ${text(meta.camera_model)}`.trim()
  const timestamp = meta.timestamp
  const dateTaken =
    timestamp instanceof Date && timestamp.getTime() > 0 ? timestamp.getTime() : undefined
  return {
    camera: camera || undefined,
    lens: text(lens?.Lens) || text(lens?.makernotes?.Lens) || undefined,
    iso: positive(meta.iso_speed),
    fNumber: positive(meta.aperture),
    exposureTime: positive(meta.shutter),
    focalLength: positive(meta.focal_len),
    dateTaken,
  }
}

/**
 * LibRaw's `metadata.width/height` are pre-rotation, so pick whichever
 * orientation matches the aspect of the image it actually produced.
 */
function orientedFullSize(
  meta: Record<string, unknown> | undefined,
  imgWidth: number,
  imgHeight: number,
  halfSize: boolean,
): [number, number] {
  const metaW = positive(meta?.width)
  const metaH = positive(meta?.height)
  if (!metaW || !metaH) {
    const scale = halfSize ? 2 : 1
    return [imgWidth * scale, imgHeight * scale]
  }
  const target = imgWidth / imgHeight
  const upright = Math.abs(metaW / metaH - target)
  const rotated = Math.abs(metaH / metaW - target)
  return rotated < upright ? [metaH, metaW] : [metaW, metaH]
}

export async function decodeWithLibRaw(
  raw: LibRaw,
  buffer: ArrayBuffer,
  mode: 'proxy' | 'full',
): Promise<RawDecodeResult> {
  const halfSize = mode === 'proxy'
  // `open()` transfers the buffer into LibRaw's worker, detaching it. Hand over a
  // copy so the caller keeps its bytes and a retry on a fresh instance is possible.
  await raw.open(new Uint8Array(buffer.slice(0)), halfSize ? PROXY_SETTINGS : FULL_SETTINGS)

  const meta = (await raw.metadata(true)) as unknown as Record<string, unknown> | undefined
  const img = await raw.imageData()
  if (!img) throw new Error('LibRaw returned no image data')
  if (img.colors !== 3) {
    throw new Error(`Unsupported sensor layout (${img.colors} colour channels)`)
  }
  if (img.bits !== 8) {
    throw new Error(`Unexpected bit depth (${img.bits})`)
  }

  const rgb = img.data instanceof Uint8Array ? img.data : new Uint8Array(img.data.buffer)
  const [fullWidth, fullHeight] = orientedFullSize(meta, img.width, img.height, halfSize)

  return {
    rgb,
    width: img.width,
    height: img.height,
    fullWidth: Math.round(fullWidth),
    fullHeight: Math.round(fullHeight),
    exif: readExif(meta),
  }
}

export { LibRaw }

/** Transfers a decoder result without copying, even for offset views. */
export function toTransferable(view: Uint8Array): ArrayBuffer {
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view.buffer as ArrayBuffer
  }
  return view.slice().buffer as ArrayBuffer
}
