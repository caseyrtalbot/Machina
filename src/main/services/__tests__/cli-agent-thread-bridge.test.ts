// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  blockToMessage,
  CliAgentThreadBridge,
  type CliAgentThreadMessageEvent
} from '../cli-agent-thread-bridge'
import {
  pendingBlock,
  startBlock,
  appendOutput,
  completeBlock,
  cancelBlock,
  type Block,
  type BlockMetadata
} from '@shared/engine/block-model'
import { getAgentSpec } from '@shared/cli-agents'

function meta(sessionId: string, cwd: string | null = '/Users/c/proj'): BlockMetadata {
  return { sessionId, cwd, user: null, host: null, shellType: 'zsh' }
}

function startedBlock(sessionId: string, command: string): Block {
  const p = pendingBlock(`b-${sessionId}`, meta(sessionId))
  const r = startBlock(p, command, 1000)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

function completed(block: Block, exit: number): Block {
  const r = completeBlock(block, exit, 5000)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

const claudeSpec = getAgentSpec('claude')!

describe('blockToMessage (pure mapping)', () => {
  it('maps a successful completed block to assistant + cli_command ok result', () => {
    const out = 'hello world\n'
    let block = startedBlock('s1', 'claude --print "hi"')
    block = appendOutput(block, new TextEncoder().encode(out), out)
    block = completed(block, 0)

    const msg = blockToMessage(block, claudeSpec)

    expect(msg.role).toBe('assistant')
    expect(msg.body).toBe('')
    expect(msg.toolCalls).toBeDefined()
    expect(msg.toolCalls?.length).toBe(1)
    const entry = msg.toolCalls![0]
    expect(entry.call.kind).toBe('cli_command')
    expect(entry.call.args).toEqual({ command: 'claude --print "hi"', cwd: '/Users/c/proj' })
    expect(entry.result?.ok).toBe(true)
    if (entry.result?.ok) {
      expect(entry.result.output).toEqual({ output: out, exitCode: 0 })
    }
    expect(msg.metadata?.sessionId).toBe('s1')
  })

  it('maps a non-zero exit to ok=false with IO_FATAL and a hint of the last 300 chars', () => {
    const out = 'a'.repeat(500) + 'TAIL'
    let block = startedBlock('s2', 'claude --print "x"')
    block = appendOutput(block, new TextEncoder().encode(out), out)
    block = completed(block, 1)

    const msg = blockToMessage(block, claudeSpec)
    const entry = msg.toolCalls![0]

    expect(entry.result?.ok).toBe(false)
    if (entry.result && !entry.result.ok) {
      expect(entry.result.error.code).toBe('IO_FATAL')
      expect(entry.result.error.message).toContain('exit 1')
      expect(entry.result.error.hint?.length).toBe(300)
      expect(entry.result.error.hint?.endsWith('TAIL')).toBe(true)
    }
  })

  it('maps a cancelled block to ok=false with IO_FATAL and exit -1', () => {
    let block = startedBlock('s3', 'claude --print "x"')
    block = appendOutput(block, new TextEncoder().encode('partial'), 'partial')
    const r = cancelBlock(block, 5000)
    if (!r.ok) throw new Error(r.error)
    block = r.value

    const msg = blockToMessage(block, claudeSpec)
    const entry = msg.toolCalls![0]

    expect(entry.result?.ok).toBe(false)
    if (entry.result && !entry.result.ok) {
      expect(entry.result.error.code).toBe('IO_FATAL')
      expect(entry.result.error.message).toContain('cancelled')
      expect(entry.result.error.hint).toBe('partial')
    }
  })

  it('folds parsed inline tool calls into the message after the cli_command entry', () => {
    const out = '⏺ Read(file_path: "/a.ts")\n⏺ Bash(command: "ls")\n'
    let block = startedBlock('s4', 'claude --print "x"')
    block = appendOutput(block, new TextEncoder().encode(out), out)
    block = completed(block, 0)

    const msg = blockToMessage(block, claudeSpec)

    expect(msg.toolCalls?.length).toBe(3)
    expect(msg.toolCalls![0].call.kind).toBe('cli_command')
    expect(msg.toolCalls![1].call.kind).toBe('cli_claude_read')
    expect(msg.toolCalls![1].call.args).toMatchObject({ preview: expect.stringContaining('/a.ts') })
    expect(msg.toolCalls![2].call.kind).toBe('cli_claude_bash')
    expect(msg.toolCalls![2].call.args).toMatchObject({ preview: expect.stringContaining('ls') })
  })
})

describe('CliAgentThreadBridge', () => {
  function recording(): {
    bridge: CliAgentThreadBridge
    emitted: CliAgentThreadMessageEvent[]
  } {
    const emitted: CliAgentThreadMessageEvent[] = []
    const bridge = new CliAgentThreadBridge({ onMessage: (e) => emitted.push(e) })
    return { bridge, emitted }
  }

  it('does not emit when no thread is mapped to the session', () => {
    const { bridge, emitted } = recording()
    let block = startedBlock('s1', 'claude --print "x"')
    block = completed(block, 0)
    bridge.observe('s1', block)
    expect(emitted).toEqual([])
  })

  it('does not emit when the command is not a known CLI agent', () => {
    const { bridge, emitted } = recording()
    bridge.bind('s1', 'thread-A')
    let block = startedBlock('s1', 'npm test')
    block = completed(block, 0)
    bridge.observe('s1', block)
    expect(emitted).toEqual([])
  })

  it('does not emit while the block is still running', () => {
    const { bridge, emitted } = recording()
    bridge.bind('s1', 'thread-A')
    const block = startedBlock('s1', 'claude --print "x"')
    bridge.observe('s1', block)
    expect(emitted).toEqual([])
  })

  it('emits one message when a mapped session block reaches completed', () => {
    const { bridge, emitted } = recording()
    bridge.bind('s1', 'thread-A')
    let block = startedBlock('s1', 'claude --print "hi"')
    bridge.observe('s1', block)
    block = completed(block, 0)
    bridge.observe('s1', block)
    expect(emitted).toHaveLength(1)
    expect(emitted[0].threadId).toBe('thread-A')
    expect(emitted[0].message.toolCalls?.[0].call.kind).toBe('cli_command')
  })

  it('does not re-emit for the same block id seen multiple times', () => {
    const { bridge, emitted } = recording()
    bridge.bind('s1', 'thread-A')
    let block = startedBlock('s1', 'claude --print "x"')
    block = completed(block, 0)
    bridge.observe('s1', block)
    bridge.observe('s1', block)
    bridge.observe('s1', block)
    expect(emitted).toHaveLength(1)
  })

  it('emits separately for each new block in the same session', () => {
    const { bridge, emitted } = recording()
    bridge.bind('s1', 'thread-A')
    const a = completed(startedBlock('s1', 'claude --print "a"'), 0)
    bridge.observe('s1', a)
    // Second block: same session, new id (pendingBlock uses different id input)
    const p = pendingBlock('b-s1-2', meta('s1'))
    const r = startBlock(p, 'claude --print "b"', 2000)
    if (!r.ok) throw new Error(r.error)
    const b = completed(r.value, 0)
    bridge.observe('s1', b)
    expect(emitted).toHaveLength(2)
  })

  it('drops the binding when the session is closed', () => {
    const { bridge, emitted } = recording()
    bridge.bind('s1', 'thread-A')
    bridge.closeSession('s1')
    let block = startedBlock('s1', 'claude --print "x"')
    block = completed(block, 0)
    bridge.observe('s1', block)
    expect(emitted).toEqual([])
  })

  it('routes by sessionId so two threads in flight do not cross', () => {
    const { bridge, emitted } = recording()
    bridge.bind('s1', 'thread-A')
    bridge.bind('s2', 'thread-B')
    const a = completed(startedBlock('s1', 'claude --print "a"'), 0)
    const b = completed(startedBlock('s2', 'codex chat'), 0)
    bridge.observe('s1', a)
    bridge.observe('s2', b)
    expect(emitted.map((e) => e.threadId)).toEqual(['thread-A', 'thread-B'])
  })
})
