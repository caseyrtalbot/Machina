import type { Artifact } from '@shared/types'
import {
  borderRadius,
  colors,
  getArtifactColor,
  transitions,
  typography
} from '../../design/tokens'
import { SectionLabel } from '../../design/components/SectionLabel'
import { useUiStore } from '../../store/ui-store'

/**
 * Strip markdown formatting from a snippet so it reads as clean prose.
 * Removes headers, bold/italic markers, `<node>` tags, and normalizes whitespace.
 */
function cleanSnippet(raw: string): string {
  return raw
    .replace(/<node>(.*?)<\/node>/gi, '$1') // <node>X</node> → X
    .replace(/#{1,6}\s*/g, '') // ## Heading → Heading
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1') // **bold** / *italic* → text
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1') // __bold__ / _italic_ → text
    .replace(/`([^`]+)`/g, '$1') // `code` → code
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1') // [[link]] → link
    .replace(/\|[^\]]*\]\]/g, '') // orphaned |display]] fragments
    .replace(/&[a-z]+;/gi, ' ') // &nbsp; and other HTML entities
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim()
}

/**
 * Finds the line containing targetId (or a `<node>targetTitle</node>` concept tag) in body
 * and returns a 100-character window centered around the match.
 * Returns an empty string when not found.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function extractContext(body: string, targetId: string, targetTitle?: string): string {
  let matchIndex = body.indexOf(targetId)
  let matchLength = targetId.length

  // Fallback: search for <node>title</node> concept node when ID isn't in body text
  if (matchIndex === -1 && targetTitle) {
    const conceptForm = `<node>${targetTitle}</node>`
    matchIndex = body.indexOf(conceptForm)
    matchLength = conceptForm.length
    // Case-insensitive fallback
    if (matchIndex === -1) {
      const lower = targetTitle.toLowerCase()
      const bodyLower = body.toLowerCase()
      const conceptLower = `<node>${lower}</node>`
      matchIndex = bodyLower.indexOf(conceptLower)
      if (matchIndex !== -1) {
        matchLength = conceptLower.length
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
  return cleanSnippet(`${prefix}${snippet}${suffix}`)
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
      className="w-full text-left flex flex-col gap-0.5 focus-ring interactive-hover"
      style={{
        borderRadius: borderRadius.card,
        // Console: 12px vertical / 32px horizontal padding aligns with the
        // chrome row scale used elsewhere in the editor.
        padding: '8px 32px',
        fontFamily: typography.fontFamily.mono
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* Square chip dot — replaces the round one to match the hairline-square aesthetic */}
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            backgroundColor: typeColor,
            borderRadius: borderRadius.inline,
            flexShrink: 0
          }}
        />
        <span
          className="truncate"
          style={{
            color: colors.text.primary,
            fontSize: '11px',
            transition: transitions.hover
          }}
        >
          {artifact.title}
        </span>
      </div>
      {context && (
        <p
          className="truncate"
          style={{
            color: colors.text.muted,
            fontSize: '11px',
            paddingLeft: 16
          }}
          title={context}
        >
          {context}
        </p>
      )}
    </button>
  )
}

interface BacklinksPanelProps {
  currentNoteId: string
  currentNotePath: string
  currentNoteTitle?: string
  backlinks: Artifact[]
  onNavigate: (id: string) => void
}

export function BacklinksPanel({
  currentNoteId,
  currentNotePath,
  currentNoteTitle,
  backlinks,
  onNavigate
}: BacklinksPanelProps) {
  const collapsed = useUiStore((s) => s.getBacklinkCollapsed(currentNotePath))
  const toggle = useUiStore((s) => s.toggleBacklinkCollapsed)

  if (backlinks.length === 0) return null

  return (
    // Console: hairline top border separates the backlinks bar from the
    // editor body. Padding 12 / 32 matches the breadcrumb row scale.
    <div
      style={{
        borderTop: `0.5px solid ${colors.border.subtle}`
      }}
    >
      {/* Header row */}
      <button
        type="button"
        onClick={() => toggle(currentNotePath)}
        className="w-full flex items-center justify-between focus-ring interactive-hover"
        style={{
          padding: '12px 32px',
          transition: transitions.hover,
          fontFamily: typography.fontFamily.mono
        }}
      >
        <SectionLabel
          style={{
            fontSize: '11px',
            letterSpacing: typography.metadata.letterSpacing
          }}
        >
          Backlinks
        </SectionLabel>
        <div className="flex items-center gap-2">
          <span
            style={{
              color: colors.text.muted,
              fontFamily: typography.fontFamily.mono,
              fontSize: '11px'
            }}
          >
            {backlinks.length}
          </span>
          <span
            style={{
              color: colors.text.muted,
              fontSize: '11px',
              transition: transitions.hover
            }}
          >
            {collapsed ? '\u25BE' : '\u25B4'}
          </span>
        </div>
      </button>

      {/* Backlink list */}
      {!collapsed && (
        <div style={{ paddingBottom: 8 }}>
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
