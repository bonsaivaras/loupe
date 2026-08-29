import type { Adjustments, Spot } from '@/types'

/** Default blemish size, as a fraction of the image height. */
export const DEFAULT_SPOT_RADIUS = 0.02
export const MIN_SPOT_RADIUS = 0.004
export const MAX_SPOT_RADIUS = 0.25

export function clampSpotRadius(radius: number): number {
  return Math.min(MAX_SPOT_RADIUS, Math.max(MIN_SPOT_RADIUS, radius))
}

/**
 * Oriented (what you see) to source (what the file holds) coordinates.
 *
 * This mirrors base.frag exactly, including the vertical flip that exists
 * because an ImageBitmap's first row is at t = 0 while a framebuffer's is at
 * the bottom. Input y is measured UP from the bottom, matching `vUv`; output y
 * is measured DOWN from the top, matching the texture.
 */
export function orientedToSource(
  u: number,
  v: number,
  rotate: number,
  flipH: boolean,
): [number, number] {
  let x = flipH ? 1 - u : u
  let y = v
  let cx = x - 0.5
  let cy = y - 0.5
  if (rotate === 90) [cx, cy] = [-cy, cx]
  else if (rotate === 180) [cx, cy] = [-cx, -cy]
  else if (rotate === 270) [cx, cy] = [cy, -cx]
  x = cx + 0.5
  y = cy + 0.5
  return [x, 1 - y]
}

/** The inverse, for drawing a stored spot back onto the screen. */
export function sourceToOriented(
  x: number,
  y: number,
  rotate: number,
  flipH: boolean,
): [number, number] {
  let cx = x - 0.5
  let cy = 1 - y - 0.5
  if (rotate === 90) [cx, cy] = [cy, -cx]
  else if (rotate === 180) [cx, cy] = [-cx, -cy]
  else if (rotate === 270) [cx, cy] = [-cy, cx]
  const u = cx + 0.5
  return [flipH ? 1 - u : u, cy + 0.5]
}

export function withSpots(adjustments: Adjustments, spots: Spot[]): Adjustments {
  return { ...adjustments, spots }
}

/* ------------------------------------------------------------------ *
 * Automatic source selection
 * ------------------------------------------------------------------ */

export interface SamplePlane {
  data: Uint8ClampedArray
  width: number
  height: number
}

function sampleAt(plane: SamplePlane, x: number, y: number): [number, number, number] {
  const px = Math.min(plane.width - 1, Math.max(0, Math.round(x * plane.width)))
  const py = Math.min(plane.height - 1, Math.max(0, Math.round(y * plane.height)))
  const i = (py * plane.width + px) * 4
  return [plane.data[i], plane.data[i + 1], plane.data[i + 2]]
}

/** Mean and spread of a small disc, used to score how usable a patch is. */
function patchStats(
  plane: SamplePlane,
  cx: number,
  cy: number,
  radius: number,
  aspect: number,
): { mean: [number, number, number]; spread: number } {
  const samples: [number, number, number][] = []
  for (let ring = 0; ring <= 2; ring += 1) {
    const r = (radius * ring) / 2
    const count = ring === 0 ? 1 : ring * 6
    for (let i = 0; i < count; i += 1) {
      const a = (2 * Math.PI * i) / count
      samples.push(sampleAt(plane, cx + (Math.cos(a) * r) / aspect, cy + Math.sin(a) * r))
    }
  }
  const mean: [number, number, number] = [0, 0, 0]
  for (const s of samples) {
    mean[0] += s[0]
    mean[1] += s[1]
    mean[2] += s[2]
  }
  mean[0] /= samples.length
  mean[1] /= samples.length
  mean[2] /= samples.length

  let spread = 0
  for (const s of samples) {
    spread += Math.abs(s[0] - mean[0]) + Math.abs(s[1] - mean[1]) + Math.abs(s[2] - mean[2])
  }
  return { mean, spread: spread / (samples.length * 3) }
}

/**
 * Finds a nearby patch to heal from: close by, similar in tone, and as free of
 * structure as possible, since cloning detail in is what makes a heal obvious.
 * Rings outward so the nearest good match wins.
 */
export function pickSourcePoint(
  plane: SamplePlane,
  x: number,
  y: number,
  radius: number,
  existing: Spot[],
): [number, number] {
  const aspect = plane.width / Math.max(1, plane.height)
  const target = patchStats(plane, x, y, radius, aspect)

  let best: { x: number; y: number; score: number } | null = null
  for (const distance of [2.4, 3.4, 4.6, 6]) {
    for (let i = 0; i < 16; i += 1) {
      const angle = (2 * Math.PI * i) / 16 + distance
      const sx = x + (Math.cos(angle) * radius * distance) / aspect
      const sy = y + Math.sin(angle) * radius * distance

      // Must sit fully inside the frame, and not on another blemish.
      const marginX = radius / aspect
      if (sx < marginX || sx > 1 - marginX || sy < radius || sy > 1 - radius) continue
      const clash = existing.some(
        (spot) => Math.hypot((spot.x - sx) * aspect, spot.y - sy) < (spot.radius + radius) * 1.2,
      )
      if (clash) continue

      const candidate = patchStats(plane, sx, sy, radius, aspect)
      const toneGap =
        Math.abs(candidate.mean[0] - target.mean[0]) +
        Math.abs(candidate.mean[1] - target.mean[1]) +
        Math.abs(candidate.mean[2] - target.mean[2])
      // Flat and similar beats near; distance only breaks ties.
      const score = toneGap * 1.6 + candidate.spread * 2.2 + distance * 3
      if (!best || score < best.score) best = { x: sx, y: sy, score }
    }
    // A clearly good match this close is not worth improving on.
    if (best && best.score < 40) break
  }

  if (best) return [best.x, best.y]
  // Nothing suitable: offset straight down, clamped into frame.
  return [x, Math.min(1 - radius, Math.max(radius, y + radius * 3))]
}
