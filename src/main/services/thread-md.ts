import matter from 'gray-matter'
import type {
  Thread,
  ThreadMessage,
  ToolCall,
  ToolResult,
  AssistantMessage
} from '../../shared/thread-types'

export function encodeThread(t: Thread): string {
  const fm = {
    agent: t.agent,
    model: t.model,
    started: t.started,
    last_message: t.lastMessage,
    title: t.title,
    dock_state: t.dockState,
    auto_accept_session: t.autoAcceptSession ?? false
  }
  const body = t.messages.map(encodeMessage).join('\n')
  return matter.stringify(body, fm)
}

function encodeMessage(m: ThreadMessage): string {
  if (m.role === 'user') {
    return `\n## User\n\n${m.body.trim()}\n`
  }
  if (m.role === 'system') {
    return `\n## System\n\n${m.body.trim()}\n`
  }
  let out = `\n## Machina\n\n${m.body.trim()}\n`
  for (const tc of m.toolCalls ?? []) {
    out += '\n```machina-tool-call\n'
    out += JSON.stringify({ id: tc.call.id, tool: tc.call.kind, args: tc.call.args }, null, 2)
    out += '\n```\n'
    if (tc.result) {
      out += '\n```machina-tool-result\n'
      out += JSON.stringify(tc.result, null, 2)
      out += '\n```\n'
    }
  }
  return out
}

export function decodeThread(md: string): Thread {
  const { data, content } = matter(md)
  const messages = decodeMessages(content)
  return {
    id: '',
    agent: data.agent,
    model: data.model,
    started: data.started,
    lastMessage: data.last_message,
    title: data.title,
    dockState: data.dock_state ?? { tabs: [] },
    autoAcceptSession: data.auto_accept_session ?? false,
    messages
  }
}

function decodeMessages(content: string): ThreadMessage[] {
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
      messages.push(parseAssistantMessage(body))
    } else if (indices[i].role === 'user') {
      messages.push({ role: 'user', body, sentAt: '' })
    } else {
      messages.push({ role: 'system', body, sentAt: '' })
    }
  }
  return messages
}

function parseAssistantMessage(body: string): AssistantMessage {
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
