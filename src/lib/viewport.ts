import type { ViewRect } from '@/engine/gl/renderer'

export const MIN_ZOOM = 1
export const MAX_ZOOM = 8

export interface ViewState {
  /** Multiplier on the fit-to-window scale. 1 is fit. */
  zoom: number
  /** Centre of the visible window, in 0..1 image coordinates. */
  cx: number
  cy: number
}

export const FIT_VIEW: ViewState = { zoom: 1, cx: 0.5, cy: 0.5 }

export interface Viewport {
  /** CSS size of the canvas: the image when it fits, the stage when it doesn't. */
  canvasWidth: number
  canvasHeight: number
  /** Image pixels per CSS pixel at this zoom. */
  scale: number
  view: ViewRect
  /** False when the whole image is on screen, so panning is meaningless. */
  pannable: boolean
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export function clampZoom(zoom: number): number {
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM)
}

/**
 * Exponential, so one pinch or notch feels the same at every zoom level.
 * Trackpad pinches report small deltas continuously; mouse wheels report large
 * ones in steps, so the delta is capped to keep a single notch sane.
 */
export function zoomStep(zoom: number, deltaY: number): number {
  // 0.0025 puts a 100-unit mouse notch at ~1.28x and a small trackpad pinch
  // delta at a percent or two, which is what makes a pinch feel continuous.
  const capped = clamp(deltaY, -200, 200)
  return clampZoom(zoom * Math.exp(-capped * 0.0025))
}

/**
 * Works out what to draw for an image of `imageWidth`x`imageHeight` (already
 * oriented) inside a `stageWidth`x`stageHeight` box.
 *
 * At zoom 1 the image is letterboxed and fully visible. Beyond that the canvas
 * grows to the stage and a sub-rectangle of the image is drawn instead, so the
 * pixels stay at native canvas resolution rather than being scaled up by CSS.
 */
export function computeViewport(
  imageWidth: number,
  imageHeight: number,
  stageWidth: number,
  stageHeight: number,
  padding: number,
  state: ViewState,
): Viewport | null {
  const availableWidth = stageWidth - padding * 2
  const availableHeight = stageHeight - padding * 2
  if (imageWidth < 1 || imageHeight < 1 || availableWidth < 8 || availableHeight < 8) return null

  const fitScale = Math.min(availableWidth / imageWidth, availableHeight / imageHeight)
  const zoom = clampZoom(state.zoom)
  const scale = fitScale * zoom

  const displayedWidth = imageWidth * scale
  const displayedHeight = imageHeight * scale

  // Once the image outgrows the stage it is allowed the full box, padding included.
  const canvasWidth = Math.max(1, Math.round(Math.min(displayedWidth, stageWidth)))
  const canvasHeight = Math.max(1, Math.round(Math.min(displayedHeight, stageHeight)))

  const scaleX = Math.min(1, canvasWidth / displayedWidth)
  const scaleY = Math.min(1, canvasHeight / displayedHeight)

  // A window narrower than the image can slide; one that covers it is pinned.
  const offsetX = scaleX >= 1 ? 0 : clamp(state.cx - scaleX / 2, 0, 1 - scaleX)
  const offsetY = scaleY >= 1 ? 0 : clamp(state.cy - scaleY / 2, 0, 1 - scaleY)

  return {
    canvasWidth,
    canvasHeight,
    scale,
    view: { scaleX, scaleY, offsetX, offsetY },
    pannable: scaleX < 1 || scaleY < 1,
  }
}

/** The zoom at which one image pixel covers one CSS pixel. */
export function oneToOneZoom(
  imageWidth: number,
  imageHeight: number,
  stageWidth: number,
  stageHeight: number,
  padding: number,
): number {
  const fitScale = Math.min(
    (stageWidth - padding * 2) / imageWidth,
    (stageHeight - padding * 2) / imageHeight,
  )
  if (!Number.isFinite(fitScale) || fitScale <= 0) return 1
  return clampZoom(1 / fitScale)
}

/**
 * Re-centres so the image point currently under the pointer stays under it.
 * `px`/`py` are pointer coordinates within the canvas, 0..1.
 */
export function zoomAbout(
  current: Viewport,
  next: Viewport,
  nextZoom: number,
  px: number,
  py: number,
): ViewState {
  // `py` is measured DOWN from the top of the canvas, while the view rect lives
  // in GL's y-UP space. Mixing the two is what makes vertical panning mirrored.
  const anchorX = current.view.offsetX + px * current.view.scaleX
  const anchorY = current.view.offsetY + (1 - py) * current.view.scaleY
  return {
    zoom: nextZoom,
    cx: anchorX - (px - 0.5) * next.view.scaleX,
    cy: anchorY + (py - 0.5) * next.view.scaleY,
  }
}
