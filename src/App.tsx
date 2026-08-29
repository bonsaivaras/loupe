import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TopBar } from '@/components/layout/TopBar'
import { Workspace } from '@/components/layout/Workspace'
import { DropZone } from '@/components/import/DropZone'
import { ImportProgress } from '@/components/import/ImportProgress'
import { ImportReviewDialog } from '@/components/import/ImportReviewDialog'
import { ExportDialog } from '@/components/export/ExportDialog'
import { DeletePhotosDialog } from '@/components/project/DeletePhotosDialog'
import { WelcomeDialog } from '@/components/project/WelcomeDialog'
import { ExpiryBanner } from '@/components/project/ExpiryBanner'
import { FinishProjectDialog } from '@/components/project/FinishProjectDialog'
import { QuotaDialog } from '@/components/project/QuotaDialog'
import { ShortcutsDialog } from '@/components/project/ShortcutsDialog'
import {
  collectFromDataTransfer,
  collectFromDirectoryHandle,
  collectFromFileList,
  type CollectResult,
} from '@/engine/import/collect'
import { checkQuota, QuotaError, runImport } from '@/engine/import/importer'
import { getAllProjects, getPhotosForProject } from '@/storage/db'
import {
  persistedState,
  requestPersistence,
  sweepExpired,
  sweepOrphans,
  touchProject,
  wipeProject,
} from '@/storage/lifecycle'
import { opfsSupported } from '@/storage/opfs'
import { readActiveProjectId } from '@/storage/prefs'
import { flushPhotoWrites, useProjectStore } from '@/store/projectStore'
import { useEditStore } from '@/store/editStore'
import { initialFilter } from '@/store/uiStore'
import { useGlobalKeyboard } from '@/lib/keyboard'
import { formatBytes } from '@/lib/format'

/** Below this, a folder import is almost certainly wanted whole. */
const REVIEW_THRESHOLD = 12

export default function App() {
  const project = useProjectStore((s) => s.project)
  const photoCount = useProjectStore((s) => s.order.length)
  const booted = useProjectStore((s) => s.booted)
  const loadProject = useProjectStore((s) => s.loadProject)
  const setBooted = useProjectStore((s) => s.setBooted)

  const [dragging, setDragging] = useState(false)
  const [review, setReview] = useState<CollectResult | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(persistedState())
  const [unsupported, setUnsupported] = useState<string | null>(null)
  const dragDepth = useRef(0)

  useGlobalKeyboard()

  /* ---- boot -------------------------------------------------------------- */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!opfsSupported()) {
        setUnsupported(
          'This browser has no origin private file system, so photos cannot be stored locally. Use a recent Chrome, Edge, Safari or Firefox.',
        )
        setBooted(true)
        return
      }
      try {
        // Expired projects are deleted before any UI renders.
        await sweepExpired()
        await sweepOrphans()
        const activeId = readActiveProjectId()
        const projects = await getAllProjects()
        const target =
          projects.find((p) => p.id === activeId) ??
          projects.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0]
        if (target && !cancelled) {
          const refreshed = (await touchProject(target.id)) ?? target
          const photos = await getPhotosForProject(target.id)
          loadProject(refreshed, photos)
          // Go through setFilter so a restored filter that hides the first
          // photo still leaves a visible one selected.
          useProjectStore.getState().setFilter(initialFilter)
          setPersisted(await requestPersistence())
        }
      } catch (error) {
        toast.error('Could not open your last project', {
          description: error instanceof Error ? error.message : String(error),
        })
      } finally {
        if (!cancelled) setBooted(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadProject, setBooted])

  /* ---- flush debounced writes on the way out ----------------------------- */
  useEffect(() => {
    const flush = () => flushPhotoWrites()
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flush)
      flush()
    }
  }, [])

  /* ---- import ------------------------------------------------------------ */
  const performImport = useCallback(
    async (collected: CollectResult) => {
      try {
        const outcome = await runImport(collected)
        setPersisted(persistedState())
        const parts = [`Imported ${outcome.imported} photos`]
        if (outcome.skipped > 0) parts.push(`skipped ${outcome.skipped} unsupported files`)
        if (outcome.failed > 0) parts.push(`${outcome.failed} could not be decoded`)
        toast.success(parts.join(' · '))
      } catch (error) {
        useProjectStore.getState().resetImportProgress()
        if (error instanceof QuotaError) {
          // Offer a subset rather than a dead end.
          toast.warning(
            `That needs about ${formatBytes(error.needed)} but only ${formatBytes(
              error.available,
            )} is free — choose fewer photos.`,
          )
          setReview(collected)
          return
        }
        toast.error('Import failed', {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [],
  )

  /**
   * Anything larger than a handful gets a review step first, so a card can be
   * culled down before a single byte is decoded. A selection the user made
   * themselves in a file picker is taken at face value.
   */
  const startImport = useCallback(
    async (collected: CollectResult, fromFolder: boolean) => {
      if (collected.files.length === 0) {
        toast.warning(
          collected.skipped > 0
            ? `No supported photos found — skipped ${collected.skipped} files`
            : 'No supported photos found',
        )
        return
      }
      const crowded = fromFolder && collected.files.length > REVIEW_THRESHOLD
      const { fits } = await checkQuota(collected.files)
      if (crowded || !fits) {
        setReview(collected)
        return
      }
      await performImport(collected)
    },
    [performImport],
  )

  const pickDirectory = useCallback(async () => {
    if (typeof window.showDirectoryPicker !== 'function') {
      // Fall back to a webkitdirectory input.
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      input.webkitdirectory = true
      input.onchange = () => {
        if (input.files?.length) void startImport(collectFromFileList(input.files), true)
      }
      input.click()
      return
    }
    try {
      const dir = await window.showDirectoryPicker({ id: 'll-import', mode: 'read' })
      void startImport(await collectFromDirectoryHandle(dir), true)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/abort/i.test(message)) toast.error('Could not read that folder', { description: message })
    }
  }, [startImport])

  const pickFiles = useCallback(
    (files: FileList) => void startImport(collectFromFileList(files), false),
    [startImport],
  )

  /** Only reachable when the project holds no photos, so nothing is at risk. */
  const closeEmptyProject = useCallback(() => {
    const current = useProjectStore.getState().project
    if (!current) return
    void wipeProject(current.id).then(() => {
      useProjectStore.getState().closeProject()
      useEditStore.getState().clear()
      toast.success('Project closed')
    })
  }, [])

  /* ---- drag and drop ----------------------------------------------------- */
  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      dragDepth.current += 1
      setDragging(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer) return
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      void collectFromDataTransfer(event.dataTransfer).then((collected) =>
        // A dropped folder is worth reviewing; a dropped file selection is not.
        startImport(collected, collected.folderName !== null),
      )
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [startImport])

  if (unsupported) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="max-w-md text-center text-sm text-muted-foreground">{unsupported}</p>
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <TopBar onAddPhotos={pickDirectory} />
        <ExpiryBanner />
        <ImportProgress />
        {booted && photoCount === 0 ? (
          // An empty three-pane workspace is a dead end; always offer a way out.
          <div className="min-h-0 flex-1">
            <DropZone
              dragging={dragging}
              onPickDirectory={pickDirectory}
              onPickFiles={pickFiles}
              persisted={persisted}
              emptyProject={project !== null}
              onCloseProject={closeEmptyProject}
            />
          </div>
        ) : (
          <Workspace />
        )}
        {dragging && project && (
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70">
            <p className="rounded-lg border border-dashed border-primary px-6 py-4 text-sm">
              Drop to add these photos
            </p>
          </div>
        )}
      </div>

      <ExportDialog />
      <ImportReviewDialog
        collected={review}
        onCancel={() => setReview(null)}
        onConfirm={(files) => {
          const source = review
          setReview(null)
          if (source) void performImport({ ...source, files })
        }}
      />
      <WelcomeDialog />
      <DeletePhotosDialog />
      <FinishProjectDialog />
      <ShortcutsDialog />
      <QuotaDialog />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  )
}
