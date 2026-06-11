import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { borderRadius, colors, transitions } from '../../design/tokens'

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
  const [hovered, setHovered] = useState(false)

  const style: CSSProperties = {
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
        ? 'var(--bg-tint-text)'
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
