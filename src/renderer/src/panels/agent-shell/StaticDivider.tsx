import { colors } from '../../design/tokens'

export function StaticDivider() {
  return (
    <div
      aria-hidden
      style={{
        flexShrink: 0,
        width: 3,
        position: 'relative',
        background: 'transparent'
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 1,
          width: 0.5,
          background: colors.border.subtle
        }}
      />
    </div>
  )
}
