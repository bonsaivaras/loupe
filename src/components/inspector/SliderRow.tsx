import { useCallback, useRef, useState } from 'react'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

export interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  defaultValue: number
  precision?: number
  /** Fires continuously while dragging — drives the GL render. */
  onChange: (value: number) => void
  /** Fires on pointer-up. This is the undo boundary. */
  onCommit: (value: number) => void
}

function format(value: number, precision: number): string {
  return precision > 0 ? value.toFixed(precision) : String(Math.round(value))
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  precision = 0,
  onChange,
  onCommit,
}: SliderRowProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const modified = value !== defaultValue

  // The text field mirrors the slider unless the user is mid-edit.
  const display = draft ?? format(value, precision)

  const commitDraft = useCallback(
    (raw: string) => {
      const parsed = Number.parseFloat(raw.replace(',', '.'))
      setDraft(null)
      if (!Number.isFinite(parsed)) return
      const clamped = Math.min(max, Math.max(min, parsed))
      const snapped = Number((Math.round(clamped / step) * step).toFixed(6))
      if (snapped !== value) {
        onChange(snapped)
        onCommit(snapped)
      }
    },
    [max, min, step, value, onChange, onCommit],
  )

  const reset = useCallback(() => {
    if (value === defaultValue) return
    onChange(defaultValue)
    onCommit(defaultValue)
  }, [defaultValue, value, onChange, onCommit])

  return (
    <div className="group/row py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <button
          type="button"
          onDoubleClick={reset}
          title="Double-click to reset"
          className="flex select-none items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
        >
          {label}
          <span
            aria-hidden
            className={cn(
              'size-1 rounded-full bg-primary transition-opacity',
              modified ? 'opacity-100' : 'opacity-0',
            )}
          />
        </button>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          spellCheck={false}
          value={display}
          aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => commitDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitDraft(event.currentTarget.value)
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(null)
              event.currentTarget.blur()
            }
          }}
          className={cn(
            'w-14 rounded-sm bg-transparent px-1 py-0.5 text-right text-xs tabular-nums outline-none transition-colors',
            'hover:bg-muted/60 focus:bg-muted focus:text-foreground',
            modified ? 'text-foreground' : 'text-muted-foreground',
          )}
        />
      </div>
      <div onDoubleClick={reset} className="pt-1.5 pb-0.5">
        <Slider
          value={value}
          min={min}
          max={max}
          step={step}
          largeStep={step * 10}
          origin={defaultValue}
          aria-label={label}
          onValueChange={(next) => onChange(next as number)}
          onValueCommitted={(next) => onCommit(next as number)}
        />
      </div>
    </div>
  )
}
