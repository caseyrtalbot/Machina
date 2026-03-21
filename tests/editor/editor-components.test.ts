import { describe, it, expect } from 'vitest'

// ─── parseBreadcrumb ──────────────────────────────────────────────────────────

describe('parseBreadcrumb', () => {
  it('parses a file path into breadcrumb segments', async () => {
    const { parseBreadcrumb } =
      await import('../../src/renderer/src/panels/editor/EditorBreadcrumb')
    const segments = parseBreadcrumb('/vault/folder/note.md', '/vault')
    expect(segments).toHaveLength(2)
    // Folder segment
    expect(segments[0]).toMatchObject({ name: 'folder', isFile: false })
    expect(segments[0].path).toContain('folder')
    // File segment: parseBreadcrumb strips .md from the display name
    expect(segments[1]).toMatchObject({ name: 'note', isFile: true })
    expect(segments[1].path).toContain('note.md')
  })

  it('handles deeply nested paths', async () => {
    const { parseBreadcrumb } =
      await import('../../src/renderer/src/panels/editor/EditorBreadcrumb')
    const segments = parseBreadcrumb('/vault/a/b/c/d.md', '/vault')
    expect(segments).toHaveLength(4)
    expect(segments[3].isFile).toBe(true)
    expect(segments[0].isFile).toBe(false)
  })

  it('handles root-level file', async () => {
    const { parseBreadcrumb } =
      await import('../../src/renderer/src/panels/editor/EditorBreadcrumb')
    const segments = parseBreadcrumb('/vault/root.md', '/vault')
    expect(segments).toHaveLength(1)
    expect(segments[0].isFile).toBe(true)
    // .md is stripped from display name
    expect(segments[0].name).toBe('root')
  })
})

// ─── buildMetadataEntries ─────────────────────────────────────────────────────

describe('buildMetadataEntries', () => {
  it('builds entries from artifact fields', async () => {
    const { buildMetadataEntries } =
      await import('../../src/renderer/src/panels/editor/FrontmatterHeader')
    const artifact = {
      id: 'test-1',
      type: 'gene' as const,
      title: 'Test Gene',
      signal: 'core' as const,
      created: '2026-03-01',
      modified: '2026-03-12',
      tags: ['ai', 'design'],
      connections: [],
      clusters_with: [],
      tensions_with: [],
      appears_in: [],
      related: [],
      bodyLinks: [],
      body: 'test body'
    }
    const entries = buildMetadataEntries(artifact)
    // Always: ID, Type, Signal, Created, Modified (5 base) + Tags (1) = 6
    expect(entries.length).toBeGreaterThanOrEqual(5)
    // Entries use `label`/`value` shape; Type is at index 1 (ID is first)
    expect(entries[1]).toMatchObject({ label: 'Type', value: 'gene' })
    expect(entries.find((e) => e.label === 'Tags')?.value).toBe('ai, design')
  })

  it('omits optional fields when absent', async () => {
    const { buildMetadataEntries } =
      await import('../../src/renderer/src/panels/editor/FrontmatterHeader')
    const artifact = {
      id: 'test-2',
      type: 'note' as const,
      title: 'Minimal',
      signal: 'untested' as const,
      created: '2026-03-01',
      modified: '2026-03-01',
      tags: [],
      connections: [],
      clusters_with: [],
      tensions_with: [],
      appears_in: [],
      related: [],
      bodyLinks: [],
      body: ''
    }
    const entries = buildMetadataEntries(artifact)
    expect(entries.find((e) => e.label === 'Source')).toBeUndefined()
    expect(entries.find((e) => e.label === 'Tags')).toBeUndefined()
  })
})

// ─── extractContext ───────────────────────────────────────────────────────────

describe('extractContext', () => {
  it('extracts context around target ID in body', async () => {
    const { extractContext } = await import('../../src/renderer/src/panels/editor/BacklinksPanel')
    const body = 'Some text before the target-id and some text after'
    const result = extractContext(body, 'target-id')
    expect(result).toContain('target-id')
    // snippet window is 100 chars max plus up to 2 ellipsis chars
    expect(result.length).toBeLessThanOrEqual(120)
  })

  it('returns empty string when target not found in body', async () => {
    const { extractContext } = await import('../../src/renderer/src/panels/editor/BacklinksPanel')
    const body = 'This body does not contain the reference anywhere'
    const result = extractContext(body, 'nonexistent-id')
    // Source explicitly returns '' when targetId is absent
    expect(result).toBe('')
  })

  it('finds context via concept node tag', async () => {
    const { extractContext } = await import('../../src/renderer/src/panels/editor/BacklinksPanel')
    const body = 'Some text about <node>strategy</node> and more'
    const result = extractContext(body, 'nonexistent-id', 'strategy')
    // cleanSnippet strips <node> tags, so output should contain the plain text
    expect(result).toContain('strategy')
    expect(result).not.toContain('<node>')
  })
})
