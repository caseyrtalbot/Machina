import { colors } from '../../design/tokens'

export function CanvasView() {
  return (
    <div
      className="h-full flex items-center justify-center"
      style={{ backgroundColor: colors.bg.base, color: colors.text.muted }}
    >
      <p className="text-sm">Canvas view — implementation in progress</p>
    </div>
  )
}
