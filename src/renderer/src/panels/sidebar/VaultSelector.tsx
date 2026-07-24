import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { colors } from '../../design/tokens'
import { ContextMenu, type ContextMenuEntry } from '../../components/ContextMenu'
import { logError } from '../../utils/error-logger'
import { useVaultHealthStore } from '../../store/vault-health-store'
import { useDockStore } from '../../store/dock-store'

interface ContextMenuState {
  readonly x: number
  readonly y: number
  readonly path: string
}

interface VaultSelectorProps {
  readonly currentName: string
  readonly currentPath: string | null
  readonly history: readonly string[]
  readonly onSelectVault: (path: string) => void
  readonly onOpenPicker: () => void
  readonly onRemoveFromHistory?: (path: string) => void
}

function vaultDisplayName(path: string): string {
  return path.split('/').pop() ?? path
}

function HealthDot() {
  const status = useVaultHealthStore((s) => s.status)
  const runs = useVaultHealthStore((s) => s.runs)
  const issues = useVaultHealthStore((s) => s.issues)
  let fill: string
  let title: string
  switch (status) {
    case 'green': {
      const passingCount = runs.filter((r) => r.passed).length
      fill = colors.accent.default
      title = `Vault healthy • ${passingCount}/${runs.length} checks passing`
      break
    }
    case 'degraded':
      fill = colors.claude.warning
      title = `${issues.length} issues, click for details`
      break
    default:
      fill = colors.text.muted
      title = 'Checking…'
  }

  const handleClick = () => {
    if (status !== 'green') {
      useDockStore.getState().openOrFocusDockTab({ kind: 'health' })
    }
  }

  return (
    <svg
      width={6}
      height={6}
      viewBox="0 0 6 6"
      data-testid="health-dot"
      data-clickable={status !== 'green' ? 'true' : undefined}
      onClick={handleClick}
      className="te-vault-selector__health-dot"
      role="status"
    >
      <title>{title}</title>
      <circle cx={3} cy={3} r={3} fill={fill} />
    </svg>
  )
}

export function VaultSelector({
  currentName,
  currentPath,
  history,
  onSelectVault,
  onOpenPicker,
  onRemoveFromHistory
}: VaultSelectorProps) {
  const [open, setOpen] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const toggle = useCallback(() => setOpen((prev) => !prev), [])

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // Defer to avoid the opening click from closing immediately
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  // Recent vaults, excluding the currently loaded vault by path (not name)
  const recentVaults = history.filter((p) => p !== currentPath)

  const ctxEntries = useMemo<readonly ContextMenuEntry[]>(() => {
    if (!ctxMenu) return []
    const base: readonly ContextMenuEntry[] = [
      {
        id: 'reveal-finder',
        label: 'Reveal in Finder',
        onSelect: () => {
          window.api.shell.showInFolder(ctxMenu.path).catch((err) => {
            logError('reveal-in-finder', err)
          })
        }
      },
      {
        id: 'copy-path',
        label: 'Copy Path',
        onSelect: () => {
          navigator.clipboard.writeText(ctxMenu.path)
        }
      }
    ]
    if (ctxMenu.path !== currentPath && onRemoveFromHistory) {
      return [
        ...base,
        { kind: 'separator', id: 'sep-remove' },
        {
          id: 'remove-history',
          label: 'Remove from History',
          destructive: true,
          onSelect: () => onRemoveFromHistory(ctxMenu.path)
        }
      ]
    }
    return base
  }, [ctxMenu, currentPath, onRemoveFromHistory])

  return (
    // minWidth 0 lets this flex item shrink so the vault name truncates instead
    // of overflowing into (and overlapping) the Files label beside it.
    <div className="te-vault-selector" ref={menuRef}>
      <div className="te-vault-selector__row">
        <button
          onClick={toggle}
          onContextMenu={(e) => {
            if (currentPath) {
              e.preventDefault()
              e.stopPropagation()
              setCtxMenu({ x: e.clientX, y: e.clientY, path: currentPath })
            }
          }}
          className="sidebar-vault-button te-vault-selector__button"
          data-open={open ? 'true' : 'false'}
          title={currentPath ?? undefined}
        >
          <span className="te-vault-selector__icon">
            <svg
              width={11}
              height={11}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="te-vault-selector__glyph"
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </span>
          <span className="te-vault-selector__name">{currentName}</span>
          <svg width={9} height={9} viewBox="0 0 10 10" className="te-vault-selector__chevron">
            <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        {currentPath && <HealthDot />}
      </div>

      {open && (
        <div className="sidebar-popover te-vault-selector__popover">
          {currentPath && (
            <>
              <div className="sidebar-kicker te-vault-selector__kicker">Current</div>
              <div className="te-vault-selector__current">
                <span className="te-vault-selector__current-name">{currentName}</span>
                <span className="te-vault-selector__current-path" title={currentPath}>
                  {currentPath}
                </span>
              </div>
              <div className="sidebar-popover-divider te-vault-selector__divider" />
            </>
          )}
          {recentVaults.length > 0 && (
            <>
              <div className="sidebar-kicker te-vault-selector__kicker">Recent</div>
              {recentVaults.map((path) => {
                const name = vaultDisplayName(path)
                return (
                  <button
                    key={path}
                    onClick={() => {
                      setOpen(false)
                      onSelectVault(path)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (onRemoveFromHistory) {
                        setCtxMenu({ x: e.clientX, y: e.clientY, path })
                      }
                    }}
                    className="sidebar-popover-item te-vault-selector__recent"
                  >
                    <svg
                      width={12}
                      height={12}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="te-vault-selector__recent-icon"
                    >
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span className="te-vault-selector__recent-name">{name}</span>
                  </button>
                )
              })}
            </>
          )}

          <div className="sidebar-popover-divider te-vault-selector__divider" />
          <button
            onClick={() => {
              setOpen(false)
              onOpenPicker()
            }}
            className="sidebar-popover-item te-vault-selector__open-different"
          >
            <span>Open Different Vault...</span>
          </button>
        </div>
      )}

      {/* Right-click context menu for vault path actions */}
      {ctxMenu && (
        <ContextMenu
          position={{ x: ctxMenu.x, y: ctxMenu.y }}
          items={ctxEntries}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}
