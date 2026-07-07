/**
 * Flag-chip mapping for the approvals tray (workstation contracts §4).
 * Separate module (not ApprovalsTray.tsx) so the component file only exports
 * components — react-refresh requires it — and tests can cover the mapping
 * without rendering.
 */
import type { PendingChange } from '@shared/git-types'
import { colors } from '../../design/tokens'

export interface FlagChip {
  readonly key: string
  readonly label: string
  readonly color: string
}

/** Chip set per contracts §4 — one chip per tripped flag, plus No rollback. */
export function flagChips(item: PendingChange): readonly FlagChip[] {
  const chips: FlagChip[] = []
  if (item.kind === 'cli-change' && !item.revertible) {
    chips.push({ key: 'no-rollback', label: 'No rollback', color: colors.claude.error })
  }
  if (item.flags.forbidden) {
    chips.push({ key: 'forbidden', label: 'Forbidden path', color: colors.claude.error })
  }
  if (item.flags.headMoved) {
    chips.push({
      key: 'head-moved',
      label: 'History rewritten during turn',
      color: colors.claude.error
    })
  }
  if (item.flags.highVelocity) {
    chips.push({ key: 'high-velocity', label: 'High-velocity', color: colors.claude.warning })
  }
  if (item.flags.degradedAttribution) {
    chips.push({
      key: 'degraded',
      label: 'Attribution degraded',
      color: colors.claude.warning
    })
  }
  if (item.flags.attributionSuspect) {
    // Error, not warning: a forwarded agentId that failed main-side binding
    // validation is an identity-forgery signal (contracts §4, step 3).
    chips.push({
      key: 'attribution-suspect',
      label: 'Attribution suspect',
      color: colors.claude.error
    })
  }
  if (item.flags.gateDegraded) {
    chips.push({
      key: 'gate-degraded',
      label: 'Containment degraded',
      color: colors.claude.warning
    })
  }
  if (item.flags.concurrentTurns) {
    chips.push({ key: 'concurrent', label: 'Concurrent turns', color: colors.claude.warning })
  }
  return chips
}
