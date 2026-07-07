import type { CSSProperties } from 'react'
import { colors } from '../../design/tokens'

/**
 * In-thread "thinking" affordance for a turn that is in flight with no
 * assistant output yet: three muted dots pulsing on a staggered cycle.
 *
 * Mount point (ThreadPanel's InflightAssistant) is owned by another track;
 * this component is standalone and takes no props on purpose — render it
 * in place of the empty assistant body when
 * `inFlightByThreadId[threadId] && !hasText && !hasTools`.
 *
 * Reuses the existing `te-pulse` keyframe (index.css). The class name
 * contains `te-pulse` so the app's prefers-reduced-motion rule
 * (`[class*='te-pulse']`) neutralizes the animation.
 */

const DOT_DELAYS = ['0s', '0.2s', '0.4s'] as const

const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0
}

export function ThinkingIndicator() {
  return (
    <div
      role="status"
      data-testid="thinking-indicator"
      style={{ display: 'flex', alignItems: 'center', gap: 5, minHeight: 18 }}
    >
      {DOT_DELAYS.map((delay) => (
        <span
          key={delay}
          aria-hidden
          className="te-pulse-thinking-dot"
          style={{
            display: 'inline-block',
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: colors.text.muted,
            animation: 'te-pulse 1.4s ease-in-out infinite',
            animationDelay: delay
          }}
        />
      ))}
      <span style={visuallyHidden}>Machina is thinking</span>
    </div>
  )
}
