import { useEffect, useRef } from 'react'

interface HistogramProps {
  /** 3 * bins entries: red, then green, then blue. */
  data: Uint32Array | null
}

const BINS = 256
const WIDTH = 192
const HEIGHT = 64

export function Histogram({ data }: HistogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = WIDTH * dpr
    canvas.height = HEIGHT * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    if (!data) return

    // Ignore the extremes when scaling: clipped pixels would flatten everything.
    let peak = 1
    for (let c = 0; c < 3; c += 1) {
      for (let i = 2; i < BINS - 2; i += 1) {
        const v = data[c * BINS + i]
        if (v > peak) peak = v
      }
    }

    ctx.globalCompositeOperation = 'lighter'
    const channels = ['#ff4d4d', '#4dff88', '#4d9bff']
    for (let c = 0; c < 3; c += 1) {
      ctx.beginPath()
      ctx.moveTo(0, HEIGHT)
      for (let i = 0; i < BINS; i += 1) {
        const x = (i / (BINS - 1)) * WIDTH
        const y = HEIGHT - Math.min(1, data[c * BINS + i] / peak) * (HEIGHT - 2)
        ctx.lineTo(x, y)
      }
      ctx.lineTo(WIDTH, HEIGHT)
      ctx.closePath()
      ctx.fillStyle = channels[c]
      ctx.globalAlpha = 0.5
      ctx.fill()
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }, [data])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: WIDTH, height: HEIGHT }}
      className="rounded-md border border-white/10 bg-black/55 backdrop-blur-sm"
    />
  )
}
