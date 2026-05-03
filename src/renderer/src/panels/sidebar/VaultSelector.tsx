import { useState, useCallback, useEffect, useRef } from 'react'
import { borderRadius, colors, typography } from '../../design/tokens'
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
  const ctxMenuRef = useRef<HTMLDivElement>(null)

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

  // Close right-click context menu on outside click or escape
  useEffect(() => {
    if (!ctxMenu) return
    const handleClick = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [ctxMenu])

  // Recent vaults, excluding the currently loaded vault by path (not name)
  const recentVaults = history.filter((p) => p !== currentPath)

  return (
    <div className="relative" ref={menuRef}>
      <div className="flex items-center">
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
          style={{
            color: colors.text.primary,
            // Console: square hairline frame, inline radius. The card itself
            // stays flat; only the icon box gets accent-tint.
            borderRadius: borderRadius.inline,
            gap: 10
          }}
        >
          {/* Accent-tinted icon box (28×28) — anchors the vault card with
              the warm Ember accent without coloring the whole row. */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              flexShrink: 0,
              borderRadius: borderRadius.inline,
              background: colors.accent.soft,
              border: `1px solid ${colors.accent.line}`
            }}
          >
            <svg
              width={14}
              height={14}
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
          <span className="sidebar-vault-copy">
            <span
              className="sidebar-vault-name truncate"
              style={{
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: 0,
                color: colors.text.primary
              }}
            >
              {currentName}
            </span>
            {currentPath && (
              <span
                className="sidebar-vault-path truncate"
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
            )}
          </span>
          <svg
            width={10}
            height={10}
            viewBox="0 0 10 10"
            style={{
              color: colors.text.muted,
              flexShrink: 0,
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: '150ms ease-out'
            }}
          >
            <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        {currentPath && <HealthDot />}
      </div>

      {open && (
        <div
          className="sidebar-popover absolute left-0 right-0 flex flex-col py-1 z-50"
          style={{
            top: '100%',
            marginTop: 6
          }}
        >
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
        <div
          ref={ctxMenuRef}
          className="sidebar-popover fixed z-[100] py-1"
          style={{
            left: ctxMenu.x,
            top: ctxMenu.y
          }}
        >
          <button
            onClick={() => {
              window.api.shell.showInFolder(ctxMenu.path)
              setCtxMenu(null)
            }}
            className="sidebar-popover-item"
            style={{ color: colors.text.secondary }}
          >
            Reveal in Finder
          </button>
          <button
            onClick={() => {
              navigator.clipboard.writeText(ctxMenu.path)
              setCtxMenu(null)
            }}
            className="sidebar-popover-item"
            style={{ color: colors.text.secondary }}
          >
            Copy Path
          </button>
          {ctxMenu.path !== currentPath && onRemoveFromHistory && (
            <>
              <div className="sidebar-popover-divider mx-3 my-1" />
              <button
                onClick={() => {
                  onRemoveFromHistory(ctxMenu.path)
                  setCtxMenu(null)
                }}
                className="sidebar-popover-item"
                style={{ color: '#EF4444' }}
              >
                Remove from History
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
