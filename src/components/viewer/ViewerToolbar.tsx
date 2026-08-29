import {
  CheckIcon,
  EyeIcon,
  FlipHorizontalIcon,
  MinusIcon,
  Redo2Icon,
  RotateCcwIcon,
  RotateCwIcon,
  Undo2Icon,
  XIcon,
  StampIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { MAX_ZOOM, MIN_ZOOM, zoomStep } from '@/lib/viewport'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useEditStore } from '@/store/editStore'
import { useProjectStore } from '@/store/projectStore'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import type { Adjustments, FlagState } from '@/types'

const ROTATIONS: Adjustments['rotate'][] = [0, 90, 180, 270]

function Hint({ label, keys }: { label: string; keys: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {label}
      <kbd className="rounded bg-white/15 px-1 text-[10px]">{keys}</kbd>
    </span>
  )
}

export function ViewerToolbar() {
  const photo = useProjectStore((s) => (s.selectedId ? s.photos[s.selectedId] : null))
  const setFlag = useProjectStore((s) => s.setFlag)
  const viewZoom = useUiStore((s) => s.viewZoom)
  const viewCx = useUiStore((s) => s.viewCx)
  const viewCy = useUiStore((s) => s.viewCy)
  const setView = useUiStore((s) => s.setView)
  const resetView = useUiStore((s) => s.resetView)
  const spotMode = useUiStore((s) => s.spotMode)
  const setSpotMode = useUiStore((s) => s.setSpotMode)
  const commit = useEditStore((s) => s.commit)
  const undo = useEditStore((s) => s.undo)
  const redo = useEditStore((s) => s.redo)
  const revision = useEditStore((s) => s.revision)
  const canUndo = useEditStore((s) => s.canUndo)
  const canRedo = useEditStore((s) => s.canRedo)
  const beforeSticky = useUiStore((s) => s.beforeSticky)
  const setBeforeHeld = useUiStore((s) => s.setBeforeHeld)
  const toggleBeforeSticky = useUiStore((s) => s.toggleBeforeSticky)

  const disabled = !photo
  // `revision` is read so undo availability re-evaluates after every commit.
  void revision
  const undoAvailable = photo ? canUndo(photo.id) : false
  const redoAvailable = photo ? canRedo(photo.id) : false

  const applyFlag = (flag: FlagState) => {
    if (!photo) return
    const next = photo.flag === flag ? 'none' : flag
    // Clearing a flag is a correction, so it stays put.
    setFlag(photo.id, next, next !== 'none')
  }

  const rotate = (direction: 1 | -1) => {
    if (!photo) return
    const index = (ROTATIONS.indexOf(photo.adjustments.rotate) + direction + 4) % 4
    commit(photo.id, { ...photo.adjustments, rotate: ROTATIONS[index] })
  }

  const flip = () => {
    if (!photo) return
    commit(photo.id, { ...photo.adjustments, flipH: !photo.adjustments.flipH })
  }

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-black/40 bg-background/60 px-3">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              onClick={() => applyFlag('pick')}
              className={cn(photo?.flag === 'pick' && 'bg-pick/15 text-pick hover:bg-pick/20')}
            >
              <CheckIcon />
            </Button>
          }
        />
        <TooltipContent>
          <Hint label="Pick" keys="P" />
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              onClick={() => applyFlag('none')}
              className={cn(photo?.flag === 'none' && 'bg-muted text-foreground')}
            >
              <MinusIcon />
            </Button>
          }
        />
        <TooltipContent>
          <Hint label="Unflag" keys="U" />
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              onClick={() => applyFlag('reject')}
              className={cn(
                photo?.flag === 'reject' && 'bg-reject/15 text-reject hover:bg-reject/20',
              )}
            >
              <XIcon />
            </Button>
          }
        />
        <TooltipContent>
          <Hint label="Reject" keys="X" />
        </TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="mx-1.5 h-5" />

      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" disabled={disabled} onClick={() => rotate(-1)}>
              <RotateCcwIcon />
            </Button>
          }
        />
        <TooltipContent>
          <Hint label="Rotate left" keys="[" />
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" disabled={disabled} onClick={() => rotate(1)}>
              <RotateCwIcon />
            </Button>
          }
        />
        <TooltipContent>
          <Hint label="Rotate right" keys="]" />
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              onClick={flip}
              className={cn(photo?.adjustments.flipH && 'bg-muted text-foreground')}
            >
              <FlipHorizontalIcon />
            </Button>
          }
        />
        <TooltipContent>Flip horizontal</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              size="sm"
              pressed={spotMode}
              disabled={disabled}
              onPressedChange={setSpotMode}
            >
              <StampIcon />
            </Toggle>
          }
        />
        <TooltipContent>
          <Hint label="Remove spots — click a blemish" keys="R" />
        </TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="mx-1.5 h-5" />

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={disabled || viewZoom <= MIN_ZOOM}
              onClick={() => setView({ zoom: zoomStep(viewZoom, 120), cx: viewCx, cy: viewCy })}
            >
              <ZoomOutIcon />
            </Button>
          }
        />
        <TooltipContent>Zoom out</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={resetView}
              className="w-14 px-0 text-[11px] tabular-nums"
            >
              {viewZoom <= MIN_ZOOM ? 'Fit' : `${Math.round(viewZoom * 100)}%`}
            </Button>
          }
        />
        <TooltipContent>
          <Hint label="Fit to window" keys="F" />
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={disabled || viewZoom >= MAX_ZOOM}
              onClick={() => setView({ zoom: zoomStep(viewZoom, -120), cx: viewCx, cy: viewCy })}
            >
              <ZoomInIcon />
            </Button>
          }
        />
        <TooltipContent>
          <Hint label="Zoom in — pinch, or ⌘-scroll" keys="+" />
        </TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="mx-1.5 h-5" />

      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              size="sm"
              pressed={beforeSticky}
              disabled={disabled}
              onPressedChange={toggleBeforeSticky}
              onPointerDown={() => setBeforeHeld(true)}
              onPointerUp={() => setBeforeHeld(false)}
              onPointerLeave={() => setBeforeHeld(false)}
            >
              <EyeIcon />
            </Toggle>
          }
        />
        <TooltipContent>
          <Hint label="Show original — hold" keys="B" />
        </TooltipContent>
      </Tooltip>

      <div className="flex-1" />

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!undoAvailable}
              onClick={() => photo && undo(photo.id)}
            >
              <Undo2Icon />
            </Button>
          }
        />
        <TooltipContent>
          <Hint label="Undo" keys="⌘Z" />
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!redoAvailable}
              onClick={() => photo && redo(photo.id)}
            >
              <Redo2Icon />
            </Button>
          }
        />
        <TooltipContent>
          <Hint label="Redo" keys="⌘⇧Z" />
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
