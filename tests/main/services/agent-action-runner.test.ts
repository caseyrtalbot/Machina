// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import {
  extractJsonFromResponse,
  validateAgentOps,
  buildPlanFromOps,
  buildPrompt,
  runAgentAction
} from '../../../src/main/services/agent-action-runner'
import type { AgentContext, AgentActionRequest } from '@shared/agent-action-types'
import type { CanvasMutationOp } from '@shared/canvas-mutation-types'

describe('extractJsonFromResponse', () => {
  it('extracts JSON from a code fence', () => {
    const text = 'Here is the plan:\n```json\n{"ops": []}\n```\nDone.'
    expect(extractJsonFromResponse(text)).toEqual({ ops: [] })
  })

  it('extracts JSON from bare code fence', () => {
    const text = '```\n{"ops": [{"type": "move-node"}]}\n```'
    expect(extractJsonFromResponse(text)).toEqual({ ops: [{ type: 'move-node' }] })
  })

  it('extracts raw JSON object when no fence', () => {
    const text = '{"ops": [{"type": "add-node"}]}'
    expect(extractJsonFromResponse(text)).toEqual({ ops: [{ type: 'add-node' }] })
  })

  it('throws when no JSON found', () => {
    expect(() => extractJsonFromResponse('No json here')).toThrow('No JSON found')
  })
})

describe('validateAgentOps', () => {
  it('validates add-node ops', () => {
    const raw = [
      {
        type: 'add-node',
        node: {
          id: 'n1',
          type: 'text',
          position: { x: 100, y: 200 },
          size: { width: 200, height: 100 },
          content: 'New card',
          metadata: {}
        }
      }
    ]
    const result = validateAgentOps(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toHaveLength(1)
      expect(result.value[0].type).toBe('add-node')
    }
  })

  it('validates move-node ops', () => {
    const raw = [{ type: 'move-node', nodeId: 'a', position: { x: 50, y: 50 } }]
    const result = validateAgentOps(raw)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value[0].type).toBe('move-node')
  })

  it('validates add-edge ops with defaults for missing sides', () => {
    const raw = [{ type: 'add-edge', edge: { fromNode: 'a', toNode: 'b' } }]
    const result = validateAgentOps(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const op = result.value[0] as Extract<CanvasMutationOp, { type: 'add-edge' }>
      expect(op.edge.id).toBeTruthy() // auto-generated
      expect(op.edge.fromSide).toBe('bottom') // default
      expect(op.edge.toSide).toBe('top') // default
    }
  })

  it('validates resize-node ops', () => {
    const raw = [{ type: 'resize-node', nodeId: 'a', size: { width: 300, height: 200 } }]
    const result = validateAgentOps(raw)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value[0].type).toBe('resize-node')
  })

  it('validates remove-node ops', () => {
    const raw = [{ type: 'remove-node', nodeId: 'x' }]
    const result = validateAgentOps(raw)
    expect(result.ok).toBe(true)
  })

  it('validates remove-edge ops', () => {
    const raw = [{ type: 'remove-edge', edgeId: 'e1' }]
    const result = validateAgentOps(raw)
    expect(result.ok).toBe(true)
  })

  it('rejects ops with unknown type', () => {
    const raw = [{ type: 'fly-away', nodeId: 'a' }]
    const result = validateAgentOps(raw)
    expect(result.ok).toBe(false)
  })

  it('rejects non-array input', () => {
    const result = validateAgentOps('not an array')
    expect(result.ok).toBe(false)
  })

  it('rejects add-node with invalid node type', () => {
    const raw = [
      {
        type: 'add-node',
        node: { id: 'n1', type: 'hologram', position: { x: 0, y: 0 }, content: '' }
      }
    ]
    const result = validateAgentOps(raw)
    expect(result.ok).toBe(false)
  })
})

describe('buildPlanFromOps', () => {
  it('computes summary counts from ops', () => {
    const ops: CanvasMutationOp[] = [
      {
        type: 'add-node',
        node: {
          id: 'n1',
          type: 'text',
          position: { x: 0, y: 0 },
          size: { width: 200, height: 100 },
          content: 'test',
          metadata: {}
        }
      },
      {
        type: 'add-edge',
        edge: {
          id: 'e1',
          fromNode: 'a',
          toNode: 'n1',
          fromSide: 'bottom',
          toSide: 'top'
        }
      },
      { type: 'move-node', nodeId: 'a', position: { x: 100, y: 100 } }
    ]
    const plan = buildPlanFromOps(ops)
    expect(plan.source).toBe('agent')
    expect(plan.summary.addedNodes).toBe(1)
    expect(plan.summary.addedEdges).toBe(1)
    expect(plan.summary.movedNodes).toBe(1)
    expect(plan.id).toBeTruthy()
    expect(plan.operationId).toBeTruthy()
  })
})

describe('buildPrompt', () => {
  const minimalContext: AgentContext = {
    action: 'challenge',
    selectedCards: [
      {
        id: 'a',
        type: 'text',
        title: 'Test Card',
        body: 'Some content here',
        tags: ['idea'],
        position: { x: 0, y: 0 },
        size: { width: 200, height: 100 }
      }
    ],
    neighbors: [],
    edges: [],
    canvasMeta: {
      viewportBounds: { x: 0, y: 0, width: 1200, height: 800 },
      totalCardCount: 1
    }
  }

  it('includes the action name in the prompt', () => {
    const prompt = buildPrompt('challenge', minimalContext)
    expect(prompt).toContain('challenge')
  })

  it('includes card content in the prompt', () => {
    const prompt = buildPrompt('challenge', minimalContext)
    expect(prompt).toContain('Some content here')
  })

  it('includes JSON schema instructions', () => {
    const prompt = buildPrompt('challenge', minimalContext)
    expect(prompt).toContain('"ops"')
    expect(prompt).toContain('add-node')
  })

  it('builds prompts for all actions', () => {
    for (const action of ['challenge', 'emerge', 'organize', 'tidy', 'compile', 'ask'] as const) {
      const prompt = buildPrompt(action, { ...minimalContext, action })
      expect(prompt.length).toBeGreaterThan(100)
    }
  })
})

describe('buildPrompt with ask action', () => {
  const minimalContext: AgentContext = {
    action: 'challenge',
    selectedCards: [
      {
        id: 'a',
        type: 'text',
        title: 'Test Card',
        body: 'Some content here',
        tags: ['idea'],
        position: { x: 0, y: 0 },
        size: { width: 200, height: 100 }
      }
    ],
    neighbors: [],
    edges: [],
    canvasMeta: {
      viewportBounds: { x: 0, y: 0, width: 1200, height: 800 },
      totalCardCount: 1
    }
  }

  it('includes user prompt section when userPrompt is provided', () => {
    const prompt = buildPrompt(
      'ask',
      { ...minimalContext, action: 'ask' },
      'what is the tension here?'
    )
    expect(prompt).toContain('## User Prompt')
    expect(prompt).toContain('what is the tension here?')
  })

  it('omits user prompt section when userPrompt is absent', () => {
    const prompt = buildPrompt('ask', { ...minimalContext, action: 'ask' })
    expect(prompt).not.toContain('## User Prompt')
  })

  it('includes ask instructions', () => {
    const prompt = buildPrompt('ask', { ...minimalContext, action: 'ask' }, 'test')
    expect(prompt).toContain('thinking partner')
    expect(prompt).toContain('spatial canvas')
  })
})

describe('runAgentAction', () => {
  const minimalContext: AgentContext = {
    action: 'challenge',
    selectedCards: [
      {
        id: 'a',
        type: 'text',
        title: 'Test Card',
        body: 'Content',
        tags: [],
        position: { x: 0, y: 0 },
        size: { width: 200, height: 100 }
      }
    ],
    neighbors: [],
    edges: [],
    canvasMeta: { viewportBounds: { x: 0, y: 0, width: 1200, height: 800 }, totalCardCount: 1 }
  }

  const request: AgentActionRequest = { action: 'challenge', context: minimalContext }

  it('returns a plan when CLI returns valid JSON', async () => {
    const mockClaude = async () =>
      '```json\n{"ops": [{"type": "add-node", "node": {"id": "q1", "type": "text", "position": {"x": 300, "y": 200}, "size": {"width": 250, "height": 120}, "content": "A question", "metadata": {}}}]}\n```'

    const result = await runAgentAction(request, mockClaude)
    expect('plan' in result).toBe(true)
    if ('plan' in result) {
      expect(result.plan.ops).toHaveLength(1)
      expect(result.plan.ops[0].type).toBe('add-node')
      expect(result.plan.source).toBe('agent')
      expect(result.plan.summary.addedNodes).toBe(1)
    }
  })

  it('returns error when CLI returns invalid JSON', async () => {
    const mockClaude = async () => 'Sorry, I cannot help with that.'
    const result = await runAgentAction(request, mockClaude)
    expect('error' in result).toBe(true)
  })

  it('returns error when CLI returns invalid ops', async () => {
    const mockClaude = async () => '{"ops": [{"type": "fly-away"}]}'
    const result = await runAgentAction(request, mockClaude)
    expect('error' in result).toBe(true)
  })

  it('returns error when CLI throws', async () => {
    const mockClaude = async () => {
      throw new Error('claude not found')
    }
    const result = await runAgentAction(request, mockClaude)
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('claude not found')
    }
  })

  it('returns a plan with empty ops when CLI returns no operations', async () => {
    const mockClaude = async () => '{"ops": []}'
    const result = await runAgentAction(request, mockClaude)
    expect('plan' in result).toBe(true)
    if ('plan' in result) {
      expect(result.plan.ops).toHaveLength(0)
    }
  })
})

describe('runAgentAction with ask', () => {
  it('passes userPrompt through to prompt builder', async () => {
    const mockClaude = vi.fn().mockResolvedValue('```json\n{"ops":[]}\n```')
    const askContext: AgentContext = {
      action: 'ask',
      selectedCards: [
        {
          id: 'a',
          type: 'text',
          title: 'Test Card',
          body: 'Content',
          tags: [],
          position: { x: 0, y: 0 },
          size: { width: 200, height: 100 }
        }
      ],
      neighbors: [],
      edges: [],
      canvasMeta: {
        viewportBounds: { x: 0, y: 0, width: 1200, height: 800 },
        totalCardCount: 1
      }
    }
    await runAgentAction(
      { action: 'ask', context: askContext, userPrompt: 'explain this' },
      mockClaude
    )
    const callArg = mockClaude.mock.calls[0][0] as string
    expect(callArg).toContain('explain this')
  })
})

import { EventEmitter } from 'events'
import { Readable, Writable } from 'stream'
import type { AgentStreamEvent } from '@shared/agent-action-types'

// ---------------------------------------------------------------------------
// callClaude streaming tests — use a fake ChildProcess-like shape
// ---------------------------------------------------------------------------

// Minimal ChildProcess shim: stdin writable, stdout readable, kill(), close emitter
function makeFakeProc() {
  const noop = () => {}
  const stdout = new Readable({ read: noop })
  const stderr = new Readable({ read: noop })
  const stdin = new Writable({
    write(_c, _e, cb) {
      cb()
    }
  })
  const ee = new EventEmitter()
  const proc = {
    stdout,
    stderr,
    stdin,
    kill: vi.fn((_sig?: string) => {
      ee.emit('close', 0)
    }),
    on: (event: string, cb: (...args: unknown[]) => void) => ee.on(event, cb),
    emit: (event: string, ...args: unknown[]) => ee.emit(event, ...args)
  }
  return proc
}

// Helper to write a JSONL line into the fake stdout.
// We emit 'data' synchronously (rather than push()) so the production code's
// standard .on('data', ...) handler fires immediately — push() defers via
// nextTick, which vi.advanceTimersByTime cannot flush.
function emitLine(proc: ReturnType<typeof makeFakeProc>, obj: unknown) {
  proc.stdout.emit('data', Buffer.from(JSON.stringify(obj) + '\n'))
}

describe('callClaude streaming transport', () => {
  it('parses stream events and forwards typed deltas via onEvent', async () => {
    vi.useFakeTimers()
    const proc = makeFakeProc()
    const spawned: Array<{ bin: string; args: string[] }> = []
    const spawnFn = (bin: string, args: string[]) => {
      spawned.push({ bin, args })
      return proc as unknown as ReturnType<typeof import('child_process').spawn>
    }

    const { callClaudeWith } = await import('../../../src/main/services/agent-action-runner')
    const events: AgentStreamEvent[] = []
    const pending = callClaudeWith(spawnFn, 'prompt text', (ev) => events.push(ev))

    // Allow event loop to wire stdout listeners before we push data
    await Promise.resolve()

    emitLine(proc, { type: 'system', subtype: 'init' })
    emitLine(proc, { type: 'stream_event', event: { type: 'message_start' } })
    emitLine(proc, {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Hmm...' } }
    })
    emitLine(proc, {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Here is the plan.' }
      }
    })
    emitLine(proc, { type: 'result', result: '```json\n{"ops":[]}\n```' })
    proc.emit('close', 0)

    const output = await pending
    expect(output).toContain('"ops"')
    expect(spawned[0].args).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages'
    ])
    expect(events.map((e) => e.kind)).toEqual([
      'phase', // thinking (on message_start)
      'thinking-delta',
      'phase', // drafting (on first text delta)
      'text-delta'
    ])
    const phases = events.filter((e) => e.kind === 'phase') as Extract<
      AgentStreamEvent,
      { kind: 'phase' }
    >[]
    expect(phases.map((p) => p.phase)).toEqual(['thinking', 'drafting'])
    vi.useRealTimers()
  })

  it('throws stalled error with tag after 30s silence', async () => {
    vi.useFakeTimers()
    const proc = makeFakeProc()
    const { callClaudeWith } = await import('../../../src/main/services/agent-action-runner')
    const pending = callClaudeWith(
      () => proc as unknown as ReturnType<typeof import('child_process').spawn>,
      'prompt',
      () => {}
    ).catch((e) => e)

    await Promise.resolve()
    vi.advanceTimersByTime(30_001)
    const err = await pending
    expect(err).toBeInstanceOf(Error)
    expect((err as Error & { tag?: string }).tag).toBe('stalled')
    vi.useRealTimers()
  })

  it('throws cap error with tag after 180s even with activity', async () => {
    vi.useFakeTimers()
    const proc = makeFakeProc()
    const { callClaudeWith } = await import('../../../src/main/services/agent-action-runner')
    const pending = callClaudeWith(
      () => proc as unknown as ReturnType<typeof import('child_process').spawn>,
      'prompt',
      () => {}
    ).catch((e) => e)

    await Promise.resolve()
    for (let t = 0; t < 180_000; t += 10_000) {
      emitLine(proc, { type: 'system' })
      vi.advanceTimersByTime(10_000)
    }
    vi.advanceTimersByTime(1)
    const err = await pending
    expect(err).toBeInstanceOf(Error)
    expect((err as Error & { tag?: string }).tag).toBe('cap')
    vi.useRealTimers()
  })

  it('throws cli-error tag on non-zero exit', async () => {
    const proc = makeFakeProc()
    const { callClaudeWith } = await import('../../../src/main/services/agent-action-runner')
    const pending = callClaudeWith(
      () => proc as unknown as ReturnType<typeof import('child_process').spawn>,
      'prompt',
      () => {}
    ).catch((e) => e)

    await Promise.resolve()
    proc.stderr.emit('data', Buffer.from('some error text\n'))
    proc.emit('close', 1)
    const err = await pending
    expect((err as Error & { tag?: string }).tag).toBe('cli-error')
    expect((err as Error).message).toContain('some error text')
  })

  it('throws not-found tag when spawn fires ENOENT error', async () => {
    const proc = makeFakeProc()
    const { callClaudeWith } = await import('../../../src/main/services/agent-action-runner')
    const pending = callClaudeWith(
      () => proc as unknown as ReturnType<typeof import('child_process').spawn>,
      'prompt',
      () => {}
    ).catch((e) => e)

    await Promise.resolve()
    const enoent = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
    proc.emit('error', enoent)
    const err = await pending
    expect((err as Error & { tag?: string }).tag).toBe('not-found')
  })
})

describe('runAgentAction streaming integration', () => {
  it('emits starting and materializing phases via onStream', async () => {
    const events: AgentStreamEvent[] = []
    const request: AgentActionRequest = {
      action: 'challenge',
      context: {
        action: 'challenge',
        selectedCards: [
          {
            id: 'a',
            type: 'text',
            title: 't',
            body: 'b',
            tags: [],
            position: { x: 0, y: 0 },
            size: { width: 200, height: 100 }
          }
        ],
        neighbors: [],
        edges: [],
        canvasMeta: {
          viewportBounds: { x: 0, y: 0, width: 1200, height: 800 },
          totalCardCount: 1
        }
      }
    }
    const mockClaude = async () =>
      '```json\n{"ops": [{"type": "add-node", "node": {"id": "n1", "type": "text", "position": {"x":0,"y":0}, "size": {"width":200,"height":100}, "content": "x", "metadata": {}}}]}\n```'

    const result = await runAgentAction(request, mockClaude, (ev) => events.push(ev))

    expect('plan' in result).toBe(true)
    const phases = events
      .filter((e): e is Extract<AgentStreamEvent, { kind: 'phase' }> => e.kind === 'phase')
      .map((e) => e.phase)
    expect(phases[0]).toBe('starting')
    expect(phases[phases.length - 1]).toBe('materializing')
    const mat = events[events.length - 1] as Extract<AgentStreamEvent, { kind: 'phase' }>
    expect(mat.count).toBe(1)
  })

  it('tags invalid-output errors', async () => {
    const mockClaude = async () => 'sorry, cannot help'
    const request: AgentActionRequest = {
      action: 'challenge',
      context: {
        action: 'challenge',
        selectedCards: [
          {
            id: 'a',
            type: 'text',
            title: 't',
            body: 'b',
            tags: [],
            position: { x: 0, y: 0 },
            size: { width: 200, height: 100 }
          }
        ],
        neighbors: [],
        edges: [],
        canvasMeta: {
          viewportBounds: { x: 0, y: 0, width: 1200, height: 800 },
          totalCardCount: 1
        }
      }
    }
    const result = await runAgentAction(request, mockClaude)
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.tag).toBe('invalid-output')
    }
  })
})
