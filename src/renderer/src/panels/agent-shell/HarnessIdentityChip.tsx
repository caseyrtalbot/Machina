/**
 * Harness-identity chip (workstation step 3, contracts §4): the thread's
 * bound harness slug, sourced from MAIN's binding registry — the attribution
 * authority — never from frontmatter agent_id (display-only). Bindings are
 * write-once, but a fresh harness run binds AFTER the thread is created (and
 * this chip has mounted), so the thread's store agentId — set on bind — is
 * the re-fetch signal for that one null→bound transition; the displayed
 * value stays main-binding-sourced. Renders nothing while unbound (ad-hoc
 * threads) or bound under a different workspace root.
 */
import { useEffect, useState } from 'react'
import { borderRadius, colors, typography } from '../../design/tokens'

export function HarnessIdentityChip({
  threadId,
  agentId
}: {
  readonly threadId: string
  readonly agentId?: string
}) {
  // Keyed by threadId so a stale slug never bleeds across a thread switch —
  // the render-time comparison hides it without a setState-in-effect reset.
  const [bound, setBound] = useState<{ threadId: string; slug: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.api.harness.binding(threadId).then((binding) => {
      if (!cancelled && binding !== null) setBound({ threadId, slug: binding.slug })
    })
    return () => {
      cancelled = true
    }
  }, [threadId, agentId])

  const slug = bound !== null && bound.threadId === threadId ? bound.slug : null
  if (slug === null) return null
  return (
    <span
      data-testid="thread-harness-chip"
      title={`Harness: ${slug}. Attribution is bound main-side for this thread.`}
      style={{
        padding: '2px 7px',
        border: `1px solid ${colors.accent.line}`,
        borderRadius: borderRadius.inline,
        color: colors.accent.default,
        background: `color-mix(in srgb, ${colors.accent.default} 8%, transparent)`,
        fontFamily: typography.fontFamily.mono,
        fontSize: 10,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap'
      }}
    >
      harness {slug}
    </span>
  )
}
