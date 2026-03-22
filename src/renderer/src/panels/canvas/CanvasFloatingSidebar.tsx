import { colors, floatingPanel, typography } from '../../design/tokens'

interface CanvasFloatingSidebarProps {
  readonly collapsed: boolean
  readonly onToggle: () => void
  readonly vaultName?: string
  readonly children: React.ReactNode
}

/**
 * Floating sidebar with collapse/expand.
 *
 * Expanded: full file tree panel with glass-like backdrop.
 * Collapsed: compact pill showing vault icon + toggle affordance.
 *
 * Both states share the same floating panel aesthetic and position
 * to the right of the floating ActivityBar.
 */
export function CanvasFloatingSidebar({
  collapsed,
  onToggle,
  vaultName,
  children
}: CanvasFloatingSidebarProps) {
  if (collapsed) {
    return (
      <button
        className="absolute flex items-center gap-2 cursor-pointer"
        style={{
          top: 40,
          left: 64,
          zIndex: 40,
          height: 36,
          padding: '0 12px',
          borderRadius: floatingPanel.borderRadius,
          boxShadow: floatingPanel.shadowCompact,
          backdropFilter: floatingPanel.blur.compact,
          backgroundColor: colors.bg.elevated,
          color: colors.text.secondary,
          border: 'none',
          transition: 'background-color 150ms ease-out'
        }}
        onClick={onToggle}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(50, 50, 50, 0.95)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = ''
        }}
        title="Expand sidebar (Cmd+B)"
        aria-label="Expand sidebar"
      >
        {/* Sidebar expand icon */}
        <svg
          width={14}
          height={14}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <rect x="1" y="2" width="14" height="12" rx="2" />
          <line x1="5.5" y1="2" x2="5.5" y2="14" />
        </svg>
        {vaultName && (
          <span
            style={{
              fontSize: 11,
              fontFamily: typography.fontFamily.mono,
              color: colors.text.muted,
              whiteSpace: 'nowrap'
            }}
          >
            {vaultName}
          </span>
        )}
      </button>
    )
  }

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
        backgroundColor: 'rgba(20, 20, 22, 0.82)',
        color: colors.text.primary
      }}
    >
      {/* Collapse button in header */}
      <button
        className="absolute top-2 right-2 flex items-center justify-center cursor-pointer"
        style={{
          width: 22,
          height: 22,
          zIndex: 1,
          borderRadius: 4,
          backgroundColor: 'transparent',
          color: colors.text.muted,
          border: 'none',
          transition: 'background-color 150ms ease-out'
        }}
        onClick={onToggle}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
        }}
        title="Collapse sidebar (Cmd+B)"
        aria-label="Collapse sidebar"
      >
        <svg
          width={12}
          height={12}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <rect x="1" y="2" width="14" height="12" rx="2" />
          <line x1="5.5" y1="2" x2="5.5" y2="14" />
          <polyline points="10 7 8 9.5 10 12" />
        </svg>
      </button>
      <div className="h-full overflow-y-auto pt-2">{children}</div>
    </div>
  )
}
