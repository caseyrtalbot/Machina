import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { FolderTree } from 'lucide-react'
import { borderRadius, colors, floatingPanel, transitions } from '../../design/tokens'
import { FilesDockAdapter } from './dock-adapters/FilesDockAdapter'

const POPOVER_SIZE = 360
const HEADER_HEIGHT = 39
const TRIGGER_BUTTON_SIZE = 26

export interface HeaderFilesPopoverProps {
  readonly onChangeVault?: () => void
  readonly onOpenSettings?: () => void
}

/**
 * Floating Files surface anchored to the window header.
 *
 * Replaces the Files dock tab with a transient popover so the right-hand
 * editor / canvas / dual-use surfaces are not pinned out of view by file
 * browsing. File rows remain HTML-draggable (drag onto canvas) and a click
 * opens the file as an Editor dock tab via FilesDockAdapter.
 */
export function HeaderFilesPopover({
  onChangeVault,
  onOpenSettings
}: HeaderFilesPopoverProps = {}) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const close = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => setOpen((o) => !o), [])

  // Close on outside click + Escape. Suppress close while a drag is in
  // flight so the user can drop onto the canvas behind without dismissing.
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      if (draggingRef.current) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const onDragStart = () => {
      draggingRef.current = true
    }
    const onDragEnd = () => {
      draggingRef.current = false
    }
    const tid = setTimeout(() => {
      document.addEventListener('mousedown', onMouseDown)
      document.addEventListener('keydown', onKey)
      document.addEventListener('dragstart', onDragStart, true)
      document.addEventListener('dragend', onDragEnd, true)
      document.addEventListener('drop', onDragEnd, true)
    }, 0)
    return () => {
      clearTimeout(tid)
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('dragstart', onDragStart, true)
      document.removeEventListener('dragend', onDragEnd, true)
      document.removeEventListener('drop', onDragEnd, true)
    }
  }, [open, close])

  const triggerStyle: CSSProperties = {
    width: TRIGGER_BUTTON_SIZE,
    height: TRIGGER_BUTTON_SIZE,
    padding: 0,
    boxSizing: 'border-box',
    borderRadius: borderRadius.inline,
    border: `0.5px solid ${
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

  const popoverStyle: CSSProperties = {
    position: 'fixed',
    top: HEADER_HEIGHT + 6,
    right: 8,
    width: POPOVER_SIZE,
    height: POPOVER_SIZE,
    background: floatingPanel.glass.popoverBg,
    backdropFilter: floatingPanel.glass.popoverBlur,
    WebkitBackdropFilter: floatingPanel.glass.popoverBlur,
    border: `0.5px solid ${colors.border.default}`,
    borderRadius: floatingPanel.borderRadius,
    boxShadow: floatingPanel.shadowCompact,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 500
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label="Open files"
        title="Files"
        aria-expanded={open}
        aria-haspopup="dialog"
        style={triggerStyle}
      >
        <FolderTree size={15} strokeWidth={1.75} aria-hidden />
      </button>
      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Files"
          data-testid="header-files-popover"
          style={popoverStyle}
        >
          <FilesDockAdapter onChangeVault={onChangeVault} onOpenSettings={onOpenSettings} />
        </div>
      )}
    </>
  )
}
