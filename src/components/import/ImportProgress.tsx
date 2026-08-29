import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { formatBytes, formatDuration } from '@/lib/format'
import { useProjectStore } from '@/store/projectStore'
import { abortImport } from '@/engine/import/importer'

export function ImportProgress() {
  const progress = useProjectStore((s) => s.importProgress)
  if (!progress.active) return null

  const pct = progress.total > 0 ? (progress.done / progress.total) * 100 : 0
  const elapsed = performance.now() - progress.startedAt
  const throughput = elapsed > 0 ? (progress.bytesRead / elapsed) * 1000 : 0

  return (
    <div className="border-b border-border/60 bg-card/60 px-4 py-2.5">
      <div className="flex items-center gap-3">
        <Progress value={pct} className="min-w-0 flex-1" />
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {progress.done} / {progress.total}
        </span>
        <Button variant="ghost" size="sm" onClick={abortImport}>
          Stop
        </Button>
      </div>
      <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
        {progress.label}
        {throughput > 0 && ` · ${formatBytes(throughput)}/s · ${formatDuration(elapsed)} elapsed`}
        {progress.failed > 0 && ` · ${progress.failed} failed`}
      </p>
    </div>
  )
}
