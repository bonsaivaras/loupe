import { useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useProjectStore } from '@/store/projectStore'
import { useUiStore } from '@/store/uiStore'
import { wipeProject } from '@/storage/lifecycle'
import { clearProxies } from '@/lib/proxyCache'
import { clearThumbs } from '@/lib/thumbCache'
import { useEditStore } from '@/store/editStore'

export function FinishProjectDialog() {
  const open = useUiStore((s) => s.finishOpen)
  const setOpen = useUiStore((s) => s.setFinishOpen)
  const setExportOpen = useUiStore((s) => s.setExportOpen)
  const project = useProjectStore((s) => s.project)
  const closeProject = useProjectStore((s) => s.closeProject)
  const [busy, setBusy] = useState(false)

  const unexported = useProjectStore((s) =>
    s.order.filter((id) => s.photos[id]?.flag === 'pick' && !s.exported.has(id)).length,
  )

  const wipe = async () => {
    if (!project) return
    setBusy(true)
    try {
      await wipeProject(project.id)
      clearProxies()
      clearThumbs()
      useEditStore.getState().clear()
      closeProject()
      setOpen(false)
      toast.success('Project wiped — nothing left on this device')
    } catch (error) {
      toast.error('Could not wipe the project', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Finish and wipe this project?</AlertDialogTitle>
          <AlertDialogDescription>
            {unexported > 0 ? (
              <>
                <strong className="text-destructive">
                  {unexported} picked {unexported === 1 ? 'photo has' : 'photos have'} not been
                  exported this session.
                </strong>{' '}
                Every original, proxy and edit for this project will be deleted from this browser
                and cannot be recovered.
              </>
            ) : (
              <>
                Every original, proxy and edit for this project will be deleted from this browser
                and cannot be recovered.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep working</AlertDialogCancel>
          {unexported > 0 && (
            <AlertDialogCancel
              disabled={busy}
              onClick={() => {
                setOpen(false)
                setExportOpen(true)
              }}
            >
              Export picks first
            </AlertDialogCancel>
          )}
          <AlertDialogAction disabled={busy} onClick={wipe}>
            {busy ? 'Wiping…' : 'Wipe everything'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
