/**
 * BlockRecorder + replay — capture PTY byte streams (and detector events)
 * into JSONL fixtures, and replay them back through a detector to derive
 * the canonical Block list.
 *
 * Used to lock down BlockDetector + block-model behaviour under future
 * refactors: a recorded session yields a deterministic block list, which
 * we snapshot in `block-replay.test.ts`.
 *
 * Pure: no I/O. Filesystem reads/writes happen at fixture-load time in
 * tests and in `scripts/regen-block-fixtures.ts`.
 */

import {
  appendOutput,
  cancelBlock,
  completeBlock,
  pendingBlock,
  startBlock,
  type Block,
  type BlockMetadata,
  type ShellType
} from './block-model'
import { type BlockDetector, type BlockEvent } from './block-detector'

export type RecordedEvent = { readonly kind: 'pty-bytes'; readonly data: string } | BlockEvent

export interface BlockRecorder {
  recordEvent(event: RecordedEvent): void
  serialize(): string
  events(): readonly RecordedEvent[]
}

const KNOWN_SHELL_TYPES: readonly ShellType[] = ['zsh', 'bash', 'fish', 'sh']

function shellTypeOf(meta: Readonly<Record<string, string>>): ShellType {
  const raw = meta.shell
  return KNOWN_SHELL_TYPES.includes(raw as ShellType) ? (raw as ShellType) : 'sh'
}

function defaultIdFactory(): () => string {
  let n = 0
  return () => `te-replay-block-${++n}`
}

export function createBlockRecorder(): BlockRecorder {
  const buf: RecordedEvent[] = []
  return {
    recordEvent(event: RecordedEvent): void {
      buf.push(event)
    },
    serialize(): string {
      return buf.map((e) => JSON.stringify(e)).join('\n') + (buf.length > 0 ? '\n' : '')
    },
    events(): readonly RecordedEvent[] {
      return buf
    }
  }
}

export function parseRecording(serialized: string): readonly RecordedEvent[] {
  const out: RecordedEvent[] = []
  for (const raw of serialized.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    out.push(JSON.parse(line) as RecordedEvent)
  }
  return out
}

export interface ReplayOptions {
  readonly sessionId?: string
  readonly idFactory?: () => string
}

/**
 * Folds detector events into Blocks, mirroring the production BlockWatcher
 * but pure (no IPC, no callback). Cross-block boundaries close the current
 * block and open a fresh one on the next prompt-start.
 */
export function replay(
  serialized: string,
  detector: BlockDetector,
  opts: ReplayOptions = {}
): readonly Block[] {
  const recorded = parseRecording(serialized)
  const sessionId = opts.sessionId ?? 's'
  const nextId = opts.idFactory ?? defaultIdFactory()

  const blocks: Block[] = []
  let current: Block | null = null

  const finalize = (): void => {
    if (current === null) return
    blocks.push(current)
    current = null
  }

  const handleEvent = (ev: BlockEvent): void => {
    switch (ev.kind) {
      case 'prompt-start': {
        finalize()
        const meta: BlockMetadata = {
          sessionId,
          cwd: null,
          user: null,
          host: null,
          shellType: 'sh'
        }
        current = pendingBlock(nextId(), meta)
        break
      }
      case 'command-start': {
        const meta: BlockMetadata = {
          sessionId,
          cwd: ev.cwd,
          user: ev.meta.user ?? null,
          host: ev.meta.host ?? null,
          shellType: shellTypeOf(ev.meta)
        }
        const base = current ?? pendingBlock(nextId(), meta)
        const withMeta: Block = { ...base, metadata: meta }
        const started = startBlock(withMeta, '', ev.ts)
        if (started.ok) current = started.value
        break
      }
      case 'output-chunk': {
        if (current === null) break
        const bytes = new TextEncoder().encode(ev.text)
        current = appendOutput(current, bytes, ev.text)
        break
      }
      case 'command-end': {
        if (current === null) break
        const done = completeBlock(current, ev.exit, ev.ts)
        if (done.ok) current = done.value
        break
      }
    }
  }

  for (const e of recorded) {
    if (e.kind === 'pty-bytes') {
      const events = detector.consume(e.data)
      for (const ev of events) handleEvent(ev)
    } else {
      handleEvent(e)
    }
  }

  finalize()
  return blocks
}

/**
 * Marks the current block as cancelled at the supplied timestamp. Exposed
 * for fixture generators that record an explicit cancellation rather than
 * relying on a non-zero exit code from the shell.
 */
export function replayWithCancel(
  serialized: string,
  detector: BlockDetector,
  cancelAt: number,
  opts: ReplayOptions = {}
): readonly Block[] {
  const blocks = [...replay(serialized, detector, opts)]
  const last = blocks[blocks.length - 1]
  if (last && last.state.kind === 'running') {
    const cancelled = cancelBlock(last, cancelAt)
    if (cancelled.ok) blocks[blocks.length - 1] = cancelled.value
  }
  return blocks
}
