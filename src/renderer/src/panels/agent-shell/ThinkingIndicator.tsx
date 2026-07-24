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

export function ThinkingIndicator() {
  return (
    <div role="status" data-testid="thinking-indicator" className="te-thinking">
      {DOT_DELAYS.map((delay) => (
        <span
          key={delay}
          aria-hidden
          className="te-pulse-thinking-dot"
          style={{ animationDelay: delay }}
        />
      ))}
      <span className="te-thinking-sr">Machina is thinking</span>
    </div>
  )
}
