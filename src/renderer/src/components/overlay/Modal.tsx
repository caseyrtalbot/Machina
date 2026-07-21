import { useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useFocusTrap, type FocusableRef } from '../../hooks/useFocusTrap'
import { Overlay, type OverlayProps } from './Overlay'

export interface ModalProps extends Omit<OverlayProps, 'children' | 'variant'> {
  readonly variant?: 'center' | 'top'
  readonly panelClassName?: string
  readonly panelStyle?: CSSProperties
  readonly ariaLabel?: string
  readonly ariaLabelledBy?: string
  readonly ariaBusy?: boolean
  readonly trapFocus?: boolean
  /** Defaults to trapFocus. */
  readonly restoreFocus?: boolean
  readonly initialFocusRef?: FocusableRef
  /** Entrance animation (te-popover-enter). Defaults off for keepMounted. */
  readonly animate?: boolean
  readonly children: ReactNode
}

/**
 * Centered (or top-positioned) dialog panel on the Overlay base: role=dialog
 * semantics, focus trap + restore, and the standard entrance animation.
 * Panel visuals come from panelClassName/panelStyle — the Modal owns chrome,
 * not looks.
 */
export function Modal({
  panelClassName,
  panelStyle,
  ariaLabel,
  ariaLabelledBy,
  ariaBusy,
  trapFocus = true,
  restoreFocus = trapFocus,
  initialFocusRef,
  animate,
  children,
  ...overlayProps
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const { onKeyDown } = useFocusTrap(panelRef, {
    active: trapFocus && overlayProps.open,
    initialFocusRef,
    restoreFocus
  })
  const shouldAnimate = animate ?? !overlayProps.keepMounted
  const panelClass =
    [shouldAnimate ? 'te-popover-enter' : null, panelClassName].filter(Boolean).join(' ') ||
    undefined

  return (
    <Overlay {...overlayProps}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-busy={ariaBusy}
        className={panelClass}
        style={panelStyle}
        onKeyDown={trapFocus ? onKeyDown : undefined}
      >
        {children}
      </div>
    </Overlay>
  )
}
