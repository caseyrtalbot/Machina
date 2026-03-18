import { useState, useRef, useCallback, type KeyboardEvent } from 'react'
import type { Artifact } from '@shared/types'
import { colors, getArtifactColor } from '../../design/tokens'
import { serializeFrontmatter } from './markdown-utils'

// ── Types ──

export interface MetadataEntry {
  readonly label: string
  readonly value: string
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildMetadataEntries(artifact: Artifact): readonly MetadataEntry[] {
  const entries: MetadataEntry[] = [
    { label: 'ID', value: artifact.id },
    { label: 'Type', value: artifact.type },
    { label: 'Signal', value: artifact.signal },
    { label: 'Created', value: artifact.created },
    { label: 'Modified', value: artifact.modified }
  ]
  if (artifact.frame) entries.push({ label: 'Frame', value: artifact.frame })
  if (artifact.source) entries.push({ label: 'Source', value: artifact.source })
  if (artifact.tags.length > 0) entries.push({ label: 'Tags', value: artifact.tags.join(', ') })
  return entries
}

// ── Pill style shared with type badge ──

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  fontWeight: 500,
  letterSpacing: '0.04em',
  borderRadius: 4,
  padding: '2px 8px',
  border: `1px solid ${colors.text.muted}50`,
  color: colors.text.secondary,
  lineHeight: 1.4
}

// ── Tag Pills Editor ──

interface TagEditorProps {
  tags: string[]
  onChange: (tags: string[]) => void
}

function TagEditor({ tags, onChange }: TagEditorProps) {
  const [inputValue, setInputValue] = useState('')
  const [adding, setAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addTag = useCallback(
    (raw: string) => {
      const tag = raw.trim().replace(/^#/, '')
      if (tag && !tags.includes(tag)) {
        onChange([...tags, tag])
      }
      setInputValue('')
    },
    [tags, onChange]
  )

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (inputValue.trim()) {
        addTag(inputValue)
      } else {
        setAdding(false)
      }
    }
    if (e.key === 'Escape') {
      setInputValue('')
      setAdding(false)
    }
    if (e.key === 'Backspace' && inputValue === '' && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1" style={{ verticalAlign: 'middle' }}>
      {tags.map((tag) => (
        <span key={tag} style={pillStyle} className="group">
          {tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            className="ml-1 focus:outline-none"
            style={{
              color: colors.text.muted,
              fontSize: '9px',
              lineHeight: 1,
              opacity: 0.6
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.6'
            }}
            aria-label={`Remove tag ${tag}`}
          >
            {'\u00D7'}
          </button>
        </span>
      ))}
      {adding ? (
        <input
          ref={inputRef}
          autoFocus
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (inputValue.trim()) addTag(inputValue)
            setAdding(false)
          }}
          className="bg-transparent border-0 outline-none"
          style={{
            color: colors.text.secondary,
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            width: `${Math.max((inputValue.length || 4) + 1, 5)}ch`
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true)
            setTimeout(() => inputRef.current?.focus(), 30)
          }}
          style={{
            ...pillStyle,
            color: colors.text.muted,
            cursor: 'pointer',
            border: `1px dashed ${colors.text.muted}40`
          }}
          className="hover:opacity-80 transition-opacity"
        >
          +
        </button>
      )}
    </span>
  )
}

// ── Editable Property Value ──

interface EditableValueProps {
  value: string
  onChange: (value: string) => void
}

function EditableValue({ value, onChange }: EditableValueProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = () => {
    setEditing(false)
    if (draft !== value) onChange(draft)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
        className="bg-transparent border-0 outline-none"
        style={{
          color: colors.text.secondary,
          fontFamily: 'var(--font-mono)',
          fontSize: '11px'
        }}
      />
    )
  }

  return (
    <span
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      style={{ color: colors.text.secondary, cursor: 'text' }}
    >
      {value || '\u00A0'}
    </span>
  )
}

// ── Add Property ──

const SUGGESTED_PROPERTIES = [
  'tags',
  'type',
  'author',
  'category',
  'source',
  'parent',
  'url',
  'signal',
  'frame'
]

interface AddPropertyButtonProps {
  existingKeys: string[]
  onAdd: (key: string) => void
}

function AddPropertyButton({ existingKeys, onAdd }: AddPropertyButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [customKey, setCustomKey] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const available = SUGGESTED_PROPERTIES.filter(
    (p) => !existingKeys.some((k) => k.toLowerCase() === p.toLowerCase())
  )

  const handleAdd = (key: string) => {
    onAdd(key)
    setIsOpen(false)
    setCustomKey('')
  }

  return (
    <div className="relative" style={{ marginTop: '0.25em' }}>
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen)
          setTimeout(() => inputRef.current?.focus(), 50)
        }}
        className="transition-colors hover:opacity-80 focus:outline-none"
        style={{ color: colors.text.muted, fontSize: '11px', fontFamily: 'var(--font-mono)' }}
      >
        + add property
      </button>

      {isOpen && (
        <div
          className="absolute left-0 top-full mt-1 z-30 rounded-md shadow-lg overflow-hidden"
          style={{
            backgroundColor: colors.bg.elevated,
            border: `1px solid ${colors.border.default}`,
            minWidth: 160
          }}
        >
          <div className="p-1.5">
            <input
              ref={inputRef}
              type="text"
              value={customKey}
              onChange={(e) => setCustomKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customKey.trim()) handleAdd(customKey.trim())
                if (e.key === 'Escape') setIsOpen(false)
              }}
              placeholder="Property name..."
              className="w-full bg-transparent border-0 outline-none text-xs px-1.5 py-1"
              style={{ color: colors.text.primary, fontFamily: 'var(--font-mono)' }}
            />
          </div>
          {available.length > 0 && (
            <div className="border-t" style={{ borderColor: colors.border.default }}>
              {available.map((prop) => (
                <button
                  key={prop}
                  type="button"
                  onClick={() => handleAdd(prop)}
                  className="w-full text-left px-3 py-1.5 text-xs transition-colors hover:opacity-80 focus:outline-none"
                  style={{ color: colors.text.secondary, fontFamily: 'var(--font-mono)' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = colors.bg.surface
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                >
                  {prop}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main FrontmatterHeader ──

interface FrontmatterHeaderProps {
  artifact: Artifact | null
  frontmatter: Readonly<Record<string, string | readonly string[]>> | null
  mode: 'rich' | 'source'
  onNavigate?: (id: string) => void
  onFrontmatterChange?: (newRaw: string) => void
}

export function FrontmatterHeader({
  artifact,
  frontmatter,
  mode,
  onNavigate,
  onFrontmatterChange
}: FrontmatterHeaderProps) {
  if (mode === 'source') return null

  // Build a mutable property map from available data
  const properties: Record<string, string | string[]> = {}
  if (frontmatter) {
    for (const [k, v] of Object.entries(frontmatter)) {
      properties[k] = Array.isArray(v) ? [...v] : String(v)
    }
  }

  const dispatchChange = (updated: Record<string, string | string[]>) => {
    if (!onFrontmatterChange) return
    const raw = serializeFrontmatter(updated)
    onFrontmatterChange(raw)
  }

  const handlePropertyChange = (key: string, value: string | string[]) => {
    const updated = { ...properties, [key]: value }
    dispatchChange(updated)
  }

  const handleAddProperty = (key: string) => {
    const updated = { ...properties, [key]: key.toLowerCase() === 'tags' ? [] : '' }
    dispatchChange(updated)
  }

  // Determine the artifact type for display
  const artifactType = (properties['type'] as string) ?? artifact?.type ?? 'note'
  const typeColor = getArtifactColor(artifactType)

  // Skip title from display (it's the H1)
  const displayKeys = Object.keys(properties).filter((k) => k.toLowerCase() !== 'title')

  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        color: colors.text.muted,
        lineHeight: 1.8,
        maxWidth: '42rem',
        margin: '0 auto',
        marginBottom: '2em'
      }}
      className="px-8 pt-6"
    >
      {/* Type badge with neon border */}
      <div style={{ marginBottom: '0.75em' }}>
        <span
          style={{
            color: typeColor,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontSize: '10px',
            fontWeight: 600,
            border: `1px solid ${typeColor}60`,
            borderRadius: 4,
            padding: '2px 8px',
            display: 'inline-block'
          }}
        >
          {artifactType}
        </span>
      </div>

      {/* Key-value lines: editable */}
      {displayKeys.map((key) => {
        const value = properties[key]
        if (key.toLowerCase() === 'type') return null

        const isTagField = key.toLowerCase() === 'tags'

        if (isTagField) {
          const tagArray = Array.isArray(value)
            ? value.map(String)
            : typeof value === 'string'
              ? value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
              : []
          return (
            <div key={key} style={{ marginTop: '0.4em', marginBottom: '0.2em' }}>
              <div
                style={{
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: '0.3em'
                }}
              >
                {key}
              </div>
              <TagEditor tags={tagArray} onChange={(tags) => handlePropertyChange(key, tags)} />
            </div>
          )
        }

        return (
          <div key={key}>
            <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {key.padEnd(12)}
            </span>
            <EditableValue
              value={Array.isArray(value) ? value.join(', ') : String(value)}
              onChange={(v) => handlePropertyChange(key, v)}
            />
          </div>
        )
      })}

      {/* Relationship section */}
      {artifact && <RelationshipSection artifact={artifact} onNavigate={onNavigate} />}

      {/* Add property */}
      {onFrontmatterChange && (
        <AddPropertyButton existingKeys={Object.keys(properties)} onAdd={handleAddProperty} />
      )}
    </div>
  )
}

// ── Relationship Section ──

const RELATIONSHIP_FIELDS = [
  { key: 'connections', label: 'Connections' },
  { key: 'clusters_with', label: 'Clusters with' },
  { key: 'tensions_with', label: 'Tensions with' },
  { key: 'appears_in', label: 'Appears in' }
] as const

interface RelationshipSectionProps {
  artifact: Artifact
  onNavigate?: (id: string) => void
}

function RelationshipSection({ artifact, onNavigate }: RelationshipSectionProps) {
  const rows = RELATIONSHIP_FIELDS.filter(({ key }) => artifact[key].length > 0)
  if (rows.length === 0) return null

  return (
    <div style={{ marginTop: '0.5em' }}>
      {rows.map(({ key, label }) => (
        <RelationshipRow key={key} label={label} ids={artifact[key]} onNavigate={onNavigate} />
      ))}
    </div>
  )
}

// ── Relationship Row ──

interface RelationshipRowProps {
  label: string
  ids: readonly string[]
  onNavigate?: (id: string) => void
}

function RelationshipRow({ label, ids, onNavigate }: RelationshipRowProps) {
  return (
    <div>
      <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label.padEnd(12)}
      </span>
      {ids.map((id, i) => (
        <span key={id}>
          <span
            onClick={() => onNavigate?.(id)}
            style={{
              color: colors.text.secondary,
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = colors.text.primary
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = colors.text.secondary
            }}
          >
            {id}
          </span>
          {i < ids.length - 1 && <span>, </span>}
        </span>
      ))}
    </div>
  )
}
