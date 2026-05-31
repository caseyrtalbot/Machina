import { typography } from '../../../design/tokens'

export interface MetadataEntry {
  readonly key: string
  readonly value: string | readonly string[]
}

interface MetadataGridProps {
  readonly entries: readonly MetadataEntry[]
}

const pillStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '1px 8px',
  borderRadius: 0,
  fontSize: 11,
  fontFamily: typography.fontFamily.mono,
  backgroundColor: 'rgba(255, 255, 255, 0.06)',
  color: 'var(--color-text-secondary)',
  lineHeight: 1.6,
  whiteSpace: 'nowrap'
}

function MetadataValue({ value }: { readonly value: string | readonly string[] }) {
  if (typeof value === 'string') {
    return (
      <span
        style={{
          fontFamily: typography.fontFamily.mono,
          fontSize: 13,
          color: 'var(--color-text-primary)',
          lineHeight: 1.5,
          wordBreak: 'break-word'
        }}
      >
        {value}
      </span>
    )
  }

  return (
    <div className="flex flex-wrap gap-1" style={{ paddingTop: 1 }}>
      {value.map((item, i) => (
        <span key={i} style={pillStyle}>
          {item}
        </span>
      ))}
    </div>
  )
}

export function MetadataGrid({ entries }: MetadataGridProps) {
  if (entries.length === 0) return null

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'max-content 1fr',
        rowGap: 8,
        columnGap: 16,
        marginBottom: 20,
        alignItems: 'start'
      }}
    >
      {entries.map(({ key, value }) => (
        <div key={key} style={{ display: 'contents' }}>
          <span
            style={{
              fontFamily: typography.fontFamily.mono,
              fontSize: 10,
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--label-tracking)',
              lineHeight: 1.8,
              userSelect: 'none',
              whiteSpace: 'nowrap'
            }}
          >
            {key.replace(/_/g, '_')}
          </span>
          <MetadataValue value={value} />
        </div>
      ))}
    </div>
  )
}
