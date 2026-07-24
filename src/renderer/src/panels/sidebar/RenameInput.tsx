import { useCallback, useEffect, useRef, useState } from 'react'

interface RenameInputProps {
  initialValue: string
  onConfirm: (newName: string) => void
  onCancel: () => void
}

export function RenameInput({ initialValue, onConfirm, onCancel }: RenameInputProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    // Select the name without extension
    const dotIdx = initialValue.lastIndexOf('.')
    el.setSelectionRange(0, dotIdx > 0 ? dotIdx : initialValue.length)
  }, [initialValue])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        const trimmed = value.trim()
        if (trimmed && trimmed !== initialValue) {
          onConfirm(trimmed)
        } else {
          onCancel()
        }
      }
      if (e.key === 'Escape') {
        onCancel()
      }
    },
    [value, initialValue, onConfirm, onCancel]
  )

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={onCancel}
      className="te-rename-input"
    />
  )
}
