import { useState, useCallback, useEffect, useRef } from 'react'
import { colors, floatingPanel } from '../../design/tokens'

interface ContextMenuState {
  readonly x: number
  readonly y: number
  readonly path: string
}

interface VaultSelectorProps {
  readonly currentName: string
  readonly history: readonly string[]
  readonly onSelectVault: (path: string) => void
  readonly onOpenPicker: () => void
  readonly onRemoveFromHistory?: (path: string) => void
}

function vaultDisplayName(path: string): string {
  return path.split('/').pop() ?? path
}

export function VaultSelector({
  currentName,
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

  // Recent vaults, excluding current vault name if it matches
  const recentVaults = history.filter((p) => {
    const name = vaultDisplayName(p)
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
        {/* Vault icon */}
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: colors.text.muted, flexShrink: 0 }}
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span
          className="text-xs truncate flex-1"
          style={{ color: 'rgba(255, 255, 255, 0.7)', fontWeight: 500 }}
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
            backgroundColor: floatingPanel.glass.popoverBg,
            backdropFilter: floatingPanel.glass.popoverBlur,
            WebkitBackdropFilter: floatingPanel.glass.popoverBlur,
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
          }}
        >
          {/* Recent vaults */}
          {recentVaults.length > 0 && (
            <>
              <div
                className="mx-2 my-1"
                style={{ height: 1, backgroundColor: 'rgba(255, 255, 255, 0.06)' }}
              />
              {recentVaults.map((path) => {
                const name = vaultDisplayName(path)
                const isCurrent = name === currentName
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
            style={{ height: 1, backgroundColor: 'rgba(255, 255, 255, 0.06)' }}
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
            backgroundColor: floatingPanel.glass.popoverBg,
            backdropFilter: floatingPanel.glass.popoverBlur,
            WebkitBackdropFilter: floatingPanel.glass.popoverBlur,
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
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
