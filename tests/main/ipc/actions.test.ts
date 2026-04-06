// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { globSync } from 'glob'
import matter from 'gray-matter'
import type { ActionDefinition } from '../../../src/shared/action-types'

function parseActionFile(f: string): ActionDefinition {
  const content = readFileSync(f, 'utf-8')
  const { data } = matter(content)
  return {
    id: basename(f, '.md'),
    name: (data.name as string) ?? basename(f, '.md'),
    description: (data.description as string) ?? '',
    icon: data.icon as string | undefined,
    scope: ['any', 'files', 'vault'].includes(data.scope as string)
      ? (data.scope as 'any' | 'files' | 'vault')
      : 'any',
    custom: (data.custom as boolean) ?? undefined
  }
}

function readActionBody(file: string): string {
  const raw = readFileSync(file, 'utf-8')
  const { content } = matter(raw)
  return content.trim()
}

describe('action file parsing', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `actions-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('parses frontmatter into ActionDefinition', () => {
    const file = join(testDir, 'emerge.md')
    writeFileSync(
      file,
      [
        '---',
        'name: Emerge',
        'description: Surface hidden connections',
        'icon: sparkles',
        'scope: any',
        '---',
        '',
        'You are an emergence engine.'
      ].join('\n')
    )

    const def = parseActionFile(file)
    expect(def.id).toBe('emerge')
    expect(def.name).toBe('Emerge')
    expect(def.description).toBe('Surface hidden connections')
    expect(def.icon).toBe('sparkles')
    expect(def.scope).toBe('any')
  })

  it('defaults scope to any when missing', () => {
    const file = join(testDir, 'test.md')
    writeFileSync(file, '---\nname: Test\ndescription: A test\n---\nBody')
    const def = parseActionFile(file)
    expect(def.scope).toBe('any')
  })

  it('defaults scope to any for invalid scope values', () => {
    const file = join(testDir, 'test.md')
    writeFileSync(file, '---\nname: Test\ndescription: A test\nscope: bogus\n---\nBody')
    const def = parseActionFile(file)
    expect(def.scope).toBe('any')
  })

  it('uses filename stem as name when frontmatter name is missing', () => {
    const file = join(testDir, 'my-action.md')
    writeFileSync(file, '---\ndescription: No name field\n---\nBody')
    const def = parseActionFile(file)
    expect(def.name).toBe('my-action')
  })

  it('defaults description to empty string when missing', () => {
    const file = join(testDir, 'test.md')
    writeFileSync(file, '---\nname: Test\n---\nBody')
    const def = parseActionFile(file)
    expect(def.description).toBe('')
  })

  it('parses custom boolean flag', () => {
    const file = join(testDir, 'custom-action.md')
    writeFileSync(file, '---\nname: Custom\ndescription: A custom action\ncustom: true\n---\nBody')
    const def = parseActionFile(file)
    expect(def.custom).toBe(true)
  })

  it('extracts body content without frontmatter', () => {
    const file = join(testDir, 'test.md')
    writeFileSync(
      file,
      '---\nname: Test\ndescription: A test\n---\n\nYou are an agent.\n\nDo things.'
    )
    const body = readActionBody(file)
    expect(body).toBe('You are an agent.\n\nDo things.')
  })

  it('lists all .md files in directory', () => {
    writeFileSync(join(testDir, 'a.md'), '---\nname: A\ndescription: A\n---\nBody')
    writeFileSync(join(testDir, 'b.md'), '---\nname: B\ndescription: B\n---\nBody')
    writeFileSync(join(testDir, 'readme.txt'), 'not an action')
    const files = globSync(join(testDir, '*.md'))
    expect(files.length).toBe(2)
  })

  it('returns empty array when directory does not exist', () => {
    const missingDir = join(testDir, 'nonexistent')
    expect(existsSync(missingDir)).toBe(false)
    // The handler should return [] when directory doesn't exist
    // Simulating the guard check from the handler
    const result = existsSync(missingDir) ? globSync(join(missingDir, '*.md')) : []
    expect(result).toEqual([])
  })

  it('handles files scope correctly', () => {
    const file = join(testDir, 'review.md')
    writeFileSync(file, '---\nname: Review\ndescription: Review files\nscope: files\n---\nBody')
    const def = parseActionFile(file)
    expect(def.scope).toBe('files')
  })

  it('handles vault scope correctly', () => {
    const file = join(testDir, 'index.md')
    writeFileSync(file, '---\nname: Index\ndescription: Index vault\nscope: vault\n---\nBody')
    const def = parseActionFile(file)
    expect(def.scope).toBe('vault')
  })
})
