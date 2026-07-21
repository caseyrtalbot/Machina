import { useEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { colors, zIndex } from '../../design/tokens'

export type OverlayVariant = 'center' | 'top' | 'popover'

export interface OverlayProps {
  readonly open: boolean
  readonly onClose: () => void
  /** Gates Escape and click-outside. Consumers block dismiss mid-submit. */
  readonly canDismiss?: boolean
  readonly variant?: OverlayVariant
  /** Vertical offset for the `top` variant (e.g. '12vh' or 80). */
  readonly topOffset?: string | number
  /** `parent` positions absolute inside the nearest positioned ancestor. */
  readonly containment?: 'viewport' | 'parent'
  /** Defaults on for center/top, off for popover. */
  readonly scrim?: boolean
  /** Backdrop-filter applied to the scrim, e.g. 'blur(4px)'. */
  readonly scrimBlur?: string
  /**
   * Keep the backdrop mounted when closed (opacity 0 + pointer-events none)
   * so consumer state survives close. Pass a transition via `style` to fade.
   * Not supported for the popover variant.
   */
  readonly keepMounted?: boolean
  readonly zLayer?: keyof typeof zIndex
  readonly className?: string
  readonly style?: CSSProperties
  readonly children: ReactNode
}

/**
 * Chrome-only overlay base: scrim, positioning, z-index from the token
 * scale, capture-phase Escape, and click-outside dismissal. Business logic
 * and panel styling stay in consumers (or the thin Modal layered on top).
 *
 * Overlays do not stack: the Escape handler stops propagation, so open at
 * most one dismissable overlay at a time.
 */
export function Overlay({
  open,
  onClose,
  canDismiss = true,
  variant = 'center',
  topOffset = '12vh',
  containment = 'viewport',
  scrim = variant !== 'popover',
  scrimBlur,
  keepMounted = false,
  zLayer = 'modal',
  className,
  style,
  children
}: OverlayProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !canDismiss) return
    function onWindowKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onWindowKeyDown, true)
    return () => window.removeEventListener('keydown', onWindowKeyDown, true)
  }, [open, canDismiss, onClose])

  // Scrimless popovers dismiss on any mousedown outside the container.
  useEffect(() => {
    if (!open || !canDismiss || variant !== 'popover') return
    function onDocumentMouseDown(event: MouseEvent): void {
      const node = popoverRef.current
      if (node && event.target instanceof Node && !node.contains(event.target)) onClose()
    }
    document.addEventListener('mousedown', onDocumentMouseDown)
    return () => document.removeEventListener('mousedown', onDocumentMouseDown)
  }, [open, canDismiss, variant, onClose])

  if (!open && !keepMounted) return null

  if (variant === 'popover') {
    if (!open) return null
    return (
      <div ref={popoverRef} className={className} style={{ zIndex: zIndex[zLayer], ...style }}>
        {children}
      </div>
    )
  }

  const backdropStyle: CSSProperties = {
    position: containment === 'parent' ? 'absolute' : 'fixed',
    inset: 0,
    zIndex: zIndex[zLayer],
    display: 'flex',
    alignItems: variant === 'top' ? 'flex-start' : 'center',
    justifyContent: 'center',
    paddingTop: variant === 'top' ? topOffset : undefined,
    background: scrim ? colors.scrim.modal : undefined,
    backdropFilter: scrimBlur,
    WebkitBackdropFilter: scrimBlur,
    ...(keepMounted && !open ? { opacity: 0, pointerEvents: 'none' } : null),
    ...style
  }

  return (
    <div
      className={className}
      style={backdropStyle}
      onMouseDown={(event) => {
        if (canDismiss && event.target === event.currentTarget) onClose()
      }}
    >
      {children}
    </div>
  )
}
