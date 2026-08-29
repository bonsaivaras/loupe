import { createProgram, type CompiledProgram } from './programs'
import quadVert from './shaders/quad.vert.glsl?raw'
import baseFrag from './shaders/base.frag.glsl?raw'
import blurFrag from './shaders/blur.frag.glsl?raw'
import finishFrag from './shaders/finish.frag.glsl?raw'
import deconvFrag from './shaders/deconv.frag.glsl?raw'
import { PROXY_LONG_EDGE } from '@/engine/decode/decodeTypes'
import type { Adjustments } from '@/types'

interface Target {
  texture: WebGLTexture
  framebuffer: WebGLFramebuffer
  width: number
  height: number
}

const ROTATE_INDEX: Record<number, number> = { 0: 0, 90: 1, 180: 2, 270: 3 }

/** The window of the finished image to draw, in 0..1 image coordinates. */
export interface ViewRect {
  scaleX: number
  scaleY: number
  offsetX: number
  offsetY: number
}

export const FULL_VIEW: ViewRect = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }

/** Must match MAX_SPOTS in base.frag.glsl. */
export const MAX_SPOTS = 24

/** Rotated dimensions of a source image under a 90/270 degree turn. */
export function orientedSize(
  width: number,
  height: number,
  rotate: number,
): [number, number] {
  return rotate === 90 || rotate === 270 ? [height, width] : [width, height]
}

export class Renderer {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private base!: CompiledProgram
  private blur!: CompiledProgram
  private finish!: CompiledProgram
  private deconv!: CompiledProgram
  private vao!: WebGLVertexArrayObject
  private source: Target | null = null
  private t1: Target | null = null
  private t2: Target | null = null
  private t3: Target | null = null
  private deconvA: Target | null = null
  private deconvB: Target | null = null
  private deconvC: Target | null = null
  private deconvObs: Target | null = null
  /** Null until probed: half-float render targets are what deconvolution needs. */
  private floatSupported: boolean | null = null
  private readback: Target | null = null
  private histogramTarget: Target | null = null
  private lost = false
  private onRestored: (() => void) | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    })
    if (!gl) throw new Error('WebGL2 is not available in this browser')
    this.gl = gl

    canvas.addEventListener('webglcontextlost', this.handleLost)
    canvas.addEventListener('webglcontextrestored', this.handleRestored)
    this.buildPipeline()
  }

  /** Without preventDefault the context is never restored. */
  private handleLost = (event: Event): void => {
    event.preventDefault()
    this.lost = true
    this.source = null
    this.t1 = this.t2 = this.t3 = this.readback = this.histogramTarget = null
    this.deconvA = this.deconvB = this.deconvC = this.deconvObs = null
  }

  private handleRestored = (): void => {
    this.lost = false
    this.buildPipeline()
    this.onRestored?.()
  }

  setRestoreHandler(handler: (() => void) | null): void {
    this.onRestored = handler
  }

  get isLost(): boolean {
    return this.lost || this.gl.isContextLost()
  }

  get hasSource(): boolean {
    return this.source !== null
  }

  private buildPipeline(): void {
    const gl = this.gl
    this.base = createProgram(gl, quadVert, baseFrag)
    this.blur = createProgram(gl, quadVert, blurFrag)
    this.finish = createProgram(gl, quadVert, finishFrag)
    this.deconv = createProgram(gl, quadVert, deconvFrag)
    this.floatSupported = null
    const vao = gl.createVertexArray()
    if (!vao) throw new Error('Unable to create VAO')
    this.vao = vao
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
  }

  private makeTarget(width: number, height: number, half = false): Target {
    const gl = this.gl
    const texture = gl.createTexture()
    const framebuffer = gl.createFramebuffer()
    if (!texture || !framebuffer) throw new Error('Unable to allocate render target')
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texStorage2D(gl.TEXTURE_2D, 1, half ? gl.RGBA16F : gl.RGBA8, width, height)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { texture, framebuffer, width, height }
  }

  private releaseTarget(target: Target | null): void {
    if (!target) return
    this.gl.deleteTexture(target.texture)
    this.gl.deleteFramebuffer(target.framebuffer)
  }

  private ensureTarget(
    current: Target | null,
    width: number,
    height: number,
    half = false,
  ): Target {
    if (current && current.width === width && current.height === height) return current
    this.releaseTarget(current)
    return this.makeTarget(width, height, half)
  }

  /**
   * Deconvolution accumulates a correction over several passes; through RGBA8
   * that quantises into banding, so it needs a half-float target or nothing.
   */
  private canDeconvolve(): boolean {
    if (this.floatSupported === null) {
      this.floatSupported =
        !!this.gl.getExtension('EXT_color_buffer_half_float') ||
        !!this.gl.getExtension('EXT_color_buffer_float')
    }
    return this.floatSupported
  }

  private releaseDeconvTargets(): void {
    this.releaseTarget(this.deconvA)
    this.releaseTarget(this.deconvB)
    this.releaseTarget(this.deconvObs)
    this.deconvA = this.deconvB = this.deconvC = this.deconvObs = null
  }

  /**
   * Van Cittert deconvolution of `input`, returning the sharpened target.
   * Iterations rise with strength; the shader clamps each correction so the
   * result converges instead of ringing.
   */
  private runDeconvolution(input: Target, strength: number, texelScale: number): Target {
    const gl = this.gl
    if (strength <= 0 || !this.canDeconvolve()) return input

    const s = Math.min(1, strength / 100)
    const iterations = Math.max(1, Math.round(2 + s * 8))
    const alpha = 0.55 + s * 0.55
    const { width, height } = input

    this.deconvObs = this.ensureTarget(this.deconvObs, width, height, true)
    this.deconvA = this.ensureTarget(this.deconvA, width, height, true)
    this.deconvB = this.ensureTarget(this.deconvB, width, height, true)
    this.deconvC = this.ensureTarget(this.deconvC, width, height, true)

    const stepX = (1 / width) * texelScale
    const stepY = (1 / height) * texelScale

    gl.useProgram(this.deconv.program)
    gl.uniform1i(this.deconv.uniform('uRotate'), 0)
    gl.uniform1i(this.deconv.uniform('uFlipH'), 0)
    gl.uniform1i(this.deconv.uniform('uFlipV'), 0)
    this.setView(this.deconv, FULL_VIEW)
    gl.uniform1f(this.deconv.uniform('uAlpha'), alpha)

    const blurInto = (src: Target, dst: Target, dx: number, dy: number) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.framebuffer)
      gl.viewport(0, 0, dst.width, dst.height)
      gl.uniform1i(this.deconv.uniform('uMode'), 0)
      gl.uniform2f(this.deconv.uniform('uDir'), dx, dy)
      this.bindTexture(0, src.texture, this.deconv.uniform('uTex'))
      this.draw()
    }

    // A zero-length step copies, which seeds the observation and first estimate.
    blurInto(input, this.deconvObs, 0, 0)
    blurInto(input, this.deconvA, 0, 0)

    let estimate = this.deconvA
    let next = this.deconvB
    const scratch = this.deconvC
    for (let i = 0; i < iterations; i += 1) {
      // `next` doubles as the horizontal-pass scratch before it is written to.
      blurInto(estimate, next, stepX, 0)
      blurInto(next, scratch, 0, stepY)

      gl.bindFramebuffer(gl.FRAMEBUFFER, next.framebuffer)
      gl.viewport(0, 0, width, height)
      gl.uniform1i(this.deconv.uniform('uMode'), 1)
      this.bindTexture(0, estimate.texture, this.deconv.uniform('uTex'))
      this.bindTexture(1, this.deconvObs.texture, this.deconv.uniform('uObserved'))
      this.bindTexture(2, scratch.texture, this.deconv.uniform('uBlurred'))
      this.draw()

      const swap = estimate
      estimate = next
      next = swap
    }

    this.deconvA = estimate
    this.deconvB = next
    return estimate
  }

  /** Replaces the resident source texture. The previous one is freed immediately. */
  setSource(bitmap: ImageBitmap): void {
    const gl = this.gl
    if (this.isLost) return
    this.releaseTarget(this.source)
    const texture = gl.createTexture()
    if (!texture) throw new Error('Unable to allocate source texture')
    gl.bindTexture(gl.TEXTURE_2D, texture)
    // No UNPACK_FLIP_Y_WEBGL here: it has no effect on ImageBitmap sources.
    // The vertical flip is applied by the vertex shader's uFlipV instead.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.source = {
      texture,
      framebuffer: null as unknown as WebGLFramebuffer,
      width: bitmap.width,
      height: bitmap.height,
    }
  }

  clearSource(): void {
    if (!this.source) return
    this.gl.deleteTexture(this.source.texture)
    this.source = null
  }

  get sourceSize(): [number, number] {
    return this.source ? [this.source.width, this.source.height] : [0, 0]
  }

  private draw(): void {
    this.gl.bindVertexArray(this.vao)
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3)
  }

  private bindTexture(unit: number, texture: WebGLTexture, location: WebGLUniformLocation | null) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    if (location) gl.uniform1i(location, unit)
  }

  /**
   * Passes 1-3. Leaves T1 (full source resolution, oriented) and T3 (quarter
   * resolution blur of T1) ready for the finish pass.
   */
  private renderIntermediates(adj: Adjustments): { t1: Target; blur: Target } {
    const gl = this.gl
    if (!this.source) throw new Error('No source image')
    const [w1, h1] = orientedSize(this.source.width, this.source.height, adj.rotate)
    this.t1 = this.ensureTarget(this.t1, w1, h1)

    // ---- pass 1 ------------------------------------------------------------
    gl.useProgram(this.base.program)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.t1.framebuffer)
    gl.viewport(0, 0, w1, h1)
    this.bindTexture(0, this.source.texture, this.base.uniform('uImage'))
    gl.uniform1i(this.base.uniform('uRotate'), ROTATE_INDEX[adj.rotate] ?? 0)
    gl.uniform1i(this.base.uniform('uFlipH'), adj.flipH ? 1 : 0)
    gl.uniform1i(this.base.uniform('uFlipV'), 1)
    this.setView(this.base, FULL_VIEW)
    gl.uniform1f(this.base.uniform('uTemp'), adj.temp)
    gl.uniform1f(this.base.uniform('uTint'), adj.tint)
    gl.uniform1f(this.base.uniform('uExposure'), adj.exposure)
    gl.uniform1f(this.base.uniform('uContrast'), adj.contrast)
    gl.uniform1f(this.base.uniform('uHighlights'), adj.highlights)
    gl.uniform1f(this.base.uniform('uShadows'), adj.shadows)
    gl.uniform1f(this.base.uniform('uWhites'), adj.whites)
    gl.uniform1f(this.base.uniform('uBlacks'), adj.blacks)

    // Spots are healed in source space inside pass 1 — see base.frag.
    const spots = adj.spots.slice(0, MAX_SPOTS)
    gl.uniform1i(this.base.uniform('uSpotCount'), spots.length)
    if (spots.length > 0) {
      gl.uniform1f(
        this.base.uniform('uSpotAspect'),
        this.source.width / Math.max(1, this.source.height),
      )
      const rects = new Float32Array(MAX_SPOTS * 4)
      const radii = new Float32Array(MAX_SPOTS)
      spots.forEach((spot, i) => {
        rects[i * 4] = spot.x
        rects[i * 4 + 1] = spot.y
        rects[i * 4 + 2] = spot.sx
        rects[i * 4 + 3] = spot.sy
        radii[i] = spot.radius
      })
      gl.uniform4fv(this.base.uniform('uSpots'), rects)
      gl.uniform1fv(this.base.uniform('uSpotRadius'), radii)
    }
    this.draw()

    // Deconvolution sits between tone and the local-contrast passes, so clarity
    // and sharpening act on the recovered detail rather than the soft original.
    let sharp = this.t1
    if (adj.deblur > 0) {
      sharp = this.runDeconvolution(this.t1, adj.deblur, Math.max(1, Math.max(w1, h1) / PROXY_LONG_EDGE))
    } else {
      // Four half-float buffers is real memory; do not hold them when unused.
      this.releaseDeconvTargets()
    }

    if (adj.clarity === 0) return { t1: sharp, blur: sharp }

    // ---- passes 2 and 3 ----------------------------------------------------
    const qw = Math.max(1, Math.ceil(w1 / 4))
    const qh = Math.max(1, Math.ceil(h1 / 4))
    this.t2 = this.ensureTarget(this.t2, qw, qh)
    this.t3 = this.ensureTarget(this.t3, qw, qh)

    gl.useProgram(this.blur.program)
    gl.uniform1i(this.blur.uniform('uRotate'), 0)
    gl.uniform1i(this.blur.uniform('uFlipH'), 0)
    gl.uniform1i(this.blur.uniform('uFlipV'), 0)
    this.setView(this.blur, FULL_VIEW)

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.t2.framebuffer)
    gl.viewport(0, 0, qw, qh)
    this.bindTexture(0, sharp.texture, this.blur.uniform('uTex'))
    gl.uniform2f(this.blur.uniform('uDir'), 3.0 / qw, 0)
    this.draw()

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.t3.framebuffer)
    gl.viewport(0, 0, qw, qh)
    this.bindTexture(0, this.t2.texture, this.blur.uniform('uTex'))
    gl.uniform2f(this.blur.uniform('uDir'), 0, 3.0 / qh)
    this.draw()

    return { t1: sharp, blur: this.t3 }
  }

  private setView(program: CompiledProgram, view: ViewRect): void {
    this.gl.uniform2f(program.uniform('uUvScale'), view.scaleX, view.scaleY)
    this.gl.uniform2f(program.uniform('uUvOffset'), view.offsetX, view.offsetY)
  }

  private renderFinish(
    adj: Adjustments,
    t1: Target,
    blur: Target,
    framebuffer: WebGLFramebuffer | null,
    width: number,
    height: number,
    view: ViewRect = FULL_VIEW,
  ): void {
    const gl = this.gl
    gl.useProgram(this.finish.program)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.viewport(0, 0, width, height)
    gl.uniform1i(this.finish.uniform('uRotate'), 0)
    gl.uniform1i(this.finish.uniform('uFlipH'), 0)
    gl.uniform1i(this.finish.uniform('uFlipV'), 0)
    this.setView(this.finish, view)
    this.bindTexture(0, t1.texture, this.finish.uniform('uBase'))
    this.bindTexture(1, blur.texture, this.finish.uniform('uBlur'))
    gl.uniform2f(this.finish.uniform('uTexel'), 1 / t1.width, 1 / t1.height)
    gl.uniform1f(this.finish.uniform('uAspect'), t1.width / t1.height)
    gl.uniform1f(this.finish.uniform('uClarity'), adj.clarity)
    gl.uniform1f(this.finish.uniform('uSharpen'), adj.sharpen)
    gl.uniform1f(this.finish.uniform('uDenoise'), adj.denoise)
    // Keeps the unsharp mask at the same relative scale on proxy and export.
    gl.uniform1f(
      this.finish.uniform('uSharpRadius'),
      Math.max(1, Math.max(t1.width, t1.height) / PROXY_LONG_EDGE),
    )
    gl.uniform1f(this.finish.uniform('uVibrance'), adj.vibrance)
    gl.uniform1f(this.finish.uniform('uSaturation'), adj.saturation)
    gl.uniform1f(this.finish.uniform('uVignette'), adj.vignette)
    this.draw()
  }

  /** Renders the current source into the canvas at its backing-store size. */
  renderToCanvas(adj: Adjustments, view: ViewRect = FULL_VIEW): void {
    if (this.isLost || !this.source) return
    const { t1, blur } = this.renderIntermediates(adj)
    this.renderFinish(adj, t1, blur, null, this.canvas.width, this.canvas.height, view)
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
  }

  /**
   * Renders into an offscreen target and reads it back top-down.
   * `readPixels` returns rows bottom-up, so the row order is reversed here.
   */
  renderToPixels(adj: Adjustments, width: number, height: number): Uint8ClampedArray {
    if (this.isLost || !this.source) throw new Error('Renderer has no source')
    const gl = this.gl
    const { t1, blur } = this.renderIntermediates(adj)
    this.readback = this.ensureTarget(this.readback, width, height)
    this.renderFinish(adj, t1, blur, this.readback.framebuffer, width, height)

    const stride = width * 4
    const pixels = new Uint8Array(stride * height)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.readback.framebuffer)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    // Reverse in place — a full second copy of a 24 MP readback is 96 MB.
    const row = new Uint8Array(stride)
    for (let y = 0; y < (height >> 1); y += 1) {
      const top = y * stride
      const bottom = (height - 1 - y) * stride
      row.set(pixels.subarray(top, top + stride))
      pixels.copyWithin(top, bottom, bottom + stride)
      pixels.set(row, bottom)
    }
    return new Uint8ClampedArray(pixels.buffer)
  }

  /**
   * RGB histogram from a small readback of the finished image. Called from a
   * debounced settle, never per frame.
   */
  readHistogram(adj: Adjustments, bins = 256): Uint32Array | null {
    if (this.isLost || !this.source) return null
    const gl = this.gl
    const size = 256
    const { t1, blur } = this.renderIntermediates(adj)
    this.histogramTarget = this.ensureTarget(this.histogramTarget, size, size)
    this.renderFinish(adj, t1, blur, this.histogramTarget.framebuffer, size, size)

    const pixels = new Uint8Array(size * size * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.histogramTarget.framebuffer)
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    const out = new Uint32Array(bins * 3)
    const scale = bins / 256
    for (let i = 0; i < pixels.length; i += 4) {
      out[Math.min(bins - 1, (pixels[i] * scale) | 0)] += 1
      out[bins + Math.min(bins - 1, (pixels[i + 1] * scale) | 0)] += 1
      out[bins * 2 + Math.min(bins - 1, (pixels[i + 2] * scale) | 0)] += 1
    }
    return out
  }

  /** Frees the largest intermediates while keeping the context and programs. */
  releaseIntermediates(): void {
    this.releaseTarget(this.readback)
    this.readback = null
    this.releaseTarget(this.t2)
    this.releaseTarget(this.t3)
    this.t2 = null
    this.t3 = null
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleLost)
    this.canvas.removeEventListener('webglcontextrestored', this.handleRestored)
    this.releaseTarget(this.source)
    this.releaseTarget(this.t1)
    this.releaseTarget(this.t2)
    this.releaseTarget(this.t3)
    this.releaseTarget(this.readback)
    this.releaseTarget(this.histogramTarget)
    this.releaseDeconvTargets()
    this.source = this.t1 = this.t2 = this.t3 = this.readback = null
    this.histogramTarget = null
  }
}
