import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangleIcon, Loader2Icon } from 'lucide-react'
import { Renderer, orientedSize } from '@/engine/gl/renderer'
import {
  clampZoom,
  computeViewport,
  MIN_ZOOM,
  oneToOneZoom,
  zoomAbout,
  zoomStep,
  type ViewState,
} from '@/lib/viewport'
import { setActiveRenderer } from '@/engine/gl/activeRenderer'
import { loadProxy } from '@/lib/proxyCache'
import { loadFullBitmap } from '@/engine/export/runExport'
import { toBefore } from '@/lib/adjustments'
import { useProjectStore, visibleIds } from '@/store/projectStore'
import { useUiStore } from '@/store/uiStore'
import { PhotoContextMenu } from '@/components/photo/PhotoContextMenu'
import { SpotLayer } from './SpotLayer'
import { Histogram } from './Histogram'
import { ViewerToolbar } from './ViewerToolbar'
import { cn } from '@/lib/utils'
import type { Adjustments } from '@/types'

const CANVAS_CAP = 4096
const PADDING = 24
const HISTOGRAM_DEBOUNCE_MS = 120
/** Long enough that a pinch through the threshold does not trigger a decode. */
const FULL_RES_DELAY_MS = 350

export function Viewer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const frameRef = useRef(0)
  const histogramTimer = useRef(0)

  const photo = useProjectStore((s) => (s.selectedId ? s.photos[s.selectedId] : null))
  const projectId = useProjectStore((s) => s.project?.id ?? null)
  const beforeHeld = useUiStore((s) => s.beforeHeld)
  const beforeSticky = useUiStore((s) => s.beforeSticky)
  const fitToken = useUiStore((s) => s.fitToken)
  const sourceToken = useUiStore((s) => s.sourceToken)
  const viewZoom = useUiStore((s) => s.viewZoom)
  const viewCx = useUiStore((s) => s.viewCx)
  const viewCy = useUiStore((s) => s.viewCy)
  const setView = useUiStore((s) => s.setView)
  const resetView = useUiStore((s) => s.resetView)
  const spotMode = useUiStore((s) => s.spotMode)

  const [glError, setGlError] = useState<string | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [sourceSize, setSourceSize] = useState<[number, number] | null>(null)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [histogram, setHistogram] = useState<Uint32Array | null>(null)
  const [fullResId, setFullResId] = useState<string | null>(null)

  const showBefore = beforeHeld || beforeSticky
  const adjustments: Adjustments | null = useMemo(() => {
    if (!photo) return null
    return showBefore ? toBefore(photo.adjustments) : photo.adjustments
  }, [photo, showBefore])

  /* ---- renderer lifetime ------------------------------------------------ */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let renderer: Renderer
    try {
      renderer = new Renderer(canvas)
    } catch (error) {
      setGlError(error instanceof Error ? error.message : String(error))
      return
    }
    rendererRef.current = renderer
    setActiveRenderer(renderer)
    // A restored context has no textures: force the source to be re-uploaded.
    renderer.setRestoreHandler(() => {
      setSourceId(null)
      useUiStore.getState().invalidateSource()
    })
    return () => {
      setActiveRenderer(null)
      renderer.setRestoreHandler(null)
      renderer.dispose()
      rendererRef.current = null
    }
  }, [])

  /* ---- container measurement -------------------------------------------- */
  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setBox({ width, height })
    })
    observer.observe(node)
    setBox({ width: node.clientWidth, height: node.clientHeight })
    return () => observer.disconnect()
  }, [])

  /* ---- source texture ---------------------------------------------------- */
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || !photo || !projectId) return
    if (photo.decodeState !== 'ready') {
      setSourceId(null)
      setSourceSize(null)
      return
    }
    let stale = false
    void loadProxy(projectId, photo.id).then((bitmap) => {
      if (stale || !bitmap || !rendererRef.current) return
      rendererRef.current.setSource(bitmap)
      setSourceSize([bitmap.width, bitmap.height])
      setSourceId(photo.id)
    })
    return () => {
      stale = true
    }
  }, [photo?.id, photo?.decodeState, projectId, sourceToken])

  /* ---- preload the next photo so arrow stepping is instant --------------- */
  useEffect(() => {
    if (!projectId || !photo) return
    const handle = requestIdleCallbackSafe(() => {
      const state = useProjectStore.getState()
      const ids = visibleIds(state)
      const index = ids.indexOf(photo.id)
      for (const next of [ids[index + 1], ids[index - 1]]) {
        const candidate = next ? state.photos[next] : null
        if (candidate?.decodeState === 'ready') void loadProxy(projectId, candidate.id)
      }
    })
    return () => cancelIdleCallbackSafe(handle)
  }, [photo?.id, projectId])

  /* ---- fitted / zoomed display ------------------------------------------ */
  const oriented = useMemo(() => {
    if (!sourceSize || !photo) return null
    return orientedSize(sourceSize[0], sourceSize[1], photo.adjustments.rotate)
  }, [sourceSize, photo?.adjustments.rotate])

  const viewState: ViewState = useMemo(
    () => ({ zoom: viewZoom, cx: viewCx, cy: viewCy }),
    [viewZoom, viewCx, viewCy],
  )

  const viewport = useMemo(() => {
    if (!oriented || box.width < 2 || box.height < 2) return null
    return computeViewport(oriented[0], oriented[1], box.width, box.height, PADDING, viewState)
  }, [oriented, box.width, box.height, viewState, fitToken])

  const display = viewport
    ? { width: viewport.canvasWidth, height: viewport.canvasHeight }
    : null

  /* Zoom and pan belong to a photo, not to the viewer. */
  useEffect(() => {
    resetView()
    setFullResId(null)
  }, [photo?.id, resetView])

  /* `F` fits, which means dropping any zoom too. */
  useEffect(() => {
    if (fitToken > 0) resetView()
  }, [fitToken, resetView])

  /*
   * Past 1:1 on the proxy we are magnifying 2560px pixels, which is no use for
   * checking focus. Once the zoom settles there, decode the original at full
   * resolution and swap it in. The proxy stays on screen until it lands, and a
   * failure just leaves the proxy in place.
   */
  /*
   * Measured against the photo's on-screen size, not the loaded texture's
   * scale: swapping in a bigger source changes the fit scale, so a test based
   * on that would flip straight back and oscillate.
   */
  const wantFullRes = useMemo(() => {
    if (!viewport || !oriented || photo?.decodeState !== 'ready') return false
    const proxyLongEdge = Math.max(photo.proxyWidth, photo.proxyHeight)
    const fullLongEdge = Math.max(photo.width, photo.height)
    if (proxyLongEdge < 1 || fullLongEdge <= proxyLongEdge) return false
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    // Displayed size in device pixels; identical whichever source is bound.
    const displayedLongEdge = Math.max(oriented[0], oriented[1]) * viewport.scale * dpr
    return displayedLongEdge > proxyLongEdge
  }, [viewport, oriented, photo])

  useEffect(() => {
    if (!wantFullRes || !photo || fullResId === photo.id) return
    let stale = false
    const timer = window.setTimeout(() => {
      void loadFullBitmap(photo)
        .then((bitmap) => {
          if (stale || !rendererRef.current) {
            bitmap.close()
            return
          }
          rendererRef.current.setSource(bitmap)
          setSourceSize([bitmap.width, bitmap.height])
          setFullResId(photo.id)
        })
        .catch(() => {
          /* Stay on the proxy. */
        })
    }, FULL_RES_DELAY_MS)
    return () => {
      stale = true
      window.clearTimeout(timer)
    }
  }, [wantFullRes, photo, fullResId])

  /* Back at fit, drop the full-resolution texture and its memory. */
  useEffect(() => {
    if (!fullResId || wantFullRes) return
    if (!photo || !projectId) return
    let stale = false
    void loadProxy(projectId, fullResId).then((bitmap) => {
      if (stale || !bitmap || !rendererRef.current) return
      rendererRef.current.setSource(bitmap)
      setSourceSize([bitmap.width, bitmap.height])
      setFullResId(null)
    })
    return () => {
      stale = true
    }
  }, [wantFullRes, fullResId, photo, projectId])

  /* ---- pointer and wheel interaction ------------------------------------- */
  const measure = useCallback(
    (zoom: number) => {
      if (!oriented) return null
      return computeViewport(oriented[0], oriented[1], box.width, box.height, PADDING, {
        zoom,
        cx: viewCx,
        cy: viewCy,
      })
    },
    [oriented, box.width, box.height, viewCx, viewCy],
  )

  const applyZoom = useCallback(
    (nextZoom: number, clientX?: number, clientY?: number) => {
      const canvas = canvasRef.current
      if (!viewport || !canvas) return
      const zoom = clampZoom(nextZoom)
      const next = measure(zoom)
      if (!next) return
      if (zoom === MIN_ZOOM) {
        resetView()
        return
      }
      const rect = canvas.getBoundingClientRect()
      // Anchor on the pointer when there is one, otherwise on the centre.
      const px = clientX === undefined ? 0.5 : (clientX - rect.left) / rect.width
      const py = clientY === undefined ? 0.5 : (clientY - rect.top) / rect.height
      setView(zoomAbout(viewport, next, zoom, Math.min(1, Math.max(0, px)), Math.min(1, Math.max(0, py))))
    },
    [viewport, measure, setView, resetView],
  )

  /*
   * A native listener, not React's onWheel: React registers wheel passively, so
   * preventDefault there is ignored and the page/trackpad gesture wins.
   */
  useEffect(() => {
    const node = stageRef.current
    if (!node) return
    const handler = (event: WheelEvent) => {
      if (!viewport) return
      // A trackpad pinch arrives as a wheel event with ctrlKey set, as does
      // ctrl/cmd + wheel from a mouse. Anything else is a scroll, which pans.
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        applyZoom(zoomStep(viewZoom, event.deltaY), event.clientX, event.clientY)
        return
      }
      if (!viewport.pannable || !oriented) return
      event.preventDefault()
      setView({
        zoom: viewZoom,
        // Scrolling down moves the view toward the bottom of the picture, which
        // is a SMALLER cy — the view rect's y runs upward.
        cx: viewCx + event.deltaX / (oriented[0] * viewport.scale),
        cy: viewCy - event.deltaY / (oriented[1] * viewport.scale),
      })
    }
    node.addEventListener('wheel', handler, { passive: false })
    return () => node.removeEventListener('wheel', handler)
  }, [viewport, applyZoom, setView, viewZoom, viewCx, viewCy, oriented])

  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (spotMode || !viewport?.pannable || event.button !== 0) return
      dragRef.current = { x: event.clientX, y: event.clientY }
      setDragging(true)
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [viewport, spotMode],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const start = dragRef.current
      if (!start || !viewport || !oriented) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      dragRef.current = { x: event.clientX, y: event.clientY }
      setView({
        zoom: viewZoom,
        // The photo follows the finger: drag right and the window slides left
        // (smaller cx); drag down and it slides up the picture (larger cy).
        cx: viewCx - dx / (oriented[0] * viewport.scale),
        cy: viewCy + dy / (oriented[1] * viewport.scale),
      })
    },
    [viewport, oriented, setView, viewZoom, viewCx, viewCy],
  )

  const endDrag = useCallback((event: React.PointerEvent) => {
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const toggleOneToOne = useCallback(
    (event: React.MouseEvent) => {
      if (!oriented) return
      if (viewZoom > MIN_ZOOM) {
        resetView()
        return
      }
      applyZoom(
        oneToOneZoom(oriented[0], oriented[1], box.width, box.height, PADDING),
        event.clientX,
        event.clientY,
      )
    },
    [oriented, viewZoom, resetView, applyZoom, box.width, box.height],
  )

  /* ---- render on demand, never per input event --------------------------- */
  useEffect(() => {
    const renderer = rendererRef.current
    const canvas = canvasRef.current
    if (!renderer || !canvas || !display || !adjustments || sourceId !== photo?.id) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const backingWidth = Math.min(CANVAS_CAP, Math.round(display.width * dpr))
    const backingHeight = Math.min(CANVAS_CAP, Math.round(display.height * dpr))
    if (canvas.width !== backingWidth) canvas.width = backingWidth
    if (canvas.height !== backingHeight) canvas.height = backingHeight

    cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      renderer.renderToCanvas(adjustments, viewport?.view)
      window.clearTimeout(histogramTimer.current)
      histogramTimer.current = window.setTimeout(() => {
        setHistogram(renderer.readHistogram(adjustments))
      }, HISTOGRAM_DEBOUNCE_MS)
    })
    return () => cancelAnimationFrame(frameRef.current)
  }, [adjustments, display, viewport, sourceId, photo?.id])

  useEffect(() => () => window.clearTimeout(histogramTimer.current), [])

  const ready = photo?.decodeState === 'ready' && sourceId === photo.id && display !== null

  return (
    <div className="flex h-full min-w-0 flex-col bg-viewer">
      <ViewerToolbar />
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={stageRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={toggleOneToOne}
          className={cn(
            'absolute inset-0 flex items-center justify-center',
            viewport?.pannable && (dragging ? 'cursor-grabbing' : 'cursor-grab'),
          )}
        >
          <PhotoContextMenu photo={photo} className="relative block">
            <canvas
              ref={canvasRef}
              style={
                display ? { width: display.width, height: display.height } : { width: 0, height: 0 }
              }
              className={cn(
                'block',
                // A zoomed image fills the stage, so the drop shadow and the
                // rounding that frame a fitted photo would just be noise.
                viewport?.pannable
                  ? ''
                  : 'rounded-[2px] shadow-[0_2px_24px_rgba(0,0,0,0.45)]',
              )}
            />
            {spotMode && ready && photo && projectId && viewport && display && (
              <SpotLayer
                photo={photo}
                projectId={projectId}
                viewport={viewport}
                width={display.width}
                height={display.height}
              />
            )}
          </PhotoContextMenu>
        </div>

        {!ready && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <ViewerPlaceholder
              state={
                glError
                  ? { kind: 'error', message: glError }
                  : !photo
                    ? { kind: 'empty' }
                    : photo.decodeState === 'error'
                      ? { kind: 'error', message: photo.decodeError ?? 'Could not decode' }
                      : { kind: 'loading' }
              }
            />
          </div>
        )}

        {showBefore && ready && (
          <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[11px] font-medium tracking-wide text-white/90 uppercase">
            Before
          </div>
        )}

        {ready && (
          <div className="pointer-events-none absolute right-3 bottom-3">
            <Histogram data={histogram} />
          </div>
        )}
      </div>
    </div>
  )
}

type PlaceholderState =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }

function ViewerPlaceholder({ state }: { state: PlaceholderState }) {
  if (state.kind === 'empty') {
    return <p className="text-sm text-muted-foreground">No photo selected</p>
  }
  if (state.kind === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        Decoding…
      </div>
    )
  }
  return (
    <div className="flex max-w-sm flex-col items-center gap-2 px-6 text-center">
      <AlertTriangleIcon className="size-5 text-destructive" />
      <p className="text-sm text-foreground">This file could not be decoded</p>
      <p className="text-xs break-words text-muted-foreground">{state.message}</p>
    </div>
  )
}

/* Safari has no requestIdleCallback. */
function requestIdleCallbackSafe(callback: () => void): number {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback
  return ric ? ric(callback) : window.setTimeout(callback, 120)
}

function cancelIdleCallbackSafe(handle: number): void {
  const cic = (window as unknown as { cancelIdleCallback?: (h: number) => void })
    .cancelIdleCallback
  if (cic) cic(handle)
  else window.clearTimeout(handle)
}
