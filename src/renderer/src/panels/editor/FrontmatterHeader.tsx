import { useEffect, useRef, useState } from 'react'
import type { Artifact } from '@shared/types'
import { getArtifactColor } from '../../design/tokens'
import { SectionLabel } from '../../design/components/SectionLabel'
import { useVaultStore } from '../../store/vault-store'
import { useEditorStore } from '../../store/editor-store'
import {
  deleteFrontmatterKey,
  parseFrontmatter,
  setFrontmatterValue,
  type PropertyValue
} from './markdown-utils'
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

/**
 * Current raw frontmatter block of the live document. EditorPanel keeps
 * editor-store content in sync on every edit and derives the body from the
 * same store in its onFrontmatterChange handler, so patching against this raw
 * preserves YAML the properties panel cannot represent (nested maps, block
 * scalars, comments) instead of re-serializing a lossy parse.
 */
function currentRawFrontmatter(): string {
  return parseFrontmatter(useEditorStore.getState().content).raw
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildMetadataEntries(artifact: Artifact): readonly MetadataEntry[] {
  const entries: MetadataEntry[] = [
    { label: 'ID', value: artifact.id },
    { label: 'Type', value: artifact.type },
    { label: 'Signal', value: artifact.signal }
  ]
  // created/modified are optional (no fabricated dates) — omit the row when absent
  if (artifact.created) entries.push({ label: 'Created', value: artifact.created })
  if (artifact.modified) entries.push({ label: 'Modified', value: artifact.modified })
  if (artifact.frame) entries.push({ label: 'Frame', value: artifact.frame })
  if (artifact.source) entries.push({ label: 'Source', value: artifact.source })
  if (artifact.tags.length > 0) entries.push({ label: 'Tags', value: artifact.tags.join(', ') })
  return entries
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
    <div className="te-frontmatter-addprop">
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen)
          setTimeout(() => inputRef.current?.focus(), 50)
        }}
        className="te-frontmatter-addprop-trigger"
      >
        + add property
      </button>

      {isOpen && (
        <div className="te-frontmatter-addprop-menu">
          <div className="te-frontmatter-addprop-field">
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
              className="te-frontmatter-addprop-input"
            />
          </div>
          {available.length > 0 && (
            <div className="te-frontmatter-addprop-divider">
              {available.map((prop) => (
                <button
                  key={prop}
                  type="button"
                  onClick={() => handleAdd(prop)}
                  className="te-frontmatter-addprop-item"
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
      className="fm-property-row te-frontmatter-prop-row"
      data-first={isFirst ? 'true' : undefined}
    >
      <div className="te-frontmatter-row-label">
        {editable && (
          <button
            type="button"
            onClick={onDelete}
            className="fm-property-row__delete te-frontmatter-prop-delete"
            aria-label={`Delete property ${propKey}`}
          >
            {'\u00D7'}
          </button>
        )}
        <span className="te-frontmatter-prop-key">{formatPropertyLabel(propKey)}</span>
        {editable && (
          <TypeBadge
            type={pType}
            onTypeChange={(newType) => {
              const converted = convertValue(value, newType)
              onTypeChange(newType)
              onChange(converted)
            }}
          />
        )}
      </div>
      <div className="te-frontmatter-row-value">{renderInput()}</div>
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

  const handlePropertyChange = (key: string, value: PropertyValue) => {
    if (!onFrontmatterChange) return
    onFrontmatterChange(setFrontmatterValue(currentRawFrontmatter(), key, value))
  }

  const handleDeleteProperty = (key: string) => {
    if (!onFrontmatterChange) return
    onFrontmatterChange(deleteFrontmatterKey(currentRawFrontmatter(), key))
  }

  const handleAddProperty = (key: string) => {
    if (!onFrontmatterChange) return
    const lower = key.toLowerCase()
    const defaultValue: PropertyValue =
      lower === 'tags' ? [] : lower === 'draft' ? false : lower === 'order' ? 0 : ''
    onFrontmatterChange(setFrontmatterValue(currentRawFrontmatter(), key, defaultValue))
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
    <div className="te-frontmatter">
      {/* Console-direction type pill: square 2px radius, hairline border, mono caps */}
      <div className="te-frontmatter-type-pill-row">
        <span
          className="te-frontmatter-type-pill"
          style={{
            border: `1px solid ${typeColor}60`,
            backgroundColor: `${typeColor}10`,
            color: typeColor
          }}
        >
          <span className="te-frontmatter-type-pill__key">type</span>
          <span style={{ color: typeColor }}>{artifactType}</span>
        </span>
      </div>

      {/* Origin indicator (only for source/agent) */}
      {artifact?.origin && artifact.origin !== 'human' && (
        <div className="te-frontmatter-origin">
          <span className="te-frontmatter-origin__kind">
            {artifact.origin === 'source' ? 'source material' : 'agent-compiled'}
          </span>
          {artifact.sources.length > 0 && (
            <span className="te-frontmatter-origin__from">
              from{' '}
              {artifact.sources.map((src, i) => (
                <span key={src}>
                  {i > 0 && ', '}
                  <span
                    onClick={() => onNavigate?.(src)}
                    className="te-frontmatter-source-link"
                    data-nav={onNavigate ? 'true' : undefined}
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
      <div className="te-frontmatter-props">
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
}

function RelationshipSection({
  artifact,
  onNavigate,
  onFrontmatterChange
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
    onFrontmatterChange(setFrontmatterValue(currentRawFrontmatter(), 'connections', [...next]))
  }

  return (
    <div className="te-frontmatter-relationships">
      <SectionLabel as="div" className="te-frontmatter-rel-heading">
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
    <div className="te-frontmatter-rel-row">
      <SectionLabel className="te-frontmatter-rel-row-label">{label}</SectionLabel>
      <div className="te-frontmatter-rel-value">
        {ids.map((id) => (
          <ConnectionPill
            key={id}
            id={id}
            onNavigate={onNavigate}
            onRemove={editable ? () => handleRemove(id) : undefined}
          />
        ))}
        {editable && (
          <div ref={wrapperRef} className="te-frontmatter-addconn">
            <button
              type="button"
              onClick={() => setAddOpen((v) => !v)}
              className="te-frontmatter-addconn-trigger"
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
  return (
    <span
      className="fm-connection-pill te-frontmatter-connection-pill"
      data-nav={onNavigate ? 'true' : undefined}
      data-remove={onRemove ? 'true' : undefined}
    >
      <span className="fm-connection-pill__label" onClick={() => onNavigate?.(id)}>
        {id}
      </span>
      {onRemove && (
        <button
          type="button"
          className="fm-connection-pill__remove"
          aria-label={`Remove connection ${id}`}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          {'\u00D7'}
        </button>
      )}
    </span>
  )
}
