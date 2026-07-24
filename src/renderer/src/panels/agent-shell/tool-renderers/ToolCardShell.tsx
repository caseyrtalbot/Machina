import { useEffect, useState } from 'react'
import type { MouseEventHandler, ReactNode, Ref } from 'react'

type ToolCardVariant = 'pill' | 'block' | 'error'

interface Props {
  readonly variant: ToolCardVariant
  readonly children: ReactNode
  readonly inline?: boolean
  readonly pending?: boolean
  readonly onContextMenu?: MouseEventHandler<HTMLDivElement>
  readonly onMouseEnter?: MouseEventHandler<HTMLDivElement>
  readonly onMouseLeave?: MouseEventHandler<HTMLDivElement>
  readonly innerRef?: Ref<HTMLDivElement>
  /** Caller-specific static styling; compounds with `.te-tool-card`. */
  readonly className?: string
}

// Only show shimmer once a tool call has been pending this long. Fast calls
// must not flash a loader.
const SHIMMER_DELAY_MS = 300

export function ToolCardShell({
  variant,
  children,
  inline,
  pending,
  onContextMenu,
  onMouseEnter,
  onMouseLeave,
  innerRef,
  className
}: Props) {
  const isPill = variant === 'pill'

  // Delay-then-flag pattern. The timer callback (async, post-effect) flips
  // `elapsed` true; effect cleanup on the next pending change cancels the
  // timer and resets the flag so re-pending starts the delay over. Render
  // gates on `pending && elapsed` so flipping pending false hides the
  // shimmer immediately even if the cleanup setState hasn't flushed.
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    if (!pending) return
    const t = window.setTimeout(() => setElapsed(true), SHIMMER_DELAY_MS)
    return () => {
      window.clearTimeout(t)
      setElapsed(false)
    }
  }, [pending])

  const classes = ['te-tool-card', className, pending && elapsed && 'te-tool-card-pending']
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={innerRef}
      className={classes}
      data-variant={variant}
      data-inline={isPill && inline ? '' : undefined}
      data-pending={pending ? '' : undefined}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  )
}
