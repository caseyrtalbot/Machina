import { useEffect, useRef, useState } from 'react'
import { FolderTree } from 'lucide-react'
import { FilesDockAdapter } from './dock-adapters/FilesDockAdapter'
import { TitlebarPanelToggle } from './TitlebarPanelToggle'
import {
  clampFilesPanelWidth,
  persistFilesPanelWidth,
  readPersistedFilesPanelWidth
} from './files-side-panel-storage'

interface HeaderFilesToggleButtonProps {
  readonly open: boolean
  readonly onToggle: () => void
}

export function HeaderFilesToggleButton({ open, onToggle }: HeaderFilesToggleButtonProps) {
  return (
    <TitlebarPanelToggle
      open={open}
      onToggle={onToggle}
      expandLabel="Expand files"
      collapseLabel="Collapse files"
      title="Files"
      controlsId="header-files-side-panel"
    >
      <FolderTree size={15} strokeWidth={1.75} aria-hidden />
    </TitlebarPanelToggle>
  )
}

interface HeaderFilesSidePanelProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly onChangeVault?: () => void
  readonly onOpenSettings?: () => void
}

/**
 * Right-edge Files panel. A real flex column in the shell row — opening it
 * reflows the dock instead of occluding it. Persistent (no outside-click
 * dismiss); the header toggle or Esc closes it. Width is user-resizable via
 * the left-edge drag handle, matching the sidebar/chat resize behavior.
 */
export function HeaderFilesSidePanel({
  open,
  onClose,
  onChangeVault,
  onOpenSettings
}: HeaderFilesSidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [hasOpened, setHasOpened] = useState(open)
  if (open && !hasOpened) setHasOpened(true)

  const [width, setWidth] = useState<number>(() => readPersistedFilesPanelWidth())
  const [resizing, setResizing] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    // Open state (min-width 280 shrinkable, left border, width transition) keys
    // off data-open in CSS; data-resizing suppresses the transition mid-drag so
    // width tracks the cursor 1:1. The resting width itself is measured state.
    <div
      id="header-files-side-panel"
      ref={panelRef}
      role="complementary"
      aria-label="Files"
      aria-hidden={!open}
      data-testid="header-files-side-panel"
      data-open={open ? 'true' : 'false'}
      data-resizing={resizing ? 'true' : undefined}
      className="te-shell-files-panel"
      style={{ width: open ? width : 0 }}
    >
      {open && (
        <LeftEdgeResizeHandle
          width={width}
          onChange={(next) => setWidth(clampFilesPanelWidth(next))}
          onResizingChange={setResizing}
          onCommit={(next) => persistFilesPanelWidth(clampFilesPanelWidth(next))}
        />
      )}
      {hasOpened && (
        // Inner wrapper pinned to the resting width so content doesn't
        // reflow mid-animation while the outer column collapses to 0.
        <div className="te-shell-files-inner" style={{ width }}>
          <FilesDockAdapter onChangeVault={onChangeVault} onOpenSettings={onOpenSettings} />
        </div>
      )}
    </div>
  )
}

interface LeftEdgeResizeHandleProps {
  readonly width: number
  readonly onChange: (next: number) => void
  readonly onResizingChange: (resizing: boolean) => void
  readonly onCommit: (next: number) => void
}

/**
 * Vertical drag handle pinned to the panel's left edge. Dragging left grows
 * the panel (panel is anchored to the right of the viewport, so a leftward
 * cursor delta means a larger width). Mirrors the visual treatment of the
 * sidebar/dock ResizeHandle: 1px hairline that lights up on hover/active.
 */
function LeftEdgeResizeHandle({
  width,
  onChange,
  onResizingChange,
  onCommit
}: LeftEdgeResizeHandleProps) {
  const [active, setActive] = useState(false)

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    let lastWidth = startWidth
    setActive(true)
    onResizingChange(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMove(ev: PointerEvent) {
      // Panel is right-anchored: dragging the cursor leftward (negative dx)
      // grows the panel. Direction = -1 matches the dock handle.
      const next = startWidth - (ev.clientX - startX)
      lastWidth = next
      onChange(next)
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setActive(false)
      onResizingChange(false)
      onCommit(lastWidth)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      data-testid="resize-handle-files-panel"
      className="resize-handle resize-handle--ghost"
      data-active={active ? 'true' : undefined}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={handlePointerDown}
    >
      <div className="resize-handle__line" aria-hidden />
    </div>
  )
}
