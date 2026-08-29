import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { Filmstrip } from '@/components/filmstrip/Filmstrip'
import { Inspector } from '@/components/inspector/Inspector'
import { Viewer } from '@/components/viewer/Viewer'
import { persistPanelSizes, readUiPrefs } from '@/storage/prefs'

// react-resizable-panels sizes are percentages when given as strings; read the
// persisted values once so a drag never re-renders the whole workspace.
const initial = readUiPrefs()

export function Workspace() {
  return (
    <ResizablePanelGroup className="min-h-0 flex-1">
      <ResizablePanel
        id="filmstrip"
        defaultSize={`${initial.filmstripPct}%`}
        minSize="9%"
        maxSize="30%"
        onResize={(size, _id, previous) => {
          if (previous) persistPanelSizes({ filmstripPct: size.asPercentage })
        }}
      >
        <Filmstrip />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="viewer" minSize="30%">
        <Viewer />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel
        id="inspector"
        defaultSize={`${initial.inspectorPct}%`}
        minSize="16%"
        maxSize="36%"
        onResize={(size, _id, previous) => {
          if (previous) persistPanelSizes({ inspectorPct: size.asPercentage })
        }}
      >
        <Inspector />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
