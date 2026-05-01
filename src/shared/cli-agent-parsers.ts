/**
 * Per-agent tool-call parsers for the CLI agent session listener (Move 8).
 *
 * Each parser receives a chunk of CLI output (already stripped of ANSI/OSC
 * controls) and returns the tool calls it can recognize. Parsers are
 * intentionally permissive — formats are observed empirically and may shift
 * between agent releases. Misses degrade to "no tool call detected" rather
 * than throwing.
 *
 * Pure: zero I/O, zero side effects. Importable from main and renderer.
 */

import type { ToolCall } from './cli-agents'

const PREVIEW_MAX = 120

function preview(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length <= PREVIEW_MAX) return trimmed
  return `${trimmed.slice(0, PREVIEW_MAX - 1)}…`
}

/**
 * Extract the substring inside the first balanced `(...)` starting at `start`,
 * or `null` if the parens are unbalanced. Handles nested parens but does not
 * attempt to parse quoted strings (so `"a)b"` still increments depth).
 */
function balancedParens(text: string, start: number): string | null {
  if (text[start] !== '(') return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return text.slice(start + 1, i)
    }
  }
  return null
}

/**
 * Claude Code tool calls render as `⏺ Name(args...)` at the start of a line.
 * Result lines (`  ⎿  ...`) are skipped.
 */
export function claudeToolCallParser(chunk: string): readonly ToolCall[] {
  if (chunk.length === 0) return []
  const calls: ToolCall[] = []
  for (const rawLine of chunk.split('\n')) {
    const line = rawLine.replace(/^\s+/, '')
    if (!line.startsWith('⏺ ')) continue
    const after = line.slice(2)
    const parenIdx = after.indexOf('(')
    if (parenIdx <= 0) continue
    const name = after.slice(0, parenIdx).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue
    const args = balancedParens(after, parenIdx)
    if (args === null) continue
    calls.push({ name, inputPreview: preview(args) })
  }
  return calls
}

/**
 * Codex CLI tool calls render as `[tool_call] name {json}` or `tool: name args`.
 * Both forms appear on their own line.
 */
export function codexToolCallParser(chunk: string): readonly ToolCall[] {
  if (chunk.length === 0) return []
  const calls: ToolCall[] = []
  const pattern = /^\s*(?:\[tool[_\s-]?call\]|tool:)\s+(\S+)(?:\s+(.+))?$/i
  for (const line of chunk.split('\n')) {
    const m = pattern.exec(line)
    if (!m) continue
    const name = m[1].replace(/[,:;]+$/, '')
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) continue
    calls.push({ name, inputPreview: preview(m[2] ?? '') })
  }
  return calls
}

/**
 * Gemini CLI tool calls render as `▷ name(args)` (similar marker to Claude)
 * or `Calling <name> with {args}`.
 */
export function geminiToolCallParser(chunk: string): readonly ToolCall[] {
  if (chunk.length === 0) return []
  const calls: ToolCall[] = []
  for (const rawLine of chunk.split('\n')) {
    const line = rawLine.replace(/^\s+/, '')
    if (line.startsWith('▷ ')) {
      const after = line.slice(2)
      const parenIdx = after.indexOf('(')
      if (parenIdx > 0) {
        const name = after.slice(0, parenIdx).trim()
        const args = balancedParens(after, parenIdx)
        if (args !== null && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) {
          calls.push({ name, inputPreview: preview(args) })
          continue
        }
      }
      const justName = after.trim().split(/\s+/)[0]
      if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(justName)) {
        calls.push({ name: justName, inputPreview: preview(after.slice(justName.length)) })
      }
      continue
    }
    const callMatch = /^Calling\s+(\S+?)(?:\s+with\s+(.+))?$/i.exec(line)
    if (callMatch) {
      const name = callMatch[1].replace(/[,.:;]+$/, '')
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) continue
      calls.push({ name, inputPreview: preview(callMatch[2] ?? '') })
    }
  }
  return calls
}
