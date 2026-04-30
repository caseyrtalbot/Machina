/**
 * Block model: structured shell-session records.
 *
 * Pure types and immutable state-machine transitions. Zero I/O, zero side effects.
 * Inspired by Warp's terminal/model/block.rs (concept-borrowed, clean-room TS).
 */

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
