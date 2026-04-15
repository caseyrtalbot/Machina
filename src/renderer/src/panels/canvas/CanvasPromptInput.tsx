import { useState, useRef, useEffect } from 'react'
import { colors, typography } from '../../design/tokens'

interface CanvasPromptInputProps {
  readonly selectedCount: number
  readonly placeholder?: string
  readonly onSubmit: (prompt: string) => void
  readonly onCancel: () => void
}

export function CanvasPromptInput({
  selectedCount,
  placeholder,
  onSubmit,
  onCancel
}: CanvasPromptInputProps): React.ReactElement {
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const scopeHint = selectedCount > 0 ? `${selectedCount} cards selected` : 'vault scope'
  const defaultPlaceholder =
    selectedCount > 0 ? `Ask about ${selectedCount} selected cards...` : 'Ask about vault...'

  const submit = () => {
    const trimmed = text.trim()
    if (trimmed) onSubmit(trimmed)
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 48,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        width: 'min(640px, calc(100% - 80px))',
        backdropFilter: 'blur(12px)',
        backgroundColor: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px'
      }}
    >
      <span
        style={{
          color: colors.text.secondary,
          fontSize: 12,
          opacity: 0.5,
          whiteSpace: 'nowrap'
        }}
      >
        {scopeHint}
      </span>
      <input
        ref={ref}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? defaultPlaceholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          else if (e.key === 'Escape') onCancel()
        }}
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          color: colors.text.primary,
          fontFamily: typography.fontFamily.mono,
          fontSize: 13,
          outline: 'none'
        }}
      />
      <button
        type="button"
        onClick={submit}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = colors.text.primary
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = colors.text.muted
        }}
        style={{
          background: 'none',
          border: 'none',
          color: colors.text.muted,
          fontFamily: typography.fontFamily.mono,
          fontSize: 11,
          cursor: 'pointer',
          padding: 0
        }}
      >
        /ask
      </button>
    </div>
  )
}
