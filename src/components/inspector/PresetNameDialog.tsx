import { useEffect, useState } from 'react'
import { toast } from 'sonner'
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
import { describePreset } from '@/lib/adjustments'
import { PresetStorageFullError } from '@/storage/presets'
import { usePresetStore } from '@/store/presetStore'
import type { Preset, PresetAdjustments } from '@/types'

export type PresetNameRequest =
  | { mode: 'create'; adjustments: PresetAdjustments }
  | { mode: 'rename'; preset: Preset }

interface PresetNameDialogProps {
  request: PresetNameRequest | null
  onClose: () => void
}

export function PresetNameDialog({ request, onClose }: PresetNameDialogProps) {
  const create = usePresetStore((s) => s.create)
  const rename = usePresetStore((s) => s.rename)
  const nameTaken = usePresetStore((s) => s.nameTaken)
  const uniqueName = usePresetStore((s) => s.uniqueName)
  const [name, setName] = useState('')

  useEffect(() => {
    if (!request) return
    setName(request.mode === 'rename' ? request.preset.name : uniqueName('Preset'))
  }, [request, uniqueName])

  const trimmed = name.trim()
  const duplicate =
    trimmed.length > 0 &&
    nameTaken(trimmed, request?.mode === 'rename' ? request.preset.id : undefined)
  const valid = trimmed.length > 0 && !duplicate

  const submit = () => {
    if (!request || !valid) return
    try {
      if (request.mode === 'create') {
        create({ name: trimmed, adjustments: request.adjustments })
        toast.success(`Saved preset “${trimmed}”`)
      } else {
        rename(request.preset.id, trimmed)
      }
      onClose()
    } catch (error) {
      if (error instanceof PresetStorageFullError) {
        toast.error('No room left for more presets', {
          description: 'Remove a few presets and try again.',
        })
        return
      }
      toast.error('Could not save that preset', {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const summary =
    request?.mode === 'create'
      ? describePreset(request.adjustments)
      : request
        ? describePreset(request.preset.adjustments)
        : ''

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {request?.mode === 'rename' ? 'Rename preset' : 'Save preset'}
          </DialogTitle>
          <DialogDescription>
            Presets store the sliders only — rotation and flip stay with each photo. They are
            kept on this device and survive finishing a project.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-1">
          <Label htmlFor="preset-name">Name</Label>
          <Input
            id="preset-name"
            autoFocus
            value={name}
            spellCheck={false}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
          />
          {duplicate ? (
            <p className="text-[11px] text-destructive">A preset with that name already exists.</p>
          ) : (
            <p className="truncate text-[11px] text-muted-foreground" title={summary}>
              {summary}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid}>
            {request?.mode === 'rename' ? 'Rename' : 'Save preset'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
