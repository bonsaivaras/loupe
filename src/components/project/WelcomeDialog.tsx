import { useEffect, useState } from 'react'
import { HeartIcon, ImagesIcon, LockIcon, ZapIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

const SEEN_KEY = 'll:seenWelcome'

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* Private mode: the note just shows again next time. */
  }
}

function alreadySeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

const POINTS = [
  {
    icon: LockIcon,
    title: 'Nothing is uploaded',
    body: 'There is no server. Your photos are decoded and edited by this browser, on this laptop, and never leave it.',
  },
  {
    icon: ImagesIcon,
    title: 'No login, no paywall, no ads',
    body: 'No account to make, nothing to subscribe to, no upsell at the export button. All of it works, all of the time.',
  },
  {
    icon: ZapIcon,
    title: 'Cull, edit, export, forget',
    body: 'Point it at a card, flag the keepers, push some sliders, export the ones you want. Hit Finish and it wipes itself.',
  },
]

export function WelcomeDialog() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!alreadySeen()) setOpen(true)
  }, [])

  const dismiss = () => {
    markSeen()
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss()
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <div className="flex flex-col items-center pt-2 text-center">
          <HeartIcon className="size-7 text-muted-foreground" />
          <DialogTitle className="mt-4 text-lg">
            Loupe — edit your photos and get on with your day
          </DialogTitle>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
            A photo editor for the shoot you actually care about — your kid's birthday, a
            weekend away — without any of the ceremony that usually comes with one.
          </p>
        </div>

        <ul className="mt-5 grid gap-4">
          {POINTS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{title}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground">
          Photos stay on this device and are deleted after 30 days of not opening them, so
          export anything you want to keep. Free, and it will stay that way.
        </p>

        <Button className="mt-4 w-full" onClick={dismiss}>
          Get started
        </Button>
      </DialogContent>
    </Dialog>
  )
}
