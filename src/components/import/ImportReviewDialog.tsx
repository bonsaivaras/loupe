import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HardDriveIcon, SearchIcon, TriangleAlertIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { checkQuota, estimateImportBytes } from '@/engine/import/importer'
import type { CollectResult } from '@/engine/import/collect'
import { extOf } from '@/lib/files'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'

const ROW_HEIGHT = 30
const OVERSCAN = 8

interface ImportReviewDialogProps {
  collected: CollectResult | null
  onCancel: () => void
  onConfirm: (files: File[]) => void
}

export function ImportReviewDialog({ collected, onCancel, onConfirm }: ImportReviewDialogProps) {
  const files = useMemo(() => collected?.files ?? [], [collected])

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [query, setQuery] = useState('')
  const [available, setAvailable] = useState<number | null>(null)
  const lastToggled = useRef<number | null>(null)

  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const observerRef = useRef<ResizeObserver | null>(null)

  /**
   * A callback ref, not an effect: the dialog is portalled and its popup mounts
   * after layout effects run, so a ref read there is still null.
   */
  const attachScroller = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setViewportHeight(entry.contentRect.height))
    observer.observe(node)
    observerRef.current = observer
    setViewportHeight(node.clientHeight)
  }, [])

  /* Everything starts selected; trimming down is the common case. */
  useEffect(() => {
    if (!collected) return
    setQuery('')
    lastToggled.current = null
    setSelected(new Set(collected.files.map((_, i) => i)))
    void checkQuota(collected.files).then((estimate) => {
      setAvailable(Number.isFinite(estimate.available) ? estimate.available : null)
      if (estimate.fits) return
      // Too big for this browser: preselect the leading run that does fit.
      const fitting = new Set<number>()
      let running = 0
      collected.files.forEach((file, index) => {
        const next = running + estimateImportBytes([file])
        if (next <= estimate.available) {
          fitting.add(index)
          running = next
        }
      })
      setSelected(fitting)
    })
  }, [collected])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const indices = files.map((_, i) => i)
    if (!needle) return indices
    return indices.filter((i) => files[i].name.toLowerCase().includes(needle))
  }, [files, query])

  const toggle = useCallback(
    (index: number, shiftKey: boolean) => {
      setSelected((current) => {
        const next = new Set(current)
        const anchor = lastToggled.current
        // Shift-click extends from the previous click, the way file lists do.
        if (shiftKey && anchor !== null) {
          const from = visible.indexOf(anchor)
          const to = visible.indexOf(index)
          if (from >= 0 && to >= 0) {
            const [lo, hi] = from < to ? [from, to] : [to, from]
            const turningOn = !current.has(index)
            for (let i = lo; i <= hi; i += 1) {
              if (turningOn) next.add(visible[i])
              else next.delete(visible[i])
            }
            return next
          }
        }
        if (next.has(index)) next.delete(index)
        else next.add(index)
        return next
      })
      lastToggled.current = index
    },
    [visible],
  )

  const selectedBytes = useMemo(() => {
    let total = 0
    for (const index of selected) total += files[index]?.size ?? 0
    return total
  }, [selected, files])

  const neededBytes = Math.round(selectedBytes * 1.35)
  const overBudget = available !== null && neededBytes > available
  const allVisibleSelected = visible.length > 0 && visible.every((i) => selected.has(i))

  const setVisible = (on: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      for (const i of visible) {
        if (on) next.add(i)
        else next.delete(i)
      }
      return next
    })
    lastToggled.current = null
  }

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(
    visible.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  )
  const window = visible.slice(first, last)

  const confirm = () => {
    const chosen = files.filter((_, index) => selected.has(index))
    if (chosen.length > 0) onConfirm(chosen)
  }

  return (
    <Dialog
      open={collected !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {collected?.folderName ? `Import from ${collected.folderName}` : 'Choose photos to import'}
          </DialogTitle>
          <DialogDescription>
            {files.length} supported {files.length === 1 ? 'photo' : 'photos'} found
            {collected && collected.skipped > 0
              ? ` · ${collected.skipped} unsupported ${
                  collected.skipped === 1 ? 'file' : 'files'
                } ignored`
              : ''}
            . Shift-click to select a range.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              placeholder="Filter by filename…"
              spellCheck={false}
              className="h-8 pl-8"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => setVisible(!allVisibleSelected)}>
            {allVisibleSelected ? 'Deselect' : 'Select'} {query.trim() ? 'matches' : 'all'}
          </Button>
        </div>

        <div
          ref={attachScroller}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          className="thin-scrollbar h-72 shrink-0 overflow-y-auto rounded-md border border-border/60"
        >
          {visible.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">
              No filenames match “{query}”
            </p>
          ) : (
            <div style={{ height: visible.length * ROW_HEIGHT, position: 'relative' }}>
              {window.map((index, offset) => {
                const file = files[index]
                const row = first + offset
                const isSelected = selected.has(index)
                return (
                  <label
                    key={index}
                    style={{ position: 'absolute', top: row * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT }}
                    className={cn(
                      'flex cursor-default items-center gap-2.5 px-2.5 text-xs select-none',
                      isSelected ? 'bg-muted/50' : 'hover:bg-muted/30',
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      onClick={(event) => {
                        event.preventDefault()
                        toggle(index, event.shiftKey)
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground uppercase">
                      {extOf(file.name)}
                    </span>
                    <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                      {formatBytes(file.size)}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <HardDriveIcon className="size-3.5 shrink-0" />
          {available === null ? (
            <span>This import needs about {formatBytes(neededBytes)} of browser storage.</span>
          ) : overBudget ? (
            <span className="flex items-center gap-1.5 text-destructive">
              <TriangleAlertIcon className="size-3.5 shrink-0" />
              Needs {formatBytes(neededBytes)} but only {formatBytes(available)} is free — deselect
              about {formatBytes(neededBytes - available)}.
            </span>
          ) : (
            <span>
              Needs about {formatBytes(neededBytes)} of the {formatBytes(available)} free.
            </span>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground tabular-nums">
            {selected.size} of {files.length} selected · {formatBytes(selectedBytes)}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={selected.size === 0 || overBudget}>
              Import {selected.size} {selected.size === 1 ? 'photo' : 'photos'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
