import { describe, it, expect } from 'vitest'
import { DEFAULT_IGNORE_PATTERNS } from '../../src/main/services/vault-watcher'

describe('vault-watcher ignore patterns', () => {
  it('includes default ignores', () => {
    expect(DEFAULT_IGNORE_PATTERNS).toContain('node_modules')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('dist')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('build')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('.git')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('.DS_Store')
  })

  it('includes blanket dotfile pattern to filter all hidden files', () => {
    expect(DEFAULT_IGNORE_PATTERNS).toContain('.*')
  })
})
