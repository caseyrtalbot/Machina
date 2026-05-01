// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { CLIAgentSessionListener, type CLIAgentSessionStatus } from '../cli-agent-session-listener'
import {
  pendingBlock,
  startBlock,
  appendOutput,
  completeBlock,
  cancelBlock,
  type Block,
  type BlockMetadata
} from '@shared/engine/block-model'

function meta(sessionId: string, cwd: string | null = null): BlockMetadata {
  return { sessionId, cwd, user: null, host: null, shellType: 'zsh' }
}

function recordingListener(): {
  listener: CLIAgentSessionListener
  emitted: CLIAgentSessionStatus[]
} {
  const emitted: CLIAgentSessionStatus[] = []
  const listener = new CLIAgentSessionListener({
    onStatus: (s) => emitted.push(s),
    onContext: (s) => emitted.push(s)
  })
  return { listener, emitted }
}

function recordingFull(): {
  listener: CLIAgentSessionListener
  status: CLIAgentSessionStatus[]
  context: CLIAgentSessionStatus[]
} {
  const status: CLIAgentSessionStatus[] = []
  const context: CLIAgentSessionStatus[] = []
  const listener = new CLIAgentSessionListener({
    onStatus: (s) => status.push(s),
    onContext: (s) => context.push(s)
  })
  return { listener, status, context }
}

function withCommand(sessionId: string, command: string, cwd: string | null = null): Block {
  const p = pendingBlock(`b-${sessionId}`, meta(sessionId, cwd))
  const r = startBlock(p, command, 1)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('CLIAgentSessionListener', () => {
  it('ignores blocks whose command is not a known CLI agent', () => {
    const { listener, emitted } = recordingListener()
    const block = withCommand('s1', 'npm test')
    listener.observe('s1', block)
    expect(emitted).toEqual([])
  })

  it('emits in-progress when a Claude session is running', () => {
    const { listener, emitted } = recordingListener()
    const block = withCommand('s1', 'claude --print "hello"', '/Users/c/proj')
    listener.observe('s1', block)
    expect(emitted).toHaveLength(1)
    expect(emitted[0].agentId).toBe('claude')
    expect(emitted[0].sessionId).toBe('s1')
    expect(emitted[0].status).toBe('in-progress')
    expect(emitted[0].context.cwd).toBe('/Users/c/proj')
    expect(emitted[0].context.project).toBe('proj')
  })

  it('emits success on a completed Claude block with exit 0', () => {
    const { listener, emitted } = recordingListener()
    let block = withCommand('s1', 'claude --print "hi"')
    listener.observe('s1', block)
    const done = completeBlock(block, 0, 5)
    expect(done.ok).toBe(true)
    if (!done.ok) return
    block = done.value
    listener.observe('s1', block)
    const last = emitted[emitted.length - 1]
    expect(last.status).toBe('success')
  })

  it('emits blocked on a non-zero exit', () => {
    const { listener, emitted } = recordingListener()
    let block = withCommand('s1', 'claude --print "x"')
    listener.observe('s1', block)
    const done = completeBlock(block, 1, 5)
    if (!done.ok) return
    block = done.value
    listener.observe('s1', block)
    expect(emitted[emitted.length - 1].status).toBe('blocked')
  })

  it('emits blocked on cancellation', () => {
    const { listener, emitted } = recordingListener()
    let block = withCommand('s1', 'claude --print "x"')
    listener.observe('s1', block)
    const done = cancelBlock(block, 5)
    if (!done.ok) return
    block = done.value
    listener.observe('s1', block)
    expect(emitted[emitted.length - 1].status).toBe('blocked')
  })

  it('extracts the most recent tool call from Claude output', () => {
    const { listener, emitted } = recordingListener()
    let block = withCommand('s1', 'claude --print "x"')
    listener.observe('s1', block)
    const text = '⏺ Read(file_path: "/a.ts")\n⏺ Bash(command: "ls")\n'
    block = appendOutput(block, new TextEncoder().encode(text), text)
    listener.observe('s1', block)
    const last = emitted[emitted.length - 1]
    expect(last.context.toolName).toBe('Bash')
    expect(last.context.toolInputPreview).toContain('ls')
  })

  it('extracts tool calls from Codex output', () => {
    const { listener, emitted } = recordingListener()
    let block = withCommand('s1', 'codex chat')
    listener.observe('s1', block)
    const text = '[tool_call] read_file path=/a.ts\n'
    block = appendOutput(block, new TextEncoder().encode(text), text)
    listener.observe('s1', block)
    const last = emitted[emitted.length - 1]
    expect(last.agentId).toBe('codex')
    expect(last.context.toolName).toBe('read_file')
  })

  it('extracts tool calls from Gemini output', () => {
    const { listener, emitted } = recordingListener()
    let block = withCommand('s1', 'gemini chat')
    listener.observe('s1', block)
    const text = '▷ search(query="vercel")\n'
    block = appendOutput(block, new TextEncoder().encode(text), text)
    listener.observe('s1', block)
    const last = emitted[emitted.length - 1]
    expect(last.agentId).toBe('gemini')
    expect(last.context.toolName).toBe('search')
  })

  it('strips terminal control sequences before parsing', () => {
    const { listener, emitted } = recordingListener()
    let block = withCommand('s1', 'claude --print "x"')
    listener.observe('s1', block)
    const noisy = '\x1b[0m⏺ Read(file_path: "/a.ts")\x1b[?2004l\n'
    block = appendOutput(block, new TextEncoder().encode(noisy), noisy)
    listener.observe('s1', block)
    const last = emitted[emitted.length - 1]
    expect(last.context.toolName).toBe('Read')
  })

  it('deduplicates emissions when nothing material has changed', () => {
    const { listener, emitted } = recordingListener()
    const block = withCommand('s1', 'claude --print "x"')
    listener.observe('s1', block)
    listener.observe('s1', block)
    listener.observe('s1', block)
    expect(emitted).toHaveLength(1)
  })

  it('routes status changes to onStatus and context-only changes to onContext', () => {
    const { listener, status, context } = recordingFull()
    let block = withCommand('s1', 'claude --print "x"')
    listener.observe('s1', block) // in-progress, fires onStatus
    const text1 = '⏺ Read(file_path: "/a.ts")\n'
    block = appendOutput(block, new TextEncoder().encode(text1), text1)
    listener.observe('s1', block) // context change only, fires onContext
    const done = completeBlock(block, 0, 5)
    if (!done.ok) return
    block = done.value
    listener.observe('s1', block) // status change to success, fires onStatus
    expect(status.map((s) => s.status)).toEqual(['in-progress', 'success'])
    expect(context).toHaveLength(1)
    expect(context[0].context.toolName).toBe('Read')
  })

  it('isolates state between sessions', () => {
    const { listener, emitted } = recordingListener()
    const a = withCommand('s1', 'claude --print "a"')
    const b = withCommand('s2', 'claude --print "b"')
    listener.observe('s1', a)
    listener.observe('s2', b)
    expect(emitted.map((e) => e.sessionId)).toEqual(['s1', 's2'])
  })

  it('forgets state when a session is closed', () => {
    const { listener, emitted } = recordingListener()
    const block = withCommand('s1', 'claude --print "x"')
    listener.observe('s1', block)
    listener.closeSession('s1')
    listener.observe('s1', block)
    expect(emitted).toHaveLength(2)
  })

  it('captures the query (args after the binary) and project basename', () => {
    const { listener, emitted } = recordingListener()
    const block = withCommand(
      's1',
      'claude --print "what is 2+2"',
      '/Users/c/Projects/thought-engine'
    )
    listener.observe('s1', block)
    expect(emitted[0].context.query).toContain('what is 2+2')
    expect(emitted[0].context.project).toBe('thought-engine')
  })

  it('strips a path prefix from the binary lookup (e.g. /usr/local/bin/claude)', () => {
    const { listener, emitted } = recordingListener()
    const block = withCommand('s1', '/usr/local/bin/claude --print "x"')
    listener.observe('s1', block)
    expect(emitted[0].agentId).toBe('claude')
  })

  it('does not emit on pending blocks with no command yet', () => {
    const { listener, emitted } = recordingListener()
    const pending = pendingBlock('b1', meta('s1'))
    listener.observe('s1', pending)
    expect(emitted).toEqual([])
  })
})
