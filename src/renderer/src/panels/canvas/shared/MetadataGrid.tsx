export interface MetadataEntry {
  readonly key: string
  readonly value: string | readonly string[]
}

interface MetadataGridProps {
  readonly entries: readonly MetadataEntry[]
}

function MetadataValue({ value }: { readonly value: string | readonly string[] }) {
  if (typeof value === 'string') {
    return <span className="te-metadata-grid__value">{value}</span>
  }

  return (
    <div className="te-metadata-grid__pills">
      {value.map((item, i) => (
        <span key={i} className="te-metadata-grid__pill">
          {item}
        </span>
      ))}
    </div>
  )
}

export function MetadataGrid({ entries }: MetadataGridProps) {
  if (entries.length === 0) return null

  return (
    <div className="te-metadata-grid">
      {entries.map(({ key, value }) => (
        <div key={key} className="te-metadata-grid__row">
          <span className="te-metadata-grid__key">{key.replace(/_/g, ' ')}</span>
          <MetadataValue value={value} />
        </div>
      ))}
    </div>
  )
}
