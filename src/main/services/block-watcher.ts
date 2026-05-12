/**
 * BlockWatcher — bridges raw PTY data to structured Block updates.
 *
 * Holds one BlockDetector and one in-flight Block per session. As detector
 * events arrive, transitions the block through pending → running → completed
 * (or cancelled) and emits a snapshot via the onUpdate callback.
 *
 * Pure side-effect-free except for the user-supplied onUpdate emitter; all
 * state lives in this object so it's trivially mockable in tests.
 */

import {
  pendingBlock,
  startBlock,
  completeBlock,
  appendOutput,
  type Block,
  type BlockMetadata,
  type ShellType
} from '@shared/engine/block-model'
import { createBlockDetector, type BlockDetector } from '@shared/engine/block-detector'

export interface BlockUpdate {
  readonly sessionId: string
  readonly block: Block
}

interface BlockWatcherOptions {
  readonly onUpdate: (update: BlockUpdate) => void
  /** Inject for tests; defaults to a uuid-ish counter. */
  readonly nextBlockId?: () => string
}

interface SessionState {
  readonly detector: BlockDetector
  current: Block | null
}

const KNOWN_SHELL_TYPES: readonly ShellType[] = ['zsh', 'bash', 'fish', 'sh']

function shellTypeOf(meta: Readonly<Record<string, string>>): ShellType {
  const raw = meta.shell
  return KNOWN_SHELL_TYPES.includes(raw as ShellType) ? (raw as ShellType) : 'sh'
}

function defaultIdFactory(): () => string {
  let n = 0
  return () => `te-block-${Date.now()}-${++n}`
}

export class BlockWatcher {
  private readonly sessions = new Map<string, SessionState>()
  private readonly onUpdate: BlockWatcherOptions['onUpdate']
  private readonly nextBlockId: () => string

  constructor(opts: BlockWatcherOptions) {
    this.onUpdate = opts.onUpdate
    this.nextBlockId = opts.nextBlockId ?? defaultIdFactory()
  }

  observe(sessionId: string, data: string): void {
    const state = this.getOrCreate(sessionId)
    const events = state.detector.consume(data)
    for (const ev of events) {
      switch (ev.kind) {
        case 'prompt-start': {
          const meta: BlockMetadata = {
            sessionId,
            cwd: null,
            user: null,
            host: null,
            shellType: 'sh'
          }
          state.current = pendingBlock(this.nextBlockId(), meta)
          this.emit(sessionId, state.current)
          break
        }
        case 'command-start': {
          const baseMeta: BlockMetadata = {
            sessionId,
            cwd: ev.cwd,
            user: ev.meta.user ?? null,
            host: ev.meta.host ?? null,
            shellType: shellTypeOf(ev.meta)
          }
          // If we somehow saw command-start without a prior prompt-start,
          // synthesize a fresh pending block first.
          const base = state.current ?? pendingBlock(this.nextBlockId(), baseMeta)
          const withMeta: Block = { ...base, metadata: baseMeta }
          // command-start has no command text; it arrives in subsequent output
          // until the user's bytes themselves are echoed. The detector treats
          // typed bytes as output too, so we leave command='' and use the
          // first output line as command later, downstream of this watcher.
          const started = startBlock(withMeta, '', ev.ts)
          if (started.ok) {
            state.current = started.value
            this.emit(sessionId, state.current)
          }
          break
        }
        case 'output-chunk': {
          if (state.current === null) break
          const bytes = new TextEncoder().encode(ev.text)
          state.current = appendOutput(state.current, bytes, ev.text)
          this.emit(sessionId, state.current)
          break
        }
        case 'command-end': {
          if (state.current === null) break
          const done = completeBlock(state.current, ev.exit, ev.ts)
          if (done.ok) {
            state.current = done.value
            this.emit(sessionId, state.current)
          }
          break
        }
      }
    }
  }

  closeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  private getOrCreate(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId)
    if (state === undefined) {
      state = { detector: createBlockDetector(), current: null }
      this.sessions.set(sessionId, state)
    }
    return state
  }

  private emit(sessionId: string, block: Block): void {
    this.onUpdate({ sessionId, block })
  }
}
