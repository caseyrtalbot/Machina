import { useEffect, useRef, useCallback, useState } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { colors, ARTIFACT_COLORS } from '../../design/tokens'

interface GraphContextMenuProps {
  x: number
  y: number
  nodeId: string
  onClose: () => void
  onOpenInEditor: (id: string) => void
}

export interface ContextMenuItem {
  label: string
  action: string
  dangerous?: boolean
}

export const CONTEXT_MENU_ITEMS: readonly ContextMenuItem[] = [
  { label: 'Open in editor', action: 'open' },
  { label: 'Reveal in sidebar', action: 'reveal' },
  { label: 'Copy file path', action: 'copy-path' },
  { label: 'Delete', action: 'delete', dangerous: true }
]

export function GraphContextMenu({ x, y, nodeId, onClose, onOpenInEditor }: GraphContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  const fileToId = useVaultStore((s) => s.fileToId)
  const filePath = Object.entries(fileToId).find(([, id]) => id === nodeId)?.[0] ?? null

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
          handleClose()
        }
      }
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }, 0)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [handleClose])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleClose])

  const handleAction = useCallback(
    async (action: string) => {
      switch (action) {
        case 'open':
          onOpenInEditor(nodeId)
          handleClose()
          break
        case 'reveal':
          document.dispatchEvent(new CustomEvent('graph:reveal-in-sidebar', { detail: { nodeId } }))
          handleClose()
          break
        case 'copy-path':
          if (filePath) {
            await navigator.clipboard.writeText(filePath)
          }
          handleClose()
          break
        case 'delete':
          setShowConfirm(true)
          break
        default:
          break
      }
    },
    [nodeId, filePath, onOpenInEditor, handleClose]
  )

  const handleConfirmDelete = useCallback(async () => {
    if (filePath) {
      await window.api.vault.deleteFile(filePath)
    }
    handleClose()
  }, [filePath, handleClose])

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 50,
        minWidth: '180px',
        backgroundColor: colors.bg.elevated,
        border: `1px solid ${colors.border.default}`,
        borderRadius: '6px',
        padding: '4px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)'
      }}
    >
      {showConfirm ? (
        <div style={{ padding: '8px' }}>
          <p
            style={{
              color: colors.text.secondary,
              fontSize: '13px',
              marginBottom: '8px'
            }}
          >
            Delete this node? This cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setShowConfirm(false)}
              style={{
                padding: '4px 10px',
                fontSize: '13px',
                backgroundColor: 'transparent',
                border: `1px solid ${colors.border.default}`,
                borderRadius: '4px',
                color: colors.text.secondary,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmDelete}
              style={{
                padding: '4px 10px',
                fontSize: '13px',
                backgroundColor: ARTIFACT_COLORS.constraint,
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                cursor: 'pointer'
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        CONTEXT_MENU_ITEMS.map((item) => (
          <button
            key={item.action}
            onClick={() => handleAction(item.action)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 10px',
              fontSize: '13px',
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: '4px',
              color: item.dangerous ? ARTIFACT_COLORS.constraint : colors.text.primary,
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = item.dangerous
                ? 'rgba(239,68,68,0.1)'
                : colors.accent.muted
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
            }}
          >
            {item.label}
          </button>
        ))
      )}
    </div>
  )
}
