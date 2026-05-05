import type { CSSProperties, ComponentType } from 'react'
import * as Lucide from 'lucide-react'

type LucideIconComponent = ComponentType<{
  size?: number | string
  strokeWidth?: number | string
  className?: string
  style?: CSSProperties
  'aria-hidden'?: boolean
}>

const ICONS = Lucide as unknown as Record<string, LucideIconComponent>

/**
 * Renders a Lucide icon inline at the host's font size, vertically centered
 * with surrounding text. Emits `null` when the requested icon is missing
 * from the lucide-react export so a typo doesn't crash the message tree.
 */
export function LucideInline({ name }: { readonly name: string }) {
  const Icon = ICONS[name]
  if (!Icon) return null
  return (
    <Icon
      aria-hidden
      size="1em"
      strokeWidth={1.6}
      style={{
        display: 'inline-block',
        verticalAlign: '-0.16em',
        marginInlineEnd: '0.18em',
        flexShrink: 0
      }}
    />
  )
}
