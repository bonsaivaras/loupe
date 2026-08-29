import { useEffect } from 'react'
import { DEFAULT_ADJUSTMENTS } from '@/lib/adjustments'
import { useEditStore } from '@/store/editStore'
import { useProjectStore, visibleIds } from '@/store/projectStore'
import { useUiStore } from '@/store/uiStore'
import { zoomStep } from '@/lib/viewport'
import type { Adjustments, FlagState } from '@/types'

/**
 * The slider primitive binds Arrow and Shift+Arrow itself, so a focused slider
 * must not also step to the next photo.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    target.getAttribute('role') === 'slider' ||
    target.closest('[role="slider"]') !== null
  )
}

function step(delta: number): void {
  const state = useProjectStore.getState()
  const ids = visibleIds(state)
  if (ids.length === 0) return
  const current = state.selectedId ? ids.indexOf(state.selectedId) : -1
  const next = current < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, current + delta))
  state.select(ids[next])
}

function flag(value: FlagState, advance: boolean): void {
  const state = useProjectStore.getState()
  if (!state.selectedId) return
  state.setFlag(state.selectedId, value, advance)
}

function mutate(change: (adjustments: Adjustments) => Adjustments): void {
  const state = useProjectStore.getState()
  const photo = state.selectedId ? state.photos[state.selectedId] : null
  if (!photo) return
  useEditStore.getState().commit(photo.id, change(photo.adjustments))
}

const ROTATIONS: Adjustments['rotate'][] = [0, 90, 180, 270]

function rotate(direction: 1 | -1): void {
  mutate((a) => ({
    ...a,
    rotate: ROTATIONS[(ROTATIONS.indexOf(a.rotate) + direction + 4) % 4],
  }))
}

export function useGlobalKeyboard(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ui = useUiStore.getState()
      if (isTypingTarget(event.target)) return

      const meta = event.metaKey || event.ctrlKey
      const project = useProjectStore.getState()
      const selectedId = project.selectedId

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (!selectedId) return
        if (event.shiftKey) useEditStore.getState().redo(selectedId)
        else useEditStore.getState().undo(selectedId)
        return
      }
      if (meta) return

      if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
        event.preventDefault()
        ui.setShortcutsOpen(!ui.shortcutsOpen)
        return
      }

      if (ui.anyDialogOpen()) return
      if (!project.project) return

      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault()
          step(-1)
          return
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault()
          step(1)
          return
        case 'r': {
          event.preventDefault()
          ui.setSpotMode(!ui.spotMode)
          return
        }
        case 'Escape': {
          if (ui.spotMode) {
            event.preventDefault()
            ui.setSpotMode(false)
          }
          return
        }
        case 'Backspace':
        case 'Delete': {
          event.preventDefault()
          // In spot mode this clears the selected heal, not the photo.
          if (ui.spotMode && ui.selectedSpotId && selectedId) {
            const target = useProjectStore.getState().photos[selectedId]
            if (target) {
              const doomed = ui.selectedSpotId
              useEditStore.getState().commit(selectedId, {
                ...target.adjustments,
                spots: target.adjustments.spots.filter((spot) => spot.id !== doomed),
              })
              ui.selectSpot(null)
            }
            return
          }
          if (selectedId) ui.requestDelete([selectedId])
          return
        }
        case '+':
        case '=': {
          event.preventDefault()
          const s1 = useUiStore.getState()
          s1.setView({ zoom: zoomStep(s1.viewZoom, -120), cx: s1.viewCx, cy: s1.viewCy })
          return
        }
        case '-':
        case '_': {
          event.preventDefault()
          const s2 = useUiStore.getState()
          s2.setView({ zoom: zoomStep(s2.viewZoom, 120), cx: s2.viewCx, cy: s2.viewCy })
          return
        }
        case '\\':
          event.preventDefault()
          ui.toggleBeforeSticky()
          return
        case '0':
          event.preventDefault()
          mutate((a) => ({ ...DEFAULT_ADJUSTMENTS, rotate: a.rotate, flipH: a.flipH }))
          return
        case '[':
          event.preventDefault()
          rotate(-1)
          return
        case ']':
          event.preventDefault()
          rotate(1)
          return
        default:
          break
      }

      switch (event.key.toLowerCase()) {
        case 'p':
          event.preventDefault()
          flag('pick', !event.shiftKey)
          return
        case 'x':
          event.preventDefault()
          flag('reject', !event.shiftKey)
          return
        case 'u':
          event.preventDefault()
          flag('none', false)
          return
        case 'b':
          if (!event.repeat) ui.setBeforeHeld(true)
          return
        case 'e':
          event.preventDefault()
          if (project.order.length > 0) ui.setExportOpen(true)
          return
        case 'f':
          event.preventDefault()
          ui.requestFit()
          return
        default:
          break
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'b') useUiStore.getState().setBeforeHeld(false)
    }

    // Held keys must not stick when the window loses focus mid-press.
    const onBlur = () => useUiStore.getState().setBeforeHeld(false)

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
}
