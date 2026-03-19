import { useState, useCallback, useEffect, useRef } from 'react'
import { colors, typography } from '../../design/tokens'

interface ContextMenuState {
  readonly x: number
  readonly y: number
  readonly path: string
}

interface VaultSelectorProps {
  readonly currentName: string
  readonly isClaudeConfig?: boolean
  readonly history: readonly string[]
  readonly onSelectVault: (path: string) => void
  readonly onOpenPicker: () => void
  readonly onSelectClaudeConfig: () => void
  readonly onRemoveFromHistory?: (path: string) => void
}

function vaultDisplayName(path: string): string {
  return path.split('/').pop() ?? path
}

export function VaultSelector({
  currentName,
  isClaudeConfig = false,
  history,
  onSelectVault,
  onOpenPicker,
  onSelectClaudeConfig,
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

  // Recent vaults, excluding ~/.claude and current vault name if it matches
  const recentVaults = history.filter((p) => {
    const name = vaultDisplayName(p)
    if (isClaudeConfig) return true
    return name !== currentName
  })

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-left hover:opacity-80"
        style={{
          color: colors.text.primary,
          backgroundColor: open ? 'rgba(255, 255, 255, 0.06)' : 'transparent'
        }}
      >
        {/* Vault/config icon */}
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: isClaudeConfig ? '#a78bfa' : colors.text.muted, flexShrink: 0 }}
        >
          {isClaudeConfig ? (
            // Gear icon for .claude config
            <>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </>
          ) : (
            // Folder icon for vaults
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          )}
        </svg>
        <span
          className="text-xs font-medium truncate flex-1"
          style={{ fontFamily: typography.fontFamily.mono }}
        >
          {currentName}
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

      {open && (
        <div
          className="absolute left-0 right-0 flex flex-col py-1 z-50"
          style={{
            top: '100%',
            marginTop: 2,
            backgroundColor: colors.bg.elevated,
            border: `1px solid ${colors.border.default}`,
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
          }}
        >
          {/* Claude config option */}
          <button
            onClick={() => {
              setOpen(false)
              onSelectClaudeConfig()
            }}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:opacity-80"
            style={{
              color: isClaudeConfig ? colors.text.primary : colors.text.secondary,
              backgroundColor: isClaudeConfig ? 'rgba(255, 255, 255, 0.06)' : 'transparent'
            }}
          >
            <svg
              width={12}
              height={12}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ color: '#a78bfa' }}
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span style={{ fontFamily: typography.fontFamily.mono }}>~/.claude/</span>
            {isClaudeConfig && (
              <span style={{ color: colors.accent.default, marginLeft: 'auto' }}>&#10003;</span>
            )}
          </button>

          {/* Recent vaults */}
          {recentVaults.length > 0 && (
            <>
              <div
                className="mx-2 my-1"
                style={{ height: 1, backgroundColor: colors.border.default }}
              />
              {recentVaults.map((path) => {
                const name = vaultDisplayName(path)
                const isCurrent = !isClaudeConfig && name === currentName
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
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:opacity-80"
                    style={{
                      color: isCurrent ? colors.text.primary : colors.text.secondary,
                      backgroundColor: isCurrent ? 'rgba(255, 255, 255, 0.06)' : 'transparent'
                    }}
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
                    {isCurrent && (
                      <span style={{ color: colors.accent.default, marginLeft: 'auto' }}>
                        &#10003;
                      </span>
                    )}
                  </button>
                )
              })}
            </>
          )}

          {/* Open different vault */}
          <div
            className="mx-2 my-1"
            style={{ height: 1, backgroundColor: colors.border.default }}
          />
          <button
            onClick={() => {
              setOpen(false)
              onOpenPicker()
            }}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:opacity-80"
            style={{ color: colors.text.muted }}
          >
            <span>Open Different Vault...</span>
          </button>
        </div>
      )}

      {/* Right-click context menu for removing vaults from history */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="fixed z-[100] py-1"
          style={{
            left: ctxMenu.x,
            top: ctxMenu.y,
            backgroundColor: colors.bg.elevated,
            border: `1px solid ${colors.border.default}`,
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
          }}
        >
          <button
            onClick={() => {
              onRemoveFromHistory?.(ctxMenu.path)
              setCtxMenu(null)
            }}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:opacity-80 w-full"
            style={{ color: colors.text.secondary }}
          >
            Remove from History
          </button>
        </div>
      )}
    </div>
  )
}
