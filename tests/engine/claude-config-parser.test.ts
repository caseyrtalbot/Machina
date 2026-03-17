import { describe, it, expect } from 'vitest'
import {
  parseClaudeSettings,
  parseClaudeAgent,
  parseClaudeSkill,
  parseClaudeRule,
  parseClaudeCommand,
  parseClaudeTeam,
  parseClaudeMemory
} from '../../src/renderer/src/engine/claude-config-parser'

describe('claude-config-parser', () => {
  describe('parseClaudeSettings', () => {
    it('parses a real settings.json with dict env and enabledPlugins', () => {
      const json = JSON.stringify({
        permissions: { allow: ['Bash(npx build)', 'Read(*)'], additionalDirectories: ['/tmp'] },
        env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1', NODE_ENV: 'dev' },
        enabledPlugins: {
          'vercel@official': true,
          'figma@official': true,
          'disabled@official': false
        }
      })
      const settings = parseClaudeSettings(json)
      expect(settings.envVars).toEqual(['CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', 'NODE_ENV'])
      expect(settings.plugins).toEqual(['vercel@official', 'figma@official'])
      expect(settings.allowCount).toBe(2)
    })

    it('handles invalid JSON gracefully', () => {
      const settings = parseClaudeSettings('not json')
      expect(settings.permissions).toEqual({})
      expect(settings.envVars).toEqual([])
      expect(settings.plugins).toEqual([])
      expect(settings.allowCount).toBe(0)
    })

    it('handles empty object', () => {
      const settings = parseClaudeSettings('{}')
      expect(settings.envVars).toEqual([])
      expect(settings.plugins).toEqual([])
      expect(settings.allowCount).toBe(0)
    })

    it('handles legacy array env format', () => {
      const json = JSON.stringify({ env: ['KEY1', 'KEY2'] })
      const settings = parseClaudeSettings(json)
      // Array env is not a dict, so envVars should be empty
      expect(settings.envVars).toEqual([])
    })
  })

  describe('parseClaudeAgent', () => {
    it('parses agent with frontmatter', () => {
      const content = `---
name: code-reviewer
description: Reviews code for quality
model: opus
tools:
  - Read
  - Grep
  - Glob
---

Review all changed files for issues.`

      const agent = parseClaudeAgent(content, '/home/.claude/agents/code-reviewer.md')
      expect(agent.name).toBe('code-reviewer')
      expect(agent.description).toBe('Reviews code for quality')
      expect(agent.model).toBe('opus')
      expect(agent.tools).toEqual(['Read', 'Grep', 'Glob'])
      expect(agent.instructionPreview).toContain('Review all changed files')
    })

    it('falls back to filename when no frontmatter', () => {
      const content = 'Just some instructions without frontmatter'
      const agent = parseClaudeAgent(content, '/agents/my-agent.md')
      expect(agent.name).toBe('my-agent')
      expect(agent.model).toBe('')
      expect(agent.tools).toEqual([])
    })

    it('truncates long instruction preview', () => {
      const longContent = '---\nname: test\n---\n\n' + 'A'.repeat(200)
      const agent = parseClaudeAgent(longContent, '/agents/test.md')
      expect(agent.instructionPreview.length).toBeLessThanOrEqual(123) // 120 + '...'
    })
  })

  describe('parseClaudeSkill', () => {
    it('parses SKILL.md with subfiles', () => {
      const content = `---
name: debugging
description: Step-by-step debugging workflow
---

Follow the debugging process.`

      const skill = parseClaudeSkill(content, '/skills/debugging/SKILL.md', [
        '/skills/debugging/SKILL.md',
        '/skills/debugging/prompts/init.md',
        '/skills/debugging/prompts/analyze.md',
        '/skills/debugging/references/patterns.md'
      ])

      expect(skill.name).toBe('debugging')
      expect(skill.description).toBe('Step-by-step debugging workflow')
      expect(skill.promptFiles).toHaveLength(2)
      expect(skill.referenceFiles).toHaveLength(1)
    })

    it('derives name from parent dir when no frontmatter name', () => {
      const content = '---\ndescription: test\n---\n\nContent'
      const skill = parseClaudeSkill(content, '/skills/my-skill/SKILL.md', [])
      expect(skill.name).toBe('my-skill')
    })
  })

  describe('parseClaudeRule', () => {
    it('parses rule with category from parent dir', () => {
      const content = '# Constraints\n\nNever hardcode secrets.'
      const rule = parseClaudeRule(content, '/rules/common/constraints.md')
      expect(rule.name).toBe('constraints')
      expect(rule.category).toBe('common')
      expect(rule.content).toContain('Never hardcode secrets')
    })

    it('defaults to global category when at root', () => {
      const rule = parseClaudeRule('Some rule', '/rules/my-rule.md')
      expect(rule.category).toBe('rules')
    })
  })

  describe('parseClaudeCommand', () => {
    it('extracts description from first H1', () => {
      const content = '# Generate a commit message\n\nLook at staged changes...'
      const cmd = parseClaudeCommand(content, '/commands/commit.md')
      expect(cmd.name).toBe('commit')
      expect(cmd.description).toBe('Generate a commit message')
    })

    it('handles content with no heading', () => {
      const cmd = parseClaudeCommand('Just instructions', '/commands/test.md')
      expect(cmd.name).toBe('test')
      expect(cmd.description).toBe('')
    })
  })

  describe('parseClaudeTeam', () => {
    it('parses team with string members', () => {
      const json = JSON.stringify({
        name: 'review-squad',
        members: ['code-reviewer', 'security-reviewer'],
        lead: 'code-reviewer'
      })
      const team = parseClaudeTeam(json, '/teams/review-squad/config.json')
      expect(team.name).toBe('review-squad')
      expect(team.members).toEqual(['code-reviewer', 'security-reviewer'])
      expect(team.lead).toBe('code-reviewer')
    })

    it('parses team with object members (real Claude Code format)', () => {
      const json = JSON.stringify({
        members: [
          {
            agentId: 'team-lead@db-fix-team',
            name: 'team-lead',
            agentType: 'team-lead',
            model: 'opus'
          },
          {
            agentId: 'code-fixer@db-fix-team',
            name: 'code-fixer',
            agentType: 'member',
            model: 'sonnet'
          }
        ]
      })
      const team = parseClaudeTeam(json, '/teams/db-fix-team/config.json')
      expect(team.name).toBe('db-fix-team')
      expect(team.members).toEqual(['team-lead', 'code-fixer'])
    })

    it('extracts name from agentId when name field missing', () => {
      const json = JSON.stringify({
        members: [{ agentId: 'reviewer@my-team' }]
      })
      const team = parseClaudeTeam(json, '/teams/my-team/config.json')
      expect(team.members).toEqual(['reviewer'])
    })

    it('derives team name from directory path', () => {
      const json = JSON.stringify({ members: [] })
      const team = parseClaudeTeam(json, '/teams/phase-1-build/config.json')
      expect(team.name).toBe('phase-1-build')
    })

    it('handles invalid JSON', () => {
      const team = parseClaudeTeam('not json', '/teams/broken/config.json')
      expect(team.name).toBe('broken')
      expect(team.members).toEqual([])
      expect(team.lead).toBeNull()
    })
  })

  describe('parseClaudeMemory', () => {
    it('parses memory with frontmatter and extracts links', () => {
      const content = `---
name: casey-central
description: Full context about Casey
type: user
---

See [casey-central.md](casey-central.md) and [feedback.md](feedback.md) for details.`

      const memory = parseClaudeMemory(content, '/memory/casey-central.md')
      expect(memory.name).toBe('casey-central')
      expect(memory.description).toBe('Full context about Casey')
      expect(memory.memoryType).toBe('user')
      expect(memory.links).toEqual(['casey-central.md', 'feedback.md'])
    })

    it('handles memory without frontmatter', () => {
      const content = 'Just some memory notes with [link.md](link.md)'
      const memory = parseClaudeMemory(content, '/memory/note.md')
      expect(memory.name).toBe('note')
      expect(memory.memoryType).toBe('unknown')
      expect(memory.links).toEqual(['link.md'])
    })

    it('handles empty content', () => {
      const memory = parseClaudeMemory('', '/memory/empty.md')
      expect(memory.name).toBe('empty')
      expect(memory.links).toEqual([])
    })
  })
})
