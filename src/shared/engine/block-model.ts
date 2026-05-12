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

export interface AgentContext {
  readonly agentId: string
  readonly sessionId: string | null
  readonly toolName: string | null
}

export interface Block {
  readonly id: BlockId
  readonly metadata: BlockMetadata
  readonly prompt: string
  readonly command: string
  readonly outputBytes: Uint8Array
  readonly outputText: string
  readonly state: BlockState
  readonly agentContext: AgentContext | null
  readonly secrets: readonly SecretRef[]
}

type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export function pendingBlock(id: string, metadata: BlockMetadata): Block {
  return {
    id: id as BlockId,
    metadata,
    prompt: '',
    command: '',
    outputBytes: new Uint8Array(),
    outputText: '',
    state: { kind: 'pending' },
    agentContext: null,
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

export function appendOutput(block: Block, chunkBytes: Uint8Array, chunkText: string): Block {
  if (chunkBytes.byteLength === 0 && chunkText.length === 0) {
    return block
  }
  const merged = new Uint8Array(block.outputBytes.byteLength + chunkBytes.byteLength)
  merged.set(block.outputBytes, 0)
  merged.set(chunkBytes, block.outputBytes.byteLength)
  const outputText = block.outputText + chunkText

  // Re-scan only the new chunk plus an overlap window so a secret split across
  // two chunks still flags. Secrets fully outside the rescan region are kept.
  const rescanStart = Math.max(0, block.outputText.length - SECRET_RESCAN_OVERLAP)
  const rescanRegion = outputText.slice(rescanStart)
  const newRefs = scanSecrets(rescanRegion).map((s) => ({
    kind: s.kind,
    start: s.start + rescanStart,
    end: s.end + rescanStart
  }))
  const kept = block.secrets.filter((s) => s.end <= rescanStart)
  const secrets = [...kept, ...newRefs]

  return { ...block, outputBytes: merged, outputText, secrets }
}

export function setAgentContext(block: Block, ctx: AgentContext): Block {
  return { ...block, agentContext: ctx }
}
