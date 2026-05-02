import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SILENCE_WATCHDOG_MS = 30_000
const TOTAL_CAP_MS = 180_000

/** Resolve the claude CLI binary, checking common install locations if not on PATH. */
function resolveClaudeBin(): string {
  const home = process.env.HOME ?? ''
  const candidates = [
    join(home, '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    join(home, '.nvm', 'current', 'bin', 'claude')
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return 'claude'
}

const CLAUDE_BIN = resolveClaudeBin()

// ---------------------------------------------------------------------------
// JSON Extraction
// ---------------------------------------------------------------------------

export function extractJsonFromResponse(text: string): unknown {
  const fenceMatch = /```(?:json)?\s*\n([\s\S]*?)```/.exec(text)
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim())
  }

  const objectMatch = /(\{[\s\S]*\})/.exec(text)
  if (objectMatch) {
    return JSON.parse(objectMatch[1].trim())
  }

  throw new Error('No JSON found in response')
}

// ---------------------------------------------------------------------------
// Streaming types
// ---------------------------------------------------------------------------

export type ClaudeCliStreamPhase = 'thinking' | 'drafting'

export type ClaudeCliStreamEvent =
  | { readonly kind: 'phase'; readonly phase: ClaudeCliStreamPhase }
  | { readonly kind: 'thinking-delta'; readonly text: string }
  | { readonly kind: 'text-delta'; readonly text: string }

export type ClaudeCliErrorTag = 'stalled' | 'cap' | 'cli-error' | 'not-found'

export type OnStreamEvent = (ev: ClaudeCliStreamEvent) => void
export type CallClaudeFn = (prompt: string, onEvent?: OnStreamEvent) => Promise<string>

class TaggedError extends Error {
  readonly tag: ClaudeCliErrorTag
  constructor(message: string, tag: ClaudeCliErrorTag) {
    super(message)
    this.tag = tag
  }
}

// ---------------------------------------------------------------------------
// Stream parsing
// ---------------------------------------------------------------------------

function takeCompleteLines(buf: string): { lines: unknown[]; rest: string } {
  const parts = buf.split('\n')
  const rest = parts.pop() ?? ''
  const lines: unknown[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    try {
      lines.push(JSON.parse(trimmed))
    } catch {
      // Skip non-JSON lines (e.g. blank, partial)
    }
  }
  return { lines, rest }
}

// ---------------------------------------------------------------------------
// Claude CLI caller (spawn injectable for testing)
// ---------------------------------------------------------------------------

type SpawnFn = typeof spawn

export function callClaudeWith(
  spawnFn: SpawnFn,
  prompt: string,
  onEvent: OnStreamEvent = () => {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawnFn(
      CLAUDE_BIN,
      ['--print', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )

    let stderr = ''
    let textBuf = ''
    let resultFallback: string | null = null
    let sawFirstTextDelta = false
    let sawThinking = false
    let stdoutBuf = ''
    let settled = false

    let silenceTimer: ReturnType<typeof setTimeout> | null = null
    let totalTimer: ReturnType<typeof setTimeout> | null = null

    const clearTimers = () => {
      if (silenceTimer) {
        clearTimeout(silenceTimer)
        silenceTimer = null
      }
      if (totalTimer) {
        clearTimeout(totalTimer)
        totalTimer = null
      }
    }

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimers()
      fn()
    }

    const resetSilence = () => {
      if (silenceTimer) clearTimeout(silenceTimer)
      silenceTimer = setTimeout(() => {
        settle(() => {
          reject(new TaggedError('Agent stalled: no activity for 30s', 'stalled'))
          proc.kill('SIGTERM')
        })
      }, SILENCE_WATCHDOG_MS)
    }

    totalTimer = setTimeout(() => {
      settle(() => {
        reject(new TaggedError('Agent exceeded 3-minute total cap', 'cap'))
        proc.kill('SIGTERM')
      })
    }, TOTAL_CAP_MS)

    resetSilence()

    const handleJsonEvent = (obj: unknown) => {
      if (typeof obj !== 'object' || obj === null) return
      const o = obj as Record<string, unknown>

      if (o.type === 'result' && typeof o.result === 'string') {
        resultFallback = o.result
        return
      }
      if (o.type !== 'stream_event') return

      const event = o.event as Record<string, unknown> | undefined
      if (!event || typeof event.type !== 'string') return

      if (event.type === 'message_start') {
        if (!sawThinking) {
          sawThinking = true
          onEvent({ kind: 'phase', phase: 'thinking' })
        }
        return
      }

      if (event.type === 'content_block_delta') {
        const delta = event.delta as Record<string, unknown> | undefined
        if (!delta || typeof delta.type !== 'string') return

        if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          if (!sawThinking) {
            sawThinking = true
            onEvent({ kind: 'phase', phase: 'thinking' })
          }
          onEvent({ kind: 'thinking-delta', text: delta.thinking })
          return
        }

        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          if (!sawFirstTextDelta) {
            sawFirstTextDelta = true
            onEvent({ kind: 'phase', phase: 'drafting' })
          }
          textBuf += delta.text
          onEvent({ kind: 'text-delta', text: delta.text })
          return
        }
      }
    }

    const onStdoutChunk = (text: string) => {
      if (!text) return
      resetSilence()
      stdoutBuf += text
      const { lines, rest } = takeCompleteLines(stdoutBuf)
      stdoutBuf = rest
      for (const line of lines) handleJsonEvent(line)
    }

    const onStderrChunk = (text: string) => {
      if (!text) return
      resetSilence()
      stderr += text
    }

    proc.stdout?.on('data', (chunk: Buffer | string) => {
      onStdoutChunk(Buffer.isBuffer(chunk) ? chunk.toString() : chunk)
    })
    proc.stderr?.on('data', (chunk: Buffer | string) => {
      onStderrChunk(Buffer.isBuffer(chunk) ? chunk.toString() : chunk)
    })

    proc.on('error', (err: NodeJS.ErrnoException) => {
      settle(() => {
        if (err.code === 'ENOENT') {
          reject(new TaggedError(`Claude CLI not found: ${err.message}`, 'not-found'))
        } else {
          reject(new TaggedError(`Failed to spawn claude: ${err.message}`, 'cli-error'))
        }
      })
    })

    proc.on('close', (code) => {
      // Defer to nextTick so any stdout/stderr data events queued by the stream
      // have a chance to fire before we finalize the result.
      process.nextTick(() => {
        settle(() => {
          if (stdoutBuf.trim()) {
            const { lines } = takeCompleteLines(stdoutBuf + '\n')
            for (const line of lines) handleJsonEvent(line)
          }

          if (code !== 0 && code !== null) {
            reject(new TaggedError(`claude exited with code ${code}: ${stderr}`, 'cli-error'))
            return
          }

          resolve(resultFallback ?? textBuf)
        })
      })
    })

    proc.stdin?.on('error', () => {})
    proc.stdin?.write(prompt)
    proc.stdin?.end()
  })
}

export async function callClaude(
  prompt: string,
  onEvent: OnStreamEvent = () => {}
): Promise<string> {
  return callClaudeWith(spawn, prompt, onEvent)
}
