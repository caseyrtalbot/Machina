import { colors, floatingPanel } from '../../design/tokens'

interface CanvasFloatingSidebarProps {
  readonly children: React.ReactNode
}

/**
 * Floating sidebar container for canvas-style views.
 * Positioned absolutely over the canvas surface, outside the pan/zoom transform.
 * Sits to the right of the floating ActivityBar with gaps on all sides
 * so the canvas grid is visible around it.
 */
export function CanvasFloatingSidebar({ children }: CanvasFloatingSidebarProps) {
  return (
    <div
      className="absolute flex flex-col overflow-hidden"
      style={{
        top: 40,
        left: 64,
        width: 260,
        maxHeight: 'calc(100vh - 52px)',
        zIndex: 40,
        borderRadius: floatingPanel.borderRadius,
        boxShadow: floatingPanel.shadow,
        backdropFilter: floatingPanel.blur.sidebar,
        backgroundColor: 'rgba(20, 20, 20, 0.92)',
        color: colors.text.primary
      }}
    >
      <div className="h-full overflow-y-auto pt-7">{children}</div>
    </div>
  )
}
