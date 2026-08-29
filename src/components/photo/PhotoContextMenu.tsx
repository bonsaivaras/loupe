import type { ReactNode } from 'react'
import {
  CheckIcon,
  DownloadIcon,
  FlipHorizontalIcon,
  MinusIcon,
  RotateCcwIcon,
  RotateCwIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
} from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  applyPresetAdjustments,
  DEFAULT_ADJUSTMENTS,
  describePreset,
  isDefault,
} from '@/lib/adjustments'
import { usePresetStore } from '@/store/presetStore'
import { useEditStore } from '@/store/editStore'
import { useProjectStore } from '@/store/projectStore'
import { useUiStore } from '@/store/uiStore'
import type { Adjustments, FlagState, Photo } from '@/types'

const ROTATIONS: Adjustments['rotate'][] = [0, 90, 180, 270]

interface PhotoContextMenuProps {
  /** Null renders the trigger with no menu, keeping the wrapped node mounted. */
  photo: Photo | null
  children: ReactNode
  /** The filmstrip wraps a positioned row; the viewer wraps a full-size stage. */
  className?: string
}

export function PhotoContextMenu({ photo, children, className }: PhotoContextMenuProps) {
  const select = useProjectStore((s) => s.select)
  const setFlag = useProjectStore((s) => s.setFlag)
  const rejectedCount = useProjectStore(
    (s) => s.order.filter((id) => s.photos[id]?.flag === 'reject').length,
  )
  const commit = useEditStore((s) => s.commit)
  const presets = usePresetStore((s) => s.presets)
  const setExportOpen = useUiStore((s) => s.setExportOpen)
  const requestDelete = useUiStore((s) => s.requestDelete)

  const editable = photo?.decodeState === 'ready'
  const atDefaults = photo ? isDefault(photo.adjustments) : true

  const flag = (value: FlagState) => {
    if (photo) setFlag(photo.id, photo.flag === value ? 'none' : value)
  }

  const rotate = (direction: 1 | -1) => {
    if (!photo) return
    const index = (ROTATIONS.indexOf(photo.adjustments.rotate) + direction + 4) % 4
    commit(photo.id, { ...photo.adjustments, rotate: ROTATIONS[index] })
  }

  const deleteRejected = () => {
    const state = useProjectStore.getState()
    requestDelete(state.order.filter((id) => state.photos[id]?.flag === 'reject'))
  }

  return (
    <ContextMenu>
      {/* Right-clicking a photo acts on that photo, so select it first. */}
      <ContextMenuTrigger
        className={className}
        onContextMenu={() => photo && select(photo.id)}
      >
        {children}
      </ContextMenuTrigger>
      {photo && (
      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={() => flag('pick')}>
          <CheckIcon className={photo.flag === 'pick' ? 'text-pick' : undefined} />
          {photo.flag === 'pick' ? 'Remove pick' : 'Pick'}
          <ContextMenuShortcut>P</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => flag('reject')}>
          <XIcon className={photo.flag === 'reject' ? 'text-reject' : undefined} />
          {photo.flag === 'reject' ? 'Remove reject' : 'Reject'}
          <ContextMenuShortcut>X</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={photo.flag === 'none'} onClick={() => flag('none')}>
          <MinusIcon />
          Unflag
          <ContextMenuShortcut>U</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem disabled={!editable} onClick={() => rotate(-1)}>
          <RotateCcwIcon />
          Rotate left
          <ContextMenuShortcut>[</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={!editable} onClick={() => rotate(1)}>
          <RotateCwIcon />
          Rotate right
          <ContextMenuShortcut>]</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!editable}
          onClick={() =>
            commit(photo.id, { ...photo.adjustments, flipH: !photo.adjustments.flipH })
          }
        >
          <FlipHorizontalIcon />
          Flip horizontal
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!editable || atDefaults}
          onClick={() =>
            commit(photo.id, {
              ...DEFAULT_ADJUSTMENTS,
              rotate: photo.adjustments.rotate,
              flipH: photo.adjustments.flipH,
            })
          }
        >
          <Undo2Icon />
          Reset adjustments
          <ContextMenuShortcut>0</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={!editable || presets.length === 0}>
            <SlidersHorizontalIcon />
            {presets.length === 0 ? 'No presets yet' : 'Apply preset'}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-72 w-56 overflow-y-auto">
            {presets.map((preset) => (
              <ContextMenuItem
                key={preset.id}
                title={describePreset(preset.adjustments)}
                onClick={() =>
                  photo &&
                  commit(photo.id, applyPresetAdjustments(photo.adjustments, preset.adjustments))
                }
              >
                <span className="truncate">{preset.name}</span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem
          disabled={!editable}
          onClick={() => {
            select(photo.id)
            setExportOpen(true)
          }}
        >
          <DownloadIcon />
          Export…
          <ContextMenuShortcut>E</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem variant="destructive" onClick={() => requestDelete([photo.id])}>
          <Trash2Icon />
          Remove from project
          <ContextMenuShortcut>⌫</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          disabled={rejectedCount === 0}
          onClick={deleteRejected}
        >
          <Trash2Icon />
          Remove {rejectedCount} rejected
        </ContextMenuItem>
      </ContextMenuContent>
      )}
    </ContextMenu>
  )
}
