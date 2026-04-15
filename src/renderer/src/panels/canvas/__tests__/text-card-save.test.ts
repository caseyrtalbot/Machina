import { describe, it, expect } from 'vitest'
import {
  slugifyFilename,
  resolveNewPath,
  appendToExisting,
  hashContent
} from '../text-card-save'

describe('slugifyFilename', () => {
  const fixedNow = new Date('2026-04-15T13:42:00Z')

  it('returns timestamp fallback for empty input', () => {
    expect(slugifyFilename('', fixedNow)).toBe('canvas-note-2026-04-15-1342')
  })

  it('returns timestamp fallback for whitespace-only input', () => {
    expect(slugifyFilename('   \n\t  ', fixedNow)).toBe('canvas-note-2026-04-15-1342')
  })

  it('strips leading markdown heading prefix', () => {
    expect(slugifyFilename('# My Title', fixedNow)).toBe('my-title')
  })

  it('strips leading list bullet prefix', () => {
    expect(slugifyFilename('- a thought', fixedNow)).toBe('a-thought')
  })

  it('strips leading task checkbox prefix', () => {
    expect(slugifyFilename('- [ ] do the thing', fixedNow)).toBe('do-the-thing')
  })

  it('strips leading blockquote prefix', () => {
    expect(slugifyFilename('> a quote', fixedNow)).toBe('a-quote')
  })

  it('lowercases and replaces non-alphanumeric runs with hyphens', () => {
    expect(slugifyFilename('Hello, World! Foo.bar', fixedNow)).toBe('hello-world-foo-bar')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugifyFilename('---weird---', fixedNow)).toBe('weird')
  })

  it('caps result at 60 characters', () => {
    const long = 'a'.repeat(200)
    expect(slugifyFilename(long, fixedNow)).toBe('a'.repeat(60))
  })

  it('falls back to timestamp when slug becomes empty after stripping', () => {
    expect(slugifyFilename('!!!@@@###', fixedNow)).toBe('canvas-note-2026-04-15-1342')
  })

  it('uses only the first non-empty line', () => {
    expect(slugifyFilename('First line\nSecond line', fixedNow)).toBe('first-line')
  })

  it('skips leading empty lines to find first content', () => {
    expect(slugifyFilename('\n\n  Real Title  \nmore', fixedNow)).toBe('real-title')
  })
})

describe('resolveNewPath', () => {
  it('returns base path when no collision', () => {
    expect(resolveNewPath('/vault/Inbox', 'note', [])).toBe('/vault/Inbox/note.md')
  })

  it('returns base path when collision list contains unrelated names', () => {
    expect(resolveNewPath('/vault/Inbox', 'note', ['other.md', 'thing.md'])).toBe(
      '/vault/Inbox/note.md'
    )
  })

  it('appends " (2)" on first collision', () => {
    expect(resolveNewPath('/vault/Inbox', 'note', ['note.md'])).toBe('/vault/Inbox/note (2).md')
  })

  it('appends " (3)" when (2) is also taken', () => {
    expect(resolveNewPath('/vault/Inbox', 'note', ['note.md', 'note (2).md'])).toBe(
      '/vault/Inbox/note (3).md'
    )
  })

  it('respects gaps and picks the first free integer', () => {
    expect(resolveNewPath('/vault/Inbox', 'note', ['note.md', 'note (3).md'])).toBe(
      '/vault/Inbox/note (2).md'
    )
  })

  it('throws after 999 attempts', () => {
    const existing = ['note.md', ...Array.from({ length: 999 }, (_, i) => `note (${i + 2}).md`)]
    expect(() => resolveNewPath('/vault/Inbox', 'note', existing)).toThrow(
      /could not allocate filename/i
    )
  })

  it('handles slug with spaces and special chars by trusting caller', () => {
    expect(resolveNewPath('/vault/Inbox', 'my-note', [])).toBe('/vault/Inbox/my-note.md')
  })
})

describe('appendToExisting', () => {
  it('returns addition unchanged when existing is empty', () => {
    expect(appendToExisting('', 'new content')).toBe('new content')
  })

  it('returns addition unchanged when existing is whitespace only', () => {
    expect(appendToExisting('   \n\n  ', 'new content')).toBe('new content')
  })

  it('adds blank-line separator when existing has no trailing newline', () => {
    expect(appendToExisting('existing', 'addition')).toBe('existing\n\naddition')
  })

  it('adds blank-line separator when existing has one trailing newline', () => {
    expect(appendToExisting('existing\n', 'addition')).toBe('existing\n\naddition')
  })

  it('collapses multiple trailing newlines to one blank line between', () => {
    expect(appendToExisting('existing\n\n\n\n', 'addition')).toBe('existing\n\naddition')
  })

  it('preserves internal whitespace in existing', () => {
    expect(appendToExisting('a\n\nb', 'c')).toBe('a\n\nb\n\nc')
  })

  it('preserves internal whitespace in addition', () => {
    expect(appendToExisting('a', 'b\n\nc')).toBe('a\n\nb\n\nc')
  })
})

describe('hashContent', () => {
  it('returns the same string for equal input', () => {
    expect(hashContent('hello')).toBe(hashContent('hello'))
  })

  it('returns different strings for different input', () => {
    expect(hashContent('hello')).not.toBe(hashContent('world'))
  })

  it('returns a non-empty string for empty input', () => {
    expect(hashContent('')).toMatch(/^\d+$/)
  })

  it('treats unicode reliably', () => {
    expect(hashContent('héllo')).not.toBe(hashContent('hello'))
  })
})
