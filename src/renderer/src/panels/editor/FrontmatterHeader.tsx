import { useEffect, useRef, useState } from 'react'
import type { Artifact } from '@shared/types'
import { borderRadius, colors, getArtifactColor, typography } from '../../design/tokens'
import { SectionLabel } from '../../design/components/SectionLabel'
import { useVaultStore } from '../../store/vault-store'
import { serializeFrontmatter, type PropertyValue } from './markdown-utils'
import { ConnectionAutocomplete } from './ConnectionAutocomplete'
import {
  inferPropertyType,
  convertValue,
  BooleanInput,
  NumberInput,
  DateInput,
  ListInput,
  TextInput,
  TypeBadge,
  type PropertyType
} from './PropertyInputs'

// ── Types ──

interface MetadataEntry {
  readonly label: string
  readonly value: string
}

function formatPropertyLabel(key: string): string {
  return key.replace(/_/g, ' ')
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

// ── Shared styles ──

// Console-direction pill: hairline-square (radius 2), mono 10px, surface bg.
// Key/value pills use the `colors.text.muted` → `colors.text.primary` pattern
// applied at the call site; this base only carries chrome.
const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  fontFamily: typography.fontFamily.mono,
  fontSize: '10px',
  fontWeight: 500,
  letterSpacing: '0.08em',
  borderRadius: borderRadius.inline,
  padding: '2px 8px',
  border: `1px solid ${colors.border.default}`,
  backgroundColor: 'var(--color-bg-surface)',
  color: colors.text.primary,
  lineHeight: 1.4
}

const sectionLabelStyle: React.CSSProperties = {
  textTransform: typography.metadata.textTransform,
  letterSpacing: typography.metadata.letterSpacing,
  fontSize: typography.metadata.size,
  fontWeight: 600,
  color: colors.text.muted
}

const rowLabelStyle: React.CSSProperties = {
  ...sectionLabelStyle,
  display: 'flex',
  alignItems: 'center',
  gap: '0.35rem'
}

const rowValueStyle: React.CSSProperties = {
  color: colors.text.secondary,
  minHeight: 22,
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.4rem'
}

// ── Wikilink display helper ──

/** Strip [[brackets]] from display text while preserving raw value for editing */
function stripWikilinks(text: string): string {
  return text.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
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
          className="absolute left-0 top-full mt-1 z-30 shadow-lg overflow-hidden"
          style={{
            backgroundColor: colors.bg.elevated,
            border: `1px solid ${colors.border.default}`,
            borderRadius: borderRadius.inline,
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

// ── Typed Property Row ──

interface PropertyRowProps {
  propKey: string
  value: PropertyValue
  editable: boolean
  onChange: (value: PropertyValue) => void
  onDelete: () => void
  onTypeChange: (type: PropertyType) => void
  isFirst: boolean
}

function PropertyRow({
  propKey,
  value,
  editable,
  onChange,
  onDelete,
  onTypeChange,
  isFirst
}: PropertyRowProps) {
  const [hovered, setHovered] = useState(false)
  const pType = inferPropertyType(propKey, value)

  const renderInput = () => {
    switch (pType) {
      case 'boolean':
        return <BooleanInput value={value as boolean} onChange={(v) => onChange(v)} />
      case 'number':
        return <NumberInput value={value as number} onChange={(v) => onChange(v)} />
      case 'date':
        return <DateInput value={String(value)} onChange={(v) => onChange(v)} />
      case 'list': {
        const arr = Array.isArray(value)
          ? value.map(String)
          : typeof value === 'string'
            ? value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : []
        return <ListInput value={arr} onChange={(v) => onChange(v)} />
      }
      case 'text':
      default: {
        const raw = Array.isArray(value) ? value.join(', ') : String(value)
        return (
          <TextInput value={raw} displayValue={stripWikilinks(raw)} onChange={(v) => onChange(v)} />
        )
      }
    }
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(110px, 150px) minmax(0, 1fr)',
        columnGap: '1rem',
        alignItems: 'center',
        paddingTop: isFirst ? 0 : '0.1rem'
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={rowLabelStyle}>
        {editable && (
          <button
            type="button"
            onClick={onDelete}
            className="focus:outline-none transition-opacity"
            style={{
              color: colors.text.muted,
              fontSize: '9px',
              lineHeight: 1,
              opacity: hovered ? 0.7 : 0,
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              padding: 0,
              flexShrink: 0
            }}
            aria-label={`Delete property ${propKey}`}
          >
            {'\u00D7'}
          </button>
        )}
        <span style={{ flex: 1 }}>{formatPropertyLabel(propKey)}</span>
        {editable && (
          <TypeBadge
            type={pType}
            visible={hovered}
            onTypeChange={(newType) => {
              const converted = convertValue(value, newType)
              onTypeChange(newType)
              onChange(converted)
            }}
          />
        )}
      </div>
      <div style={rowValueStyle}>{renderInput()}</div>
    </div>
  )
}

// ── Main FrontmatterHeader ──

interface FrontmatterHeaderProps {
  artifact: Artifact | null
  frontmatter: Readonly<Record<string, PropertyValue>> | null
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
  const properties: Record<string, PropertyValue> = {}
  if (frontmatter) {
    for (const [k, v] of Object.entries(frontmatter)) {
      properties[k] = Array.isArray(v) ? [...v] : v
    }
  }

  const editable = !!onFrontmatterChange

  const dispatchChange = (updated: Record<string, PropertyValue>) => {
    if (!onFrontmatterChange) return
    const raw = serializeFrontmatter(updated)
    onFrontmatterChange(raw)
  }

  const handlePropertyChange = (key: string, value: PropertyValue) => {
    dispatchChange({ ...properties, [key]: value })
  }

  const handleDeleteProperty = (key: string) => {
    const updated = { ...properties }
    delete updated[key]
    dispatchChange(updated)
  }

  const handleAddProperty = (key: string) => {
    const lower = key.toLowerCase()
    const defaultValue: PropertyValue =
      lower === 'tags' ? [] : lower === 'draft' ? false : lower === 'order' ? 0 : ''
    dispatchChange({ ...properties, [key]: defaultValue })
  }

  // Determine the artifact type for display
  const artifactType =
    typeof properties['type'] === 'string' ? properties['type'] : (artifact?.type ?? 'note')
  const typeColor = getArtifactColor(artifactType)

  // Skip title and relationship fields from generic display (handled by RelationshipSection)
  const RELATIONSHIP_KEYS = new Set([
    'title',
    'connections',
    'clusters_with',
    'tensions_with',
    'appears_in',
    'related'
  ])
  const displayKeys = Object.keys(properties).filter(
    (k) => !RELATIONSHIP_KEYS.has(k.toLowerCase()) && k.toLowerCase() !== 'type'
  )

  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        color: colors.text.muted,
        lineHeight: 1.7,
        maxWidth: '52rem',
        margin: '0 auto',
        marginBottom: '2.25em'
      }}
      className="px-8 pt-5"
    >
      {/* Console-direction type pill: square 2px radius, hairline border, mono caps */}
      <div style={{ marginBottom: '1rem' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontFamily: typography.fontFamily.mono,
            textTransform: 'uppercase',
            letterSpacing: typography.metadata.letterSpacing,
            fontSize: typography.metadata.size,
            fontWeight: 600,
            border: `1px solid ${typeColor}60`,
            borderRadius: borderRadius.inline,
            padding: '2px 8px',
            backgroundColor: `${typeColor}10`,
            color: typeColor
          }}
        >
          <span style={{ color: colors.text.muted }}>type</span>
          <span style={{ color: typeColor }}>{artifactType}</span>
        </span>
      </div>

      {/* Origin indicator (only for source/agent) */}
      {artifact?.origin && artifact.origin !== 'human' && (
        <div
          style={{
            marginTop: '0.5rem',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: colors.text.muted,
            letterSpacing: '0.08em'
          }}
        >
          <span style={{ textTransform: 'uppercase' }}>
            {artifact.origin === 'source' ? 'source material' : 'agent-compiled'}
          </span>
          {artifact.sources.length > 0 && (
            <span style={{ marginLeft: '0.75rem', color: colors.text.secondary }}>
              from{' '}
              {artifact.sources.map((src, i) => (
                <span key={src}>
                  {i > 0 && ', '}
                  <span
                    onClick={() => onNavigate?.(src)}
                    style={{
                      cursor: onNavigate ? 'pointer' : 'default',
                      textDecoration: 'underline',
                      textDecorationColor: `${colors.text.muted}40`,
                      textUnderlineOffset: '2px'
                    }}
                    onMouseEnter={(e) => {
                      if (onNavigate) e.currentTarget.style.color = colors.text.primary
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = colors.text.secondary
                    }}
                  >
                    {src}
                  </span>
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      {/* Key-value lines: typed editing */}
      <div
        style={{
          display: 'grid',
          gap: '0.55rem',
          borderTop: `1px solid ${colors.border.default}`,
          paddingTop: '0.9rem'
        }}
      >
        {displayKeys.map((key, index) => (
          <PropertyRow
            key={key}
            propKey={key}
            value={properties[key]}
            editable={editable}
            onChange={(v) => handlePropertyChange(key, v)}
            onDelete={() => handleDeleteProperty(key)}
            onTypeChange={() => {
              /* type change handled via convertValue in PropertyRow */
            }}
            isFirst={index === 0}
          />
        ))}
      </div>

      {/* Relationship section */}
      {artifact && (
        <RelationshipSection
          artifact={artifact}
          onNavigate={onNavigate}
          onFrontmatterChange={onFrontmatterChange}
          currentProperties={properties}
        />
      )}

      {/* Add property */}
      {editable && (
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
  { key: 'appears_in', label: 'Appears in' },
  { key: 'related', label: 'Related' }
] as const

interface RelationshipSectionProps {
  artifact: Artifact
  onNavigate?: (id: string) => void
  onFrontmatterChange?: (newRaw: string) => void
  currentProperties: Record<string, PropertyValue>
}

function RelationshipSection({
  artifact,
  onNavigate,
  onFrontmatterChange,
  currentProperties
}: RelationshipSectionProps) {
  const editable = !!onFrontmatterChange
  const connectionsEditable = editable
  const artifacts = useVaultStore((s) => s.artifacts)

  // Rows with content always render. When editable, always render the Connections row
  // (even when empty) so users have an entry point to add the first connection.
  const rows = RELATIONSHIP_FIELDS.filter(({ key }) => {
    if (key === 'connections' && connectionsEditable) return true
    return artifact[key].length > 0
  })
  if (rows.length === 0) return null

  const handleConnectionsChange = (next: readonly string[]) => {
    if (!onFrontmatterChange) return
    const updated = { ...currentProperties, connections: [...next] }
    onFrontmatterChange(serializeFrontmatter(updated))
  }

  return (
    <div
      style={{
        marginTop: '1.1rem',
        paddingTop: '0.9rem',
        borderTop: `1px solid ${colors.border.default}`
      }}
    >
      <SectionLabel as="div" style={{ marginBottom: '0.7rem' }}>
        Relationships
      </SectionLabel>
      {rows.map(({ key, label }) => {
        const editableRow = key === 'connections' && connectionsEditable
        return (
          <RelationshipRow
            key={key}
            label={label}
            ids={artifact[key]}
            onNavigate={onNavigate}
            onChange={editableRow ? handleConnectionsChange : undefined}
            currentArtifactId={artifact.id}
            artifacts={artifacts}
          />
        )
      })}
    </div>
  )
}

// ── Relationship Row ──

interface RelationshipRowProps {
  label: string
  ids: readonly string[]
  onNavigate?: (id: string) => void
  onChange?: (next: readonly string[]) => void
  currentArtifactId: string
  artifacts: readonly Artifact[]
}

function RelationshipRow({
  label,
  ids,
  onNavigate,
  onChange,
  currentArtifactId,
  artifacts
}: RelationshipRowProps) {
  const editable = !!onChange
  const [addOpen, setAddOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!addOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setAddOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [addOpen])

  const handleRemove = (id: string) => {
    if (!onChange) return
    onChange(ids.filter((existing) => existing !== id))
  }

  const handleAdd = (connectionValue: string) => {
    if (!onChange) return
    if (ids.includes(connectionValue)) {
      setAddOpen(false)
      return
    }
    onChange([...ids, connectionValue])
    setAddOpen(false)
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(110px, 136px) minmax(0, 1fr)',
        columnGap: '1rem',
        alignItems: 'center',
        marginBottom: '0.55rem'
      }}
    >
      <SectionLabel
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem'
        }}
      >
        {label}
      </SectionLabel>
      <div style={{ ...rowValueStyle, gap: '0.45rem' }}>
        {ids.map((id) => (
          <ConnectionPill
            key={id}
            id={id}
            onNavigate={onNavigate}
            onRemove={editable ? () => handleRemove(id) : undefined}
          />
        ))}
        {editable && (
          <div ref={wrapperRef} className="relative" style={{ display: 'inline-block' }}>
            <button
              type="button"
              onClick={() => setAddOpen((v) => !v)}
              className="transition-colors hover:opacity-80 focus:outline-none"
              style={{
                color: colors.text.muted,
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                background: 'none',
                border: 'none',
                padding: '2px 4px',
                cursor: 'pointer'
              }}
            >
              + add connection
            </button>
            {addOpen && (
              <ConnectionAutocomplete
                artifacts={artifacts}
                currentArtifactId={currentArtifactId}
                existingConnections={ids}
                onSelect={handleAdd}
                onClose={() => setAddOpen(false)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

interface ConnectionPillProps {
  id: string
  onNavigate?: (id: string) => void
  onRemove?: () => void
}

function ConnectionPill({ id, onNavigate, onRemove }: ConnectionPillProps) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)

  return (
    <span
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...pillStyle,
        position: 'relative',
        cursor: onNavigate ? 'pointer' : 'default',
        color: colors.text.secondary,
        paddingRight: onRemove ? '22px' : undefined,
        transition: 'border-color 120ms, color 120ms'
      }}
    >
      <span
        onClick={() => onNavigate?.(id)}
        style={{
          display: 'inline-block',
          transition: 'color 120ms'
        }}
        onMouseEnter={(e) => {
          if (!onNavigate) return
          const parent = e.currentTarget.parentElement
          if (parent) parent.style.borderColor = colors.accent.default
          e.currentTarget.style.color = colors.text.primary
        }}
        onMouseLeave={(e) => {
          const parent = e.currentTarget.parentElement
          if (parent) parent.style.borderColor = colors.border.default
          e.currentTarget.style.color = colors.text.secondary
        }}
      >
        {id}
      </span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove connection ${id}`}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            position: 'absolute',
            right: 6,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            padding: 0,
            margin: 0,
            lineHeight: 1,
            cursor: 'pointer',
            color: colors.text.muted,
            fontSize: '10px',
            opacity: focused ? 1 : hovered ? 0.7 : 0,
            transition: 'opacity 120ms'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = focused ? '1' : hovered ? '0.7' : '0'
          }}
        >
          {'\u00D7'}
        </button>
      )}
    </span>
  )
}
