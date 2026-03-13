import { useState } from 'react'
import type { Artifact } from '@shared/types'
import { Badge } from '../../design/components/Badge'
import { Chip } from '../../design/components/Chip'
import { ARTIFACT_COLORS, colors, transitions } from '../../design/tokens'

export interface MetadataEntry {
  readonly label: string
  readonly value: string
}

export function buildMetadataEntries(artifact: Artifact): readonly MetadataEntry[] {
  const entries: MetadataEntry[] = [
    { label: 'ID', value: artifact.id },
    { label: 'Type', value: artifact.type },
    { label: 'Signal', value: artifact.signal },
    { label: 'Created', value: artifact.created },
    { label: 'Modified', value: artifact.modified },
  ]

  if (artifact.frame) {
    entries.push({ label: 'Frame', value: artifact.frame })
  }
  if (artifact.source) {
    entries.push({ label: 'Source', value: artifact.source })
  }
  if (artifact.tags.length > 0) {
    entries.push({ label: 'Tags', value: artifact.tags.join(', ') })
  }

  return entries
}

interface RelationshipBlockProps {
  icon: string
  label: string
  ids: readonly string[]
  onNavigate?: (id: string) => void
}

function RelationshipBlock({ icon, label, ids, onNavigate }: RelationshipBlockProps) {
  if (ids.length === 0) return null
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs shrink-0 mt-0.5" style={{ color: colors.text.muted, minWidth: 80 }}>
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {ids.map((id) => (
          <Chip key={id} icon={icon} label={id} onClick={() => onNavigate?.(id)} />
        ))}
      </div>
    </div>
  )
}

interface FrontmatterHeaderProps {
  artifact: Artifact
  mode: 'rich' | 'source'
  onNavigate?: (id: string) => void
}

export function FrontmatterHeader({ artifact, mode, onNavigate }: FrontmatterHeaderProps) {
  const [expanded, setExpanded] = useState(false)

  if (mode === 'source') return null

  const entries = buildMetadataEntries(artifact)
  const typeColor = ARTIFACT_COLORS[artifact.type]

  return (
    <div
      className="border-b px-6 py-3"
      style={{
        borderColor: colors.border.default,
        backgroundColor: colors.bg.surface,
        transition: transitions.default,
      }}
    >
      {/* Summary row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: typeColor }}
        />
        <Badge label={artifact.type} color={typeColor} />
        {artifact.tags.map((tag) => (
          <Badge key={tag} label={tag} color={colors.text.secondary} />
        ))}
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className="ml-auto text-xs transition-colors"
          style={{ color: colors.text.muted, transition: transitions.default }}
          title={expanded ? 'Collapse metadata' : 'Expand metadata'}
        >
          {expanded ? '▴' : '▾'}
        </button>
      </div>

      {/* Expanded metadata grid */}
      {expanded && (
        <div className="mt-3 space-y-3">
          <div
            className="grid gap-x-4 gap-y-1.5"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}
          >
            {entries.map((entry) => (
              <div key={entry.label} className="flex items-baseline gap-1.5 min-w-0">
                <span
                  className="text-xs shrink-0"
                  style={{ color: colors.text.muted, minWidth: 56 }}
                >
                  {entry.label}
                </span>
                <span
                  className="text-xs truncate"
                  style={{ color: colors.text.secondary }}
                  title={entry.value}
                >
                  {entry.value}
                </span>
              </div>
            ))}
          </div>

          {/* Relationship blocks */}
          {(artifact.connections.length > 0 ||
            artifact.clusters_with.length > 0 ||
            artifact.tensions_with.length > 0 ||
            artifact.appears_in.length > 0) && (
            <div className="space-y-1.5 pt-1 border-t" style={{ borderColor: colors.border.default }}>
              <RelationshipBlock
                icon="↔"
                label="Connections"
                ids={artifact.connections}
                onNavigate={onNavigate}
              />
              <RelationshipBlock
                icon="⊕"
                label="Clusters with"
                ids={artifact.clusters_with}
                onNavigate={onNavigate}
              />
              <RelationshipBlock
                icon="⊗"
                label="Tensions with"
                ids={artifact.tensions_with}
                onNavigate={onNavigate}
              />
              <RelationshipBlock
                icon="↗"
                label="Appears in"
                ids={artifact.appears_in}
                onNavigate={onNavigate}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
