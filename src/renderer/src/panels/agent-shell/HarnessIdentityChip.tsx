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
import { borderRadius, colors, typography } from '../../design/tokens'
import { useHarnessBinding } from './use-harness-binding'

export function HarnessIdentityChip({
  threadId,
  agentId
}: {
  readonly threadId: string
  readonly agentId?: string
}) {
  const lookup = useHarnessBinding(threadId, agentId)
  if (lookup.status !== 'bound') return null
  const slug = lookup.binding.slug
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
