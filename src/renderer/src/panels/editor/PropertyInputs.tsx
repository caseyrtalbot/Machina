import { useState, useRef, useCallback, type KeyboardEvent } from 'react'
import { colors } from '../../design/tokens'
import type { PropertyValue } from './markdown-utils'

// ── Type inference ──

export type PropertyType = 'text' | 'number' | 'boolean' | 'date' | 'list'

const DATE_KEYS = new Set([
  'date',
  'created',
  'modified',
  'published',
  'updated',
  'due',
  'deadline'
])

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// eslint-disable-next-line react-refresh/only-export-components
export function inferPropertyType(key: string, value: PropertyValue): PropertyType {
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') {
    if (DATE_KEYS.has(key.toLowerCase()) || ISO_DATE_RE.test(value)) return 'date'
  }
  return 'text'
}

// eslint-disable-next-line react-refresh/only-export-components
export function convertValue(value: PropertyValue, toType: PropertyType): PropertyValue {
  switch (toType) {
    case 'boolean':
      if (typeof value === 'boolean') return value
      if (typeof value === 'number') return value !== 0
      return String(value).toLowerCase() === 'true'
    case 'number':
      if (typeof value === 'number') return value
      if (typeof value === 'boolean') return value ? 1 : 0
      return Number(String(value)) || 0
    case 'date':
      return typeof value === 'string' ? value : String(value)
    case 'list':
      if (Array.isArray(value)) return value
      return String(value)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    case 'text':
    default:
      if (Array.isArray(value)) return value.join(', ')
      return String(value)
  }
}

// ── Shared styles ──

const inputStyle: React.CSSProperties = {
  color: colors.text.secondary,
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  background: 'transparent',
  border: 0
}

// ── Boolean Input ──

interface BooleanInputProps {
  value: boolean
  onChange: (value: boolean) => void
}

export function BooleanInput({ value, onChange }: BooleanInputProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="transition-colors"
      style={{
        width: 30,
        height: 16,
        borderRadius: 8,
        border: `1px solid ${colors.border.default}`,
        backgroundColor: value ? `${colors.accent.default}40` : 'rgba(255, 255, 255, 0.04)',
        position: 'relative',
        cursor: 'pointer',
        padding: 0
      }}
      aria-label={`Toggle ${value ? 'off' : 'on'}`}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: value ? 14 : 2,
          width: 10,
          height: 10,
          borderRadius: '50%',
          backgroundColor: value ? colors.accent.default : colors.text.muted,
          transition: 'left 0.15s ease'
        }}
      />
    </button>
  )
}

// ── Number Input ──

interface NumberInputProps {
  value: number
  onChange: (value: number) => void
}

export function NumberInput({ value, onChange }: NumberInputProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))

  const commit = () => {
    setEditing(false)
    const parsed = Number(draft)
    if (!isNaN(parsed) && parsed !== value) onChange(parsed)
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setDraft(String(value))
            setEditing(false)
          }
        }}
        style={{ ...inputStyle, width: `${Math.max(draft.length + 2, 6)}ch` }}
      />
    )
  }

  return (
    <span
      onClick={() => {
        setDraft(String(value))
        setEditing(true)
      }}
      style={{
        color: colors.text.secondary,
        cursor: 'text',
        minHeight: 22,
        display: 'flex',
        alignItems: 'center',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px'
      }}
    >
      {value}
    </span>
  )
}

// ── Date Input ──

interface DateInputProps {
  value: string
  onChange: (value: string) => void
}

export function DateInput({ value, onChange }: DateInputProps) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => {
        if (e.target.value !== value) onChange(e.target.value)
      }}
      style={{
        ...inputStyle,
        colorScheme: 'dark',
        cursor: 'pointer'
      }}
    />
  )
}

// ── List Input (Tag Pills) ──

interface ListInputProps {
  value: readonly string[]
  onChange: (value: string[]) => void
}

export function ListInput({ value, onChange }: ListInputProps) {
  const [inputValue, setInputValue] = useState('')
  const [adding, setAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addItem = useCallback(
    (raw: string) => {
      const item = raw.trim().replace(/^#/, '')
      if (item && !value.includes(item)) {
        onChange([...value, item])
      }
      setInputValue('')
    },
    [value, onChange]
  )

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (inputValue.trim()) {
        addItem(inputValue)
      } else {
        setAdding(false)
      }
    }
    if (e.key === 'Escape') {
      setInputValue('')
      setAdding(false)
    }
    if (e.key === 'Backspace' && inputValue === '' && value.length > 0) {
      onChange([...value.slice(0, -1)])
    }
  }

  const pillStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    fontWeight: 500,
    letterSpacing: '0.08em',
    borderRadius: 999,
    padding: '2px 8px',
    border: `1px solid ${colors.border.default}`,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    color: colors.text.primary,
    lineHeight: 1.4
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1" style={{ verticalAlign: 'middle' }}>
      {value.map((item) => (
        <span key={item} style={pillStyle}>
          {item}
          <button
            type="button"
            onClick={() => onChange(value.filter((v) => v !== item))}
            className="ml-1 focus:outline-none"
            style={{ color: colors.text.muted, fontSize: '9px', lineHeight: 1, opacity: 0.6 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.6'
            }}
            aria-label={`Remove ${item}`}
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
            if (inputValue.trim()) addItem(inputValue)
            setAdding(false)
          }}
          className="bg-transparent border-0 outline-none"
          style={{
            ...inputStyle,
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
          aria-label="Add item"
        >
          +
        </button>
      )}
    </span>
  )
}

// ── Text Input (click-to-edit) ──

interface TextInputProps {
  value: string
  displayValue?: string
  onChange: (value: string) => void
}

export function TextInput({ value, displayValue, onChange }: TextInputProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const commit = () => {
    setEditing(false)
    if (draft !== value) onChange(draft)
  }

  if (editing) {
    return (
      <input
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
        style={inputStyle}
      />
    )
  }

  return (
    <span
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      style={{
        color: colors.text.secondary,
        minHeight: 22,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.4rem',
        cursor: 'text'
      }}
    >
      {(displayValue ?? value) || '\u00A0'}
    </span>
  )
}

// ── Type Badge ──

const TYPE_LABELS: Record<PropertyType, string> = {
  text: 'txt',
  number: 'num',
  boolean: 'bool',
  date: 'date',
  list: 'list'
}

const ALL_TYPES: PropertyType[] = ['text', 'number', 'boolean', 'date', 'list']

interface TypeBadgeProps {
  type: PropertyType
  onTypeChange: (type: PropertyType) => void
  visible?: boolean
}

export function TypeBadge({ type, onTypeChange, visible = true }: TypeBadgeProps) {
  const [open, setOpen] = useState(false)
  const triggerVisible = visible || open

  return (
    <span className="relative" style={{ display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '8px',
          letterSpacing: '0.1em',
          color: colors.text.muted,
          opacity: triggerVisible ? 0.5 : 0,
          pointerEvents: triggerVisible ? 'auto' : 'none',
          textTransform: 'uppercase',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0 2px',
          transition: 'opacity 120ms'
        }}
        className="hover:opacity-100"
        aria-label={`Property type: ${type}. Click to change.`}
        aria-hidden={!triggerVisible}
        tabIndex={triggerVisible ? 0 : -1}
      >
        {TYPE_LABELS[type]}
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-40 rounded shadow-lg overflow-hidden"
          style={{
            backgroundColor: colors.bg.elevated,
            border: `1px solid ${colors.border.default}`,
            minWidth: 56
          }}
        >
          {ALL_TYPES.filter((t) => t !== type).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                onTypeChange(t)
                setOpen(false)
              }}
              className="w-full text-left px-2 py-1 transition-colors hover:opacity-80 focus:outline-none"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                color: colors.text.secondary,
                background: 'none',
                border: 'none',
                cursor: 'pointer'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = colors.bg.surface
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
              }}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
