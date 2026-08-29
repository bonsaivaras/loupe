import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useUiStore } from '@/store/uiStore'

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Navigate',
    items: [
      ['← →  ↑ ↓', 'Previous / next photo'],
      ['F', 'Fit to window'],
      ['+  −', 'Zoom in / out'],
      ['Pinch', 'Zoom — or ⌘-scroll'],
      ['Drag', 'Pan when zoomed'],
      ['Double-click', 'Toggle 100%'],
    ],
  },
  {
    title: 'Cull',
    items: [
      ['P', 'Pick, then next photo'],
      ['X', 'Reject, then next photo'],
      ['⇧P  ⇧X', 'Flag without advancing'],
      ['U', 'Unflag'],
      ['⌫  ⌦', 'Remove photo from project'],
    ],
  },
  {
    title: 'Edit',
    items: [
      ['B', 'Show original — hold'],
      ['\\', 'Toggle before / after'],
      ['[  ]', 'Rotate left / right'],
      ['0', 'Reset all adjustments'],
      ['⌘Z  ⌘⇧Z', 'Undo / redo'],
    ],
  },
  {
    title: 'Project',
    items: [
      ['E', 'Export'],
      ['Right-click', 'Photo actions menu'],
      ['?', 'This sheet'],
    ],
  },
]

export function ShortcutsDialog() {
  const open = useUiStore((s) => s.shortcutsOpen)
  const setOpen = useUiStore((s) => s.setShortcutsOpen)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 py-1">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {group.title}
              </h3>
              <dl className="space-y-1.5">
                {group.items.map(([keys, label]) => (
                  <div key={keys} className="flex items-baseline justify-between gap-3">
                    <dd className="text-xs text-foreground">{label}</dd>
                    <dt className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {keys}
                    </dt>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
