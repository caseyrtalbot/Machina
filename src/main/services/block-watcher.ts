/**
 * BlockWatcher — bridges raw PTY data to structured Block updates.
 *
 * Holds one BlockDetector and one in-flight Block per session. As detector
 * events arrive, transitions the block through pending → running → completed
 * (or cancelled) and emits a snapshot via the onUpdate callback.
 *
 * State transitions emit immediately; output-chunk snapshots are throttled
 * to one emit per `throttleMs` per session (default ~10Hz), with a trailing
 * timer so the latest snapshot always lands.
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
import { extractCommand, stripTerminalControls } from '@shared/engine/terminal-text'
import { createBlockDetector, type BlockDetector } from '@shared/engine/block-detector'

export interface BlockUpdate {
  readonly sessionId: string
  readonly block: Block
}

interface BlockWatcherOptions {
  readonly onUpdate: (update: BlockUpdate) => void
  /** Inject for tests; defaults to a uuid-ish counter. */
  readonly nextBlockId?: () => string
  /** Min interval between output-chunk emits per session. 0 disables. */
  readonly throttleMs?: number
}

interface SessionState {
  readonly detector: BlockDetector
  current: Block | null
  lastEmitAt: number
  pendingEmit: Block | null
  timer: ReturnType<typeof setTimeout> | null
}

const DEFAULT_THROTTLE_MS = 100

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
  private readonly throttleMs: number

  constructor(opts: BlockWatcherOptions) {
    this.onUpdate = opts.onUpdate
    this.nextBlockId = opts.nextBlockId ?? defaultIdFactory()
    this.throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS
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
          this.emit(sessionId, state, state.current, true)
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
          // The hook emits the typed command as a percent-encoded cmd= key.
          // When absent (older hook), command stays '' and is derived from
          // the output echo at command-end.
          const started = startBlock(withMeta, ev.command ?? '', ev.ts)
          if (started.ok) {
            state.current = started.value
            this.emit(sessionId, state, state.current, true)
          }
          break
        }
        case 'output-chunk': {
          if (state.current === null) break
          state.current = appendOutput(state.current, ev.text)
          this.emit(sessionId, state, state.current, false)
          break
        }
        case 'command-end': {
          if (state.current === null) break
          const done = completeBlock(state.current, ev.exit, ev.ts)
          if (done.ok) {
            state.current = done.value
            if (state.current.command === '') {
              const derived = extractCommand(stripTerminalControls(state.current.outputText))
              if (derived !== '') state.current = { ...state.current, command: derived }
            }
            this.emit(sessionId, state, state.current, true)
          }
          break
        }
      }
    }
  }

  closeSession(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (state?.timer !== null && state?.timer !== undefined) {
      clearTimeout(state.timer)
    }
    this.sessions.delete(sessionId)
  }

  private getOrCreate(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId)
    if (state === undefined) {
      state = {
        detector: createBlockDetector(),
        current: null,
        lastEmitAt: 0,
        pendingEmit: null,
        timer: null
      }
      this.sessions.set(sessionId, state)
    }
    return state
  }

  private emit(sessionId: string, state: SessionState, block: Block, urgent: boolean): void {
    if (!urgent && this.throttleMs > 0) {
      const elapsed = Date.now() - state.lastEmitAt
      if (elapsed < this.throttleMs) {
        state.pendingEmit = block
        if (state.timer === null) {
          state.timer = setTimeout(() => {
            state.timer = null
            const pending = state.pendingEmit
            if (pending !== null) {
              state.pendingEmit = null
              state.lastEmitAt = Date.now()
              this.onUpdate({ sessionId, block: pending })
            }
          }, this.throttleMs - elapsed)
        }
        return
      }
    }
    if (state.timer !== null) {
      clearTimeout(state.timer)
      state.timer = null
    }
    state.pendingEmit = null
    state.lastEmitAt = Date.now()
    this.onUpdate({ sessionId, block })
  }
}
