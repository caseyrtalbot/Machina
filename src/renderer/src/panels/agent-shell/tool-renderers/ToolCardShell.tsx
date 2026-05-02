import type { CSSProperties, MouseEventHandler, ReactNode } from 'react'
import { borderRadius, colors } from '../../../design/tokens'

export type ToolCardVariant = 'pill' | 'block' | 'error'

interface Props {
  readonly variant: ToolCardVariant
  readonly children: ReactNode
  readonly inline?: boolean
  readonly onContextMenu?: MouseEventHandler<HTMLDivElement>
  readonly style?: CSSProperties
}

const PILL_PADDING = '4px 10px'
const BLOCK_PADDING = '10px 12px'
const ERROR_BG = `color-mix(in srgb, ${colors.claude.error} 8%, transparent)`
const ERROR_BORDER = `color-mix(in srgb, ${colors.claude.error} 35%, transparent)`

export function ToolCardShell({ variant, children, inline, onContextMenu, style }: Props) {
  const isError = variant === 'error'
  const isPill = variant === 'pill'
  const padding = isPill ? PILL_PADDING : BLOCK_PADDING
  const display = isPill && inline ? 'inline-flex' : 'block'
  const alignItems = isPill && inline ? 'center' : undefined

  return (
    <div
      onContextMenu={onContextMenu}
      style={{
        display,
        alignItems,
        marginTop: 10,
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
