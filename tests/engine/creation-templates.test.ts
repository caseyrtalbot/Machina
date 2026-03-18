import { describe, it, expect } from 'vitest'
import {
  slugify,
  generateCommandTemplate,
  generateAgentTemplate,
  generateSkillTemplate,
  generateMemoryTemplate,
  generateRuleTemplate,
  getTargetPath
} from '../../src/renderer/src/panels/claude-config/creation-templates'

describe('creation-templates', () => {
  describe('slugify', () => {
    it('lowercases and replaces spaces with hyphens', () => {
      expect(slugify('My Command')).toBe('my-command')
    })
    it('strips special characters', () => {
      expect(slugify('hello@world!')).toBe('helloworld')
    })
    it('collapses consecutive hyphens', () => {
      expect(slugify('a--b---c')).toBe('a-b-c')
    })
    it('trims leading/trailing hyphens', () => {
      expect(slugify('-hello-')).toBe('hello')
    })
    it('replaces underscores with hyphens', () => {
      expect(slugify('my_command')).toBe('my-command')
    })
    it('returns empty string for whitespace-only input', () => {
      expect(slugify('   ')).toBe('')
    })
  })

  describe('template generators', () => {
    it('generates command template with frontmatter', () => {
      const result = generateCommandTemplate('deploy')
      expect(result).toContain('---')
      expect(result).toContain('description:')
      expect(result).toContain('/deploy')
    })
    it('generates agent template with tools list', () => {
      const result = generateAgentTemplate('reviewer', 'Code review expert', 'sonnet', [
        'Read',
        'Grep'
      ])
      expect(result).toContain('name: reviewer')
      expect(result).toContain('model: sonnet')
      expect(result).toContain('  - Read')
      expect(result).toContain('  - Grep')
    })
    it('generates skill template with title case heading', () => {
      const result = generateSkillTemplate('deploy-check', 'Verify deployment')
      expect(result).toContain('# Deploy Check')
      expect(result).toContain('name: deploy-check')
    })
    it('generates memory template with type-specific guidance', () => {
      const result = generateMemoryTemplate('testing-rules', 'Rules for testing', 'feedback')
      expect(result).toContain('type: feedback')
      expect(result).toContain('Why:')
    })
    it('generates rule template with heading', () => {
      const result = generateRuleTemplate('no-console')
      expect(result).toContain('# No Console')
    })
  })

  describe('getTargetPath', () => {
    it('returns correct command path', () => {
      expect(getTargetPath('command', '/home/.claude', 'deploy')).toBe(
        '/home/.claude/commands/deploy.md'
      )
    })
    it('returns correct skill directory path', () => {
      expect(getTargetPath('skill', '/home/.claude', 'my-skill')).toBe(
        '/home/.claude/skills/my-skill/SKILL.md'
      )
    })
    it('returns correct memory path with type prefix', () => {
      const path = getTargetPath('memory', '/home/.claude', 'testing', {
        memoryType: 'feedback',
        projectPath: '/Users/casey/project'
      })
      expect(path).toContain('feedback-testing.md')
      expect(path).toContain('projects/')
    })
    it('returns correct rule path with category', () => {
      const path = getTargetPath('rule', '/home/.claude', 'no-console', { category: 'common' })
      expect(path).toBe('/home/.claude/rules/common/no-console.md')
    })
  })
})
