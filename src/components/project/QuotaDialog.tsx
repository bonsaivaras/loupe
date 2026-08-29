import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useUiStore } from '@/store/uiStore'

export function QuotaDialog() {
  const message = useUiStore((s) => s.quotaWarning)
  const setQuotaWarning = useUiStore((s) => s.setQuotaWarning)

  return (
    <AlertDialog
      open={message !== null}
      onOpenChange={(open) => {
        if (!open) setQuotaWarning(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Not enough browser storage</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => setQuotaWarning(null)}>Got it</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
