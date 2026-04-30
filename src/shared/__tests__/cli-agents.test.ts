import { describe, expect, it } from 'vitest'
import { CLI_AGENTS, getAgentSpec, type CLIAgentSpec } from '../cli-agents'

describe('CLI_AGENTS registry', () => {
  it('ships entries for claude, codex, and gemini', () => {
    const ids = CLI_AGENTS.map((a) => a.id)
    expect(ids).toEqual(expect.arrayContaining(['claude', 'codex', 'gemini']))
  })

  it('every entry exposes the required spec fields', () => {
    for (const agent of CLI_AGENTS) {
      expect(typeof agent.id).toBe('string')
      expect(typeof agent.displayName).toBe('string')
      expect(agent.brandColor).toMatch(/^#[0-9a-f]{6}$/i)
      expect(typeof agent.cliBinary).toBe('string')
      expect(typeof agent.versionFlag).toBe('string')
      expect(agent.detectVersionRegex).toBeInstanceOf(RegExp)
    }
  })

  it('ids are unique', () => {
    const ids = CLI_AGENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('getAgentSpec', () => {
  it('returns the matching spec when the id is registered', () => {
    const spec = getAgentSpec('claude')
    expect(spec).not.toBeNull()
    expect(spec?.id).toBe('claude')
    expect(spec?.displayName).toBe('Claude Code')
  })

  it('returns null for an unknown id', () => {
    expect(getAgentSpec('unknown-agent')).toBeNull()
  })

  it('is type-narrowed to CLIAgentSpec on hit', () => {
    const spec: CLIAgentSpec | null = getAgentSpec('codex')
    expect(spec?.cliBinary).toBe('codex')
  })
})
