/**
 * Block model: structured shell-session records.
 *
 * Pure types and immutable state-machine transitions. Zero I/O, zero side effects.
 * Inspired by Warp's terminal/model/block.rs (concept-borrowed, clean-room TS).
 */

import { scanSecrets, SECRET_RESCAN_OVERLAP } from './secrets'

export type BlockId = string & { readonly __brand: 'BlockId' }

export type ShellType = 'zsh' | 'bash' | 'fish' | 'sh'

export type BlockState =
  | { readonly kind: 'pending' }
  | { readonly kind: 'running'; readonly startedAt: number }
  | {
      readonly kind: 'completed'
      readonly startedAt: number
      readonly finishedAt: number
      readonly exitCode: number
    }
  | { readonly kind: 'cancelled'; readonly startedAt: number; readonly finishedAt: number }

export interface BlockMetadata {
  readonly sessionId: string
  readonly cwd: string | null
  readonly user: string | null
  readonly host: string | null
  readonly shellType: ShellType
}

export interface SecretRef {
  readonly start: number
  readonly end: number
  readonly kind: string
}

export interface Block {
  readonly id: BlockId
  readonly metadata: BlockMetadata
  readonly prompt: string
  readonly command: string
  readonly outputText: string
  readonly state: BlockState
  readonly secrets: readonly SecretRef[]
}

/**
 * Output cap: keep the first OUTPUT_HEAD_LIMIT chars and the most recent
 * OUTPUT_TAIL_LIMIT chars; the middle is replaced by TRUNCATION_MARKER so
 * a runaway command can't grow a block (and its IPC snapshots) unboundedly.
 */
export const OUTPUT_HEAD_LIMIT = 64 * 1024
export const OUTPUT_TAIL_LIMIT = 256 * 1024
export const TRUNCATION_MARKER = '\n…[output truncated]…\n'

type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export function pendingBlock(id: string, metadata: BlockMetadata): Block {
  return {
    id: id as BlockId,
    metadata,
    prompt: '',
    command: '',
    outputText: '',
    state: { kind: 'pending' },
    secrets: []
  }
}

export function startBlock(block: Block, command: string, startedAt: number): Result<Block> {
  if (block.state.kind !== 'pending') {
    return { ok: false, error: `cannot start block in state ${block.state.kind}` }
  }
  return {
    ok: true,
    value: { ...block, command, state: { kind: 'running', startedAt } }
  }
}

export function completeBlock(block: Block, exitCode: number, finishedAt: number): Result<Block> {
  if (block.state.kind !== 'running') {
    return { ok: false, error: `cannot complete block in state ${block.state.kind}` }
  }
  return {
    ok: true,
    value: {
      ...block,
      state: {
        kind: 'completed',
        startedAt: block.state.startedAt,
        finishedAt,
        exitCode
      }
    }
  }
}

export function cancelBlock(block: Block, finishedAt: number): Result<Block> {
  if (block.state.kind !== 'running') {
    return { ok: false, error: `cannot cancel block in state ${block.state.kind}` }
  }
  return {
    ok: true,
    value: {
      ...block,
      state: { kind: 'cancelled', startedAt: block.state.startedAt, finishedAt }
    }
  }
}

export function appendOutput(block: Block, chunkText: string): Block {
  if (chunkText.length === 0) {
    return block
  }
  const outputText = block.outputText + chunkText

  // Re-scan only the new chunk plus an overlap window so a secret split across
  // two chunks still flags. Secrets fully outside the rescan region are kept.
  // If a prior secret straddles the naive window boundary, widen the window back
  // to its start so the whole token is re-found (else it falls out of both the
  // kept-filter and the sliced rescan and silently leaks). Secrets are
  // non-overlapping and sorted, so at most one can contain the boundary point.
  const naiveStart = Math.max(0, block.outputText.length - SECRET_RESCAN_OVERLAP)
  const straddler = block.secrets.find((s) => s.start < naiveStart && s.end > naiveStart)
  const rescanStart = straddler ? straddler.start : naiveStart
  const rescanRegion = outputText.slice(rescanStart)
  const newRefs = scanSecrets(rescanRegion).map((s) => ({
    kind: s.kind,
    start: s.start + rescanStart,
    end: s.end + rescanStart
  }))
  const kept = block.secrets.filter((s) => s.end <= rescanStart)
  const secrets = [...kept, ...newRefs]

  if (outputText.length <= OUTPUT_HEAD_LIMIT + OUTPUT_TAIL_LIMIT + TRUNCATION_MARKER.length) {
    return { ...block, outputText, secrets }
  }

  // Over the cap: cut the middle (which always contains any previous marker)
  // and remap secret offsets across the cut. Secrets straddling either cut
  // edge lose their text and are dropped.
  const cutStart = OUTPUT_HEAD_LIMIT
  const cutEnd = outputText.length - OUTPUT_TAIL_LIMIT
  const cappedText = outputText.slice(0, cutStart) + TRUNCATION_MARKER + outputText.slice(cutEnd)
  const shift = cutStart + TRUNCATION_MARKER.length - cutEnd
  const cappedSecrets = secrets
    .filter((s) => s.end <= cutStart || s.start >= cutEnd)
    .map((s) => (s.start >= cutEnd ? { ...s, start: s.start + shift, end: s.end + shift } : s))

  return { ...block, outputText: cappedText, secrets: cappedSecrets }
}
