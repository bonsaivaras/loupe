import { useRef } from 'react'
import { FolderOpenIcon, ImagesIcon, LockIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ACCEPT_ATTRIBUTE, ACCEPTED_LABEL } from '@/lib/files'
import { directoryPickerAvailable } from '@/engine/export/save'
import { cn } from '@/lib/utils'

interface DropZoneProps {
  dragging: boolean
  onPickDirectory: () => void
  onPickFiles: (files: FileList) => void
  persisted: boolean | null
  /** True when a project exists but has no photos left in it. */
  emptyProject: boolean
  onCloseProject: () => void
}

export function DropZone({
  dragging,
  onPickDirectory,
  onPickFiles,
  persisted,
  emptyProject,
  onCloseProject,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div
        className={cn(
          'flex w-full max-w-xl flex-col items-center rounded-xl border border-dashed px-10 py-14 text-center transition-colors',
          dragging ? 'border-primary bg-muted/50' : 'border-border bg-card/40',
        )}
      >
        <ImagesIcon className="size-8 text-muted-foreground" />
        <h1 className="mt-5 text-lg font-medium">
          {emptyProject ? 'This project has no photos left' : 'Drop a folder of photos here'}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {emptyProject
            ? 'Add more photos to carry on, or close the project to start fresh.'
            : 'Cull, adjust and export a card of RAWs — entirely in this browser.'}
        </p>

        <div className="mt-7 flex items-center gap-2">
          <Button onClick={onPickDirectory}>
            <FolderOpenIcon />
            Choose folder
          </Button>
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            Choose files
          </Button>
          {emptyProject && (
            <Button variant="ghost" onClick={onCloseProject}>
              <XIcon />
              Close project
            </Button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files?.length) onPickFiles(event.target.files)
              event.target.value = ''
            }}
          />
        </div>

        {directoryPickerAvailable() && (
          <p className="mt-4 max-w-sm text-[11px] leading-relaxed text-muted-foreground">
            Choosing a folder? Select the folder itself, not the files —{' '}
            <code className="text-foreground/70">DCIM/100D5100</code>, or{' '}
            <code className="text-foreground/70">DCIM</code> to take every sub-folder. macOS
            always greys out the files inside a folder picker; your RAWs are still read.
          </p>
        )}

        <p className="mt-8 max-w-md text-[11px] leading-relaxed text-muted-foreground">
          {ACCEPTED_LABEL}
        </p>

        <p className="mt-5 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <LockIcon className="mt-px size-3 shrink-0" />
          <span>
            Nothing is uploaded. Stored on this device only, deleted after 30 days of inactivity
            {persisted === false
              ? ' — and your browser may clear it sooner if you don’t come back within a week.'
              : '.'}
          </span>
        </p>
      </div>
    </div>
  )
}
