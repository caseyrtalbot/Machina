import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { FolderTree } from 'lucide-react'
import { borderRadius, colors, floatingPanel, transitions, typography } from '../../design/tokens'
import { FilesDockAdapter } from './dock-adapters/FilesDockAdapter'
import {
  clampFilesPanelWidth,
  persistFilesPanelWidth,
  readPersistedFilesPanelWidth
} from './files-side-panel-storage'

const TRIGGER_BUTTON_SIZE = 26
const RESIZE_HANDLE_WIDTH = 6

export interface HeaderFilesToggleButtonProps {
  readonly open: boolean
  readonly onToggle: () => void
}

export function HeaderFilesToggleButton({ open, onToggle }: HeaderFilesToggleButtonProps) {
  const [hovered, setHovered] = useState(false)

  const triggerStyle: CSSProperties = {
    width: TRIGGER_BUTTON_SIZE,
    height: TRIGGER_BUTTON_SIZE,
    padding: 0,
    boxSizing: 'border-box',
    borderRadius: borderRadius.inline,
    border: `1px solid ${
      open ? colors.accent.line : hovered ? colors.border.default : 'transparent'
    }`,
    background: open
      ? 'color-mix(in srgb, var(--color-accent-default) 10%, transparent)'
      : hovered
        ? 'rgba(255, 255, 255, 0.05)'
        : 'transparent',
    color: open ? colors.accent.default : hovered ? colors.text.primary : colors.text.secondary,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: `background ${transitions.focusRing}, color ${transitions.focusRing}, border-color ${transitions.focusRing}`,
    // @ts-expect-error -- Electron-only CSS property
    WebkitAppRegion: 'no-drag'
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={open ? 'Collapse files' : 'Expand files'}
      title={open ? 'Collapse files' : 'Files'}
      aria-expanded={open}
      aria-controls="header-files-side-panel"
      style={triggerStyle}
    >
      <FolderTree size={15} strokeWidth={1.75} aria-hidden />
    </button>
  )
}

export interface HeaderFilesSidePanelProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly onChangeVault?: () => void
  readonly onOpenSettings?: () => void
}

/**
 * Right-edge slide-out Files panel. Persistent (no outside-click dismiss); the
 * header toggle or Esc closes it. Slides via translateX so the open/close
 * motion stays smooth even when the FilesDockAdapter tree is large. Width is
 * user-resizable via the left-edge drag handle, matching the sidebar/dock
 * resize behavior.
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

  const panelStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width,
    background: floatingPanel.glass.popoverBg,
    backdropFilter: floatingPanel.glass.popoverBlur,
    WebkitBackdropFilter: floatingPanel.glass.popoverBlur,
    borderLeft: `1px solid ${colors.border.default}`,
    boxShadow: open ? floatingPanel.shadowCompact : 'none',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: typography.fontFamily.body,
    color: colors.text.primary,
    transform: open ? 'translateX(0)' : `translateX(${width}px)`,
    opacity: open ? 1 : 0,
    pointerEvents: open ? 'auto' : 'none',
    // Suppress the slide transition while actively dragging so width changes
    // are 1:1 with the cursor instead of trailing through a 180ms ease.
    transition: resizing
      ? `opacity ${transitions.surface}, box-shadow ${transitions.surface}`
      : `transform ${transitions.surface}, opacity ${transitions.surface}, box-shadow ${transitions.surface}, width ${transitions.surface}`,
    zIndex: 60,
    willChange: 'transform, width'
  }

  return (
    <div
      id="header-files-side-panel"
      ref={panelRef}
      role="complementary"
      aria-label="Files"
      aria-hidden={!open}
      data-testid="header-files-side-panel"
      data-open={open ? 'true' : 'false'}
      style={panelStyle}
    >
      <LeftEdgeResizeHandle
        width={width}
        onChange={(next) => setWidth(clampFilesPanelWidth(next))}
        onResizingChange={setResizing}
        onCommit={(next) => persistFilesPanelWidth(clampFilesPanelWidth(next))}
      />
      {hasOpened && (
        <FilesDockAdapter onChangeVault={onChangeVault} onOpenSettings={onOpenSettings} />
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
  const [hovered, setHovered] = useState(false)

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

  const showAccent = active || hovered
  return (
    <div
      data-testid="resize-handle-files-panel"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={handlePointerDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: -RESIZE_HANDLE_WIDTH / 2,
        width: RESIZE_HANDLE_WIDTH,
        cursor: 'col-resize',
        background: 'transparent',
        zIndex: 2
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0.5,
          background: showAccent ? colors.accent.muted : 'transparent',
          transition: `background ${transitions.fast}`
        }}
      />
    </div>
  )
}
