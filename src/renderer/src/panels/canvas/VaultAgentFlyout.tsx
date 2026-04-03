import { useMemo } from 'react'
import { useSidebarSelectionStore } from '../../store/sidebar-selection-store'
import { useVaultStore } from '../../store/vault-store'
import { useEditorStore } from '../../store/editor-store'
import { useViewStore } from '../../store/view-store'
import { colors } from '../../design/tokens'

const CURATOR_MODES = [
  { id: 'critique', label: 'Critique', desc: 'Examine assumptions' },
  { id: 'emerge', label: 'Emerge', desc: 'Surface connections' },
  { id: 'research', label: 'Research', desc: 'Address gaps' },
  { id: 'learn', label: 'Learn', desc: 'Extract learnings' }
] as const

interface VaultAgentFlyoutProps {
  readonly librarianActive: boolean
  readonly curatorActive: boolean
  readonly onLibrarian: () => void
  readonly onCurator: (mode: string) => void
  readonly onClose: () => void
  readonly lastResultPath: string | null
}

export function VaultAgentFlyout({
  librarianActive,
  curatorActive,
  onLibrarian,
  onCurator,
  onClose,
  lastResultPath
}: VaultAgentFlyoutProps): React.ReactElement {
  const selectedPaths = useSidebarSelectionStore((s) => s.selectedPaths)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const artifacts = useVaultStore((s) => s.artifacts)
  const rawFileCount = useVaultStore((s) => s.rawFileCount)

  const selectedFileNames = useMemo(() => {
    if (selectedPaths.size === 0 || !vaultPath) return []
    return [...selectedPaths].map((p) => {
      const rel = p.startsWith(vaultPath) ? p.slice(vaultPath.length + 1) : p
      return rel.split('/').pop() ?? rel
    })
  }, [selectedPaths, vaultPath])

  const hasLibrarianReports = useMemo(
    () => artifacts.some((a) => a.type === 'librarian'),
    [artifacts]
  )

  const lastAuditDate = useMemo(() => {
    const reports = artifacts
      .filter((a) => a.type === 'librarian')
      .sort((a, b) => (b.modified ?? b.created ?? '').localeCompare(a.modified ?? a.created ?? ''))
    return reports[0]?.created ?? null
  }, [artifacts])

  const handleViewResult = () => {
    if (!lastResultPath || !vaultPath) return
    const absPath = lastResultPath.startsWith('/')
      ? lastResultPath
      : `${vaultPath}/${lastResultPath}`
    useEditorStore.getState().setActiveNote(absPath)
    useViewStore.getState().setContentView('editor')
    onClose()
  }

  return (
    <div
      className="sidebar-popover absolute flex flex-col"
      style={{
        bottom: 0,
        left: '100%',
        marginLeft: 8,
        width: 180,
        zIndex: 100,
        padding: 0
      }}
    >
      {/* Scope */}
      <div style={{ padding: '8px 10px 6px' }}>
        <div style={sectionLabelStyle}>Scope</div>
        {selectedFileNames.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 3 }}>
            {selectedFileNames.slice(0, 3).map((name) => (
              <div key={name} style={fileNameStyle}>
                {name}
              </div>
            ))}
            {selectedFileNames.length > 3 && (
              <div style={{ fontSize: 10, color: colors.text.muted }}>
                +{selectedFileNames.length - 3} more
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: colors.text.muted, marginTop: 3 }}>
            Entire vault ({rawFileCount})
          </div>
        )}
      </div>

      <div style={dividerStyle} />

      {/* Librarian */}
      <div style={{ padding: '6px 10px' }}>
        <div style={sectionLabelStyle}>Librarian</div>
        <button
          type="button"
          onClick={() => {
            onLibrarian()
            if (!librarianActive) onClose()
          }}
          style={{
            ...actionButtonStyle,
            color: librarianActive ? '#f87171' : 'var(--color-text-primary)',
            marginTop: 4
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          {librarianActive ? 'Stop Audit' : 'Run Audit'}
        </button>
        {lastAuditDate && !librarianActive && (
          <div style={{ fontSize: 9, color: colors.text.muted, marginTop: 2, paddingLeft: 8 }}>
            Last: {lastAuditDate}
          </div>
        )}
        {lastResultPath && !librarianActive && (
          <button
            type="button"
            onClick={handleViewResult}
            style={{
              ...actionButtonStyle,
              color: 'var(--color-accent-default)',
              fontSize: 11,
              marginTop: 2
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            View Report
          </button>
        )}
      </div>

      <div style={dividerStyle} />

      {/* Curator */}
      <div style={{ padding: '6px 10px 8px' }}>
        <div style={sectionLabelStyle}>Curator</div>
        {librarianActive ? (
          <div style={{ fontSize: 11, color: colors.text.muted, marginTop: 4 }}>
            Librarian running...
          </div>
        ) : !hasLibrarianReports ? (
          <div style={{ fontSize: 10, color: colors.text.muted, marginTop: 4 }}>
            Run Librarian first
          </div>
        ) : curatorActive ? (
          <button
            type="button"
            onClick={() => {
              onCurator('')
              onClose()
            }}
            style={{ ...actionButtonStyle, color: '#f87171', marginTop: 4 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            Stop Curator
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 4 }}>
            {CURATOR_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => {
                  onCurator(mode.id)
                  onClose()
                }}
                style={modeButtonStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>
                  {mode.label}
                </span>
                <span style={{ fontSize: 10, color: colors.text.muted, marginLeft: 6 }}>
                  {mode.desc}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)'
}

const dividerStyle: React.CSSProperties = {
  height: 1,
  margin: '0 10px',
  background: 'rgba(255, 255, 255, 0.08)'
}

const fileNameStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  color: 'var(--color-text-secondary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const actionButtonStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  fontSize: 12,
  fontWeight: 500,
  padding: '3px 8px',
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  transition: 'background 150ms ease-out'
}

const modeButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  width: '100%',
  textAlign: 'left',
  padding: '3px 8px',
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  transition: 'background 150ms ease-out'
}
