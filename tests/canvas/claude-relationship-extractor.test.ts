import { describe, it, expect } from 'vitest'
import { extractRelationships } from '../../src/renderer/src/engine/claude-relationship-extractor'
import type { ClaudeConfig } from '@shared/claude-config-types'
import type { CanvasNode } from '@shared/canvas-types'

function makeNode(
  id: string,
  type: CanvasNode['type'],
  metadata: Record<string, unknown>
): CanvasNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    content: '',
    metadata
  }
}

function makeConfig(overrides: Partial<ClaudeConfig> = {}): ClaudeConfig {
  return {
    basePath: '/tmp/.claude',
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

describe('extractRelationships', () => {
  it('should not create false skill-references from short substring matches', () => {
    const config = makeConfig({
      skills: [
        {
          name: 'research',
          description: 'Multi-agent research tool',
          filePath: '',
          scope: 'global',
          promptFiles: [],
          referenceFiles: []
        },
        {
          name: 'research-team',
          description: 'Orchestrates the research council',
          filePath: '',
          scope: 'global',
          promptFiles: [],
          referenceFiles: []
        }
      ]
    })
    const nodes: CanvasNode[] = [
      makeNode('s1', 'claude-skill', { skillName: 'research' }),
      makeNode('s2', 'claude-skill', { skillName: 'research-team' })
    ]
    const edges = extractRelationships(config, nodes)
    const skillRefs = edges.filter((e) => e.kind === 'skill-references')
    expect(skillRefs.length).toBe(0)
  })

  it('should match explicit skill invocations with slash prefix', () => {
    const config = makeConfig({
      skills: [
        {
          name: 'extract',
          description: 'Extract wisdom from content',
          filePath: '',
          scope: 'global',
          promptFiles: [],
          referenceFiles: []
        },
        {
          name: 'enrich',
          description: 'Uses /extract to pipe data',
          filePath: '',
          scope: 'global',
          promptFiles: [],
          referenceFiles: []
        }
      ]
    })
    const nodes: CanvasNode[] = [
      makeNode('s1', 'claude-skill', { skillName: 'extract' }),
      makeNode('s2', 'claude-skill', { skillName: 'enrich' })
    ]
    const edges = extractRelationships(config, nodes)
    const skillRefs = edges.filter((e) => e.kind === 'skill-references')
    expect(skillRefs.length).toBe(1)
    expect(skillRefs[0].fromNode).toBe('s2')
    expect(skillRefs[0].toNode).toBe('s1')
  })
})
