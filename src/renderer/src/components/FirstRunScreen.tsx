import { useEffect, useState } from 'react'
import { colors, floatingPanel, typography } from '../design/tokens'
import { logError } from '../utils/error-logger'

export type SavedVaultCheck =
  | { readonly kind: 'load'; readonly path: string }
  | { readonly kind: 'first-run'; readonly missingPath: string | null }

/**
 * Resolve what to do with the persisted lastWorkspacePath at boot (main
 * falls back to the legacy vault-path key while the new key is absent).
 *
 * A workspace that no longer exists on disk is NOT recreated: the stale
 * config entry is cleared (a stored null must not resurrect the legacy key)
 * and first-run shows a "not found" notice instead of mkdir-ing a ghost
 * workspace via workspace:open.
 */
// eslint-disable-next-line react-refresh/only-export-components
export async function checkSavedVault(): Promise<SavedVaultCheck> {
  const saved = await window.api.config.read('app', 'lastWorkspacePath')
  if (typeof saved !== 'string' || !saved) {
    return { kind: 'first-run', missingPath: null }
  }
  const exists = await window.api.app.pathExists(saved)
  if (exists) return { kind: 'load', path: saved }
  await window.api.config.write('app', 'lastWorkspacePath', null)
  return { kind: 'first-run', missingPath: saved }
}

interface FirstRunScreenProps {
  /** Optional warning shown above the CTA (missing vault, load failure). */
  readonly notice?: string | null
  readonly onOpenFolder: () => void
  readonly onOpenPath: (path: string) => void
}

/**
 * Full-screen state shown when no vault is open. Replaces the three-pane
 * shell so first run never lands in a silently empty workspace.
 */
export function FirstRunScreen({ notice, onOpenFolder, onOpenPath }: FirstRunScreenProps) {
  const [history, setHistory] = useState<readonly string[]>([])

  useEffect(() => {
    window.api.config
      .read('app', 'workspaceHistory')
      .then((h) => {
        if (Array.isArray(h)) {
          setHistory(h.filter((p): p is string => typeof p === 'string'))
        }
      })
      .catch((err) => logError('vault-history', err))
  }, [])

  return (
    <div
      className="h-screen w-screen flex items-center justify-center"
      style={{ backgroundColor: colors.bg.base, color: colors.text.primary }}
    >
      <div
        style={{
          width: 420,
          maxWidth: '90vw',
          background: floatingPanel.glass.bg,
          backdropFilter: floatingPanel.glass.blur,
          border: `1px solid ${colors.border.subtle}`,
          boxShadow: floatingPanel.shadow,
          padding: '32px 36px'
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 500,
            letterSpacing: '0.02em'
          }}
        >
          Machina
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: colors.text.secondary }}>
          Open a folder to use as your vault. Notes, canvas, and threads live there as plain files.
        </p>
        {notice && (
          <p
            role="status"
            style={{
              margin: '14px 0 0',
              padding: '8px 10px',
              fontSize: 12,
              color: colors.text.primary,
              background: 'color-mix(in srgb, var(--color-accent-default) 12%, transparent)',
              borderLeft: '2px solid var(--color-accent-default)'
            }}
          >
            {notice}
          </p>
        )}
        <button
          type="button"
          onClick={onOpenFolder}
          style={{
            marginTop: 20,
            width: '100%',
            padding: '10px 0',
            background: colors.accent.default,
            color: colors.bg.base,
            border: 'none',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer'
          }}
        >
          Open Folder
        </button>
        {history.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div
              style={{
                fontSize: floatingPanel.glass.sectionLabel.fontSize,
                fontWeight: floatingPanel.glass.sectionLabel.fontWeight,
                textTransform: floatingPanel.glass.sectionLabel.textTransform,
                letterSpacing: floatingPanel.glass.sectionLabel.letterSpacing,
                color: colors.text.muted,
                marginBottom: 8
              }}
            >
              Recent vaults
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {history.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    onClick={() => onOpenPath(path)}
                    title={path}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 8px',
                      background: 'transparent',
                      border: 'none',
                      color: colors.text.secondary,
                      fontFamily: typography.fontFamily.mono,
                      fontSize: 12,
                      cursor: 'pointer',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {path}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
