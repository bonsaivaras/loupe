import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FilterChips } from './FilterChips'
import { FilmstripItem, ITEM_HEIGHT } from './FilmstripItem'
import { useShallow } from 'zustand/react/shallow'
import { useProjectStore, visibleIds } from '@/store/projectStore'
import { decoderPool } from '@/engine/decode/decoderPool'

const GAP = 4
const ROW = ITEM_HEIGHT + GAP
const OVERSCAN = 6

export function Filmstrip() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  const projectId = useProjectStore((s) => s.project?.id ?? null)
  const photos = useProjectStore((s) => s.photos)
  // visibleIds builds a new array each call — shallow-compare or React loops.
  const ids = useProjectStore(useShallow(visibleIds))
  const selectedId = useProjectStore((s) => s.selectedId)
  const select = useProjectStore((s) => s.select)

  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setViewportHeight(entry.contentRect.height))
    observer.observe(node)
    setViewportHeight(node.clientHeight)
    return () => observer.disconnect()
  }, [])

  // The photo on screen jumps the decode queue.
  useEffect(() => {
    decoderPool.setPriority(selectedId)
  }, [selectedId])

  // Keep the selection visible when it moves by keyboard.
  useEffect(() => {
    const node = scrollRef.current
    if (!node || !selectedId) return
    const index = ids.indexOf(selectedId)
    if (index < 0) return
    const top = index * ROW
    const bottom = top + ITEM_HEIGHT
    if (top < node.scrollTop) node.scrollTop = top
    else if (bottom > node.scrollTop + node.clientHeight) {
      node.scrollTop = bottom - node.clientHeight
    }
  }, [selectedId, ids])

  const onScroll = useCallback(() => {
    const node = scrollRef.current
    if (node) setScrollTop(node.scrollTop)
  }, [])

  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN)
  const last = Math.min(ids.length, Math.ceil((scrollTop + viewportHeight) / ROW) + OVERSCAN)
  const window = ids.slice(first, last)

  return (
    <div className="flex h-full min-w-0 flex-col border-r border-border/60 bg-background">
      <div className="shrink-0 p-2">
        <FilterChips />
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="thin-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-2"
      >
        {ids.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            No photos match this filter
          </p>
        ) : (
          <div style={{ height: ids.length * ROW - GAP, position: 'relative' }}>
            {window.map((id, offset) => {
              const photo = photos[id]
              if (!photo) return null
              const index = first + offset
              return (
                <div
                  key={id}
                  style={{ position: 'absolute', top: index * ROW, left: 0, right: 0 }}
                >
                  <FilmstripItem
                    photo={photo}
                    index={index}
                    selected={id === selectedId}
                    projectId={projectId ?? ''}
                    onSelect={select}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
