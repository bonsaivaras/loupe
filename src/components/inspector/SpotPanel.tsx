import { toast } from 'sonner'
import { CopyIcon, StampIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Toggle } from '@/components/ui/toggle'
import {
  clampSpotRadius,
  MAX_SPOT_RADIUS,
  MIN_SPOT_RADIUS,
} from '@/lib/spots'
import { useEditStore } from '@/store/editStore'
import { useProjectStore } from '@/store/projectStore'
import { useUiStore } from '@/store/uiStore'
import type { Photo } from '@/types'

interface SpotPanelProps {
  photo: Photo
}

export function SpotPanel({ photo }: SpotPanelProps) {
  const spotMode = useUiStore((s) => s.spotMode)
  const setSpotMode = useUiStore((s) => s.setSpotMode)
  const spotRadius = useUiStore((s) => s.spotRadius)
  const setSpotRadius = useUiStore((s) => s.setSpotRadius)
  const commit = useEditStore((s) => s.commit)

  const spots = photo.adjustments.spots
  const pickedCount = useProjectStore(
    (s) => s.order.filter((id) => s.photos[id]?.flag === 'pick' && id !== photo.id).length,
  )

  /**
   * Sensor dust lands in the same place on every frame, so the whole point of
   * spot removal on a card of RAWs is doing it once.
   */
  const copyToPicked = () => {
    const state = useProjectStore.getState()
    const targets = state.order.filter(
      (id) => state.photos[id]?.flag === 'pick' && id !== photo.id,
    )
    for (const id of targets) {
      const target = state.photos[id]
      if (!target) continue
      // Fresh ids, so each photo's spots can be edited independently later.
      const copies = spots.map((spot) => ({ ...spot, id: crypto.randomUUID() }))
      commit(id, { ...target.adjustments, spots: copies })
    }
    toast.success(
      `Copied ${spots.length} spot${spots.length === 1 ? '' : 's'} to ${targets.length} picked ${
        targets.length === 1 ? 'photo' : 'photos'
      }`,
    )
  }

  return (
    <div className="border-t border-border/60 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-foreground uppercase">
          Spot removal
        </span>
        <Toggle size="sm" pressed={spotMode} onPressedChange={setSpotMode}>
          <StampIcon />
          {spotMode ? 'Done' : 'Retouch'}
        </Toggle>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        {spotMode
          ? 'Click a blemish to heal it. Drag the dashed circle to change where it heals from, ⌫ to remove.'
          : spots.length === 0
            ? 'Removes dust and blemishes by healing from a nearby patch. No spots on this photo.'
            : `${spots.length} spot${spots.length === 1 ? '' : 's'} on this photo.`}
      </p>

      {spotMode && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Spot size</span>
            <span className="text-xs tabular-nums">{(spotRadius * 200).toFixed(1)}%</span>
          </div>
          <Slider
            className="mt-1.5"
            value={spotRadius}
            min={MIN_SPOT_RADIUS}
            max={MAX_SPOT_RADIUS}
            step={0.002}
            onValueChange={(value) => setSpotRadius(clampSpotRadius(value as number))}
          />
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            Scrolling over the photo resizes it too. New spots use this size; existing ones
            keep theirs.
          </p>
        </div>
      )}

      {spots.length > 0 && (
        <div className="mt-2.5 flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={pickedCount === 0}
            onClick={copyToPicked}
            title={
              pickedCount === 0
                ? 'Flag some photos as picks first'
                : `Apply these spots to ${pickedCount} picked photos`
            }
          >
            <CopyIcon />
            Copy to picked
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => commit(photo.id, { ...photo.adjustments, spots: [] })}
          >
            <Trash2Icon />
            Clear
          </Button>
        </div>
      )}
    </div>
  )
}
