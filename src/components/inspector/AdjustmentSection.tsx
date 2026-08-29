import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { SliderRow } from './SliderRow'
import { DEFAULT_ADJUSTMENTS, sectionIsDefault, type SliderDef } from '@/lib/adjustments'
import type { Adjustments } from '@/types'

interface AdjustmentSectionProps {
  id: string
  title: string
  sliders: SliderDef[]
  adjustments: Adjustments
  onChange: (next: Adjustments) => void
  onCommit: (next: Adjustments) => void
}

export function AdjustmentSection({
  id,
  title,
  sliders,
  adjustments,
  onChange,
  onCommit,
}: AdjustmentSectionProps) {
  const atDefaults = sectionIsDefault(adjustments, sliders)

  const resetSection = () => {
    if (atDefaults) return
    const next = { ...adjustments }
    for (const def of sliders) next[def.key] = DEFAULT_ADJUSTMENTS[def.key]
    onChange(next)
    onCommit(next)
  }

  return (
    <AccordionItem value={id} className="border-b border-border/60 last:border-b-0">
      <div className="relative">
        <AccordionTrigger className="pr-14 text-xs font-medium tracking-wide text-foreground uppercase hover:no-underline">
          {title}
        </AccordionTrigger>
        <button
          type="button"
          onClick={resetSection}
          disabled={atDefaults}
          className="absolute top-1/2 right-6 -translate-y-1/2 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-0"
        >
          Reset
        </button>
      </div>
      <AccordionContent className="pb-3">
        {sliders.map((def) => (
          <SliderRow
            key={def.key}
            label={def.label}
            value={adjustments[def.key]}
            min={def.min}
            max={def.max}
            step={def.step}
            precision={def.precision}
            defaultValue={DEFAULT_ADJUSTMENTS[def.key]}
            onChange={(value) => onChange({ ...adjustments, [def.key]: value })}
            onCommit={(value) => onCommit({ ...adjustments, [def.key]: value })}
          />
        ))}
      </AccordionContent>
    </AccordionItem>
  )
}
