import { useCallback, useEffect } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

// Structural ref type: covariant in the element, so a RefObject<HTMLButtonElement | null>
// (mutable under React 19 typings) still satisfies it.
export interface FocusableRef {
  readonly current: HTMLElement | null
}

// Union of the selectors previously duplicated in HarnessGallery and
// HarnessTaskBriefDialog — one list so every trapped dialog agrees on what
// counts as focusable.
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

interface FocusTrapOptions {
  /** Trap is live. For keepMounted overlays pass the open flag here. */
  readonly active?: boolean
  /** Focused when the trap activates. Absent: leave focus alone (autoFocus works). */
  readonly initialFocusRef?: FocusableRef
  /** Restore focus to the previously focused element on deactivate. */
  readonly restoreFocus?: boolean
}

interface FocusTrap {
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
}

/**
 * Tab-cycle focus trap for dialog surfaces. Attach the returned onKeyDown to
 * the dialog container; initial focus and focus restore run as an effect
 * keyed on `active`.
 */
export function useFocusTrap(
  containerRef: FocusableRef,
  { active = true, initialFocusRef, restoreFocus = true }: FocusTrapOptions = {}
): FocusTrap {
  useEffect(() => {
    if (!active) return
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    initialFocusRef?.current?.focus()
    return () => {
      if (restoreFocus) previouslyFocused?.focus()
    }
  }, [active, initialFocusRef, restoreFocus])

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>): void => {
      if (event.key !== 'Tab') return
      const focusable = Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [containerRef]
  )

  return { onKeyDown }
}
