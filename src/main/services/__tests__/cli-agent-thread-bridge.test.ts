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
const codexSpec = getAgentSpec('codex')!

// Realistic stream-json / JSONL fixtures (shapes verified against
// claude 2.1.170 and codex CLI on 2026-06-10).
const CLAUDE_SESSION = '206caf50-df65-4a64-adf2-0749f4637bf7'
const claudeInit = JSON.stringify({
  type: 'system',
  subtype: 'init',
  cwd: '/v',
  session_id: CLAUDE_SESSION
})
const claudeText = (text: string) =>
  JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    session_id: CLAUDE_SESSION
  })
const claudeToolUse = JSON.stringify({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/a.ts' } }]
  },
  session_id: CLAUDE_SESSION
})
const claudeResult = (result: string) =>
  JSON.stringify({ type: 'result', subtype: 'success', result, session_id: CLAUDE_SESSION })

const CODEX_THREAD = '019eb1da-decb-7052-a145-1ac71e4bc80b'
const codexLines = [
  'Reading additional input from stdin...',
  JSON.stringify({ type: 'thread.started', thread_id: CODEX_THREAD }),
  JSON.stringify({ type: 'turn.started' }),
  '2026-06-10T14:08:01.334563Z ERROR codex_memories_write::phase2: Phase 2 no changes',
  JSON.stringify({
    type: 'item.completed',
    item: { id: 'item_0', type: 'command_execution', command: 'ls -la' }
  }),
  JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'reasoning' } }),
  JSON.stringify({
    type: 'item.completed',
    item: { id: 'item_2', type: 'agent_message', text: 'ok' }
  }),
  JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1 } })
]

describe('blockToMessage (pure mapping)', () => {
  it('maps a successful completed block to assistant + cli_command ok result', () => {
    const out = 'hello world\n'
    let block = startedBlock('s1', 'claude --print "hi"')
    block = appendOutput(block, out)
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
    block = appendOutput(block, out)
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
    block = appendOutput(block, 'partial')
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
    block = appendOutput(block, out)
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

describe('blockToMessage (structured claude stream-json)', () => {
  it('extracts assistant text into body and keeps the raw output on cli_command', () => {
    const out =
      [
        claudeInit,
        claudeText('Hello'),
        claudeToolUse,
        claudeText('Done.'),
        claudeResult('Hello\n\nDone.')
      ].join('\n') + '\n'
    let block = startedBlock('s1', `claude --print --verbose --output-format stream-json 'hi'`)
    block = appendOutput(block, out)
    block = completed(block, 0)

    const msg = blockToMessage(block, claudeSpec)

    expect(msg.body).toBe('Hello\n\nDone.')
    expect(msg.toolCalls?.[0].call.kind).toBe('cli_command')
    if (msg.toolCalls?.[0].result?.ok) {
      expect(msg.toolCalls[0].result.output).toEqual({ output: out, exitCode: 0 })
    } else {
      throw new Error('expected ok cli_command result')
    }
    expect(msg.toolCalls?.[1].call.kind).toBe('cli_claude_read')
    expect(msg.toolCalls?.[1].call.args).toMatchObject({
      preview: expect.stringContaining('/a.ts')
    })
    // The result line repeats the final text — it must not be double-counted.
    expect(msg.body.match(/Hello/g)?.length).toBe(1)
  })

  it('falls back to the result line when no assistant event produced text', () => {
    const out = [claudeInit, claudeResult('only result text')].join('\n') + '\n'
    let block = startedBlock('s1', `claude --print --verbose --output-format stream-json 'x'`)
    block = appendOutput(block, out)
    block = completed(block, 0)

    expect(blockToMessage(block, claudeSpec).body).toBe('only result text')
  })

  it('strips terminal controls from the stored raw output', () => {
    const out = '\x1b[31mFAIL\x1b[0m plain tail\n'
    let block = startedBlock('s1', `claude --print 'x'`)
    block = appendOutput(block, out)
    block = completed(block, 0)

    const msg = blockToMessage(block, claudeSpec)
    if (msg.toolCalls?.[0].result?.ok) {
      expect(msg.toolCalls[0].result.output).toEqual({ output: 'FAIL plain tail\n', exitCode: 0 })
    } else {
      throw new Error('expected ok cli_command result')
    }
  })
})

describe('blockToMessage (structured codex --json)', () => {
  it('extracts agent_message text, maps tool items, skips junk and reasoning', () => {
    let block = startedBlock('s1', `codex exec --json --skip-git-repo-check 'hi'`)
    block = appendOutput(block, codexLines.join('\n') + '\n')
    block = completed(block, 0)

    const msg = blockToMessage(block, codexSpec)

    expect(msg.body).toBe('ok')
    expect(msg.toolCalls?.map((tc) => tc.call.kind)).toEqual([
      'cli_command',
      'cli_codex_command_execution'
    ])
    expect(msg.toolCalls?.[1].call.args).toMatchObject({
      preview: expect.stringContaining('ls -la')
    })
  })

  it('accepts the item_type field variant', () => {
    const line = JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_0', item_type: 'agent_message', text: 'variant ok' }
    })
    let block = startedBlock('s1', `codex exec --json 'hi'`)
    block = appendOutput(block, line + '\n')
    block = completed(block, 0)

    expect(blockToMessage(block, codexSpec).body).toBe('variant ok')
  })
})

describe('blockToMessage (gemini/raw passthrough — no parseEvent on the adapter)', () => {
  const geminiSpec = getAgentSpec('gemini')!

  it('gemini output is NEVER structured-extracted, even when it looks like JSONL', () => {
    // Registry dispatch regression guard (Phase-1 step-6 lost-reply lesson):
    // the gemini adapter has no parseEvent, so JSON-looking lines must stay
    // plain passthrough — body empty, raw output intact on cli_command.
    const out = [claudeText('should not be extracted'), claudeInit].join('\n') + '\n'
    let block = startedBlock('s1', `gemini -p 'hi'`)
    block = appendOutput(block, out)
    block = completed(block, 0)

    const msg = blockToMessage(block, geminiSpec)

    expect(msg.body).toBe('')
    expect(msg.toolCalls?.length).toBe(1)
    expect(msg.toolCalls?.[0].call.kind).toBe('cli_command')
    if (msg.toolCalls?.[0].result?.ok) {
      expect(msg.toolCalls[0].result.output).toEqual({ output: out, exitCode: 0 })
    } else {
      throw new Error('expected ok cli_command result')
    }
  })

  it('gemini blocks emit no interim deltas while running', () => {
    const emitted: CliAgentThreadMessageEvent[] = []
    const bridge = new CliAgentThreadBridge({ onMessage: (e) => emitted.push(e) })
    bridge.bind('s1', 'thread-G')
    let block = startedBlock('s1', `gemini -p 'hi'`)
    block = appendOutput(block, claudeText('partial') + '\n')
    bridge.observe('s1', block)
    expect(emitted).toEqual([])
    block = completed(block, 0)
    bridge.observe('s1', block)
    expect(emitted).toHaveLength(1)
    expect(emitted[0].message.body).toBe('')
  })

  it('raw sessions (unknown binary) never emit thread messages at all', () => {
    // A cli-raw thread's PTY runs arbitrary commands; detectAgentFromCommand
    // matches no CLIAgentSpec, so the bridge is pure passthrough for it.
    const emitted: CliAgentThreadMessageEvent[] = []
    const bridge = new CliAgentThreadBridge({ onMessage: (e) => emitted.push(e) })
    bridge.bind('s1', 'thread-R')
    let block = startedBlock('s1', `mytool --json 'hi'`)
    block = appendOutput(block, claudeText('nope') + '\n')
    block = completed(block, 0)
    bridge.observe('s1', block)
    expect(emitted).toEqual([])
  })
})

describe('CliAgentThreadBridge interim streaming', () => {
  function recording(): {
    bridge: CliAgentThreadBridge
    emitted: CliAgentThreadMessageEvent[]
  } {
    const emitted: CliAgentThreadMessageEvent[] = []
    const bridge = new CliAgentThreadBridge({ onMessage: (e) => emitted.push(e) })
    return { bridge, emitted }
  }

  it('streams text deltas while running; the final body extends their concatenation', () => {
    const { bridge, emitted } = recording()
    bridge.bind('s1', 'thread-A')
    let block = startedBlock('s1', `claude --print --verbose --output-format stream-json 'hi'`)

    // Init line complete, text line still partial: nothing to stream yet.
    const textLine = claudeText('Hello')
    block = appendOutput(block, claudeInit + '\n' + textLine.slice(0, 12))
    bridge.observe('s1', block)
    expect(emitted).toEqual([])

    // Text line completes: one interim delta, no toolCalls (wire contract).
    block = appendOutput(block, textLine.slice(12) + '\n')
    bridge.observe('s1', block)
    expect(emitted).toHaveLength(1)
    expect(emitted[0].message.body).toBe('Hello')
    expect(emitted[0].message.toolCalls).toBeUndefined()
    expect(emitted[0].message.metadata?.endedAt).toBeUndefined()

    // Second segment arrives with the joiner embedded in the delta.
    block = appendOutput(block, claudeText('More text.') + '\n')
    bridge.observe('s1', block)
    expect(emitted).toHaveLength(2)
    expect(emitted[1].message.body).toBe('\n\nMore text.')

    block = completed(block, 0)
    bridge.observe('s1', block)
    expect(emitted).toHaveLength(3)
    const final = emitted[2].message
    expect(final.toolCalls?.[0].call.kind).toBe('cli_command')
    expect(final.body).toBe('Hello\n\nMore text.')
    expect(final.body.startsWith(emitted[0].message.body + emitted[1].message.body)).toBe(true)
  })

  it('captures the agent session id for thread continuity, surviving closeSession', () => {
    const { bridge } = recording()
    bridge.bind('s1', 'thread-A')
    let block = startedBlock('s1', `claude --print --verbose --output-format stream-json 'hi'`)
    block = appendOutput(block, claudeInit + '\n')
    bridge.observe('s1', block)
    expect(bridge.getAgentSessionId('thread-A')).toBe(CLAUDE_SESSION)
    bridge.closeSession('s1')
    expect(bridge.getAgentSessionId('thread-A')).toBe(CLAUDE_SESSION)
  })

  it('captures the codex thread id from thread.started', () => {
    const { bridge } = recording()
    bridge.bind('s1', 'thread-B')
    let block = startedBlock('s1', `codex exec --json 'hi'`)
    block = appendOutput(block, codexLines.slice(0, 2).join('\n') + '\n')
    bridge.observe('s1', block)
    expect(bridge.getAgentSessionId('thread-B')).toBe(CODEX_THREAD)
  })

  it('stops interim parsing when the output is truncated, keeping earlier text', () => {
    const { bridge, emitted } = recording()
    bridge.bind('s1', 'thread-A')
    let block = startedBlock('s1', `claude --print --verbose --output-format stream-json 'hi'`)
    block = appendOutput(block, claudeText('First') + '\n')
    bridge.observe('s1', block)
    expect(emitted).toHaveLength(1)

    // Blow past the output cap: the block model inserts a truncation marker.
    block = appendOutput(block, 'y'.repeat(400_000))
    bridge.observe('s1', block)
    expect(emitted).toHaveLength(1)

    block = completed(block, 0)
    bridge.observe('s1', block)
    expect(emitted).toHaveLength(2)
    expect(emitted[1].message.body).toBe('First')
  })

  it('keeps extracted text on a cancelled block alongside the error result', () => {
    const { bridge, emitted } = recording()
    bridge.bind('s1', 'thread-A')
    let block = startedBlock('s1', `claude --print --verbose --output-format stream-json 'hi'`)
    block = appendOutput(block, claudeText('Partial answer') + '\n')
    bridge.observe('s1', block)
    const r = cancelBlock(block, 5000)
    if (!r.ok) throw new Error(r.error)
    bridge.observe('s1', r.value)

    const final = emitted[emitted.length - 1].message
    expect(final.body).toBe('Partial answer')
    expect(final.toolCalls?.[0].result?.ok).toBe(false)
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

describe('CliAgentThreadBridge onTurnComplete (workstation step 3)', () => {
  function recordingWithLog(): {
    bridge: CliAgentThreadBridge
    log: { kind: 'message' | 'turn-complete'; threadId: string }[]
  } {
    const log: { kind: 'message' | 'turn-complete'; threadId: string }[] = []
    const bridge = new CliAgentThreadBridge({
      onMessage: (e) => log.push({ kind: 'message', threadId: e.threadId }),
      onTurnComplete: (threadId) => log.push({ kind: 'turn-complete', threadId })
    })
    return { bridge, log }
  }

  it('fires exactly once per completed block; running observes do not fire', () => {
    const { bridge, log } = recordingWithLog()
    bridge.bind('s1', 'thread-A')
    let block = startedBlock('s1', 'claude --print "x"')
    bridge.observe('s1', block)
    expect(log.filter((e) => e.kind === 'turn-complete')).toEqual([])
    block = completed(block, 0)
    bridge.observe('s1', block)
    // Re-observing the same completed block must not re-fire.
    bridge.observe('s1', block)
    bridge.observe('s1', block)
    expect(log.filter((e) => e.kind === 'turn-complete')).toEqual([
      { kind: 'turn-complete', threadId: 'thread-A' }
    ])
  })

  it('fires for cancelled blocks too', () => {
    const { bridge, log } = recordingWithLog()
    bridge.bind('s1', 'thread-A')
    const block = startedBlock('s1', 'claude --print "x"')
    const r = cancelBlock(block, 5000)
    if (!r.ok) throw new Error(r.error)
    bridge.observe('s1', r.value)
    expect(log.filter((e) => e.kind === 'turn-complete')).toEqual([
      { kind: 'turn-complete', threadId: 'thread-A' }
    ])
  })

  it('does not fire for unbound sessions', () => {
    const { bridge, log } = recordingWithLog()
    const block = completed(startedBlock('s1', 'claude --print "x"'), 0)
    bridge.observe('s1', block)
    expect(log).toEqual([])
  })

  it('does not fire for non-CLI-agent commands on a bound session', () => {
    const { bridge, log } = recordingWithLog()
    bridge.bind('s1', 'thread-A')
    const block = completed(startedBlock('s1', 'npm test'), 0)
    bridge.observe('s1', block)
    expect(log).toEqual([])
  })

  it("fires AFTER the block's final onMessage", () => {
    const { bridge, log } = recordingWithLog()
    bridge.bind('s1', 'thread-A')
    const block = completed(startedBlock('s1', 'claude --print "x"'), 0)
    bridge.observe('s1', block)
    expect(log).toEqual([
      { kind: 'message', threadId: 'thread-A' },
      { kind: 'turn-complete', threadId: 'thread-A' }
    ])
  })

  it('fires once per block for separate blocks in the same session', () => {
    const { bridge, log } = recordingWithLog()
    bridge.bind('s1', 'thread-A')
    const a = completed(startedBlock('s1', 'claude --print "a"'), 0)
    bridge.observe('s1', a)
    const p = pendingBlock('b-s1-2', meta('s1'))
    const r = startBlock(p, 'claude --print "b"', 2000)
    if (!r.ok) throw new Error(r.error)
    const b = completed(r.value, 0)
    bridge.observe('s1', b)
    expect(log.filter((e) => e.kind === 'turn-complete')).toHaveLength(2)
  })
})
