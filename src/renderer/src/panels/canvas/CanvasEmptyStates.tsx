import { useCallback, useEffect, useState } from 'react'
import {
  borderRadius,
  colors,
  floatingPanel,
  transitions,
  typography,
  zIndex
} from '../../design/tokens'

export function CanvasWelcomeCard() {
  const [isHovered, setIsHovered] = useState(false)

  const handleOpenFolder = useCallback(async () => {
    const path = await window.api.fs.selectVault()
    if (path) {
      window.dispatchEvent(new CustomEvent('te:open-vault', { detail: path }))
    }
  }, [])

  return (
    <div
      className="absolute inset-0 flex items-center justify-center z-[1]"
      style={{ marginTop: -40 }}
    >
      <div
        style={{
          width: 360,
          padding: '32px 28px',
          borderRadius: borderRadius.card,
          backgroundColor: 'var(--canvas-card-bg)',
          backdropFilter: floatingPanel.glass.blur,
          WebkitBackdropFilter: floatingPanel.glass.blur,
          border: '1px solid var(--canvas-card-border)',
          boxShadow: floatingPanel.shadow
        }}
      >
        <div
          style={{
            fontSize: typography.metadata.size,
            fontFamily: typography.fontFamily.mono,
            color: colors.text.muted,
            letterSpacing: typography.metadata.letterSpacing,
            textTransform: 'uppercase',
            marginBottom: 12
          }}
        >
          Machina
        </div>
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 500,
            fontFamily: typography.fontFamily.display,
            color: colors.text.primary,
            lineHeight: 1.4,
            marginBottom: 8
          }}
        >
          Open a folder to get started.
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            fontFamily: typography.fontFamily.body,
            color: colors.text.secondary,
            lineHeight: 1.6,
            marginBottom: 24
          }}
        >
          Point Machina at any folder of markdown files. Your notes become an explorable knowledge
          graph with connections, clusters, and tensions.
        </p>
        <button
          type="button"
          onClick={handleOpenFolder}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{
            padding: '8px 20px',
            fontSize: 13,
            fontWeight: 500,
            fontFamily: typography.fontFamily.body,
            color: 'var(--color-accent-fg, #1a0f08)',
            backgroundColor: isHovered ? colors.accent.hover : colors.accent.default,
            border: 'none',
            borderRadius: borderRadius.tool,
            cursor: 'pointer',
            transition: `background-color ${transitions.default}`,
            lineHeight: 1.5
          }}
        >
          Open Folder
        </button>
      </div>
    </div>
  )
}

interface CanvasEmptyVaultCardProps {
  readonly onCreateNote: () => void
  readonly onOpenImport: () => void
}

/**
 * Empty-vault state: vault is open but holds zero artifacts. Offers the three
 * fastest paths to a first card — create a note, import (⌘G), or drag files.
 */
export function CanvasEmptyVaultCard({ onCreateNote, onOpenImport }: CanvasEmptyVaultCardProps) {
  const [hovered, setHovered] = useState<'note' | 'import' | null>(null)

  return (
    <div
      data-testid="canvas-empty-vault"
      className="absolute inset-0 flex items-center justify-center z-[1] pointer-events-none"
      style={{ marginTop: -40 }}
    >
      <div
        className="pointer-events-auto"
        style={{
          width: 360,
          padding: '28px',
          borderRadius: borderRadius.card,
          backgroundColor: 'var(--canvas-card-bg)',
          backdropFilter: floatingPanel.glass.blur,
          WebkitBackdropFilter: floatingPanel.glass.blur,
          border: '1px solid var(--canvas-card-border)',
          boxShadow: floatingPanel.shadow
        }}
      >
        <div
          style={{
            fontSize: typography.metadata.size,
            fontFamily: typography.fontFamily.mono,
            color: colors.text.muted,
            letterSpacing: typography.metadata.letterSpacing,
            textTransform: 'uppercase',
            marginBottom: 12
          }}
        >
          Empty Vault
        </div>
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 500,
            fontFamily: typography.fontFamily.display,
            color: colors.text.primary,
            lineHeight: 1.4,
            marginBottom: 8
          }}
        >
          Put your first thought on the canvas.
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            fontFamily: typography.fontFamily.body,
            color: colors.text.secondary,
            lineHeight: 1.6,
            marginBottom: 20
          }}
        >
          Create a note, import from your vault with ⌘G, or drag markdown, images, and PDFs from
          Finder straight onto the canvas.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onCreateNote}
            onMouseEnter={() => setHovered('note')}
            onMouseLeave={() => setHovered(null)}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 500,
              fontFamily: typography.fontFamily.body,
              color: 'var(--color-accent-fg)',
              backgroundColor: hovered === 'note' ? colors.accent.hover : colors.accent.default,
              border: 'none',
              borderRadius: borderRadius.tool,
              cursor: 'pointer',
              transition: `background-color ${transitions.default}`,
              lineHeight: 1.5
            }}
          >
            New Note
          </button>
          <button
            type="button"
            onClick={onOpenImport}
            onMouseEnter={() => setHovered('import')}
            onMouseLeave={() => setHovered(null)}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 500,
              fontFamily: typography.fontFamily.body,
              color: hovered === 'import' ? colors.text.primary : colors.text.secondary,
              backgroundColor: 'transparent',
              border: `1px solid ${colors.border.subtle}`,
              borderRadius: borderRadius.tool,
              cursor: 'pointer',
              transition: `color ${transitions.default}`,
              lineHeight: 1.5
            }}
          >
            Import ⌘G
          </button>
        </div>
        <p
          style={{
            margin: 0,
            marginTop: 16,
            fontSize: typography.metadata.size,
            fontFamily: typography.fontFamily.mono,
            color: colors.text.muted,
            letterSpacing: typography.metadata.letterSpacing
          }}
        >
          Press ? for keyboard shortcuts
        </p>
      </div>
    </div>
  )
}

const CANVAS_SHORTCUTS: ReadonlyArray<readonly [keys: string, action: string]> = [
  ['N', 'New note at cursor'],
  ['⌘G', 'Import from vault'],
  ['⌘Z / ⇧⌘Z', 'Undo / redo'],
  ['⌘A', 'Select all cards'],
  ['⌘D', 'Duplicate selection'],
  ['⌘C / ⌘V', 'Copy / paste cards'],
  ['Arrows', 'Nudge selection (⇧ for grid)'],
  ['⌫', 'Delete selection'],
  ['J / K', 'Cycle card focus'],
  ['Esc', 'Unlock card / clear focus'],
  ['?', 'Toggle this overlay']
]

/**
 * Dismissible keyboard-shortcut overlay, toggled by `?` on the canvas.
 * Click anywhere or press Escape to close.
 */
export function ShortcutOverlay({ onClose }: { readonly onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [onClose])

  return (
    <div
      data-testid="canvas-shortcut-overlay"
      className="absolute inset-0 flex items-center justify-center"
      style={{ zIndex: zIndex.modal, backgroundColor: colors.scrim.modal }}
      onClick={onClose}
    >
      <div
        style={{
          width: 340,
          padding: '20px 24px',
          borderRadius: borderRadius.card,
          backgroundColor: floatingPanel.glass.bg,
          backdropFilter: floatingPanel.glass.blur,
          WebkitBackdropFilter: floatingPanel.glass.blur,
          border: `1px solid ${colors.border.subtle}`,
          boxShadow: floatingPanel.shadow
        }}
      >
        <div
          style={{
            fontSize: typography.metadata.size,
            fontFamily: typography.fontFamily.mono,
            color: colors.text.muted,
            letterSpacing: typography.metadata.letterSpacing,
            textTransform: 'uppercase',
            marginBottom: 12
          }}
        >
          Canvas Shortcuts
        </div>
        {CANVAS_SHORTCUTS.map(([keys, action]) => (
          <div
            key={keys}
            className="flex items-center justify-between"
            style={{ padding: '3px 0' }}
          >
            <span
              style={{
                fontFamily: typography.fontFamily.mono,
                fontSize: 12,
                color: colors.text.primary
              }}
            >
              {keys}
            </span>
            <span
              style={{
                fontFamily: typography.fontFamily.body,
                fontSize: 12,
                color: colors.text.secondary
              }}
            >
              {action}
            </span>
          </div>
        ))}
        <div
          style={{
            marginTop: 12,
            fontSize: typography.metadata.size,
            fontFamily: typography.fontFamily.mono,
            color: colors.text.muted,
            letterSpacing: typography.metadata.letterSpacing
          }}
        >
          Click anywhere or press Esc to close
        </div>
      </div>
    </div>
  )
}
