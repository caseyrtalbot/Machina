import { useEffect, useRef, useState } from 'react'
import type { AgentIdentity } from '@shared/agent-identity'
import { AgentBadge } from './agent-badge'

// 'cli-raw' appended in workstation step 1: picking it spawns a plain PTY
// (no structured view — the thread input surface disables sending).
const AGENTS: readonly AgentIdentity[] = [
  'machina-native',
  'cli-claude',
  'cli-codex',
  'cli-gemini',
  'cli-raw'
]

export function AgentPicker({
  onPick,
  onCancel
}: {
  readonly onPick: (a: AgentIdentity) => void
  readonly onCancel: () => void
}) {
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => (a + 1) % AGENTS.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => (a - 1 + AGENTS.length) % AGENTS.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onPick(AGENTS[active])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [active, onPick, onCancel])

  return (
    <div ref={ref} role="listbox" className="te-picker">
      {AGENTS.map((a, i) => {
        const isActive = i === active
        return (
          <div
            key={a}
            role="option"
            aria-selected={isActive}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(a)}
            className="te-picker-option"
          >
            <AgentBadge agent={a} compact />
          </div>
        )
      })}
      <div role="option" aria-selected={false} onClick={onCancel} className="te-picker-cancel">
        Cancel
      </div>
    </div>
  )
}
