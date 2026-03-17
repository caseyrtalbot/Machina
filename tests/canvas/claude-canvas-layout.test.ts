import { describe, it, expect } from 'vitest'
import { layoutClaudeConfig } from '../../src/renderer/src/panels/canvas/claude/claude-canvas-layout'
import type { ClaudeConfig } from '../../src/shared/claude-config-types'

function makeConfig(overrides: Partial<ClaudeConfig> = {}): ClaudeConfig {
  return {
    basePath: '/home/.claude',
    projectPath: null,
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
    expect(result.labels).toEqual([])
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
          { name: 'reviewer', description: 'Reviews code', model: 'opus', tools: ['Read'], filePath: '/agents/reviewer.md', instructionPreview: 'Review code', scope: 'global' },
          { name: 'writer', description: 'Writes code', model: 'sonnet', tools: ['Write'], filePath: '/agents/writer.md', instructionPreview: 'Write code', scope: 'global' }
        ]
      })
    )
    const agentNodes = result.nodes.filter((n) => n.type === 'claude-agent')
    expect(agentNodes).toHaveLength(2)
  })

  it('creates skill nodes with names', () => {
    const result = layoutClaudeConfig(
      makeConfig({
        skills: [
          { name: 'debugging', description: 'Debug workflow', filePath: '/skills/debugging/SKILL.md', promptFiles: [], referenceFiles: [], scope: 'global' }
        ]
      })
    )
    const skillNodes = result.nodes.filter((n) => n.type === 'claude-skill')
    expect(skillNodes).toHaveLength(1)
    expect(skillNodes[0].metadata).toMatchObject({ skillName: 'debugging' })
  })

  it('creates edges from settings to agents', () => {
    const result = layoutClaudeConfig(
      makeConfig({
        settings: { permissions: {}, envVars: [], plugins: [], allowCount: 0, rawJson: {} },
        agents: [
          { name: 'reviewer', description: '', model: '', tools: [], filePath: '/agents/reviewer.md', instructionPreview: '', scope: 'global' }
        ]
      })
    )
    expect(result.edges.length).toBeGreaterThanOrEqual(1)
  })

  it('handles a full config with all types', () => {
    const result = layoutClaudeConfig(
      makeConfig({
        settings: { permissions: {}, envVars: [], plugins: [], allowCount: 0, rawJson: {} },
        agents: [{ name: 'a', description: '', model: '', tools: [], filePath: '/a.md', instructionPreview: '', scope: 'global' }],
        skills: [{ name: 's', description: '', filePath: '/s.md', promptFiles: [], referenceFiles: [], scope: 'global' }],
        rules: [{ name: 'r', category: 'common', content: '', filePath: '/r.md', scope: 'global' }],
        commands: [{ name: 'c', description: '', content: '', filePath: '/c.md', scope: 'global' }],
        teams: [{ name: 't', members: [], lead: null, filePath: '/t.json', rawConfig: {}, scope: 'global' }],
        memories: [{ name: 'm', description: '', memoryType: 'user', content: '', filePath: '/m.md', links: [], scope: 'global' }]
      })
    )
    expect(result.nodes).toHaveLength(7)
    const types = new Set(result.nodes.map((n) => n.type))
    expect(types.size).toBe(7)
  })

  it('generates zone labels for populated zones', () => {
    const result = layoutClaudeConfig(
      makeConfig({
        rules: [{ name: 'r', category: 'common', content: '', filePath: '/r.md', scope: 'global' }],
        commands: [{ name: 'c', description: '', content: '', filePath: '/c.md', scope: 'global' }]
      })
    )
    expect(result.labels.length).toBeGreaterThanOrEqual(2)
    const labelTexts = result.labels.map((l) => l.text)
    expect(labelTexts.some((t) => t.startsWith('Rules'))).toBe(true)
    expect(labelTexts.some((t) => t.startsWith('Commands'))).toBe(true)
  })

  it('no overlapping positions', () => {
    const result = layoutClaudeConfig(
      makeConfig({
        settings: { permissions: {}, envVars: [], plugins: [], allowCount: 0, rawJson: {} },
        agents: [{ name: 'a', description: '', model: '', tools: [], filePath: '/a.md', instructionPreview: '', scope: 'global' }],
        skills: [{ name: 's', description: '', filePath: '/s.md', promptFiles: [], referenceFiles: [], scope: 'global' }],
        rules: [{ name: 'r', category: 'common', content: '', filePath: '/r.md', scope: 'global' }]
      })
    )
    const positions = result.nodes.map((n) => `${n.position.x},${n.position.y}`)
    expect(new Set(positions).size).toBe(positions.length)
  })
})
