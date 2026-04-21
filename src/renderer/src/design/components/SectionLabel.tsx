import type { CSSProperties, ReactNode } from 'react'
import { typography } from '../tokens'

interface SectionLabelProps {
  readonly children: ReactNode
  readonly className?: string
  readonly style?: CSSProperties
  readonly as?: 'span' | 'div' | 'h3'
}

const baseStyle: CSSProperties = {
  fontSize: typography.metadata.size,
  letterSpacing: typography.metadata.letterSpacing,
  textTransform: typography.metadata.textTransform,
  fontWeight: 600,
  color: 'var(--color-text-muted)'
}

export function SectionLabel({ children, className, style, as = 'span' }: SectionLabelProps) {
  const merged: CSSProperties = style ? { ...baseStyle, ...style } : baseStyle
  const Tag = as
  return (
    <Tag className={className} style={merged}>
      {children}
    </Tag>
  )
}
