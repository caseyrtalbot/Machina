import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useThreadStore } from '../../../store/thread-store'
import { useVaultStore } from '../../../store/vault-store'
import { buildPaletteItems, buildIndex, noteHitItems, searchPalette } from '../palette-sources'
import type { Thread } from '@shared/thread-types'
import type { SearchHit } from '@shared/engine/search-engine'

const sampleThread = (id: string, title: string): Thread => ({
  id,
  agent: 'machina-native',
  model: 'claude-sonnet-4-6',
  started: '2026-05-01T00:00:00Z',
  lastMessage: '2026-05-01T00:00:00Z',
  title,
  dockState: { tabs: [] },
  messages: []
})

beforeEach(() => {
  useThreadStore.setState(useThreadStore.getInitialState())
  useVaultStore.setState({
    files: [
      {
        path: '/v/notes/spark.md',
        filename: 'spark.md',
        title: 'spark',
        modified: '',
        source: 'vault'
      },
      {
        path: '/v/notes/canvas-redesign.md',
        filename: 'canvas-redesign.md',
        title: 'canvas-redesign',
        modified: '',
        source: 'vault'
      }
    ]
  })
  useThreadStore.setState({
    threadsById: {
      a: sampleThread('a', 'Spark planning'),
      b: sampleThread('b', 'Canvas notes')
    }
  })
})

describe('palette-sources', () => {
  it('builds items across threads, files, surfaces, and actions', () => {
    const items = buildPaletteItems({ closePalette: () => {} })
    const kinds = new Set(items.map((i) => i.kind))
    expect(kinds.has('thread')).toBe(true)
    expect(kinds.has('file')).toBe(true)
    expect(kinds.has('surface')).toBe(true)
    expect(kinds.has('action')).toBe(true)
    expect(items.find((i) => i.title === 'Spark planning')).toBeDefined()
    expect(items.find((i) => i.title === 'spark')).toBeDefined()
  })

  it('searches by title across kinds', () => {
    const items = buildPaletteItems({ closePalette: () => {} })
    const idx = buildIndex(items)
    const hits = searchPalette(idx, items, 'spark')
    expect(hits.length).toBeGreaterThan(0)
    const titles = hits.map((h) => h.title.toLowerCase())
    expect(titles.some((t) => t.includes('spark'))).toBe(true)
  })

  it('returns all items (up to limit) when query is empty', () => {
    const items = buildPaletteItems({ closePalette: () => {} })
    const idx = buildIndex(items)
    const hits = searchPalette(idx, items, '')
    expect(hits.length).toBe(items.length)
  })

  it('selecting a thread item closes the palette and selects the thread', async () => {
    const close = vi.fn()
    const items = buildPaletteItems({ closePalette: close })
    const threadItem = items.find((i) => i.id === 'thread:a')
    expect(threadItem).toBeDefined()
    await threadItem!.run()
    expect(close).toHaveBeenCalled()
    expect(useThreadStore.getState().activeThreadId).toBe('a')
  })

  it('selecting a file item adds an editor dock tab on the active thread', () => {
    useThreadStore.setState({ activeThreadId: 'a', dockTabsByThreadId: { a: [] } })
    const close = vi.fn()
    const items = buildPaletteItems({ closePalette: close })
    const fileItem = items.find((i) => i.kind === 'file')
    expect(fileItem).toBeDefined()
    fileItem!.run()
    const tabs = useThreadStore.getState().dockTabsByThreadId['a']
    expect(tabs?.[0]).toEqual({ kind: 'editor', path: '/v/notes/spark.md' })
  })

  it('emits one canvas entry per discovered canvas id (3.8 per-id stores)', () => {
    useVaultStore.setState({ canvasIds: ['default', 'research', 'planning'] })
    const items = buildPaletteItems({ closePalette: () => {} })
    const canvasItems = items.filter((i) => i.id.startsWith('surface:canvas:'))
    expect(canvasItems.map((i) => i.title)).toEqual([
      'Open canvas',
      'Open canvas: research',
      'Open canvas: planning'
    ])
  })

  it('running a named canvas entry opens a per-id canvas dock tab', () => {
    useVaultStore.setState({ canvasIds: ['default', 'research'] })
    useThreadStore.setState({ activeThreadId: 'a', dockTabsByThreadId: { a: [] } })
    const items = buildPaletteItems({ closePalette: () => {} })
    const named = items.find((i) => i.id === 'surface:canvas:research')
    expect(named).toBeDefined()
    named!.run()
    const tabs = useThreadStore.getState().dockTabsByThreadId['a']
    expect(tabs?.[0]).toEqual({ kind: 'canvas', id: 'research' })
  })

  it('maps full-text hits to note items with snippet subtitles, deduped against file rows', () => {
    const hits: SearchHit[] = [
      {
        id: 'spark',
        title: 'spark',
        path: '/v/notes/spark.md',
        snippet: '...the spark of an idea...',
        score: 2
      },
      {
        id: 'deep',
        title: 'Deep Note',
        path: '/v/notes/deep.md',
        snippet: '...buried body match...',
        score: 1
      }
    ]
    // spark.md already shown as a filename match — only the body-only hit remains.
    const shown = new Set(['file:/v/notes/spark.md'])
    const items = noteHitItems(hits, shown, { closePalette: () => {} })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'note:/v/notes/deep.md',
      kind: 'note',
      title: 'Deep Note',
      subtitle: '...buried body match...'
    })
  })

  it('running a note item closes the palette and opens an editor dock tab', () => {
    useThreadStore.setState({ activeThreadId: 'a', dockTabsByThreadId: { a: [] } })
    const close = vi.fn()
    const items = noteHitItems(
      [{ id: 'deep', title: 'Deep Note', path: '/v/notes/deep.md', snippet: 's', score: 1 }],
      new Set<string>(),
      { closePalette: close }
    )
    items[0].run()
    expect(close).toHaveBeenCalled()
    const tabs = useThreadStore.getState().dockTabsByThreadId['a']
    expect(tabs?.[0]).toEqual({ kind: 'editor', path: '/v/notes/deep.md' })
  })

  it('opening the canvas surface routes the dock tab to the default canvas', () => {
    useVaultStore.setState({ canvasIds: ['default', 'research'] })
    useThreadStore.setState({ activeThreadId: 'a', dockTabsByThreadId: { a: [] } })
    const items = buildPaletteItems({ closePalette: () => {} })
    const canvas = items.find((i) => i.id === 'surface:canvas:default')
    expect(canvas).toBeDefined()
    canvas!.run()
    const tabs = useThreadStore.getState().dockTabsByThreadId['a']
    expect(tabs?.[0]).toEqual({ kind: 'canvas', id: 'default' })
  })
})
