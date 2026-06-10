/**
 * Tests for buildVaultDeps: creates a VaultIndex + SearchEngine
 * from a list of file entries (path + content).
 *
 * This is the main-process indexing pipeline that feeds MCP queries.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildVaultDeps,
  initVaultIndex,
  applyFileToIndex,
  removeFileFromIndex,
  applyIndexEvents,
  createLiveIndexUpdater
} from '../vault-indexing'

const HELLO_MD = [
  '---',
  'id: hello',
  'title: Hello',
  'type: note',
  'created: 2026-01-01',
  'modified: 2026-01-01',
  'tags:',
  '  - greeting',
  'connections:',
  '  - world',
  '---',
  '',
  '# Hello World',
  '',
  'A note about greetings.'
].join('\n')

const WORLD_MD = [
  '---',
  'id: world',
  'title: World',
  'type: note',
  'created: 2026-01-01',
  'modified: 2026-01-01',
  'tags:',
  '  - place',
  '---',
  '',
  '# World',
  '',
  'The world is vast.'
].join('\n')

describe('buildVaultDeps', () => {
  it('returns a VaultIndex with all files indexed', () => {
    const files = [
      { path: 'notes/hello.md', content: HELLO_MD },
      { path: 'notes/world.md', content: WORLD_MD }
    ]
    const deps = buildVaultDeps(files)

    expect(deps.vaultIndex.getArtifacts()).toHaveLength(2)
    expect(deps.vaultIndex.getArtifact('hello')).toBeDefined()
    expect(deps.vaultIndex.getArtifact('world')).toBeDefined()
  })

  it('returns a SearchEngine populated from the artifacts', () => {
    const files = [
      { path: 'notes/hello.md', content: HELLO_MD },
      { path: 'notes/world.md', content: WORLD_MD }
    ]
    const deps = buildVaultDeps(files)

    const hits = deps.searchEngine.search('greeting')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].title).toBe('Hello')
  })

  it('stores the source file path on search hits', () => {
    const files = [
      { path: 'notes/hello.md', content: HELLO_MD },
      { path: 'notes/world.md', content: WORLD_MD }
    ]
    const deps = buildVaultDeps(files)

    const hit = deps.searchEngine.search('greeting')[0]
    expect(hit?.path).toBe('notes/hello.md')
  })

  it('builds a graph with edges from frontmatter connections', () => {
    const files = [
      { path: 'notes/hello.md', content: HELLO_MD },
      { path: 'notes/world.md', content: WORLD_MD }
    ]
    const deps = buildVaultDeps(files)

    const graph = deps.vaultIndex.getGraph()
    const connectionEdges = graph.edges.filter((e) => e.kind === 'connection')
    expect(connectionEdges).toHaveLength(1)
    expect(connectionEdges[0]).toEqual(
      expect.objectContaining({ source: 'hello', target: 'world', kind: 'connection' })
    )
  })

  it('handles empty file list gracefully', () => {
    const deps = buildVaultDeps([])

    expect(deps.vaultIndex.getArtifacts()).toHaveLength(0)
    expect(deps.searchEngine.search('anything')).toHaveLength(0)
  })

  it('skips files that fail to parse without crashing', () => {
    const files = [
      { path: 'notes/hello.md', content: HELLO_MD },
      { path: 'notes/bad.md', content: 'no frontmatter at all just text' }
    ]
    const deps = buildVaultDeps(files)

    // Should have at least the valid file
    expect(deps.vaultIndex.getArtifacts().length).toBeGreaterThanOrEqual(1)
  })
})

describe('live index updates', () => {
  it('applyFileToIndex adds a new file to both index and search', () => {
    const deps = buildVaultDeps([])

    applyFileToIndex(deps, 'notes/hello.md', HELLO_MD)

    expect(deps.vaultIndex.getArtifact('hello')).toBeDefined()
    expect(deps.searchEngine.search('greeting')[0]?.title).toBe('Hello')
  })

  it('applyFileToIndex replaces prior content for the same path', () => {
    const deps = buildVaultDeps([{ path: 'notes/hello.md', content: HELLO_MD }])

    const updated = HELLO_MD.replace('A note about greetings.', 'Now about farewells.')
    applyFileToIndex(deps, 'notes/hello.md', updated)

    expect(deps.vaultIndex.getArtifacts()).toHaveLength(1)
    expect(deps.searchEngine.search('farewells')).toHaveLength(1)
    expect(deps.vaultIndex.getArtifact('hello')?.body).toContain('farewells')
  })

  it('applyFileToIndex removes the stale search doc when the artifact id changes', () => {
    const deps = buildVaultDeps([{ path: 'notes/hello.md', content: HELLO_MD }])

    const renamed = HELLO_MD.replace('id: hello', 'id: hola')
    applyFileToIndex(deps, 'notes/hello.md', renamed)

    expect(deps.vaultIndex.getArtifact('hello')).toBeUndefined()
    expect(deps.vaultIndex.getArtifact('hola')).toBeDefined()
    const hits = deps.searchEngine.search('greeting')
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('hola')
  })

  it('removeFileFromIndex drops a file from both index and search', () => {
    const deps = buildVaultDeps([
      { path: 'notes/hello.md', content: HELLO_MD },
      { path: 'notes/world.md', content: WORLD_MD }
    ])

    removeFileFromIndex(deps, 'notes/hello.md')

    expect(deps.vaultIndex.getArtifact('hello')).toBeUndefined()
    expect(deps.searchEngine.search('greeting')).toHaveLength(0)
    expect(deps.vaultIndex.getArtifact('world')).toBeDefined()
  })

  describe('applyIndexEvents (watcher batches)', () => {
    let vaultRoot: string

    beforeEach(() => {
      const base = join(tmpdir(), `vi-live-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      mkdirSync(join(base, 'notes'), { recursive: true })
      writeFileSync(join(base, 'notes', 'hello.md'), HELLO_MD)
      vaultRoot = realpathSync(base)
    })

    afterEach(() => {
      rmSync(vaultRoot, { recursive: true, force: true })
    })

    it('add and change events read from disk into the index', async () => {
      const deps = buildVaultDeps([])
      const helloPath = join(vaultRoot, 'notes', 'hello.md')

      await applyIndexEvents(deps, [{ path: helloPath, event: 'add' }])
      expect(deps.searchEngine.search('greeting')[0]?.path).toBe(helloPath)

      writeFileSync(helloPath, HELLO_MD.replace('A note about greetings.', 'Changed on disk.'))
      await applyIndexEvents(deps, [{ path: helloPath, event: 'change' }])
      expect(deps.searchEngine.search('changed')).toHaveLength(1)
    })

    it('unlink events remove the file; non-md and unreadable paths are handled', async () => {
      const helloPath = join(vaultRoot, 'notes', 'hello.md')
      const deps = buildVaultDeps([{ path: helloPath, content: HELLO_MD }])

      await applyIndexEvents(deps, [
        { path: join(vaultRoot, 'notes', 'image.png'), event: 'add' },
        { path: join(vaultRoot, 'notes', 'gone-already.md'), event: 'change' },
        { path: helloPath, event: 'unlink' }
      ])

      expect(deps.vaultIndex.getArtifacts()).toHaveLength(0)
      expect(deps.searchEngine.search('greeting')).toHaveLength(0)
    })

    it('a change event for a file deleted before the read drops it from the index', async () => {
      const helloPath = join(vaultRoot, 'notes', 'hello.md')
      const deps = buildVaultDeps([{ path: helloPath, content: HELLO_MD }])

      rmSync(helloPath)
      await applyIndexEvents(deps, [{ path: helloPath, event: 'change' }])

      expect(deps.vaultIndex.getArtifact('hello')).toBeUndefined()
      expect(deps.searchEngine.search('greeting')).toHaveLength(0)
    })

    it('createLiveIndexUpdater applies batches fire-and-forget', async () => {
      const deps = buildVaultDeps([])
      const updater = createLiveIndexUpdater(deps)
      const helloPath = join(vaultRoot, 'notes', 'hello.md')

      updater([{ path: helloPath, event: 'add' }])

      await vi.waitFor(() => {
        expect(deps.searchEngine.search('greeting')).toHaveLength(1)
      })
    })
  })
})

describe('initVaultIndex', () => {
  let vaultRoot: string

  beforeEach(() => {
    const base = join(tmpdir(), `vi-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(base, 'notes'), { recursive: true })
    mkdirSync(join(base, 'deep', 'nested'), { recursive: true })
    writeFileSync(join(base, 'notes', 'hello.md'), HELLO_MD)
    writeFileSync(join(base, 'notes', 'world.md'), WORLD_MD)
    writeFileSync(
      join(base, 'deep', 'nested', 'deep-note.md'),
      [
        '---',
        'id: deep-note',
        'title: Deep Note',
        'type: note',
        'created: 2026-01-01',
        'modified: 2026-01-01',
        'tags: []',
        '---',
        '',
        'A deeply nested note.'
      ].join('\n')
    )
    // Non-md file should be ignored
    writeFileSync(join(base, 'notes', 'readme.txt'), 'not markdown')
    vaultRoot = realpathSync(base)
  })

  afterEach(() => {
    rmSync(vaultRoot, { recursive: true, force: true })
  })

  it('reads .md files from vault and returns populated deps', async () => {
    const deps = await initVaultIndex(vaultRoot)

    expect(deps.vaultIndex.getArtifacts().length).toBeGreaterThanOrEqual(2)
    expect(deps.searchEngine.search('greeting').length).toBeGreaterThanOrEqual(1)
  })

  it('preserves absolute source paths when indexing from disk', async () => {
    const deps = await initVaultIndex(vaultRoot)

    const hit = deps.searchEngine.search('greeting')[0]
    expect(hit?.path).toBe(join(vaultRoot, 'notes', 'hello.md'))
  })

  it('discovers nested .md files', async () => {
    const deps = await initVaultIndex(vaultRoot)

    const ids = deps.vaultIndex.getArtifacts().map((a) => a.id)
    expect(ids).toContain('deep-note')
  })

  it('ignores non-md files', async () => {
    const deps = await initVaultIndex(vaultRoot)

    const allIds = deps.vaultIndex.getArtifacts().map((a) => a.id)
    // 3 .md files: hello, world, deep-note
    expect(allIds).toHaveLength(3)
  })
})
