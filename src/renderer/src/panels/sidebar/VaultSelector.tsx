import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { borderRadius, colors, transitions, typography } from '../../design/tokens'
import { ContextMenu, type ContextMenuEntry } from '../../components/ContextMenu'
import { logError } from '../../utils/error-logger'
import { useVaultHealthStore } from '../../store/vault-health-store'
import { useThreadStore } from '../../store/thread-store'

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
      title = `Vault healthy \u2022 ${passingCount}/${runs.length} checks passing`
      break
    }
    case 'degraded':
      fill = colors.claude.warning
      title = `${issues.length} issues, click for details`
      break
    default:
      fill = colors.text.muted
      title = 'Checking\u2026'
  }

  const handleClick = () => {
    if (status !== 'green') {
      useThreadStore.getState().openOrFocusDockTab({ kind: 'health' })
    }
  }

  return (
    <svg
      width={6}
      height={6}
      viewBox="0 0 6 6"
      data-testid="health-dot"
      onClick={handleClick}
      style={{
        marginLeft: 6,
        cursor: status !== 'green' ? 'pointer' : 'default',
        flexShrink: 0
      }}
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
    <div className="relative" ref={menuRef}>
      <div className="flex items-center" style={{ minWidth: 0 }}>
        <button
          onClick={toggle}
          onContextMenu={(e) => {
            if (currentPath) {
              e.preventDefault()
              e.stopPropagation()
              setCtxMenu({ x: e.clientX, y: e.clientY, path: currentPath })
            }
          }}
          className="sidebar-vault-button"
          data-open={open ? 'true' : 'false'}
          title={currentPath ?? undefined}
          style={{
            color: colors.text.primary,
            borderRadius: borderRadius.inline,
            gap: 8
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              flexShrink: 0,
              borderRadius: borderRadius.inline,
              background: colors.accent.soft,
              border: `1px solid ${colors.accent.line}`
            }}
          >
            <svg
              width={11}
              height={11}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: colors.accent.default }}
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </span>
          <span
            className="sidebar-vault-name truncate"
            style={{
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: 0,
              color: colors.text.primary,
              minWidth: 0
            }}
          >
            {currentName}
          </span>
          <svg
            width={9}
            height={9}
            viewBox="0 0 10 10"
            style={{
              color: colors.text.muted,
              flexShrink: 0,
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: transitions.default
            }}
          >
            <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        {currentPath && <HealthDot />}
      </div>

      {open && (
        <div
          className="sidebar-popover absolute left-0 flex flex-col py-1 z-50"
          style={{
            top: '100%',
            marginTop: 6,
            minWidth: 280,
            maxWidth: 'min(420px, calc(100vw - 24px))'
          }}
        >
          {currentPath && (
            <>
              <div className="px-3 pt-2 pb-1 sidebar-kicker">Current</div>
              <div
                className="px-3 pb-2"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: colors.text.primary
                  }}
                >
                  {currentName}
                </span>
                <span
                  className="truncate"
                  title={currentPath}
                  style={{
                    fontFamily: typography.fontFamily.mono,
                    fontSize: 10,
                    letterSpacing: 0,
                    color: colors.text.muted
                  }}
                >
                  {currentPath}
                </span>
              </div>
              <div className="sidebar-popover-divider mx-3 my-1" />
            </>
          )}
          {recentVaults.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 sidebar-kicker">Recent</div>
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
                    className="sidebar-popover-item"
                    style={{ color: colors.text.secondary }}
                  >
                    <svg
                      width={12}
                      height={12}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      style={{ color: colors.text.muted }}
                    >
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span className="truncate">{name}</span>
                  </button>
                )
              })}
            </>
          )}

          <div className="sidebar-popover-divider mx-3 my-1" />
          <button
            onClick={() => {
              setOpen(false)
              onOpenPicker()
            }}
            className="sidebar-popover-item"
            style={{ color: colors.text.muted }}
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
