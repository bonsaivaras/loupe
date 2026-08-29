/**
 * Separable Lanczos-3 resampling.
 *
 * The browser's own `createImageBitmap` resize is good at making images smaller
 * but falls back to something bilinear-ish on the way up, which is visibly
 * soft. Lanczos keeps edges crisp. It adds no detail that was not recorded — it
 * is a better interpolator, not a reconstruction.
 */

const RADIUS = 3

function lanczos(x: number): number {
  if (x === 0) return 1
  const a = Math.abs(x)
  if (a >= RADIUS) return 0
  const pix = Math.PI * a
  return (RADIUS * Math.sin(pix) * Math.sin(pix / RADIUS)) / (pix * pix)
}

interface Contribution {
  start: number
  weights: Float32Array
}

/**
 * Weights for every output position along one axis. When shrinking, the filter
 * widens by the scale factor so the kernel averages the pixels being dropped
 * instead of point-sampling past them.
 */
function buildContributions(srcSize: number, dstSize: number): Contribution[] {
  const scale = dstSize / srcSize
  const filterScale = scale < 1 ? 1 / scale : 1
  const support = RADIUS * filterScale
  const out: Contribution[] = []

  for (let i = 0; i < dstSize; i += 1) {
    const centre = (i + 0.5) / scale - 0.5
    const start = Math.max(0, Math.ceil(centre - support))
    const end = Math.min(srcSize - 1, Math.floor(centre + support))
    const count = Math.max(1, end - start + 1)
    const weights = new Float32Array(count)

    let total = 0
    for (let j = 0; j < count; j += 1) {
      const w = lanczos((start + j - centre) / filterScale)
      weights[j] = w
      total += w
    }
    // Normalise so flat areas keep their exact value and edges do not shift.
    if (total !== 0) for (let j = 0; j < count; j += 1) weights[j] /= total
    out.push({ start, weights })
  }
  return out
}

export function lanczosResize(
  src: Uint8ClampedArray<ArrayBuffer>,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Uint8ClampedArray<ArrayBuffer> {
  if (srcWidth === dstWidth && srcHeight === dstHeight) return src

  const horizontal = buildContributions(srcWidth, dstWidth)
  const vertical = buildContributions(srcHeight, dstHeight)

  // Pass one: resample rows, keeping full precision between the two passes.
  const rows = new Float32Array(dstWidth * srcHeight * 4)
  for (let y = 0; y < srcHeight; y += 1) {
    const srcRow = y * srcWidth * 4
    const dstRow = y * dstWidth * 4
    for (let x = 0; x < dstWidth; x += 1) {
      const { start, weights } = horizontal[x]
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let j = 0; j < weights.length; j += 1) {
        const w = weights[j]
        const i = srcRow + (start + j) * 4
        r += src[i] * w
        g += src[i + 1] * w
        b += src[i + 2] * w
        a += src[i + 3] * w
      }
      const o = dstRow + x * 4
      rows[o] = r
      rows[o + 1] = g
      rows[o + 2] = b
      rows[o + 3] = a
    }
  }

  // Pass two: resample columns of the intermediate.
  const out = new Uint8ClampedArray(dstWidth * dstHeight * 4)
  for (let y = 0; y < dstHeight; y += 1) {
    const { start, weights } = vertical[y]
    const dstRow = y * dstWidth * 4
    for (let x = 0; x < dstWidth; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let j = 0; j < weights.length; j += 1) {
        const w = weights[j]
        const i = ((start + j) * dstWidth + x) * 4
        r += rows[i] * w
        g += rows[i + 1] * w
        b += rows[i + 2] * w
        a += rows[i + 3] * w
      }
      const o = dstRow + x * 4
      // Uint8ClampedArray rounds and clamps, which is exactly what is wanted
      // since Lanczos overshoots slightly at edges by design.
      out[o] = r
      out[o + 1] = g
      out[o + 2] = b
      out[o + 3] = a
    }
  }
  return out
}
