import matter from 'gray-matter'
import { DEFAULT_NATIVE_MODEL } from '../../shared/machina-native-tools'
import type {
  Thread,
  ThreadMessage,
  ToolCall,
  ToolResult,
  AssistantMessage
} from '../../shared/thread-types'

/**
 * Thread markdown wire format (v2, 2.2).
 *
 * Messages are delimited by full-line sentinel comments carrying role +
 * sentAt, so a body containing "## User" or a ```machina-tool-call fence can
 * no longer corrupt history. The `## User` / `## Machina` / `## System`
 * heading is still written for human readability but is presentation only.
 *
 *   <!-- te:msg role=user sentAt=2026-05-01T13:00:00Z -->
 *   ## User
 *
 *   body…
 *
 * Tool exchanges are fenced JSON blocks gated by their own sentinels:
 *
 *   <!-- te:tool-call -->
 *   ```machina-tool-call
 *   { … }
 *   ```
 *
 * Bodies are escaped so a literal sentinel inside a message round-trips: any
 * `<!-- te…:` occurrence gains one backslash before the colon on encode and
 * loses one on decode (`<!-- te:` → `<!-- te\:` → `<!-- te\\:` …), so a real
 * sentinel (zero backslashes) can only be one this module wrote. Tool JSON is
 * stringified (strings escaped), so neither a sentinel line nor a bare ```
 * fence line can appear inside a JSON block.
 *
 * decodeThread still reads the legacy v1 format (heading-delimited, no
 * sentinels) so existing vault threads keep loading; they migrate to v2 on
 * the next save.
 */

const MSG_SENTINEL_RE = /^<!-- te:msg role=(user|assistant|system) sentAt=(\S*) -->$/
const TOOL_CALL_SENTINEL = '<!-- te:tool-call -->'
const TOOL_RESULT_SENTINEL = '<!-- te:tool-result -->'

function escapeBody(body: string): string {
  return body.replace(/<!-- te(\\*):/g, (_m, bs: string) => `<!-- te\\${bs}:`)
}

function unescapeBody(body: string): string {
  return body.replace(/<!-- te\\(\\*):/g, (_m, bs: string) => `<!-- te${bs}:`)
}

export function encodeThread(t: Thread): string {
  // autoAcceptSession is intentionally omitted — it's a session-only flag.
  // Persisting it caused dangerous bypass to survive restarts (silent note edits).
  // `model` is stored only for native threads — CLI threads don't use it.
  const fm = {
    agent: t.agent,
    ...(t.agent === 'machina-native' ? { model: t.model } : {}),
    started: t.started,
    last_message: t.lastMessage,
    title: t.title,
    dock_state: t.dockState
  }
  const body = t.messages.map(encodeMessage).join('\n')
  return matter.stringify(body, fm)
}

function headingFor(role: ThreadMessage['role']): string {
  return role === 'user' ? 'User' : role === 'system' ? 'System' : 'Machina'
}

function encodeMessage(m: ThreadMessage): string {
  let out = `\n<!-- te:msg role=${m.role} sentAt=${m.sentAt} -->\n`
  out += `## ${headingFor(m.role)}\n\n${escapeBody(m.body.trim())}\n`
  if (m.role !== 'assistant') return out
  for (const tc of m.toolCalls ?? []) {
    out += `\n${TOOL_CALL_SENTINEL}\n`
    out += '```machina-tool-call\n'
    out += JSON.stringify({ id: tc.call.id, tool: tc.call.kind, args: tc.call.args }, null, 2)
    out += '\n```\n'
    if (tc.result) {
      out += `\n${TOOL_RESULT_SENTINEL}\n`
      out += '```machina-tool-result\n'
      out += JSON.stringify(tc.result, null, 2)
      out += '\n```\n'
    }
  }
  return out
}

export function decodeThread(md: string): Thread {
  const { data, content } = matter(md)
  const messages = content.includes('<!-- te:msg role=')
    ? decodeMessagesV2(content)
    : decodeMessagesLegacy(content)
  return {
    id: '',
    agent: data.agent,
    model: data.model ?? DEFAULT_NATIVE_MODEL,
    started: data.started,
    lastMessage: data.last_message,
    title: data.title,
    dockState: data.dock_state ?? { tabs: [] },
    autoAcceptSession: false,
    messages
  }
}

// --- v2 (sentinel) decoding ---

function decodeMessagesV2(content: string): ThreadMessage[] {
  const lines = content.split('\n')
  const starts: Array<{ line: number; role: 'user' | 'assistant' | 'system'; sentAt: string }> = []
  for (let i = 0; i < lines.length; i++) {
    const m = MSG_SENTINEL_RE.exec(lines[i])
    if (m) starts.push({ line: i, role: m[1] as 'user' | 'assistant' | 'system', sentAt: m[2] })
  }
  const messages: ThreadMessage[] = []
  for (let i = 0; i < starts.length; i++) {
    const begin = starts[i].line + 1
    const end = i + 1 < starts.length ? starts[i + 1].line : lines.length
    const section = lines.slice(begin, end)
    // The heading line is presentation only — drop exactly one if present.
    if (section.length > 0 && section[0] === `## ${headingFor(starts[i].role)}`) {
      section.shift()
    }
    if (starts[i].role === 'assistant') {
      messages.push(parseAssistantSection(section, starts[i].sentAt))
    } else {
      messages.push({
        role: starts[i].role,
        body: unescapeBody(section.join('\n').trim()),
        sentAt: starts[i].sentAt
      })
    }
  }
  return messages
}

function parseAssistantSection(section: readonly string[], sentAt: string): AssistantMessage {
  const calls: NonNullable<AssistantMessage['toolCalls']> = []
  const bodyLines: string[] = []
  let pending: { call: ToolCall; result?: ToolResult } | null = null

  for (let i = 0; i < section.length; i++) {
    const line = section[i]
    const isCall = line === TOOL_CALL_SENTINEL
    const isResult = line === TOOL_RESULT_SENTINEL
    const fence = isCall ? '```machina-tool-call' : '```machina-tool-result'
    if ((isCall || isResult) && section[i + 1] === fence) {
      // Collect the fenced JSON: stringified JSON never emits a bare ``` line.
      const jsonLines: string[] = []
      let j = i + 2
      while (j < section.length && section[j] !== '```') {
        jsonLines.push(section[j])
        j++
      }
      i = j // skip past the closing fence
      try {
        const json = JSON.parse(jsonLines.join('\n'))
        if (isCall) {
          if (pending) calls.push(pending)
          pending = { call: { id: json.id, kind: json.tool, args: json.args } as ToolCall }
        } else if (pending) {
          pending.result = json as ToolResult
          calls.push(pending)
          pending = null
        }
      } catch {
        // Corrupt block: drop it rather than poisoning the whole thread.
      }
      continue
    }
    bodyLines.push(line)
  }
  if (pending) calls.push(pending)
  return {
    role: 'assistant',
    body: unescapeBody(bodyLines.join('\n').trim()),
    sentAt,
    toolCalls: calls.length > 0 ? calls : undefined
  }
}

// --- legacy (v1, heading-delimited) decoding ---

function decodeMessagesLegacy(content: string): ThreadMessage[] {
  const re = /^## (User|Machina|System)\s*$/gm
  const indices: Array<{ idx: number; role: 'user' | 'assistant' | 'system' }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const role = m[1] === 'User' ? 'user' : m[1] === 'Machina' ? 'assistant' : 'system'
    indices.push({ idx: m.index, role })
  }
  const messages: ThreadMessage[] = []
  for (let i = 0; i < indices.length; i++) {
    const headingEnd = content.indexOf('\n', indices[i].idx)
    const start = headingEnd === -1 ? content.length : headingEnd + 1
    const end = i + 1 < indices.length ? indices[i + 1].idx : content.length
    const body = content.slice(start, end).trim()
    if (indices[i].role === 'assistant') {
      messages.push(parseAssistantMessageLegacy(body))
    } else if (indices[i].role === 'user') {
      messages.push({ role: 'user', body, sentAt: '' })
    } else {
      messages.push({ role: 'system', body, sentAt: '' })
    }
  }
  return messages
}

function parseAssistantMessageLegacy(body: string): AssistantMessage {
  const calls: NonNullable<AssistantMessage['toolCalls']> = []
  const stripped: string[] = []
  const blockRe = /```(machina-tool-call|machina-tool-result)\n([\s\S]*?)\n```/g
  let lastEnd = 0
  let pending: { call: ToolCall; result?: ToolResult } | null = null
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(body)) !== null) {
    stripped.push(body.slice(lastEnd, m.index))
    const json = JSON.parse(m[2])
    if (m[1] === 'machina-tool-call') {
      if (pending) calls.push(pending)
      pending = {
        call: { id: json.id, kind: json.tool, args: json.args } as ToolCall
      }
    } else {
      if (pending) {
        pending.result = json as ToolResult
        calls.push(pending)
        pending = null
      }
    }
    lastEnd = m.index + m[0].length
  }
  stripped.push(body.slice(lastEnd))
  if (pending) calls.push(pending)
  return {
    role: 'assistant',
    body: stripped.join('').trim(),
    sentAt: '',
    toolCalls: calls.length > 0 ? calls : undefined
  }
}
