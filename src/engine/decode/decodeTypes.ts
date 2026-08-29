import type { PhotoExif } from '@/types'

export const PROXY_LONG_EDGE = 2560
export const THUMB_LONG_EDGE = 320
export const PROXY_QUALITY = 0.92
export const THUMB_QUALITY = 0.8

/** Output of a LibRaw decode, before any pixel post-processing. */
export interface RawDecodeResult {
  rgb: Uint8Array
  width: number
  height: number
  fullWidth: number
  fullHeight: number
  exif: PhotoExif
}

/* ------------------------------------------------------------------ *
 * Media worker contract
 * ------------------------------------------------------------------ */

export interface ProxyFromRgbRequest {
  id: number
  kind: 'proxy-rgb'
  rgb: ArrayBuffer
  width: number
  height: number
  proxyPath: string
  thumbPath: string
  maxLongEdge: number
}

export interface ProxyFromBlobRequest {
  id: number
  kind: 'proxy-blob'
  blob: Blob
  proxyPath: string
  thumbPath: string
  maxLongEdge: number
}

export interface BitmapFromRgbRequest {
  id: number
  kind: 'bitmap-rgb'
  rgb: ArrayBuffer
  width: number
  height: number
}

export interface EncodeRequest {
  id: number
  kind: 'encode'
  pixels: ArrayBuffer
  width: number
  height: number
  targetWidth: number
  targetHeight: number
  mime: string
  quality: number
}

export type MediaRequest =
  | ProxyFromRgbRequest
  | ProxyFromBlobRequest
  | BitmapFromRgbRequest
  | EncodeRequest

/** `Omit` over a union collapses it, so distribute explicitly. */
export type MediaRequestInput =
  | Omit<ProxyFromRgbRequest, 'id'>
  | Omit<ProxyFromBlobRequest, 'id'>
  | Omit<BitmapFromRgbRequest, 'id'>
  | Omit<EncodeRequest, 'id'>

export interface ProxyResponse {
  id: number
  ok: true
  kind: 'proxy'
  proxyWidth: number
  proxyHeight: number
  sourceWidth: number
  sourceHeight: number
  bytes: number
}

export interface BitmapResponse {
  id: number
  ok: true
  kind: 'bitmap'
  bitmap: ImageBitmap
  width: number
  height: number
}

export interface EncodeResponse {
  id: number
  ok: true
  kind: 'encode'
  blob: Blob
}

export interface ErrorResponse {
  id: number
  ok: false
  error: string
}

export type MediaResponse = ProxyResponse | BitmapResponse | EncodeResponse | ErrorResponse
