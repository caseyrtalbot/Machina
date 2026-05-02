import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useThreadStore } from '../../../store/thread-store'
import { useVaultStore } from '../../../store/vault-store'
import { buildPaletteItems, buildIndex, searchPalette } from '../palette-sources'
import type { Thread } from '@shared/thread-types'

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
})
