import type { ActionDefinition } from '@shared/action-types'
import { colors } from '../../design/tokens'

/* ── Icon SVGs ───────────────────────────────────────────────────────── */

const SVG_DEFAULTS = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

const ACTION_ICONS: Record<string, React.ReactElement> = {
  emerge: (
    <svg {...SVG_DEFAULTS}>
      <circle cx={4} cy={4} r={1.5} />
      <circle cx={12} cy={4} r={1.5} />
      <circle cx={8} cy={13} r={1.5} />
      <path d="M4 5.5L8 11.5" strokeDasharray="2 2" />
      <path d="M12 5.5L8 11.5" strokeDasharray="2 2" />
    </svg>
  ),
  challenge: (
    <svg {...SVG_DEFAULTS}>
      <line x1={8} y1={2} x2={8} y2={14} />
      <path d="M5 5l3-3 3 3" />
      <path d="M5 11l3 3 3-3" />
      <line x1={3} y1={8} x2={13} y2={8} strokeDasharray="2 2" />
    </svg>
  ),
  librarian: (
    <svg {...SVG_DEFAULTS}>
      <path d="M8 3C6.5 2 4.5 1.5 2 2v10c2.5-.5 4.5 0 6 1" />
      <path d="M8 3c1.5-1 3.5-1.5 6-1v10c-2.5-.5-4.5 0-6 1" />
      <line x1={8} y1={3} x2={8} y2={13} />
    </svg>
  ),
  curator: (
    <svg {...SVG_DEFAULTS}>
      <rect x={4} y={1} width={8} height={4} rx={1} />
      <line x1={8} y1={5} x2={8} y2={9} />
      <rect x={2} y={9} width={12} height={5} rx={1} />
    </svg>
  ),
  steelman: (
    <svg {...SVG_DEFAULTS}>
      <path d="M3 13V3h7l3 3v7z" />
      <path d="M10 3v3h3" />
      <path d="M6 8h4" />
      <path d="M6 10.5h4" />
    </svg>
  ),
  'red-team': (
    <svg {...SVG_DEFAULTS}>
      <circle cx={8} cy={8} r={6} />
      <path d="M8 5v3.5l2.5 1.5" />
      <path d="M12 4l1.5-1.5" />
      <path d="M4 4L2.5 2.5" />
    </svg>
  )
}

const DEFAULT_ICON = (
  <svg {...SVG_DEFAULTS}>
    <rect x={2} y={2} width={12} height={12} rx={2} />
    <path d="M6 6l4 4" />
    <path d="M10 6l-4 4" />
  </svg>
)

function getIcon(actionId: string): React.ReactElement {
  return ACTION_ICONS[actionId] ?? DEFAULT_ICON
}

/* ── Props ───────────────────────────────────────────────────────────── */

interface ActionMenuProps {
  readonly actions: readonly ActionDefinition[]
  readonly selectedCount: number
  readonly scopeLabel: string
  readonly onSelect: (actionId: string) => void
  readonly onClose: () => void
}

/* ── Component ───────────────────────────────────────────────────────── */

export function ActionMenu({
  actions,
  selectedCount,
  scopeLabel,
  onSelect,
  onClose
}: ActionMenuProps): React.ReactElement {
  return (
    <div
      className="sidebar-popover"
      style={{
        position: 'absolute',
        bottom: 0,
        left: '100%',
        marginLeft: 8,
        display: 'flex',
        flexDirection: 'column',
        width: 240,
        padding: 0,
        zIndex: 100
      }}
    >
      {/* Scope indicator */}
      <div style={{ padding: '8px 12px 6px' }}>
        <div style={sectionLabelStyle}>Scope</div>
        <div style={{ fontSize: 11, color: colors.text.muted, marginTop: 3 }}>{scopeLabel}</div>
      </div>

      <div style={dividerStyle} />

      {/* Action list */}
      <div style={{ padding: '4px 0' }}>
        {actions.map((action) => {
          const disabled = action.scope === 'files' && selectedCount === 0

          return (
            <button
              key={action.id}
              type="button"
              onClick={() => {
                if (disabled) return
                onSelect(action.id)
                onClose()
              }}
              style={{
                ...actionItemStyle,
                opacity: disabled ? 0.35 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer'
              }}
              onMouseEnter={(e) => {
                if (!disabled) {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <span style={iconWrapperStyle}>{getIcon(action.id)}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>
                  {action.name}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: colors.text.muted,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {action.description}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div style={dividerStyle} />

      {/* Footer */}
      <div style={{ padding: '6px 12px 8px', display: 'flex', gap: 12 }}>
        <span style={footerLinkStyle}>Create action...</span>
        <span style={footerLinkStyle}>Edit actions</span>
      </div>
    </div>
  )
}

/* ── Styles ──────────────────────────────────────────────────────────── */

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)'
}

const dividerStyle: React.CSSProperties = {
  height: 1,
  margin: '0 12px',
  background: 'rgba(255, 255, 255, 0.08)'
}

const actionItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  textAlign: 'left',
  padding: '5px 12px',
  border: 'none',
  background: 'transparent',
  transition: 'background 150ms ease-out'
}

const iconWrapperStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: 20,
  height: 20,
  color: colors.text.muted
}

const footerLinkStyle: React.CSSProperties = {
  fontSize: 10,
  color: colors.text.muted,
  opacity: 0.6,
  cursor: 'pointer'
}
