import { useCallback } from 'react'
import { borderRadius, colors, floatingPanel, typography } from '../../design/tokens'
import { EmptyState } from '../../components/emptystate/EmptyState'
import { Overlay } from '../../components/overlay/Overlay'

export function CanvasWelcomeCard() {
  const handleOpenFolder = useCallback(async () => {
    const path = await window.api.fs.selectVault()
    if (path) {
      window.dispatchEvent(new CustomEvent('te:open-vault', { detail: path }))
    }
  }, [])

  return (
    <EmptyState
      variant="card"
      overlay
      eyebrow="Machina"
      title="Open a folder to get started."
      body="Point Machina at any folder of markdown files. Your notes become an explorable knowledge graph with connections, clusters, and tensions."
      actions={[{ label: 'Open Folder', onClick: handleOpenFolder }]}
    />
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
  return (
    <EmptyState
      variant="card"
      overlay
      testId="canvas-empty-vault"
      eyebrow="Empty Vault"
      title="Put your first thought on the canvas."
      body="Create a note, import from your vault with ⌘G, or drag markdown, images, and PDFs from Finder straight onto the canvas."
      actions={[
        { label: 'New Note', onClick: onCreateNote },
        { label: 'Import ⌘G', onClick: onOpenImport, kind: 'secondary' }
      ]}
      hint="Press ? for keyboard shortcuts"
    />
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
  return (
    <Overlay open onClose={onClose} containment="parent">
      <div
        data-testid="canvas-shortcut-overlay"
        // Click anywhere closes — the panel too, not just the scrim.
        onClick={onClose}
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
    </Overlay>
  )
}
