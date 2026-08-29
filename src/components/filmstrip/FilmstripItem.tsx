import { memo, useEffect, useState } from 'react'
import { CheckIcon, SlidersHorizontalIcon, TriangleAlertIcon, XIcon } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PhotoContextMenu } from '@/components/photo/PhotoContextMenu'
import { describeAdjustments, hasEdits } from '@/lib/adjustments'
import { loadThumbUrl, peekThumbUrl } from '@/lib/thumbCache'
import { cn } from '@/lib/utils'
import type { Photo } from '@/types'

export const ITEM_HEIGHT = 84

interface FilmstripItemProps {
  photo: Photo
  index: number
  selected: boolean
  projectId: string
  onSelect: (id: string) => void
}

function FilmstripItemInner({ photo, index, selected, projectId, onSelect }: FilmstripItemProps) {
  const [url, setUrl] = useState<string | null>(() => peekThumbUrl(photo.id) ?? null)

  useEffect(() => {
    if (url || photo.decodeState !== 'ready') return
    let stale = false
    void loadThumbUrl(projectId, photo.id).then((next) => {
      if (!stale) setUrl(next)
    })
    return () => {
      stale = true
    }
  }, [photo.id, photo.decodeState, projectId, url])

  const failed = photo.decodeState === 'error'
  const edited = hasEdits(photo.adjustments)

  const content = (
    <button
      type="button"
      onClick={() => onSelect(photo.id)}
      style={{ height: ITEM_HEIGHT }}
      className={cn(
        'group flex w-full items-center gap-2 rounded-md border px-1.5 text-left transition-colors',
        selected
          ? 'border-primary/60 bg-muted'
          : 'border-transparent hover:border-border hover:bg-muted/40',
        // A rejected photo is dimmed in the list, but never the one you are
        // currently looking at — you cannot judge it through a veil.
        photo.flag === 'reject' && !selected && 'opacity-40',
      )}
    >
      <span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-black/40">
        {url ? (
          <img
            src={url}
            alt=""
            draggable={false}
            className="max-h-full max-w-full object-contain"
          />
        ) : failed ? (
          <TriangleAlertIcon className="size-4 text-destructive" />
        ) : (
          <Skeleton className="size-full rounded-sm" />
        )}
        {photo.flag === 'pick' && (
          <span className="absolute top-0.5 left-0.5 flex size-3.5 items-center justify-center rounded-full bg-pick text-black">
            <CheckIcon className="size-2.5" strokeWidth={3} />
          </span>
        )}
        {photo.flag === 'reject' && (
          <span className="absolute top-0.5 left-0.5 flex size-3.5 items-center justify-center rounded-full bg-reject text-black">
            <XIcon className="size-2.5" strokeWidth={3} />
          </span>
        )}
        {edited && (
          // Opposite corner from the flag, so the two never read as one badge.
          <span
            title={describeAdjustments(photo.adjustments)}
            className="absolute right-0.5 bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-foreground/85 text-background"
          >
            <SlidersHorizontalIcon className="size-2.5" strokeWidth={2.75} />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] text-foreground/90">{photo.filename}</span>
        <span className="block truncate text-[10px] text-muted-foreground tabular-nums">
          {index + 1}
          {photo.width > 0 ? ` · ${photo.width}×${photo.height}` : ''}
          {edited && <span className="text-foreground/70"> · Edited</span>}
        </span>
      </span>
    </button>
  )

  const body = failed ? (
    <Tooltip>
      <TooltipTrigger render={<span className="block" />}>{content}</TooltipTrigger>
      <TooltipContent side="right">{photo.decodeError ?? 'Could not decode'}</TooltipContent>
    </Tooltip>
  ) : (
    content
  )

  return (
    <PhotoContextMenu photo={photo} className="block">
      {body}
    </PhotoContextMenu>
  )
}

export const FilmstripItem = memo(FilmstripItemInner)
