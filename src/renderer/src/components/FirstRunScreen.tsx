import { useEffect, useState } from 'react'
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
    <div className="first-run">
      <div className="first-run__panel">
        <h1 className="first-run__title">Machina</h1>
        <p className="first-run__lede">
          Open a folder to use as your vault. Notes, canvas, and threads live there as plain files.
        </p>
        {notice && (
          <p role="status" className="first-run__notice">
            {notice}
          </p>
        )}
        <button type="button" onClick={onOpenFolder} className="first-run__cta">
          Open Folder
        </button>
        {history.length > 0 && (
          <div className="first-run__recent">
            <div className="first-run__recent-label">Recent vaults</div>
            <ul className="first-run__recent-list">
              {history.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    onClick={() => onOpenPath(path)}
                    title={path}
                    className="first-run__recent-item"
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
