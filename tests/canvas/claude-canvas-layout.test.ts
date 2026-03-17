import { describe, it, expect } from 'vitest'
import { layoutClaudeConfig } from '../../src/renderer/src/panels/canvas/claude/claude-canvas-layout'
import type { ClaudeConfig } from '../../src/shared/claude-config-types'

function makeConfig(overrides: Partial<ClaudeConfig> = {}): ClaudeConfig {
  return {
    basePath: '/home/.claude',
    settings: null,
    agents: [],
    skills: [],
    rules: [],
    commands: [],
    teams: [],
    memories: [],
    ...overrides
  }
}

describe('claude-canvas-layout', () => {
  it('returns empty layout for empty config', () => {
    const result = layoutClaudeConfig(makeConfig())
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
  })

  it('creates a settings node when settings exist', () => {
    const result = layoutClaudeConfig(
      makeConfig({
        settings: {
          permissions: { allow: ['Read(*)', 'Write(*)'] },
          envVars: ['KEY'],
          plugins: ['mcp-server'],
          allowCount: 2,
          rawJson: {}
        }
      })
    )
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].type).toBe('claude-settings')
    expect(result.nodes[0].metadata).toMatchObject({
      permissionCount: 2,
      envVarCount: 1
    })
  })

  it('creates agent nodes in a grid', () => {
    const result = layoutClaudeConfig(
      makeConfig({
        agents: [
          {
            name: 'reviewer',
            description: 'Reviews code',
            model: 'opus',
            tools: ['Read'],
            filePath: '/agents/reviewer.md',
            instructionPreview: 'Review code'
          },
          {
            name: 'writer',
            description: 'Writes code',
            model: 'sonnet',
            tools: ['Write'],
            filePath: '/agents/writer.md',
            instructionPreview: 'Write code'
          }
        ]
      })
    )

    const agentNodes = result.nodes.filter((n) => n.type === 'claude-agent')
    expect(agentNodes).toHaveLength(2)

    // Two agents in a 2-column grid: same row, different X
    expect(agentNodes[0].position.y).toBe(agentNodes[1].position.y)
    expect(agentNodes[1].position.x).toBeGreaterThan(agentNodes[0].position.x)
  })

  it('creates skill nodes in a vertical column to the right', () => {
    const result = layoutClaudeConfig(
      makeConfig({
        skills: [
          {
            name: 'debugging',
            description: 'Debug workflow',
            filePath: '/skills/debugging/SKILL.md',
            promptFiles: [],
            referenceFiles: []
          }
        ]
      })
    )

    const skillNodes = result.nodes.filter((n) => n.type === 'claude-skill')
    expect(skillNodes).toHaveLength(1)
    expect(skillNodes[0].metadata).toMatchObject({ skillName: 'debugging' })
  })

  it('creates rule nodes in a horizontal row above center', () => {
    const result = layoutClaudeConfig(
      makeConfig({
        rules: [
          {
            name: 'constraints',
            category: 'common',
            content: 'No secrets',
            filePath: '/rules/common/constraints.md'
          },
          {
            name: 'workflow',
            category: 'common',
            content: 'PR rules',
            filePath: '/rules/common/workflow.md'
          }
        ]
      })
    )

    const ruleNodes = result.nodes.filter((n) => n.type === 'claude-rule')
    expect(ruleNodes).toHaveLength(2)

    // Rules should share the same Y position (horizontal row)
    expect(ruleNodes[0].position.y).toBe(ruleNodes[1].position.y)
  })

  it('creates edges from settings to agents', () => {
    const result = layoutClaudeConfig(
      makeConfig({
        settings: { permissions: {}, envVars: [], plugins: [], allowCount: 0, rawJson: {} },
        agents: [
          {
            name: 'reviewer',
            description: '',
            model: '',
            tools: [],
            filePath: '/agents/reviewer.md',
            instructionPreview: ''
          }
        ]
      })
    )

    expect(result.edges.length).toBeGreaterThanOrEqual(1)
    const settingsNode = result.nodes.find((n) => n.type === 'claude-settings')
    const agentNode = result.nodes.find((n) => n.type === 'claude-agent')
    expect(settingsNode).toBeDefined()
    expect(agentNode).toBeDefined()

    const edge = result.edges.find(
      (e) => e.fromNode === settingsNode!.id && e.toNode === agentNode!.id
    )
    expect(edge).toBeDefined()
    expect(edge!.fromSide).toBe('left')
    expect(edge!.toSide).toBe('right')
  })

  it('creates edges from teams to matching agents', () => {
    const result = layoutClaudeConfig(
      makeConfig({
        agents: [
          {
            name: 'reviewer',
            description: '',
            model: '',
            tools: [],
            filePath: '/agents/reviewer.md',
            instructionPreview: ''
          }
        ],
        teams: [
          {
            name: 'review-squad',
            members: ['reviewer'],
            lead: null,
            filePath: '/teams/review.json',
            rawConfig: {}
          }
        ]
      })
    )

    const teamNode = result.nodes.find((n) => n.type === 'claude-team')
    const agentNode = result.nodes.find((n) => n.type === 'claude-agent')

    const edge = result.edges.find((e) => e.fromNode === teamNode!.id && e.toNode === agentNode!.id)
    expect(edge).toBeDefined()
  })

  it('handles a full config with all types', () => {
    const result = layoutClaudeConfig(
      makeConfig({
        settings: { permissions: {}, envVars: [], plugins: [], allowCount: 0, rawJson: {} },
        agents: [
          {
            name: 'a',
            description: '',
            model: '',
            tools: [],
            filePath: '/a.md',
            instructionPreview: ''
          }
        ],
        skills: [
          { name: 's', description: '', filePath: '/s.md', promptFiles: [], referenceFiles: [] }
        ],
        rules: [{ name: 'r', category: 'common', content: '', filePath: '/r.md' }],
        commands: [{ name: 'c', description: '', content: '', filePath: '/c.md' }],
        teams: [{ name: 't', members: [], lead: null, filePath: '/t.json', rawConfig: {} }],
        memories: [
          {
            name: 'm',
            description: '',
            memoryType: 'user',
            content: '',
            filePath: '/m.md',
            links: []
          }
        ]
      })
    )

    // 1 settings + 1 agent + 1 skill + 1 rule + 1 command + 1 team + 1 memory = 7
    expect(result.nodes).toHaveLength(7)

    // Each type should be present
    const types = new Set(result.nodes.map((n) => n.type))
    expect(types.has('claude-settings')).toBe(true)
    expect(types.has('claude-agent')).toBe(true)
    expect(types.has('claude-skill')).toBe(true)
    expect(types.has('claude-rule')).toBe(true)
    expect(types.has('claude-command')).toBe(true)
    expect(types.has('claude-team')).toBe(true)
    expect(types.has('claude-memory')).toBe(true)

    // No overlapping positions
    const positions = result.nodes.map((n) => `${n.position.x},${n.position.y}`)
    expect(new Set(positions).size).toBe(positions.length)
  })
})
