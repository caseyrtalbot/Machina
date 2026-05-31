import { describe, test, expect } from 'vitest'
import {
  parseWikilinkTarget,
  resolveWikilinkTarget,
  buildResolutionMaps,
  resolveBodyLink
} from '../../src/shared/engine/wikilink-resolver'

const artifacts = [
  { id: 'Claude-Code MOC', title: 'Claude-Code MOC' },
  { id: 'Quick Reference', title: 'Quick Reference' },
  { id: 'Writing Skills', title: 'Writing Skills' },
  { id: 'Configuration', title: 'Configuration' },
  { id: 'daily-2026-04-06', title: '2026-04-06' }
]

const idToPath: Record<string, string> = {
  'Claude-Code MOC': '/vault/Caseys-Claude-Code/Claude-Code MOC.md',
  'Quick Reference': '/vault/Caseys-Claude-Code/Quick Reference.md',
  'Writing Skills': '/vault/Skills/Writing Skills.md',
  Configuration: '/vault/Caseys-Claude-Code/Configuration.md',
  'daily-2026-04-06': '/vault/daily/2026-04-06.md'
}

describe('parseWikilinkTarget', () => {
  test('simple target', () => {
    expect(parseWikilinkTarget('My Note')).toEqual({
      target: 'My Note',
      heading: null
    })
  })

  test('target with heading', () => {
    expect(parseWikilinkTarget('My Note#some-heading')).toEqual({
      target: 'My Note',
      heading: 'some-heading'
    })
  })

  test('heading-only target', () => {
    expect(parseWikilinkTarget('#local-heading')).toEqual({
      target: '',
      heading: 'local-heading'
    })
  })

  test('path-style target with heading', () => {
    expect(parseWikilinkTarget('Folder/Note#heading')).toEqual({
      target: 'Folder/Note',
      heading: 'heading'
    })
  })
})

describe('resolveWikilinkTarget', () => {
  test('resolves by exact title match (case-insensitive)', () => {
    expect(resolveWikilinkTarget('claude-code moc', artifacts)).toBe('Claude-Code MOC')
  })

  test('resolves by exact ID match', () => {
    expect(resolveWikilinkTarget('daily-2026-04-06', artifacts)).toBe('daily-2026-04-06')
  })

  test('resolves path-style target by filename stem', () => {
    expect(resolveWikilinkTarget('Caseys-Claude-Code/Claude-Code MOC', artifacts)).toBe(
      'Claude-Code MOC'
    )
  })

  test('resolves path-style target by path ending', () => {
    expect(resolveWikilinkTarget('Caseys-Claude-Code/Quick Reference', artifacts, idToPath)).toBe(
      'Quick Reference'
    )
  })

  test('strips heading before resolution', () => {
    expect(resolveWikilinkTarget('Writing Skills#blog-writing', artifacts)).toBe('Writing Skills')
  })

  test('returns null for unresolved target', () => {
    expect(resolveWikilinkTarget('Nonexistent Note', artifacts)).toBeNull()
  })

  test('returns null for empty target', () => {
    expect(resolveWikilinkTarget('#heading-only', artifacts)).toBeNull()
  })
})

describe('buildResolutionMaps + resolveBodyLink', () => {
  const maps = buildResolutionMaps(artifacts)

  test('resolves by lowercase ID', () => {
    expect(resolveBodyLink('claude-code moc', maps)).toBe('Claude-Code MOC')
  })

  test('resolves by lowercase title', () => {
    expect(resolveBodyLink('quick reference', maps)).toBe('Quick Reference')
  })

  test('resolves path-style target by stem', () => {
    expect(resolveBodyLink('caseys-claude-code/claude-code moc', maps)).toBe('Claude-Code MOC')
  })

  test('resolves path-style target by title stem when id differs from title', () => {
    expect(resolveBodyLink('daily/2026-04-06', maps)).toBe('daily-2026-04-06')
  })

  test('returns null for unresolved', () => {
    expect(resolveBodyLink('nonexistent', maps)).toBeNull()
  })

  test('strips #heading anchor before resolving to the base note', () => {
    expect(resolveBodyLink('claude-code moc#some-heading', maps)).toBe('Claude-Code MOC')
  })

  test('strips #^block-ref anchor before resolving to the base note', () => {
    expect(resolveBodyLink('quick reference#^block-id', maps)).toBe('Quick Reference')
  })

  test('strips anchor on path-style targets and resolves by stem', () => {
    expect(resolveBodyLink('caseys-claude-code/claude-code moc#heading', maps)).toBe(
      'Claude-Code MOC'
    )
  })

  test('returns null for a pure in-page anchor (target starts with #)', () => {
    expect(resolveBodyLink('#section', maps)).toBeNull()
  })
})
