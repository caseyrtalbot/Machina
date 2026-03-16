import { useState, useRef, useCallback, type KeyboardEvent } from 'react'
import type { Artifact } from '@shared/types'
import { colors, transitions } from '../../design/tokens'
import { getArtifactColor } from '../../design/tokens'
import { serializeFrontmatter } from './markdown-utils'

// ── Types ──

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
    { label: 'Modified', value: artifact.modified }
  ]
  if (artifact.frame) entries.push({ label: 'Frame', value: artifact.frame })
  if (artifact.source) entries.push({ label: 'Source', value: artifact.source })
  if (artifact.tags.length > 0) entries.push({ label: 'Tags', value: artifact.tags.join(', ') })
  return entries
}

// ── Property field icons ──

const PROPERTY_ICONS: Record<string, string> = {
  title: '\u2261',
  id: '\u2261',
  type: '\u2261',
  signal: '\u2261',
  created: '\u2261',
  modified: '\u2261',
  author: '\u2261',
  category: '\u2261',
  source: '\u2261',
  frame: '\u2261',
  url: '\u2261',
  parent: '\u2261',
  tags: '\uD83C\uDFF7\uFE0F'
}

function getPropertyIcon(key: string): string {
  return PROPERTY_ICONS[key.toLowerCase()] ?? '\u2261'
}

// ── Tag Chip ──

interface TagChipProps {
  tag: string
  onRemove?: () => void
}

function TagChip({ tag, onRemove }: TagChipProps) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
      style={{
        color: '#f59e0b',
        border: '1px solid rgba(245, 158, 11, 0.3)',
        transition: transitions.default
      }}
    >
      {tag}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="ml-0.5 hover:opacity-70 transition-opacity focus:outline-none"
          style={{ color: '#f59e0b', fontSize: '10px', lineHeight: 1 }}
          aria-label={`Remove tag ${tag}`}
        >
          {'\u00D7'}
        </button>
      )}
    </span>
  )
}

// ── Tag Input ──

interface TagInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
}

function TagInput({ tags, onChange }: TagInputProps) {
  const [inputValue, setInputValue] = useState('')
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
      addTag(inputValue)
    }
    if (e.key === 'Backspace' && inputValue === '' && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1 min-h-[28px] cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag) => (
        <TagChip key={tag} tag={tag} onRemove={() => onChange(tags.filter((t) => t !== tag))} />
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (inputValue.trim()) addTag(inputValue)
        }}
        placeholder={tags.length === 0 ? 'Add tag...' : ''}
        className="bg-transparent border-0 outline-none text-xs min-w-[60px] flex-1"
        style={{ color: colors.text.primary }}
      />
    </div>
  )
}

// ── Editable Property Row ──

interface PropertyRowProps {
  propKey: string
  value: string | readonly string[]
  onChangeValue: (value: string | string[]) => void
  onRemove: () => void
}

function PropertyRow({ propKey, value, onChangeValue, onRemove }: PropertyRowProps) {
  const isTagField = propKey.toLowerCase() === 'tags'
  const icon = getPropertyIcon(propKey)

  const labelStyle = {
    color: colors.text.muted,
    fontSize: '11px',
    letterSpacing: '0.05em',
    textTransform: 'uppercase' as const,
    fontFamily: 'var(--font-mono)'
  }

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
      <div className="flex items-start gap-3 py-1 group">
        <span className="shrink-0" style={{ ...labelStyle, minWidth: 80 }}>
          {propKey}
        </span>
        <div className="flex-1">
          <TagInput tags={tagArray} onChange={(tags) => onChangeValue(tags)} />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 text-xs transition-opacity focus:outline-none shrink-0"
          style={{ color: colors.text.muted }}
          aria-label={`Remove ${propKey}`}
        >
          {'\u00D7'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 py-1 group">
      <span className="shrink-0" style={{ ...labelStyle, minWidth: 80 }}>
        {propKey}
      </span>
      <input
        type="text"
        value={Array.isArray(value) ? value.join(', ') : String(value)}
        onChange={(e) => onChangeValue(e.target.value)}
        className="flex-1 bg-transparent border-0 outline-none text-xs"
        style={{ color: colors.text.secondary }}
      />
      <button
        type="button"
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 text-xs transition-opacity focus:outline-none shrink-0"
        style={{ color: colors.text.muted }}
        aria-label={`Remove ${propKey}`}
      >
        {'\u00D7'}
      </button>
    </div>
  )
}

// ── Add Property Dropdown ──

interface AddPropertyButtonProps {
  existingKeys: string[]
  onAdd: (key: string) => void
}

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
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen)
          setTimeout(() => inputRef.current?.focus(), 50)
        }}
        className="flex items-center gap-1 text-xs py-1 transition-colors hover:opacity-80 focus:outline-none"
        style={{ color: colors.text.muted }}
      >
        <span>+</span>
        <span>Add property</span>
      </button>

      {isOpen && (
        <div
          className="absolute left-0 top-full mt-1 z-30 rounded-md shadow-lg overflow-hidden"
          style={{
            backgroundColor: colors.bg.elevated,
            border: `1px solid ${colors.border.default}`,
            minWidth: 180
          }}
        >
          <div className="p-1.5">
            <input
              ref={inputRef}
              type="text"
              value={customKey}
              onChange={(e) => setCustomKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customKey.trim()) {
                  handleAdd(customKey.trim())
                }
                if (e.key === 'Escape') setIsOpen(false)
              }}
              placeholder="Property name..."
              className="w-full bg-transparent border-0 outline-none text-xs px-1.5 py-1"
              style={{ color: colors.text.primary }}
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
                  style={{ color: colors.text.secondary }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = colors.bg.surface
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                >
                  <span style={{ color: colors.text.muted, marginRight: 6 }}>
                    {getPropertyIcon(prop)}
                  </span>
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
  const [expanded, setExpanded] = useState(true)

  if (mode === 'source') return null

  // Build a mutable property map from available data
  const properties: Record<string, string | string[]> = {}
  if (frontmatter) {
    for (const [k, v] of Object.entries(frontmatter)) {
      properties[k] = Array.isArray(v) ? [...v] : String(v)
    }
  }

  // If no frontmatter at all, show nothing (file will still parse via lenient parser)
  // But provide the "add property" entry point
  const hasProperties = Object.keys(properties).length > 0

  const dispatchChange = (updated: Record<string, string | string[]>) => {
    if (!onFrontmatterChange) return
    const clean: Record<string, string | readonly string[]> = {}
    for (const [k, v] of Object.entries(updated)) {
      if (Array.isArray(v)) {
        clean[k] = v
      } else {
        clean[k] = String(v)
      }
    }
    const raw = serializeFrontmatter(clean)
    onFrontmatterChange(raw)
  }

  const handlePropertyChange = (key: string, value: string | string[]) => {
    const updated = { ...properties, [key]: value }
    dispatchChange(updated)
  }

  const handlePropertyRemove = (key: string) => {
    const updated = { ...properties }
    delete updated[key]
    dispatchChange(updated)
  }

  const handleAddProperty = (key: string) => {
    const updated = { ...properties, [key]: key.toLowerCase() === 'tags' ? [] : '' }
    dispatchChange(updated)
  }

  // Extract tags for display in collapsed header
  const tags: string[] = (() => {
    const raw = properties['tags'] ?? artifact?.tags
    if (!raw) return []
    if (Array.isArray(raw)) return raw.map(String)
    if (typeof raw === 'string') {
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
    return []
  })()

  // Determine the artifact type for the badge
  const artifactType = (properties['type'] as string) ?? artifact?.type ?? 'note'
  const badgeColor = getArtifactColor(artifactType)

  return (
    <div
      style={{
        transition: transitions.default
      }}
    >
      <div className="px-8 pt-4 pb-1" style={{ maxWidth: '48rem', margin: '0 auto' }}>
        {/* Type badge - outlined neon style */}
        <div className="flex items-center gap-2 mb-3">
          <span
            className="inline-flex items-center px-2.5 py-0.5 text-xs font-semibold uppercase"
            style={{
              color: badgeColor,
              border: `1px solid ${badgeColor}60`,
              borderRadius: 4,
              letterSpacing: '0.08em',
              fontSize: '10px'
            }}
          >
            {artifactType}
          </span>

          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="ml-auto text-xs transition-colors focus:outline-none"
            style={{ color: colors.text.muted, transition: transitions.default }}
            title={expanded ? 'Collapse properties' : 'Expand properties'}
          >
            {expanded ? '\u25B4' : '\u25BE'}
          </button>
        </div>

        {/* Tag chips in collapsed view */}
        {!expanded && tags.length > 0 && (
          <div className="flex gap-1 mb-1">
            {tags.map((tag) => (
              <TagChip key={tag} tag={tag} />
            ))}
          </div>
        )}

        {/* Expanded properties */}
        {expanded && (
          <div>
            {hasProperties &&
              Object.entries(properties).map(([key, value]) => (
                <PropertyRow
                  key={key}
                  propKey={key}
                  value={value}
                  onChangeValue={(v) => handlePropertyChange(key, v)}
                  onRemove={() => handlePropertyRemove(key)}
                />
              ))}

            {/* Relationship blocks */}
            {artifact &&
              (artifact.connections.length > 0 ||
                artifact.clusters_with.length > 0 ||
                artifact.tensions_with.length > 0 ||
                artifact.appears_in.length > 0) && (
                <div className="space-y-1.5 pt-2 mt-2">
                  {artifact.connections.length > 0 && (
                    <RelationshipRow
                      label="Connections"
                      ids={artifact.connections}
                      onNavigate={onNavigate}
                    />
                  )}
                  {artifact.clusters_with.length > 0 && (
                    <RelationshipRow
                      label="Clusters with"
                      ids={artifact.clusters_with}
                      onNavigate={onNavigate}
                    />
                  )}
                  {artifact.tensions_with.length > 0 && (
                    <RelationshipRow
                      label="Tensions with"
                      ids={artifact.tensions_with}
                      onNavigate={onNavigate}
                    />
                  )}
                  {artifact.appears_in.length > 0 && (
                    <RelationshipRow
                      label="Appears in"
                      ids={artifact.appears_in}
                      onNavigate={onNavigate}
                    />
                  )}
                </div>
              )}

            <div className="mt-2">
              <AddPropertyButton existingKeys={Object.keys(properties)} onAdd={handleAddProperty} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Relationship Row (read-only) ──

interface RelationshipRowProps {
  label: string
  ids: readonly string[]
  onNavigate?: (id: string) => void
}

function RelationshipRow({ label, ids, onNavigate }: RelationshipRowProps) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="shrink-0 mt-0.5"
        style={{
          color: colors.text.muted,
          minWidth: 80,
          fontSize: '11px',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          fontFamily: 'var(--font-mono)'
        }}
      >
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {ids.map((id) => (
          <span
            key={id}
            onClick={() => onNavigate?.(id)}
            className="inline-flex items-center px-1.5 py-0.5 rounded text-xs cursor-pointer transition-colors"
            style={{
              color: colors.text.secondary,
              backgroundColor: colors.bg.elevated
            }}
          >
            {id}
          </span>
        ))}
      </div>
    </div>
  )
}
