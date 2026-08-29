import { CalendarClockIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useProjectStore } from '@/store/projectStore'
import { touchProject } from '@/storage/lifecycle'
import { daysUntil } from '@/lib/format'

export function ExpiryBanner() {
  const project = useProjectStore((s) => s.project)
  const updateProject = useProjectStore((s) => s.updateProject)
  if (!project) return null

  const days = daysUntil(project.expiresAt)
  if (days > 3) return null

  const keep = async () => {
    const next = await touchProject(project.id)
    if (next) updateProject({ lastOpenedAt: next.lastOpenedAt, expiresAt: next.expiresAt })
  }

  return (
    <div className="flex items-center gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs">
      <CalendarClockIcon className="size-4 shrink-0 text-destructive" />
      <span className="flex-1">
        This project will be deleted {days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}.
        Export anything you still need.
      </span>
      <Button variant="outline" size="xs" onClick={keep}>
        Keep for another 30 days
      </Button>
    </div>
  )
}
