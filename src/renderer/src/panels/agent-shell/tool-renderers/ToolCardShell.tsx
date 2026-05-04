import { useEffect, useState } from 'react'
import type { CSSProperties, MouseEventHandler, ReactNode, Ref } from 'react'
import { borderRadius, colors } from '../../../design/tokens'

export type ToolCardVariant = 'pill' | 'block' | 'error'

interface Props {
  readonly variant: ToolCardVariant
  readonly children: ReactNode
  readonly inline?: boolean
  readonly pending?: boolean
  readonly onContextMenu?: MouseEventHandler<HTMLDivElement>
  readonly onMouseEnter?: MouseEventHandler<HTMLDivElement>
  readonly onMouseLeave?: MouseEventHandler<HTMLDivElement>
  readonly innerRef?: Ref<HTMLDivElement>
  readonly style?: CSSProperties
}

const PILL_PADDING = '4px 10px'
const BLOCK_PADDING = '8px 12px'
const ERROR_BG = `color-mix(in srgb, ${colors.claude.error} 8%, transparent)`
const ERROR_BORDER = `color-mix(in srgb, ${colors.claude.error} 35%, transparent)`
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
  style
}: Props) {
  const isError = variant === 'error'
  const isPill = variant === 'pill'
  const padding = isPill ? PILL_PADDING : BLOCK_PADDING
  const display = isPill && inline ? 'inline-flex' : 'block'
  const alignItems = isPill && inline ? 'center' : undefined

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

  const className = pending && elapsed ? 'te-tool-card-pending' : undefined

  return (
    <div
      ref={innerRef}
      className={className}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        display,
        alignItems,
        marginTop: 8,
        padding,
        borderRadius: borderRadius.tool,
        background: isError ? ERROR_BG : colors.bg.elevated,
        border: `1px solid ${isError ? ERROR_BORDER : colors.border.subtle}`,
        fontSize: 12,
        color: colors.text.primary,
        ...style
      }}
    >
      {children}
    </div>
  )
}
