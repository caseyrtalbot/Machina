import { describe, it, expect } from 'vitest'
import { buildScopeContext } from '@shared/action-types'

describe('buildScopeContext', () => {
  it('returns vault-wide scope when no files selected', () => {
    const result = buildScopeContext(new Set(), '/Users/me/vault')
    expect(result).toContain('Operate on the entire vault')
    expect(result).toContain('/Users/me/vault')
    expect(result).toContain('Glob **/*.md')
  })

  it('returns file-scoped context with relative paths', () => {
    const selected = new Set(['/Users/me/vault/notes/idea.md', '/Users/me/vault/research/paper.md'])
    const result = buildScopeContext(selected, '/Users/me/vault')
    expect(result).toContain('notes/idea.md')
    expect(result).toContain('research/paper.md')
    expect(result).toContain('Operate on these files')
  })

  it('handles paths that do not start with vault path', () => {
    const selected = new Set(['external/file.md'])
    const result = buildScopeContext(selected, '/Users/me/vault')
    expect(result).toContain('external/file.md')
  })
})
