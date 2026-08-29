import { useCallback, useEffect, useRef, useState } from 'react'
import { loadSamplePlane } from '@/lib/spotSampler'
import {
  clampSpotRadius,
  orientedToSource,
  pickSourcePoint,
  sourceToOriented,
} from '@/lib/spots'
import type { Viewport } from '@/lib/viewport'
import { useEditStore } from '@/store/editStore'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import type { Photo, Spot } from '@/types'

interface SpotLayerProps {
  photo: Photo
  projectId: string
  viewport: Viewport
  /** CSS size of the canvas the spots are drawn over. */
  width: number
  height: number
}

interface DragState {
  id: string
  /** Moving the blemish itself, or the patch it heals from. */
  handle: 'spot' | 'source'
}

/**
 * Click-to-heal overlay. Sits on top of the canvas only while spot mode is on,
 * so ordinary viewing keeps the canvas free of event handlers.
 */
export function SpotLayer({ photo, projectId, viewport, width, height }: SpotLayerProps) {
  const spotRadius = useUiStore((s) => s.spotRadius)
  const setSpotRadius = useUiStore((s) => s.setSpotRadius)
  const selectedSpotId = useUiStore((s) => s.selectedSpotId)
  const selectSpot = useUiStore((s) => s.selectSpot)
  const commit = useEditStore((s) => s.commit)
  const preview = useEditStore((s) => s.preview)

  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null)

  const { rotate, flipH, spots } = photo.adjustments

  /* Warm the sampler so the first click does not wait on a decode. */
  useEffect(() => {
    void loadSamplePlane(projectId, photo.id)
  }, [projectId, photo.id])

  /** Pointer position (client px) to source-space image coordinates. */
  const toSource = useCallback(
    (clientX: number, clientY: number): [number, number] | null => {
      const svg = svgRef.current
      if (!svg) return null
      const rect = svg.getBoundingClientRect()
      const px = (clientX - rect.left) / rect.width
      const py = (clientY - rect.top) / rect.height
      // The canvas draws a window of the image, and its y runs bottom-up.
      const u = viewport.view.offsetX + px * viewport.view.scaleX
      const v = viewport.view.offsetY + (1 - py) * viewport.view.scaleY
      return orientedToSource(u, v, rotate, flipH)
    },
    [viewport, rotate, flipH],
  )

  /** Source-space coordinates back to a position on the overlay, in percent. */
  const toScreen = useCallback(
    (x: number, y: number): { left: number; top: number } => {
      const [u, v] = sourceToOriented(x, y, rotate, flipH)
      return {
        left: ((u - viewport.view.offsetX) / viewport.view.scaleX) * 100,
        top: (1 - (v - viewport.view.offsetY) / viewport.view.scaleY) * 100,
      }
    },
    [viewport, rotate, flipH],
  )

  /** A source-space radius (fraction of image height) in overlay percent. */
  const radiusToScreen = (radius: number) => {
    const rotated = rotate === 90 || rotate === 270
    // After a quarter turn the image's height maps onto the overlay's width.
    const span = rotated ? viewport.view.scaleX : viewport.view.scaleY
    return (radius / span) * 100
  }

  const addSpot = useCallback(
    async (clientX: number, clientY: number) => {
      const point = toSource(clientX, clientY)
      if (!point) return
      const [x, y] = point
      if (x < 0 || x > 1 || y < 0 || y > 1) return

      const plane = await loadSamplePlane(projectId, photo.id)
      const [sx, sy] = plane
        ? pickSourcePoint(plane, x, y, spotRadius, spots)
        : [x, Math.min(1 - spotRadius, y + spotRadius * 3)]

      const spot: Spot = { id: crypto.randomUUID(), x, y, sx, sy, radius: spotRadius }
      commit(photo.id, { ...photo.adjustments, spots: [...spots, spot] })
      selectSpot(spot.id)
    },
    [toSource, projectId, photo, spots, spotRadius, commit, selectSpot],
  )

  const onPointerDown = (event: React.PointerEvent) => {
    event.stopPropagation()
    if (event.button !== 0) return
    const target = (event.target as HTMLElement).dataset
    if (target.spotId) {
      selectSpot(target.spotId)
      setDrag({ id: target.spotId, handle: target.spotHandle === 'source' ? 'source' : 'spot' })
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    void addSpot(event.clientX, event.clientY)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const point = toSource(event.clientX, event.clientY)
    if (point) setHoverPoint({ x: point[0], y: point[1] })
    if (!drag || !point) return
    event.stopPropagation()
    const [x, y] = point
    // Live-update without touching history; the pointer-up commits once.
    preview(photo.id, {
      ...photo.adjustments,
      spots: spots.map((spot) => {
        if (spot.id !== drag.id) return spot
        return drag.handle === 'source' ? { ...spot, sx: x, sy: y } : { ...spot, x, y }
      }),
    })
  }

  const endDrag = (event: React.PointerEvent) => {
    if (!drag) return
    event.stopPropagation()
    setDrag(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    commit(photo.id, photo.adjustments)
  }

  /* Scrolling resizes the brush rather than panning, while spot mode is on. */
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const handler = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      setSpotRadius(clampSpotRadius(spotRadius * Math.exp(-event.deltaY * 0.002)))
    }
    svg.addEventListener('wheel', handler, { passive: false })
    return () => svg.removeEventListener('wheel', handler)
  }, [spotRadius, setSpotRadius])

  const brushRadius = radiusToScreen(spotRadius)

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => setHoverPoint(null)}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      className="absolute inset-0 cursor-crosshair touch-none"
      style={{ width, height }}
    >
      {spots.map((spot) => {
        const dst = toScreen(spot.x, spot.y)
        const src = toScreen(spot.sx, spot.sy)
        const r = radiusToScreen(spot.radius)
        const selected = spot.id === selectedSpotId
        return (
          <g key={spot.id} className={cn(selected ? 'opacity-100' : 'opacity-70')}>
            {selected && (
              <line
                x1={`${src.left}%`}
                y1={`${src.top}%`}
                x2={`${dst.left}%`}
                y2={`${dst.top}%`}
                stroke="white"
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.6}
              />
            )}
            <circle
              data-spot-id={spot.id}
              data-spot-handle="source"
              cx={`${src.left}%`}
              cy={`${src.top}%`}
              r={`${r}%`}
              fill="none"
              stroke="white"
              strokeWidth={selected ? 1.5 : 1}
              strokeDasharray="4 3"
              opacity={selected ? 0.9 : 0.45}
            />
            <circle
              data-spot-id={spot.id}
              data-spot-handle="spot"
              cx={`${dst.left}%`}
              cy={`${dst.top}%`}
              r={`${r}%`}
              fill="rgba(255,255,255,0.06)"
              stroke={selected ? 'white' : 'rgba(255,255,255,0.75)'}
              strokeWidth={selected ? 2 : 1.25}
            />
          </g>
        )
      })}

      {hoverPoint && !drag && (
        <circle
          cx={`${toScreen(hoverPoint.x, hoverPoint.y).left}%`}
          cy={`${toScreen(hoverPoint.x, hoverPoint.y).top}%`}
          r={`${brushRadius}%`}
          fill="rgba(255,255,255,0.08)"
          stroke="rgba(255,255,255,0.8)"
          strokeWidth={1.25}
          className="pointer-events-none"
        />
      )}
    </svg>
  )
}
