import { useCallback, useState } from 'react'
import { Accordion } from '@/components/ui/accordion'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { AdjustmentSection } from './AdjustmentSection'
import { PresetPanel } from './PresetPanel'
import { SpotPanel } from './SpotPanel'
import { PresetNameDialog, type PresetNameRequest } from './PresetNameDialog'
import {
  COLOR_SLIDERS,
  EFFECT_SLIDERS,
  isDefault,
  LIGHT_SLIDERS,
  DEFAULT_ADJUSTMENTS,
  toPresetAdjustments,
} from '@/lib/adjustments'
import { useEditStore } from '@/store/editStore'
import { useProjectStore } from '@/store/projectStore'
import { formatShutter } from '@/lib/format'
import type { Adjustments, Photo } from '@/types'

function ExifRow({ photo }: { photo: Photo }) {
  const bits = [
    photo.exif.camera,
    photo.exif.lens,
    photo.exif.focalLength ? `${Math.round(photo.exif.focalLength)}mm` : null,
    photo.exif.fNumber ? `f/${Number(photo.exif.fNumber.toFixed(1))}` : null,
    formatShutter(photo.exif.exposureTime),
    photo.exif.iso ? `ISO ${photo.exif.iso}` : null,
  ].filter(Boolean) as string[]

  return (
    <div className="border-b border-border/60 px-4 py-3">
      <p className="truncate text-sm font-medium" title={photo.filename}>
        {photo.filename}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
        {photo.width > 0
          ? `${photo.width} × ${photo.height}`
          : photo.decodeState === 'error'
            ? 'Could not be decoded'
            : 'Decoding…'}
        {photo.isRaw ? ` · ${photo.ext.toUpperCase()}` : ''}
      </p>
      {bits.length > 0 && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {bits.join(' · ')}
        </p>
      )}
    </div>
  )
}

export function Inspector() {
  const photo = useProjectStore((s) => (s.selectedId ? s.photos[s.selectedId] : null))
  const preview = useEditStore((s) => s.preview)
  const commit = useEditStore((s) => s.commit)
  const [presetRequest, setPresetRequest] = useState<PresetNameRequest | null>(null)

  const onChange = useCallback(
    (next: Adjustments) => {
      if (photo) preview(photo.id, next)
    },
    [photo, preview],
  )

  const onCommit = useCallback(
    (next: Adjustments) => {
      if (photo) commit(photo.id, next)
    },
    [photo, commit],
  )

  if (!photo) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        Select a photo to edit
      </div>
    )
  }

  const allDefault = isDefault(photo.adjustments)

  const resetAll = () => {
    if (allDefault) return
    const next: Adjustments = {
      ...DEFAULT_ADJUSTMENTS,
      rotate: photo.adjustments.rotate,
      flipH: photo.adjustments.flipH,
    }
    onChange(next)
    onCommit(next)
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <ExifRow photo={photo} />
      <PresetPanel
        photo={photo}
        onSaveRequest={() =>
          setPresetRequest({ mode: 'create', adjustments: toPresetAdjustments(photo.adjustments) })
        }
        onRenameRequest={(preset) => setPresetRequest({ mode: 'rename', preset })}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4">
          <Accordion defaultValue={['light', 'color', 'effects']}>
            <AdjustmentSection
              id="light"
              title="Light"
              sliders={LIGHT_SLIDERS}
              adjustments={photo.adjustments}
              onChange={onChange}
              onCommit={onCommit}
            />
            <AdjustmentSection
              id="color"
              title="Color"
              sliders={COLOR_SLIDERS}
              adjustments={photo.adjustments}
              onChange={onChange}
              onCommit={onCommit}
            />
            <AdjustmentSection
              id="effects"
              title="Effects"
              sliders={EFFECT_SLIDERS}
              adjustments={photo.adjustments}
              onChange={onChange}
              onCommit={onCommit}
            />
          </Accordion>
        </div>
        <SpotPanel photo={photo} />
      </ScrollArea>
      <div className="border-t border-border/60 p-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={resetAll}
          disabled={allDefault}
        >
          Reset all
          <kbd className="ml-1 text-[10px] text-muted-foreground">0</kbd>
        </Button>
      </div>
      <PresetNameDialog request={presetRequest} onClose={() => setPresetRequest(null)} />
    </div>
  )
}
