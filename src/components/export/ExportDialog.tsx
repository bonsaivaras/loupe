import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { toast } from 'sonner'
import { Loader2Icon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { getActiveRenderer } from '@/engine/gl/activeRenderer'
import {
  FORMAT_EXT,
  RESIZE_OPTIONS,
  type ExportFormat,
  type ResizeOption,
} from '@/engine/export/encode'
import { cancelExport, runExport, type ExportProgressUpdate } from '@/engine/export/runExport'
import {
  directoryPickerAvailable,
  SaveCancelledError,
  type Destination,
} from '@/engine/export/save'
import { pickedIds, useProjectStore } from '@/store/projectStore'
import { useUiStore } from '@/store/uiStore'

type Scope = 'current' | 'picked'

const FORMAT_LABELS: Record<ExportFormat, string> = {
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  pdf: 'PDF',
}

const PHASE_LABELS: Record<ExportProgressUpdate['phase'], string> = {
  decoding: 'Decoding',
  rendering: 'Rendering',
  encoding: 'Encoding',
  saving: 'Saving',
  done: 'Done',
}

export function ExportDialog() {
  const open = useUiStore((s) => s.exportOpen)
  const setOpen = useUiStore((s) => s.setExportOpen)
  const invalidateSource = useUiStore((s) => s.invalidateSource)

  const photos = useProjectStore((s) => s.photos)
  const projectName = useProjectStore((s) => s.project?.name ?? 'export')
  const selectedId = useProjectStore((s) => s.selectedId)
  const picked = useProjectStore(useShallow(pickedIds))
  const markExported = useProjectStore((s) => s.markExported)

  const [scope, setScope] = useState<Scope>('current')
  const [format, setFormat] = useState<ExportFormat>('jpeg')
  const [quality, setQuality] = useState(92)
  const [resize, setResize] = useState<ResizeOption>('original')
  const [pattern, setPattern] = useState('{name}_edited')
  // Chrome refuses write access to plenty of ordinary folders, so downloading
  // has to be reachable without discovering that the hard way.
  const [destination, setDestination] = useState<Destination>(
    directoryPickerAvailable() ? 'folder' : 'download',
  )
  const [progress, setProgress] = useState<ExportProgressUpdate | null>(null)

  const running = progress !== null && progress.phase !== 'done'

  const targets = useMemo(() => {
    const ids = scope === 'current' ? (selectedId ? [selectedId] : []) : picked
    return ids
      .map((id) => photos[id])
      .filter((photo) => photo && photo.decodeState === 'ready')
  }, [scope, selectedId, picked, photos])

  const start = async () => {
    const renderer = getActiveRenderer()
    if (!renderer) {
      toast.error('The renderer is not ready yet')
      return
    }
    if (targets.length === 0) {
      toast.error('Nothing to export')
      return
    }
    setProgress({ index: 0, total: targets.length, filename: '', phase: 'decoding' })
    try {
      const result = await runExport(
        targets,
        { format, quality: quality / 100, resize, pattern, destination },
        renderer,
        projectName,
        setProgress,
      )
      markExported(targets.map((photo) => photo.id))
      if (result.failed.length > 0) {
        toast.warning(
          `Exported ${result.written} of ${targets.length} — ${result.failed.length} failed`,
          { description: result.failed[0].error },
        )
      } else if (result.cancelled) {
        toast.info(`Export cancelled after ${result.written} photos`)
      } else {
        toast.success(
          `Exported ${result.written} ${result.written === 1 ? 'photo' : 'photos'} as ${FORMAT_LABELS[format]}`,
        )
      }
      setOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Dismissing the folder picker is a user decision, not a failure.
      if (error instanceof SaveCancelledError || /abort/i.test(message)) {
        toast.info('Export cancelled', {
          description: 'Set Save to "Download" if the folder picker keeps refusing.',
        })
      } else {
        toast.error('Export failed', { description: message })
      }
    } finally {
      setProgress(null)
      // The renderer is holding nothing now; rebuild the preview texture.
      invalidateSource()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (running) return
        setOpen(next)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>
            {directoryPickerAvailable()
              ? 'You will be asked to pick a destination folder.'
              : 'Files download to your browser’s download folder.'}
          </DialogDescription>
        </DialogHeader>

        {running ? (
          <div className="space-y-3 py-2">
            <Progress
              value={progress.total > 0 ? (progress.index / progress.total) * 100 : 0}
            />
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              {PHASE_LABELS[progress.phase]} {Math.min(progress.index + 1, progress.total)} of{' '}
              {progress.total}
              <span className="truncate">· {progress.filename}</span>
            </p>
            <Button variant="outline" size="sm" onClick={cancelExport}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <Label>Scope</Label>
              <Select
                items={{
                  current: 'Current photo',
                  picked: `All picked — ${picked.length}`,
                }}
                value={scope}
                onValueChange={(value) => setScope(value as Scope)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">Current photo</SelectItem>
                  <SelectItem value="picked">All picked — {picked.length}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Format</Label>
                <Select
                  items={FORMAT_LABELS}
                  value={format}
                  onValueChange={(value) => setFormat(value as ExportFormat)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {FORMAT_LABELS[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label>Long edge</Label>
                <Select
                  items={Object.fromEntries(RESIZE_OPTIONS.map((o) => [o.value, o.label]))}
                  value={resize}
                  onValueChange={(value) => setResize(value as ResizeOption)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RESIZE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {directoryPickerAvailable() && (
              <div className="grid gap-2">
                <Label>Save to</Label>
                <ToggleGroup
                  value={[destination]}
                  onValueChange={(value) => {
                    const next = (value as string[])[0]
                    if (next) setDestination(next as Destination)
                  }}
                  variant="outline"
                  spacing={0}
                  className="w-full *:flex-1"
                >
                  <ToggleGroupItem value="folder">Choose a folder</ToggleGroupItem>
                  <ToggleGroupItem value="download">Download</ToggleGroupItem>
                </ToggleGroup>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {destination === 'folder'
                    ? 'Writes straight into a folder you pick. Chrome blocks some folders — including your home folder — as containing system files; a subfolder like Pictures/Export works.'
                    : targets.length > 1
                      ? 'Saves one zip to your Downloads folder. Always works.'
                      : 'Saves to your Downloads folder. Always works.'}
                </p>
              </div>
            )}

            {(format === 'jpeg' || format === 'webp') && (
              <div className="grid gap-2">
                <div className="flex items-baseline justify-between">
                  <Label>Quality</Label>
                  <span className="text-xs text-muted-foreground tabular-nums">{quality}</span>
                </div>
                <Slider
                  value={quality}
                  min={40}
                  max={100}
                  step={1}
                  onValueChange={(value) => setQuality(value as number)}
                />
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="pattern">Filename</Label>
              <Input
                id="pattern"
                value={pattern}
                onChange={(event) => setPattern(event.target.value)}
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground">
                Tokens: <code>{'{name}'}</code> <code>{'{n}'}</code> <code>{'{date}'}</code>{' '}
                <code>{'{camera}'}</code> · saved as <code>.{FORMAT_EXT[format]}</code>
              </p>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">
                {targets.length} {targets.length === 1 ? 'photo' : 'photos'} ready
              </span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={start} disabled={targets.length === 0}>
                  Export
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
