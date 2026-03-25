import { describe, it, expect } from 'vitest'
import {
  createIgnoreFilter,
  toRelativeSlashPath,
  shouldIgnore
} from '../../src/main/services/gitignore-filter'

const VAULT = '/Users/test/my-vault'

const DEFAULT_PATTERNS = [
  'node_modules',
  '.machina',
  'dist',
  'build',
  'out',
  '.git',
  '.DS_Store',
  '.*'
]

describe('createIgnoreFilter', () => {
  it('parses a .gitignore with standard patterns', () => {
    const gitignore = ['*.pyc', '__pycache__/', '.env', 'venv/', '*.log'].join('\n')
    const ig = createIgnoreFilter(DEFAULT_PATTERNS, [], gitignore)

    expect(ig.ignores('file.pyc')).toBe(true)
    expect(ig.ignores('__pycache__/cache.dat')).toBe(true)
    expect(ig.ignores('.env')).toBe(true)
    expect(ig.ignores('venv/lib/python3.11/site-packages')).toBe(true)
    expect(ig.ignores('debug.log')).toBe(true)
    expect(ig.ignores('notes.md')).toBe(false)
  })

  it('filters node_modules, .env, and dist from default patterns', () => {
    const ig = createIgnoreFilter(DEFAULT_PATTERNS)

    expect(ig.ignores('node_modules/some-pkg/index.js')).toBe(true)
    expect(ig.ignores('dist/bundle.js')).toBe(true)
    expect(ig.ignores('.git/config')).toBe(true)
    expect(ig.ignores('.DS_Store')).toBe(true)
    expect(ig.ignores('notes.md')).toBe(false)
  })

  it('filters all dotfiles and dotdirs via the blanket .* pattern', () => {
    const ig = createIgnoreFilter(DEFAULT_PATTERNS)

    expect(ig.ignores('.hidden-file')).toBe(true)
    expect(ig.ignores('.obsidian/config.json')).toBe(true)
    expect(ig.ignores('.vscode/settings.json')).toBe(true)
    expect(ig.ignores('.env.local')).toBe(true)
    expect(ig.ignores('src/visible.ts')).toBe(false)
  })

  it('handles negation patterns (!important.log)', () => {
    const gitignore = ['*.log', '!important.log'].join('\n')
    const ig = createIgnoreFilter(DEFAULT_PATTERNS, [], gitignore)

    expect(ig.ignores('debug.log')).toBe(true)
    expect(ig.ignores('error.log')).toBe(true)
    expect(ig.ignores('important.log')).toBe(false)
  })

  it('falls back gracefully if no .gitignore exists', () => {
    // null gitignore content simulates missing file
    const ig = createIgnoreFilter(DEFAULT_PATTERNS, [], null)

    // Default patterns still work
    expect(ig.ignores('node_modules/pkg/index.js')).toBe(true)
    expect(ig.ignores('build/output.js')).toBe(true)
    // Regular files pass through
    expect(ig.ignores('src/main.ts')).toBe(false)
    expect(ig.ignores('README.md')).toBe(false)
  })

  it('combines vault config custom patterns with .gitignore', () => {
    const gitignore = '*.pyc\n__pycache__/'
    const customPatterns = ['vendor', '*.bak']
    const ig = createIgnoreFilter(DEFAULT_PATTERNS, customPatterns, gitignore)

    // .gitignore rules
    expect(ig.ignores('cache.pyc')).toBe(true)
    expect(ig.ignores('__pycache__/data')).toBe(true)
    // Custom vault config patterns
    expect(ig.ignores('vendor/lib.js')).toBe(true)
    expect(ig.ignores('backup.bak')).toBe(true)
    // Default patterns
    expect(ig.ignores('node_modules/pkg/index.js')).toBe(true)
    // Regular files pass
    expect(ig.ignores('notes.md')).toBe(false)
  })

  it('handles .gitignore with comments and blank lines', () => {
    const gitignore = ['# Python artifacts', '*.pyc', '', '# Build output', 'dist/', ''].join('\n')
    const ig = createIgnoreFilter(DEFAULT_PATTERNS, [], gitignore)

    expect(ig.ignores('module.pyc')).toBe(true)
    expect(ig.ignores('dist/bundle.js')).toBe(true)
    expect(ig.ignores('src/app.ts')).toBe(false)
  })

  it('handles directory-specific patterns', () => {
    const gitignore = 'logs/\ncoverage/'
    const ig = createIgnoreFilter(DEFAULT_PATTERNS, [], gitignore)

    expect(ig.ignores('logs/app.log')).toBe(true)
    expect(ig.ignores('coverage/lcov.info')).toBe(true)
    expect(ig.ignores('src/logs.ts')).toBe(false)
  })

  it('does not mutate the input arrays', () => {
    const defaults = ['node_modules', 'dist']
    const custom = ['vendor']
    const defaultsCopy = [...defaults]
    const customCopy = [...custom]

    createIgnoreFilter(defaults, custom, null)

    expect(defaults).toEqual(defaultsCopy)
    expect(custom).toEqual(customCopy)
  })

  it('handles wildcard patterns for file extensions', () => {
    const gitignore = '*.o\n*.so\n*.dylib'
    const ig = createIgnoreFilter(DEFAULT_PATTERNS, [], gitignore)

    expect(ig.ignores('main.o')).toBe(true)
    expect(ig.ignores('lib/libfoo.so')).toBe(true)
    expect(ig.ignores('lib/libbar.dylib')).toBe(true)
    expect(ig.ignores('src/main.c')).toBe(false)
  })

  it('handles nested directory patterns', () => {
    const gitignore = '**/tmp/\n**/cache/'
    const ig = createIgnoreFilter(DEFAULT_PATTERNS, [], gitignore)

    expect(ig.ignores('tmp/data')).toBe(true)
    expect(ig.ignores('src/tmp/data')).toBe(true)
    expect(ig.ignores('cache/items')).toBe(true)
    expect(ig.ignores('deep/nested/cache/items')).toBe(true)
    expect(ig.ignores('src/main.ts')).toBe(false)
  })
})

describe('toRelativeSlashPath', () => {
  it('converts absolute path to vault-relative path', () => {
    expect(toRelativeSlashPath(VAULT, `${VAULT}/src/main.ts`)).toBe('src/main.ts')
  })

  it('returns empty string for the vault root itself', () => {
    expect(toRelativeSlashPath(VAULT, VAULT)).toBe('')
  })

  it('handles nested directories', () => {
    expect(toRelativeSlashPath(VAULT, `${VAULT}/deep/nested/file.md`)).toBe('deep/nested/file.md')
  })
})

describe('shouldIgnore', () => {
  it('returns false for the vault root', () => {
    const ig = createIgnoreFilter(DEFAULT_PATTERNS)

    expect(shouldIgnore(ig, VAULT, VAULT)).toBe(false)
  })

  it('ignores paths matched by the filter', () => {
    const ig = createIgnoreFilter(DEFAULT_PATTERNS)

    expect(shouldIgnore(ig, VAULT, `${VAULT}/node_modules/pkg/index.js`)).toBe(true)
    expect(shouldIgnore(ig, VAULT, `${VAULT}/.git/config`)).toBe(true)
  })

  it('allows paths not matched by the filter', () => {
    const ig = createIgnoreFilter(DEFAULT_PATTERNS)

    expect(shouldIgnore(ig, VAULT, `${VAULT}/notes.md`)).toBe(false)
    expect(shouldIgnore(ig, VAULT, `${VAULT}/src/app.ts`)).toBe(false)
  })

  it('works with gitignore patterns for nested paths', () => {
    const gitignore = '*.env\nsecrets/'
    const ig = createIgnoreFilter(DEFAULT_PATTERNS, [], gitignore)

    expect(shouldIgnore(ig, VAULT, `${VAULT}/config/.env`)).toBe(true)
    expect(shouldIgnore(ig, VAULT, `${VAULT}/secrets/api-key.txt`)).toBe(true)
    expect(shouldIgnore(ig, VAULT, `${VAULT}/docs/readme.md`)).toBe(false)
  })

  it('handles paths that are just directory names', () => {
    const ig = createIgnoreFilter(DEFAULT_PATTERNS)

    expect(shouldIgnore(ig, VAULT, `${VAULT}/node_modules`)).toBe(true)
    expect(shouldIgnore(ig, VAULT, `${VAULT}/dist`)).toBe(true)
    expect(shouldIgnore(ig, VAULT, `${VAULT}/src`)).toBe(false)
  })
})
