import type { CSSProperties, ReactNode } from 'react'
import { borderRadius } from '../../design/tokens'

const TRIGGER_BUTTON_SIZE = 26

interface TitlebarPanelToggleProps {
  readonly open: boolean
  readonly onToggle: () => void
  /** Accessible label when the panel is closed, e.g. "Expand files". */
  readonly expandLabel: string
  /** Accessible label when the panel is open, e.g. "Collapse files". */
  readonly collapseLabel: string
  /** Hover tooltip when closed (defaults to expandLabel). */
  readonly title?: string
  readonly controlsId?: string
  readonly children: ReactNode
}

/**
 * 26px icon toggle for the titlebar panel cluster (thread sidebar, chat,
 * files). Accent-tinted while its panel is open.
 */
export function TitlebarPanelToggle({
  open,
  onToggle,
  expandLabel,
  collapseLabel,
  title,
  controlsId,
  children
}: TitlebarPanelToggleProps) {
  const style: CSSProperties = {
    width: TRIGGER_BUTTON_SIZE,
    height: TRIGGER_BUTTON_SIZE,
    padding: 0,
    boxSizing: 'border-box',
    borderRadius: borderRadius.inline,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer'
  }

  return (
    <button
      type="button"
      className="titlebar-toggle"
      data-open={open ? 'true' : undefined}
      onClick={onToggle}
      aria-label={open ? collapseLabel : expandLabel}
      title={open ? collapseLabel : (title ?? expandLabel)}
      aria-expanded={open}
      aria-controls={controlsId}
      style={style}
    >
      {children}
    </button>
  )
}
