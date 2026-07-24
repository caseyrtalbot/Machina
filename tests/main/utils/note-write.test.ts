// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import matter from 'gray-matter'
import {
  stampProvenance,
  stampCreateProvenance,
  writeStampedNote,
  createStampedNote
} from '../../../src/main/utils/note-write'

describe('stampProvenance', () => {
  it('adds a frontmatter block to a plain note, body preserved', () => {
    const out = stampProvenance('hello world\n', 'native-agent')
    const parsed = matter(out)
    expect(parsed.data.modified_by).toBe('native-agent')
    expect(typeof parsed.data.modified_at).toBe('string')
    expect(parsed.content).toBe('hello world\n')
  })

  it('preserves existing frontmatter keys and appends provenance', () => {
    const input = '---\nid: abc\ntags:\n  - one\n---\nbody text\n'
    const out = stampProvenance(input, 'native-agent')
    const parsed = matter(out)
    expect(parsed.data.id).toBe('abc')
    expect(parsed.data.tags).toEqual(['one'])
    expect(parsed.data.modified_by).toBe('native-agent')
    expect(typeof parsed.data.modified_at).toBe('string')
    expect(parsed.content).toBe('body text\n')
  })

  it('does NOT shatter a body whose first line is --- (no closing delimiter)', () => {
    // gray-matter would misread the leading --- as frontmatter and drop the body.
    const input = '---\nthis is body, not frontmatter\n'
    const parsed = matter(stampProvenance(input, 'native-agent'))
    expect(parsed.data.modified_by).toBe('native-agent')
    expect(parsed.content).toBe(input)
  })

  it('preserves a body containing --- thematic-break sections verbatim', () => {
    const input = '---\nSection A\n---\nSection B\n'
    const parsed = matter(stampProvenance(input, 'native-agent'))
    expect(parsed.data.modified_by).toBe('native-agent')
    expect(parsed.content).toBe(input)
  })

  it('preserves the body trailing-newline state exactly (no forced newline)', () => {
    expect(matter(stampProvenance('x', 'native-agent')).content).toBe('x')
    expect(matter(stampProvenance('x\n', 'native-agent')).content).toBe('x\n')
  })
})

describe('stampCreateProvenance', () => {
  it('stamps created_by / created_at, body preserved', () => {
    const parsed = matter(stampCreateProvenance('---\nid: abc\n---\nbody text\n', 'native-agent'))
    expect(parsed.data.id).toBe('abc')
    expect(parsed.data.created_by).toBe('native-agent')
    expect(typeof parsed.data.created_at).toBe('string')
    expect(parsed.content).toBe('body text\n')
  })

  it('preserves a body that itself starts with --- verbatim', () => {
    const input = '---\nid: abc\n---\n---\nreal text after a break\n'
    const parsed = matter(stampCreateProvenance(input, 'native-agent'))
    expect(parsed.data.id).toBe('abc')
    expect(parsed.data.created_by).toBe('native-agent')
    expect(parsed.content).toBe('---\nreal text after a break\n')
  })
})

describe('writeStampedNote', () => {
  it('writes stamped content to disk', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'nw-'))
    try {
      const abs = path.join(v, 'note.md')
      await writeStampedNote(abs, 'content here\n', 'native-agent')
      const written = readFileSync(abs, 'utf8')
      const parsed = matter(written)
      expect(parsed.content).toBe('content here\n')
      expect(parsed.data.modified_by).toBe('native-agent')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('registers the external write before touching disk (echo suppression)', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'nw-'))
    try {
      const abs = path.join(v, 'note.md')
      const registrar = { registerExternalWrite: vi.fn() }
      await writeStampedNote(abs, 'x\n', 'native-agent', registrar)
      expect(registrar.registerExternalWrite).toHaveBeenCalledOnce()
      expect(registrar.registerExternalWrite).toHaveBeenCalledWith(abs)
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })
})

describe('createStampedNote', () => {
  it('exclusive-creates a stamped note and returns the stamped content', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'nw-'))
    try {
      const abs = path.join(v, 'note.md')
      const returned = await createStampedNote(abs, '---\nid: abc\n---\nbody\n', 'native-agent')
      const written = readFileSync(abs, 'utf8')
      expect(written).toBe(returned)
      const parsed = matter(written)
      expect(parsed.data.id).toBe('abc')
      expect(parsed.data.created_by).toBe('native-agent')
      expect(parsed.content).toBe('body\n')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('preserves a body that itself starts with --- verbatim', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'nw-'))
    try {
      const abs = path.join(v, 'note.md')
      await createStampedNote(abs, '---\nid: abc\n---\n---\nreal text\n', 'native-agent')
      expect(matter(readFileSync(abs, 'utf8')).content).toBe('---\nreal text\n')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('registers the external write before touching disk', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'nw-'))
    try {
      const abs = path.join(v, 'note.md')
      const registrar = { registerExternalWrite: vi.fn() }
      await createStampedNote(abs, '---\nid: abc\n---\nx\n', 'native-agent', registrar)
      expect(registrar.registerExternalWrite).toHaveBeenCalledOnce()
      expect(registrar.registerExternalWrite).toHaveBeenCalledWith(abs)
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('fails with EEXIST on an existing file without overwriting', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'nw-'))
    try {
      const abs = path.join(v, 'note.md')
      await createStampedNote(abs, '---\nid: abc\n---\nfirst\n', 'native-agent')
      const before = readFileSync(abs, 'utf8')
      await expect(
        createStampedNote(abs, '---\nid: abc\n---\nsecond\n', 'native-agent')
      ).rejects.toMatchObject({ code: 'EEXIST' })
      expect(readFileSync(abs, 'utf8')).toBe(before)
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })
})
