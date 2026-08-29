import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useShallow } from 'zustand/react/shallow'
import { useProjectStore, flagCounts } from '@/store/projectStore'
import { persistFilter } from '@/store/uiStore'
import type { FilterMode } from '@/types'

const CHIPS: { value: FilterMode; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pick', label: 'Picked' },
  { value: 'none', label: 'Unflagged' },
  { value: 'reject', label: 'Rejected' },
]

export function FilterChips() {
  const filter = useProjectStore((s) => s.filter)
  const setFilter = useProjectStore((s) => s.setFilter)
  const counts = useProjectStore(useShallow(flagCounts))

  const countFor = (value: FilterMode) =>
    value === 'all' ? counts.total : counts[value as 'pick' | 'none' | 'reject']

  return (
    <ToggleGroup
      value={[filter]}
      spacing={0}
      className="w-full grid grid-cols-4 rounded-md border border-border/70 p-0"
      onValueChange={(next) => {
        const value = (next[0] ?? filter) as FilterMode
        setFilter(value)
        persistFilter(value)
      }}
    >
      {CHIPS.map((chip) => (
        <ToggleGroupItem
          key={chip.value}
          value={chip.value}
          size="sm"
          className="h-auto min-w-0 flex-col gap-0 overflow-hidden px-0.5 py-1"
          title={`${chip.label} — ${countFor(chip.value)}`}
        >
          <span className="w-full truncate text-center text-[10px] leading-tight">
            {chip.label}
          </span>
          <span className="text-[9px] leading-tight tabular-nums opacity-60">
            {countFor(chip.value)}
          </span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
