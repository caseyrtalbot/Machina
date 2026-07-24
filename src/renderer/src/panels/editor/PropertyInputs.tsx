import { useState, useRef, useCallback, type KeyboardEvent } from 'react'
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

// ── Boolean Input ──

interface BooleanInputProps {
  value: boolean
  onChange: (value: boolean) => void
}

export function BooleanInput({ value, onChange }: BooleanInputProps) {
  return (
    // Console: hairline-square toggle. Track stays subtly hinted (2px) so the
    // moving indicator inside reads as a square block, not a pill.
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="te-prop-toggle"
      data-on={value ? 'true' : undefined}
      aria-label={`Toggle ${value ? 'off' : 'on'}`}
    >
      <span className="te-prop-toggle__knob" />
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
        className="te-prop-input"
        style={{ width: `${Math.max(draft.length + 2, 6)}ch` }}
      />
    )
  }

  return (
    <span
      onClick={() => {
        setDraft(String(value))
        setEditing(true)
      }}
      className="te-prop-num-display"
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
      className="te-prop-input te-prop-date-input"
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

  return (
    // Console-direction list pill: hairline-square, mono 10px, surface bg.
    <span className="te-prop-list">
      {value.map((item) => (
        <span key={item} className="te-prop-pill">
          {item}
          <button
            type="button"
            onClick={() => onChange(value.filter((v) => v !== item))}
            className="te-prop-pill-remove"
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
          className="te-prop-input te-prop-list-input"
          style={{ width: `${Math.max((inputValue.length || 4) + 1, 5)}ch` }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true)
            setTimeout(() => inputRef.current?.focus(), 30)
          }}
          className="te-prop-list-add"
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
        className="te-prop-input"
      />
    )
  }

  return (
    <span
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      className="te-prop-text-display"
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
}

export function TypeBadge({ type, onTypeChange }: TypeBadgeProps) {
  const [open, setOpen] = useState(false)

  return (
    <span className="te-prop-typebadge-wrap">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="fm-type-badge te-prop-typebadge"
        data-open={open ? 'true' : undefined}
        aria-label={`Property type: ${type}. Click to change.`}
      >
        {TYPE_LABELS[type]}
      </button>
      {open && (
        <div className="te-prop-typebadge-menu">
          {ALL_TYPES.filter((t) => t !== type).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                onTypeChange(t)
                setOpen(false)
              }}
              className="te-prop-typebadge-item"
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
