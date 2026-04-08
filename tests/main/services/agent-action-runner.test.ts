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
    expect(mockClaude).toHaveBeenCalledWith(expect.stringContaining('explain this'))
  })
})
