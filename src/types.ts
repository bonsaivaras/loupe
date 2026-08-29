export type FlagState = 'pick' | 'none' | 'reject'

/**
 * One healed blemish. Coordinates are in SOURCE image space — normalised, origin
 * top-left, before rotation — so a spot stays on the dust it covers however the
 * photo is later turned or flipped.
 */
export interface Spot {
  id: string
  x: number
  y: number
  /** Source patch centre, same space. */
  sx: number
  sy: number
  /** Radius as a fraction of the image height. */
  radius: number
}

export interface Adjustments {
  exposure: number //  EV, -5 .. 5
  contrast: number //     -100 .. 100
  highlights: number
  shadows: number
  whites: number
  blacks: number
  temp: number
  tint: number
  vibrance: number
  saturation: number
  clarity: number
  sharpen: number //        0 .. 100
  denoise: number //        0 .. 100
  deblur: number //         0 .. 100
  vignette: number
  rotate: 0 | 90 | 180 | 270
  flipH: boolean
  spots: Spot[]
}

export interface PhotoExif {
  camera?: string
  lens?: string
  iso?: number
  fNumber?: number
  exposureTime?: number
  focalLength?: number
  dateTaken?: number
}

export type DecodeState = 'pending' | 'decoding' | 'ready' | 'error'

export interface Photo {
  id: string
  projectId: string
  filename: string
  ext: string
  isRaw: boolean
  bytes: number
  width: number
  height: number
  proxyWidth: number
  proxyHeight: number
  exif: PhotoExif
  flag: FlagState
  adjustments: Adjustments
  decodeState: DecodeState
  decodeError?: string
  createdAt: number
  updatedAt: number
}

export interface Project {
  id: string
  name: string
  createdAt: number
  lastOpenedAt: number
  expiresAt: number
  photoCount: number
  bytesUsed: number
}

export type FilterMode = 'all' | 'pick' | 'none' | 'reject'

/**
 * A preset carries slider values only. Rotation and flip are per-photo
 * geometry, so applying a preset never re-orients someone's picture.
 */
export type PresetAdjustments = Omit<Adjustments, 'rotate' | 'flipH' | 'spots'>

export interface Preset {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  adjustments: PresetAdjustments
  /** Preset folder from an imported Lightroom pack. */
  group?: string
  /** Lightroom settings this app cannot reproduce, kept so the UI can say so. */
  ignored?: string[]
}
