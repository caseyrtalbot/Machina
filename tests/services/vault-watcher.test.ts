import { describe, it, expect } from 'vitest'
import { buildIgnorePatterns, DEFAULT_IGNORE_PATTERNS } from '../../src/main/services/vault-watcher'

describe('vault-watcher ignore patterns', () => {
  it('includes default ignores', () => {
    expect(DEFAULT_IGNORE_PATTERNS).toContain('node_modules')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('.machina')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('dist')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('build')
  })

  it('merges custom patterns with defaults', () => {
    const result = buildIgnorePatterns(['vendor', '*.log'])
    expect(result).toContain('node_modules')
    expect(result).toContain('vendor')
    expect(result).toContain('*.log')
  })

  it('deduplicates patterns', () => {
    const result = buildIgnorePatterns(['node_modules', 'vendor'])
    const count = result.filter((p) => p === 'node_modules').length
    expect(count).toBe(1)
  })

  it('handles empty custom patterns', () => {
    const result = buildIgnorePatterns([])
    expect(result.length).toBe(DEFAULT_IGNORE_PATTERNS.length)
  })
})
