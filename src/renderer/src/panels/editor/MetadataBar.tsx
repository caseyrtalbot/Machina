import { useState } from 'react'
import type { Artifact } from '@shared/types'
import { Badge } from '../../design/components/Badge'
import { Chip } from '../../design/components/Chip'
import { ARTIFACT_COLORS, colors } from '../../design/tokens'

interface MetadataBarProps {
  artifact: Artifact
  onNavigate: (id: string) => void
}

export function MetadataBar({ artifact, onNavigate }: MetadataBarProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="border-b px-8 py-3"
      style={{ borderColor: colors.border.default, backgroundColor: colors.bg.surface }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: ARTIFACT_COLORS[artifact.type] }}
        />
        <Badge label={artifact.type} color={ARTIFACT_COLORS[artifact.type]} />
        <Badge label={artifact.id} color={colors.text.secondary} />
        {artifact.frame && <Badge label={artifact.frame} color={colors.text.secondary} />}
        <Badge
          label={artifact.signal}
          color={artifact.signal === 'core' ? colors.accent.default : colors.text.muted}
        />
        <button
          onClick={() => setExpanded(!expanded)}
          className="ml-auto text-xs transition-colors"
          style={{ color: colors.text.muted }}
        >
          {expanded ? '\u25B4' : '\u25BE'}
        </button>
      </div>

      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        {artifact.connections.map((id) => (
          <Chip key={`conn-${id}`} icon="\u2194" label={id} onClick={() => onNavigate(id)} />
        ))}
        {artifact.clusters_with.map((id) => (
          <Chip key={`clus-${id}`} icon="\u2295" label={id} onClick={() => onNavigate(id)} />
        ))}
        {artifact.tensions_with.map((id) => (
          <Chip key={`tens-${id}`} icon="\u2297" label={id} onClick={() => onNavigate(id)} />
        ))}
      </div>

      {expanded && (
        <div className="mt-3 text-xs space-y-1" style={{ color: colors.text.secondary }}>
          <div>Created: {artifact.created}</div>
          <div>Modified: {artifact.modified}</div>
          {artifact.source && <div>Source: {artifact.source}</div>}
          {artifact.tags.length > 0 && <div>Tags: {artifact.tags.join(', ')}</div>}
          {artifact.appears_in.length > 0 && (
            <div>Appears in: {artifact.appears_in.join(', ')}</div>
          )}
        </div>
      )}
    </div>
  )
}
