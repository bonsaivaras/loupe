import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  DownloadIcon,
  FolderPlusIcon,
  KeyboardIcon,
  Trash2Icon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { flagCounts, useProjectStore } from '@/store/projectStore'
import { useUiStore } from '@/store/uiStore'
import { storageStatus } from '@/storage/lifecycle'
import { formatBytes, formatExpiry, daysUntil } from '@/lib/format'

interface TopBarProps {
  onAddPhotos: () => void
}

export function TopBar({ onAddPhotos }: TopBarProps) {
  const project = useProjectStore((s) => s.project)
  const counts = useProjectStore(useShallow(flagCounts))
  const importing = useProjectStore((s) => s.importProgress.active)
  const setExportOpen = useUiStore((s) => s.setExportOpen)
  const setFinishOpen = useUiStore((s) => s.setFinishOpen)
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen)

  const [storage, setStorage] = useState({ usage: 0, quota: 0 })

  useEffect(() => {
    let stale = false
    const refresh = () => {
      void storageStatus().then((next) => {
        if (!stale) setStorage(next)
      })
    }
    refresh()
    const timer = window.setInterval(refresh, importing ? 2000 : 20_000)
    return () => {
      stale = true
      window.clearInterval(timer)
    }
  }, [importing, counts.total])

  const usedPct = storage.quota > 0 ? (storage.usage / storage.quota) * 100 : 0
  const expiringSoon = project ? daysUntil(project.expiresAt) <= 3 : false

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border/60 bg-background px-3">
      <span className="text-sm font-semibold tracking-tight">Loupe</span>

      {project && (
        <>
          <Separator orientation="vertical" className="h-5" />
          <span className="max-w-56 truncate text-sm text-muted-foreground" title={project.name}>
            {project.name}
          </span>
          <Badge variant={expiringSoon ? 'destructive' : 'secondary'} className="tabular-nums">
            {formatExpiry(project.expiresAt)}
          </Badge>
        </>
      )}

      <div className="flex-1" />

      {storage.quota > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={
              <div className="hidden w-40 items-center gap-2 lg:flex">
                <Progress value={usedPct} className="flex-1" />
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {formatBytes(storage.usage)}
                </span>
              </div>
            }
          />
          <TooltipContent>
            {formatBytes(storage.usage)} of {formatBytes(storage.quota)} browser storage used
          </TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" onClick={() => setShortcutsOpen(true)}>
              <KeyboardIcon />
            </Button>
          }
        />
        <TooltipContent>Keyboard shortcuts (?)</TooltipContent>
      </Tooltip>

      {project && (
        <>
          <Button variant="outline" size="sm" onClick={onAddPhotos}>
            <FolderPlusIcon />
            Add
          </Button>
          <Button size="sm" onClick={() => setExportOpen(true)} disabled={counts.total === 0}>
            <DownloadIcon />
            Export
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setFinishOpen(true)}>
            <Trash2Icon />
            Finish
          </Button>
        </>
      )}
    </header>
  )
}
