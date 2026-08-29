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
import { deletePhotos } from '@/lib/photoActions'
import { formatBytes } from '@/lib/format'
import { useProjectStore } from '@/store/projectStore'
import { useUiStore } from '@/store/uiStore'

export function DeletePhotosDialog() {
  const pending = useUiStore((s) => s.pendingDelete)
  const cancelDelete = useUiStore((s) => s.cancelDelete)
  const photos = useProjectStore((s) => s.photos)
  const [busy, setBusy] = useState(false)

  const targets = (pending ?? []).map((id) => photos[id]).filter(Boolean)
  const bytes = targets.reduce((sum, photo) => sum + photo.bytes, 0)
  const unexported = useProjectStore((s) =>
    (pending ?? []).filter((id) => s.photos[id]?.flag === 'pick' && !s.exported.has(id)).length,
  )

  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    try {
      const result = await deletePhotos(pending)
      cancelDelete()
      toast.success(
        `Removed ${result.deleted} ${result.deleted === 1 ? 'photo' : 'photos'} · ${formatBytes(
          result.bytesFreed,
        )} freed`,
      )
    } catch (error) {
      toast.error('Could not remove those photos', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  const one = targets.length === 1 ? targets[0] : null

  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && !busy) cancelDelete()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {one ? `Remove ${one.filename}?` : `Remove ${targets.length} photos?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {unexported > 0 && (
              <>
                <strong className="text-destructive">
                  {unexported} of {unexported === 1 ? 'them is' : 'them are'} picked and not
                  exported this session.
                </strong>{' '}
              </>
            )}
            This frees about {formatBytes(bytes)} of browser storage and cannot be undone. The
            files on your card are not touched — you can import them again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={confirm}>
            {busy ? 'Removing…' : one ? 'Remove photo' : `Remove ${targets.length} photos`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
