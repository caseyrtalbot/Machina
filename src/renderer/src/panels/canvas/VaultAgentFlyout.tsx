import { useMemo } from 'react'
import { useSidebarSelectionStore } from '../../store/sidebar-selection-store'
import { useVaultStore } from '../../store/vault-store'
import { useEditorStore } from '../../store/editor-store'
import { useViewStore } from '../../store/view-store'
import { colors } from '../../design/tokens'

const CURATOR_MODES = [
  {
    id: 'critique',
    label: 'Critique',
    desc: 'Examine assumptions and contradictions.',
    detail: 'Adds ## Critique sections to vault files.'
  },
  {
    id: 'emerge',
    label: 'Emerge',
    desc: 'Surface hidden connections.',
    detail: 'Adds ## Connections sections with wikilinks.'
  },
  {
    id: 'research',
    label: 'Research',
    desc: 'Address gaps from the audit.',
    detail: 'Adds ## Research sections with citations.'
  },
  {
    id: 'learn',
    label: 'Learn',
    desc: 'Extract learning points.',
    detail: 'Adds ## Key Learnings sections.'
  }
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
        top: 0,
        left: '100%',
        marginLeft: 8,
        width: 240,
        zIndex: 100,
        padding: 0
      }}
    >
      {/* Scope section */}
      <div style={{ padding: '10px 12px 8px' }}>
        <div style={sectionLabelStyle}>Scope</div>
        {selectedFileNames.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
            {selectedFileNames.slice(0, 5).map((name) => (
              <div key={name} style={fileNameStyle}>
                {name}
              </div>
            ))}
            {selectedFileNames.length > 5 && (
              <div style={{ ...fileNameStyle, color: colors.text.muted }}>
                +{selectedFileNames.length - 5} more
              </div>
            )}
            <div style={{ fontSize: 10, color: colors.text.muted, marginTop: 2 }}>
              {selectedFileNames.length} file{selectedFileNames.length !== 1 ? 's' : ''} selected
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: colors.text.muted, marginTop: 4 }}>
            Entire vault ({rawFileCount})
          </div>
        )}
      </div>

      <div style={dividerStyle} />

      {/* Librarian section */}
      <div style={{ padding: '8px 12px' }}>
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
            marginTop: 6
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
          <div style={{ fontSize: 10, color: colors.text.muted, marginTop: 4 }}>
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
              marginTop: 4
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

      {/* Curator section */}
      <div style={{ padding: '8px 12px 10px' }}>
        <div style={sectionLabelStyle}>Curator</div>
        {librarianActive ? (
          <div style={{ fontSize: 11, color: colors.text.muted, marginTop: 6 }}>
            Librarian running...
          </div>
        ) : !hasLibrarianReports ? (
          <div style={{ fontSize: 11, color: colors.text.muted, marginTop: 6 }}>
            Run Librarian first to generate findings
          </div>
        ) : curatorActive ? (
          <button
            type="button"
            onClick={() => {
              onCurator('')
              onClose()
            }}
            style={{ ...actionButtonStyle, color: '#f87171', marginTop: 6 }}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
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
                <div style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>{mode.label}</div>
                <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', lineHeight: 1.3 }}>
                  {mode.desc}
                  <span style={{ color: colors.text.muted }}> {mode.detail}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10,
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

const fileNameStyle: React.CSSProperties = {
  fontSize: 11,
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
  padding: '4px 8px',
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  transition: 'background 150ms ease-out'
}

const modeButtonStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  width: '100%',
  textAlign: 'left',
  padding: '5px 8px',
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  transition: 'background 150ms ease-out'
}
