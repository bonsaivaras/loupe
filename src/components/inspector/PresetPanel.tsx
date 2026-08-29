import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  CheckIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  PlusIcon,
  TriangleAlertIcon,
  UploadIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { applyPresetAdjustments, describePreset, toPresetAdjustments } from '@/lib/adjustments'
import { downloadAllPresets, downloadPreset, PRESET_ACCEPT, readPresetFiles } from '@/lib/presetFiles'
import { PresetStorageFullError } from '@/storage/presets'
import { useEditStore } from '@/store/editStore'
import { usePresetStore } from '@/store/presetStore'
import { cn } from '@/lib/utils'
import type { Photo, Preset } from '@/types'

interface PresetPanelProps {
  photo: Photo
  onSaveRequest: () => void
  onRenameRequest: (preset: Preset) => void
}

export function PresetPanel({ photo, onSaveRequest, onRenameRequest }: PresetPanelProps) {
  const presets = usePresetStore((s) => s.presets)
  const createMany = usePresetStore((s) => s.createMany)
  const update = usePresetStore((s) => s.update)
  const remove = usePresetStore((s) => s.remove)
  const preview = useEditStore((s) => s.preview)
  const cancelPreview = useEditStore((s) => s.cancelPreview)
  const commit = useEditStore((s) => s.commit)

  const inputRef = useRef<HTMLInputElement>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const photoId = photo.id

  // A hover preview must never outlive the row it belongs to.
  useEffect(() => {
    return () => cancelPreview(photoId)
  }, [photoId, cancelPreview])

  const hoverOn = (preset: Preset) => {
    setHovered(preset.id)
    preview(photoId, applyPresetAdjustments(photo.adjustments, preset.adjustments))
  }

  const hoverOff = () => {
    setHovered(null)
    cancelPreview(photoId)
  }

  const apply = (preset: Preset) => {
    setHovered(null)
    // The hover already captured the pre-preview baseline, so this single
    // commit is what undo steps back to.
    commit(photoId, applyPresetAdjustments(photo.adjustments, preset.adjustments))
    toast.success(`Applied “${preset.name}”`)
  }

  const importFiles = async (files: FileList) => {
    try {
      const summary = await readPresetFiles(Array.from(files))
      if (summary.presets.length === 0) {
        toast.error('No Lightroom presets found in those files', {
          description: 'Expected .xmp or .lrtemplate files, or a zip containing them.',
        })
        return
      }
      createMany(summary.presets)
      const parts = [`Imported ${summary.presets.length} presets`]
      if (summary.rejected.length > 0) parts.push(`skipped ${summary.rejected.length}`)
      toast.success(parts.join(' · '), {
        description: summary.lossy
          ? 'Some carry settings this app has no slider for — those are listed on each preset.'
          : undefined,
      })
    } catch (error) {
      if (error instanceof PresetStorageFullError) {
        toast.error('No room left for more presets', {
          description: 'Remove a few presets and try again.',
        })
        return
      }
      toast.error('Could not read those presets', {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <div className="border-b border-border/60 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-foreground uppercase">
          Presets
        </span>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-xs" onClick={onSaveRequest}>
                  <PlusIcon />
                </Button>
              }
            />
            <TooltipContent>Save current settings as a preset</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-xs">
                  <MoreHorizontalIcon />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => inputRef.current?.click()}>
                <UploadIcon />
                Import .xmp / .lrtemplate…
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={presets.length === 0}
                onClick={() => downloadAllPresets(presets)}
              >
                <DownloadIcon />
                Export all as .xmp
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={inputRef}
            type="file"
            accept={PRESET_ACCEPT}
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files?.length) void importFiles(event.target.files)
              event.target.value = ''
            }}
          />
        </div>
      </div>

      {presets.length === 0 ? (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          No presets yet. Set up a look, then press{' '}
          <PlusIcon className="inline size-3 -translate-y-px" /> to save it — or import
          Lightroom <code>.xmp</code> presets you already own.
        </p>
      ) : (
        <ul className="mt-2 -mx-1 max-h-56 overflow-y-auto thin-scrollbar">
          {presets.map((preset) => (
            <li key={preset.id}>
              <div
                className={cn(
                  'group/preset flex items-center gap-1 rounded-md pr-0.5 transition-colors',
                  hovered === preset.id ? 'bg-muted' : 'hover:bg-muted/50',
                )}
              >
                <button
                  type="button"
                  onMouseEnter={() => hoverOn(preset)}
                  onMouseLeave={hoverOff}
                  onFocus={() => hoverOn(preset)}
                  onBlur={hoverOff}
                  onClick={() => apply(preset)}
                  title={describePreset(preset.adjustments)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-xs outline-none"
                >
                  <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                  {preset.ignored && preset.ignored.length > 0 && (
                    <Tooltip>
                      <TooltipTrigger
                        render={<TriangleAlertIcon className="size-3 shrink-0 text-muted-foreground" />}
                      />
                      <TooltipContent className="max-w-64">
                        This preset also sets {preset.ignored.join(', ')}, which this app has no
                        slider for. Everything else is applied.
                      </TooltipContent>
                    </Tooltip>
                  )}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="opacity-0 group-hover/preset:opacity-100 aria-expanded:opacity-100"
                      >
                        <MoreHorizontalIcon />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onClick={() => apply(preset)}>
                      <CheckIcon />
                      Apply to this photo
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        update(preset.id, toPresetAdjustments(photo.adjustments))
                        toast.success(`Updated “${preset.name}” to the current settings`)
                      }}
                    >
                      Update with current settings
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onRenameRequest(preset)}>
                      Rename…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => downloadPreset(preset)}>
                      <DownloadIcon />
                      Export as .xmp
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => {
                        remove(preset.id)
                        toast.success(`Deleted “${preset.name}”`)
                      }}
                    >
                      Delete preset
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
