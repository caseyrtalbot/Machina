// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { CliAgentThreadBridge, type CliAgentThreadMessageEvent } from '../cli-agent-thread-bridge'
import {
  appendOutput,
  cancelBlock,
  completeBlock,
  pendingBlock,
  startBlock,
  type Block,
  type BlockMetadata
} from '@shared/engine/block-model'

function meta(): BlockMetadata {
  return { sessionId: 's1', cwd: '/Users/c/proj', user: null, host: null, shellType: 'zsh' }
}

function rawBlock(id: string, command: string): Block {
  const started = startBlock(pendingBlock(id, meta()), command, 1000)
  if (!started.ok) throw new Error(started.error)
  return started.value
}

function completed(block: Block, exit = 0): Block {
  const result = completeBlock(block, exit, 5000)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function recordingRaw(): {
  bridge: CliAgentThreadBridge
  messages: CliAgentThreadMessageEvent[]
  turns: string[]
} {
  const messages: CliAgentThreadMessageEvent[] = []
  const turns: string[] = []
  const bridge = new CliAgentThreadBridge({
    onMessage: (event) => messages.push(event),
    onTurnComplete: (threadId) => turns.push(threadId)
  })
  bridge.bind('s1', 'thread-R', '/v', 'raw')
  return { bridge, messages, turns }
}

describe('CliAgentThreadBridge marked raw invocations', () => {
  it('keeps known-adapter bindings command-detected and rejects raw expectations on them', () => {
    const messages: CliAgentThreadMessageEvent[] = []
    const turns: string[] = []
    const bridge = new CliAgentThreadBridge({
      onMessage: (event) => messages.push(event),
      onTurnComplete: (threadId) => turns.push(threadId)
    })
    bridge.bind('s1', 'thread-A', '/v', 'claude')

    expect(bridge.expectRawInvocation('s1', 'mytool run')).toBe(false)
    bridge.observe('s1', completed(rawBlock('known-human', 'npm test')))
    bridge.observe('s1', completed(rawBlock('known-agent', 'codex exec task')))

    expect(messages).toHaveLength(1)
    expect(turns).toEqual(['thread-A'])
  })

  it('ignores unmarked and different human commands without consuming the expectation', () => {
    const { bridge, messages, turns } = recordingRaw()
    const expected = `\\mytool '--ask' 'fix it'`

    bridge.observe('s1', completed(rawBlock('raw-unmarked', expected)))
    expect(messages).toEqual([])
    expect(turns).toEqual([])

    expect(bridge.expectRawInvocation('s1', expected)).toBe(true)
    bridge.observe('s1', completed(rawBlock('raw-human', 'npm test')))
    expect(messages).toEqual([])
    expect(turns).toEqual([])

    bridge.observe('s1', completed(rawBlock('raw-expected', expected)))
    expect(messages).toHaveLength(1)
    expect(messages[0].message.toolCalls?.[0].call.args).toEqual({
      command: expected,
      cwd: '/Users/c/proj'
    })
    expect(turns).toEqual(['thread-R'])
  })

  it('refuses overlapping expectations and cancels only the matching pending command', () => {
    const { bridge, messages } = recordingRaw()
    expect(bridge.expectRawInvocation('s1', '\\first')).toBe(true)
    expect(bridge.expectRawInvocation('s1', '\\second')).toBe(false)

    bridge.cancelExpectedRawInvocation('s1', '\\second')
    bridge.observe('s1', completed(rawBlock('still-first', '\\first')))
    expect(messages).toHaveLength(1)

    expect(bridge.expectRawInvocation('s1', '\\third')).toBe(true)
    bridge.cancelExpectedRawInvocation('s1', '\\third')
    bridge.observe('s1', completed(rawBlock('cancelled-third', '\\third')))
    expect(messages).toHaveLength(1)
  })

  it.each([
    ['Ctrl-U', '\x15'],
    ['ESC', '\x1b'],
    ['DEL', '\x7f'],
    ['C1 CSI', '\u009b']
  ])('refuses %s at PTY registration without leaving a stuck expectation', (_label, byte) => {
    const { bridge, messages, turns } = recordingRaw()
    expect(bridge.expectRawInvocation('s1', `mytool before${byte}after`)).toBe(false)

    const safe = `\\mytool '--ask' 'safe'`
    expect(bridge.expectRawInvocation('s1', safe)).toBe(true)
    bridge.observe('s1', completed(rawBlock('safe-after-refusal', safe)))

    expect(messages).toHaveLength(1)
    expect(turns).toEqual(['thread-R'])
  })

  it('allows line feeds inside the already-quoted multi-line prompt command', () => {
    const { bridge, messages } = recordingRaw()
    const command = "\\mytool '--ask' 'line one\nline two'"

    expect(bridge.expectRawInvocation('s1', command)).toBe(true)
    bridge.observe('s1', completed(rawBlock('multiline-prompt', command)))

    expect(messages).toHaveLength(1)
  })

  it('observes running then completed and finalizes exactly once', () => {
    const { bridge, messages, turns } = recordingRaw()
    const command = `\\mytool '--ask' 'run'`
    expect(bridge.expectRawInvocation('s1', command)).toBe(true)

    let block = appendOutput(rawBlock('raw-running', command), 'working\n')
    bridge.observe('s1', block)
    expect(messages).toEqual([])
    expect(turns).toEqual([])

    block = completed(block)
    bridge.observe('s1', block)
    bridge.observe('s1', block)
    expect(messages).toHaveLength(1)
    expect(messages[0].message.body).toBe('')
    expect(messages[0].message.toolCalls?.[0].result).toMatchObject({
      ok: true,
      output: { output: 'working\n', exitCode: 0 }
    })
    expect(turns).toEqual(['thread-R'])
  })

  it('handles completion without a prior running observation exactly once', () => {
    const { bridge, messages, turns } = recordingRaw()
    const command = `\\mytool '--ask' 'one shot'`
    expect(bridge.expectRawInvocation('s1', command)).toBe(true)
    const block = completed(appendOutput(rawBlock('raw-complete-only', command), 'done\n'))

    bridge.observe('s1', block)
    bridge.observe('s1', block)

    expect(messages).toHaveLength(1)
    expect(turns).toEqual(['thread-R'])
  })

  it('finalizes a marked cancelled block exactly once', () => {
    const { bridge, messages, turns } = recordingRaw()
    const command = `\\mytool '--ask' 'cancel me'`
    expect(bridge.expectRawInvocation('s1', command)).toBe(true)
    const cancelled = cancelBlock(rawBlock('raw-cancelled', command), 5000)
    if (!cancelled.ok) throw new Error(cancelled.error)

    bridge.observe('s1', cancelled.value)
    bridge.observe('s1', cancelled.value)

    expect(messages).toHaveLength(1)
    expect(messages[0].message.toolCalls?.[0].result?.ok).toBe(false)
    expect(turns).toEqual(['thread-R'])
  })

  it('settles a marked running block exactly once when the PTY dies', () => {
    const { bridge, messages, turns } = recordingRaw()
    const command = `\\mytool '--ask' 'long run'`
    expect(bridge.expectRawInvocation('s1', command)).toBe(true)
    const block = appendOutput(rawBlock('raw-terminated', command), 'partial\n')
    bridge.observe('s1', block)

    bridge.closeSession('s1')
    bridge.closeSession('s1')
    bridge.observe('s1', completed(block))

    expect(messages).toHaveLength(1)
    expect(messages[0].message.toolCalls?.[0].result).toMatchObject({
      ok: false,
      error: { message: 'session terminated' }
    })
    expect(turns).toEqual(['thread-R'])
  })

  it('refuses alias-unstable bytes, unquoted spacing drift, and lone surrogates', () => {
    const { bridge, messages, turns } = recordingRaw()
    for (const command of [
      "mytool 'bare alias candidate'",
      "\\mytool  'repeated space'",
      "\\mytool 'trailing space' ",
      '\\printf "%s" $[1+2]',
      '\\mytool values[0]',
      `\\mytool '${'\ud800'}'`
    ]) {
      expect(bridge.expectRawInvocation('s1', command), command).toBe(false)
    }

    const stable = "\\mytool 'safe after refusals'"
    expect(bridge.expectRawInvocation('s1', stable)).toBe(true)
    bridge.observe('s1', completed(rawBlock('stable-after-refusals', stable)))
    expect(messages).toHaveLength(1)
    expect(turns).toEqual(['thread-R'])
  })
})
