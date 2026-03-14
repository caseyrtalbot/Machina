import { useState } from 'react'
import type { Artifact } from '@shared/types'
import { getArtifactColor, colors, transitions } from '../../design/tokens'

/**
 * Finds the line containing targetId (or a [[targetTitle]] wikilink) in body
 * and returns a 100-character window centered around the match.
 * Returns an empty string when not found.
 */
export function extractContext(body: string, targetId: string, targetTitle?: string): string {
  let matchIndex = body.indexOf(targetId)
  let matchLength = targetId.length

  // Fallback: search for [[title]] wikilink form when ID isn't in body text
  if (matchIndex === -1 && targetTitle) {
    const wikilinkForm = `[[${targetTitle}]]`
    matchIndex = body.indexOf(wikilinkForm)
    matchLength = wikilinkForm.length
    // Also try [[title|display]] pattern
    if (matchIndex === -1) {
      const wikilinkPrefix = `[[${targetTitle}|`
      matchIndex = body.indexOf(wikilinkPrefix)
      if (matchIndex !== -1) {
        const closeIdx = body.indexOf(']]', matchIndex)
        matchLength = closeIdx !== -1 ? closeIdx + 2 - matchIndex : wikilinkPrefix.length
      }
    }
  }

  if (matchIndex === -1) return ''

  const half = 50
  const start = Math.max(0, matchIndex - half)
  const end = Math.min(body.length, matchIndex + matchLength + half)
  const snippet = body.slice(start, end)

  const prefix = start > 0 ? '\u2026' : ''
  const suffix = end < body.length ? '\u2026' : ''
  return `${prefix}${snippet}${suffix}`
}

interface BacklinkItemProps {
  artifact: Artifact
  currentNoteId: string
  currentNoteTitle?: string
  onNavigate: (id: string) => void
}

function BacklinkItem({
  artifact,
  currentNoteId,
  currentNoteTitle,
  onNavigate
}: BacklinkItemProps) {
  const typeColor = getArtifactColor(artifact.type)
  const context = extractContext(artifact.body, currentNoteId, currentNoteTitle)

  return (
    <button
      type="button"
      onClick={() => onNavigate(artifact.id)}
      className="w-full text-left px-4 py-2 flex flex-col gap-0.5 focus-ring interactive-hover"
      style={{ borderRadius: 0 }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: typeColor }} />
        <span
          className="text-xs truncate"
          style={{ color: colors.text.primary, transition: transitions.hover }}
        >
          {artifact.title}
        </span>
      </div>
      {context && (
        <p className="text-xs truncate pl-4" style={{ color: colors.text.muted }} title={context}>
          {context}
        </p>
      )}
    </button>
  )
}

interface BacklinksPanelProps {
  currentNoteId: string
  currentNoteTitle?: string
  backlinks: Artifact[]
  onNavigate: (id: string) => void
}

export function BacklinksPanel({
  currentNoteId,
  currentNoteTitle,
  backlinks,
  onNavigate
}: BacklinksPanelProps) {
  const [collapsed, setCollapsed] = useState(false)

  if (backlinks.length === 0) return null

  return (
    <div className="border-t" style={{ borderColor: colors.border.default }}>
      {/* Header row */}
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        className="w-full flex items-center justify-between px-4 py-2 focus-ring interactive-hover"
        style={{ transition: transitions.hover }}
      >
        <span
          className="text-xs font-medium"
          style={{
            color: colors.text.muted,
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}
        >
          Backlinks
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: colors.text.muted }}>
            {backlinks.length}
          </span>
          <span
            className="text-xs"
            style={{ color: colors.text.muted, transition: transitions.hover }}
          >
            {collapsed ? '\u25BE' : '\u25B4'}
          </span>
        </div>
      </button>

      {/* Backlink list */}
      {!collapsed && (
        <div className="pb-2">
          {backlinks.map((artifact) => (
            <BacklinkItem
              key={artifact.id}
              artifact={artifact}
              currentNoteId={currentNoteId}
              currentNoteTitle={currentNoteTitle}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}
