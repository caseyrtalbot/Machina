import { useCallback, useMemo, useState } from 'react'
import type { Artifact } from '@shared/types'
import { linkifyMentions, type MentionMatch } from '@engine/unlinked-mentions'
import {
  borderRadius,
  colors,
  getArtifactColor,
  transitions,
  typography
} from '../../design/tokens'
import { SectionLabel } from '../../design/components/SectionLabel'
import { useUiStore } from '../../store/ui-store'
import { useVaultStore, type UnlinkedMention } from '../../store/vault-store'
import { notifyError } from '../../utils/error-logger'

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

/** 100-char cleaned window centered on a mention match, mirroring extractContext. */
function mentionSnippet(body: string, match: MentionMatch): string {
  const half = 50
  const start = Math.max(0, match.index - half)
  const end = Math.min(body.length, match.index + match.length + half)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < body.length ? '…' : ''
  return cleanSnippet(`${prefix}${body.slice(start, end)}${suffix}`)
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

interface LinkSectionProps {
  readonly label: string
  readonly artifacts: readonly Artifact[]
  readonly currentNoteId: string
  readonly currentNoteTitle?: string
  readonly onNavigate: (id: string) => void
}

function LinkSection({
  label,
  artifacts,
  currentNoteId,
  currentNoteTitle,
  onNavigate
}: LinkSectionProps) {
  if (artifacts.length === 0) return null
  return (
    <div style={{ paddingBottom: 8 }}>
      <div style={{ padding: '4px 32px' }}>
        <SectionLabel
          style={{
            fontSize: '10px',
            letterSpacing: typography.metadata.letterSpacing,
            color: colors.text.muted
          }}
        >
          {label}
        </SectionLabel>
      </div>
      {artifacts.map((artifact) => (
        <BacklinkItem
          key={artifact.id}
          artifact={artifact}
          currentNoteId={currentNoteId}
          currentNoteTitle={currentNoteTitle}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  )
}

interface UnlinkedMentionItemProps {
  readonly mention: UnlinkedMention
  readonly state: 'idle' | 'linking' | 'linked'
  readonly onNavigate: (id: string) => void
  readonly onLinkify: (artifactId: string) => void
}

function UnlinkedMentionItem({ mention, state, onNavigate, onLinkify }: UnlinkedMentionItemProps) {
  const { artifact, matches } = mention
  const typeColor = getArtifactColor(artifact.type)
  const snippet = mentionSnippet(artifact.body, matches[0])
  const label =
    state === 'linking'
      ? '…'
      : state === 'linked'
        ? 'Linked'
        : `Link${matches.length > 1 ? ` ${matches.length}` : ''}`

  return (
    <div
      className="w-full flex items-center gap-2"
      style={{
        // Console: same 8px / 32px row scale as BacklinkItem.
        padding: '8px 32px',
        fontFamily: typography.fontFamily.mono
      }}
    >
      <button
        type="button"
        onClick={() => onNavigate(artifact.id)}
        className="flex-1 min-w-0 text-left flex flex-col gap-0.5 focus-ring interactive-hover"
        style={{ borderRadius: borderRadius.card }}
      >
        <div className="flex items-center gap-2 min-w-0">
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
        {snippet && (
          <p
            className="truncate"
            style={{ color: colors.text.muted, fontSize: '11px', paddingLeft: 16 }}
            title={snippet}
          >
            {snippet}
          </p>
        )}
      </button>
      <button
        type="button"
        onClick={() => onLinkify(artifact.id)}
        disabled={state !== 'idle'}
        className="focus-ring interactive-hover"
        title="Wrap mentions in [[...]]"
        style={{
          color: state === 'idle' ? colors.accent.default : colors.text.muted,
          fontSize: '11px',
          padding: '2px 8px',
          borderRadius: borderRadius.inline,
          border: `1px solid ${colors.border.subtle}`,
          flexShrink: 0,
          transition: transitions.hover
        }}
      >
        {label}
      </button>
    </div>
  )
}

interface BacklinksPanelProps {
  currentNoteId: string
  currentNotePath: string
  currentNoteTitle?: string
  /** Inbound links: artifacts that link TO this note. */
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
  const getOutgoingLinks = useVaultStore((s) => s.getOutgoingLinks)
  const getUnlinkedMentions = useVaultStore((s) => s.getUnlinkedMentions)
  const graph = useVaultStore((s) => s.graph)
  const artifacts = useVaultStore((s) => s.artifacts)
  // Keyed `${noteId}:${artifactId}` so state never bleeds across notes.
  const [linkifyState, setLinkifyState] = useState<Readonly<Record<string, 'linking' | 'linked'>>>(
    {}
  )

  // Outgoing links recompute when the graph changes (worker result), not per render.
  const outgoingLinks = useMemo(
    () => (currentNoteId ? getOutgoingLinks(currentNoteId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- graph is the real data dependency
    [currentNoteId, getOutgoingLinks, graph]
  )

  // Unlinked mentions rescan when artifact bodies change (worker result), not per render.
  const unlinkedMentions = useMemo(
    () => (currentNoteId ? getUnlinkedMentions(currentNoteId, currentNoteTitle) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- artifacts is the real data dependency
    [currentNoteId, currentNoteTitle, getUnlinkedMentions, artifacts]
  )

  const handleLinkify = useCallback(
    async (artifactId: string) => {
      const key = `${currentNoteId}:${artifactId}`
      const path = useVaultStore.getState().artifactPathById[artifactId]
      if (!path || !currentNoteId) return
      setLinkifyState((prev) => ({ ...prev, [key]: 'linking' }))
      try {
        // Read via DocumentManager (not raw disk) so an open note's unsaved
        // edits are the linkify input — a disk read inside the autosave
        // debounce window would clobber them on save (see Sidebar rename).
        const { content } = await window.api.document.open(path)
        try {
          const terms = [currentNoteTitle ?? '', currentNoteId]
          const { content: linked, count } = linkifyMentions(content, terms)
          if (count > 0) await window.api.document.saveContent(path, linked)
        } finally {
          await window.api.document.close(path)
        }
        setLinkifyState((prev) => ({ ...prev, [key]: 'linked' }))
      } catch (err) {
        notifyError('linkify-mention', err, `Failed to link mentions in ${path}`)
        setLinkifyState((prev) => {
          const next = { ...prev }
          delete next[key]
          return next
        })
      }
    },
    [currentNoteId, currentNoteTitle]
  )

  const totalCount = backlinks.length + outgoingLinks.length + unlinkedMentions.length
  if (totalCount === 0) return null

  return (
    // Console: hairline top border separates the backlinks bar from the
    // editor body. Padding 12 / 32 matches the breadcrumb row scale.
    <div
      style={{
        borderTop: `1px solid ${colors.border.subtle}`
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
          Links
        </SectionLabel>
        <div className="flex items-center gap-2">
          <span
            style={{
              color: colors.text.muted,
              fontFamily: typography.fontFamily.mono,
              fontSize: '11px'
            }}
          >
            {totalCount}
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

      {/* Link sections: inbound mentions and outgoing links, honestly separated */}
      {!collapsed && (
        <>
          <LinkSection
            label="Linked mentions"
            artifacts={backlinks}
            currentNoteId={currentNoteId}
            currentNoteTitle={currentNoteTitle}
            onNavigate={onNavigate}
          />
          <LinkSection
            label="Links from this note"
            artifacts={outgoingLinks}
            currentNoteId={currentNoteId}
            currentNoteTitle={currentNoteTitle}
            onNavigate={onNavigate}
          />
          {unlinkedMentions.length > 0 && (
            <div style={{ paddingBottom: 8 }}>
              <div style={{ padding: '4px 32px' }}>
                <SectionLabel
                  style={{
                    fontSize: '10px',
                    letterSpacing: typography.metadata.letterSpacing,
                    color: colors.text.muted
                  }}
                >
                  Unlinked mentions
                </SectionLabel>
              </div>
              {unlinkedMentions.map((mention) => (
                <UnlinkedMentionItem
                  key={mention.artifact.id}
                  mention={mention}
                  state={linkifyState[`${currentNoteId}:${mention.artifact.id}`] ?? 'idle'}
                  onNavigate={onNavigate}
                  onLinkify={handleLinkify}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
