import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useThreadStore } from '../../../store/thread-store'
import { useVaultStore } from '../../../store/vault-store'
import { useEditorStore } from '../../../store/editor-store'
import { buildPaletteItems, buildIndex, noteHitItems, searchPalette } from '../palette-sources'
import { openStripTerminal, openStripTerminalInFolder } from '../terminal-migration'
import { runHarness } from '../../../store/harness-run'
import type { Thread } from '@shared/thread-types'
import type { HarnessSummary } from '@shared/harness-types'
import type { SearchHit } from '@shared/engine/search-engine'
import type { AgentCommits } from '@shared/git-types'

vi.mock('../terminal-migration', () => ({
  openStripTerminal: vi.fn(),
  openStripTerminalInFolder: vi.fn().mockResolvedValue(null)
}))

vi.mock('../../../store/harness-run', () => ({
  runHarness: vi.fn().mockResolvedValue(undefined)
}))

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

describe('palette-sources — step 4 terminal + editor actions', () => {
  const selectFile = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useEditorStore.setState(useEditorStore.getInitialState())
    useThreadStore.setState({ activeThreadId: 'a', dockTabsByThreadId: { a: [] } })
    // @ts-expect-error test stub
    window.api = { fs: { selectFile } }
  })

  it('includes the new-terminal, new-terminal-in-folder, and open-file-in-editor actions', () => {
    const items = buildPaletteItems({ closePalette: () => {} })
    const ids = new Set(items.map((i) => i.id))
    expect(ids.has('action:new-terminal')).toBe(true)
    expect(ids.has('action:new-terminal-in-folder')).toBe(true)
    expect(ids.has('action:open-file-in-editor')).toBe(true)
  })

  it('running new-terminal closes the palette and spawns a strip terminal', async () => {
    const close = vi.fn()
    const items = buildPaletteItems({ closePalette: close })
    const item = items.find((i) => i.id === 'action:new-terminal')
    expect(item).toBeDefined()
    await item!.run()
    expect(close).toHaveBeenCalled()
    expect(openStripTerminal).toHaveBeenCalledTimes(1)
  })

  it('running new-terminal-in-folder closes the palette and runs the folder-picker flow', async () => {
    const close = vi.fn()
    const items = buildPaletteItems({ closePalette: close })
    const item = items.find((i) => i.id === 'action:new-terminal-in-folder')
    expect(item).toBeDefined()
    await item!.run()
    expect(close).toHaveBeenCalled()
    expect(openStripTerminalInFolder).toHaveBeenCalledTimes(1)
  })

  it('open-file-in-editor opens an editor tab and dock tab when a file is picked', async () => {
    selectFile.mockResolvedValue('/v/notes/deep.md')
    const close = vi.fn()
    const items = buildPaletteItems({ closePalette: close })
    const item = items.find((i) => i.id === 'action:open-file-in-editor')
    expect(item).toBeDefined()
    await item!.run()
    expect(close).toHaveBeenCalled()
    const editor = useEditorStore.getState()
    expect(editor.activeNotePath).toBe('/v/notes/deep.md')
    expect(
      editor.openTabs.some((t) => t.path === '/v/notes/deep.md' && t.title === 'deep.md')
    ).toBe(true)
    const tabs = useThreadStore.getState().dockTabsByThreadId['a']
    expect(tabs?.[0]).toEqual({ kind: 'editor', path: '/v/notes/deep.md' })
  })

  it('open-file-in-editor does nothing when the picker returns null', async () => {
    selectFile.mockResolvedValue(null)
    const items = buildPaletteItems({ closePalette: vi.fn() })
    const item = items.find((i) => i.id === 'action:open-file-in-editor')
    await item!.run()
    expect(useEditorStore.getState().activeNotePath).toBeNull()
    expect(useEditorStore.getState().openTabs).toEqual([])
    expect(useThreadStore.getState().dockTabsByThreadId['a']).toEqual([])
  })
})

describe('palette-sources — step 7 harness lint diagnostics', () => {
  const clean: HarnessSummary = {
    slug: 'test-fixer',
    name: 'test-fixer',
    description: 'Runs the test suite, fixes the first failure, stops.',
    adapter: 'claude',
    diagnostics: []
  }
  const broken: HarnessSummary = {
    slug: 'stripped',
    name: 'stripped',
    description: 'tampered scope',
    adapter: 'claude',
    diagnostics: [
      {
        severity: 'error',
        code: 'scope-protected-globs',
        message: 'scope contract is missing protected forbiddenGlobs: .machina/agents/*/verify.sh',
        file: 'scope.json'
      }
    ]
  }
  const warned: HarnessSummary = {
    ...clean,
    slug: 'warned',
    name: 'warned',
    diagnostics: [
      { severity: 'warning', code: 'verify-mode', message: 'mode drifted', file: 'verify.sh' }
    ]
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a broken harness greyed with the reason — not vanished', () => {
    const items = buildPaletteItems({ closePalette: () => {}, harnesses: [broken] })
    const item = items.find((i) => i.id === 'action:harness-run:stripped')
    expect(item).toBeDefined()
    expect(item!.disabledReason).toContain('missing protected forbiddenGlobs')
    expect(item!.subtitle).toContain('broken harness')
    expect(item!.subtitle).toContain('missing protected forbiddenGlobs')
  })

  it('error severity disables run: activating the broken item never calls runHarness', async () => {
    const close = vi.fn()
    const items = buildPaletteItems({ closePalette: close, harnesses: [broken] })
    const item = items.find((i) => i.id === 'action:harness-run:stripped')
    await item!.run()
    expect(runHarness).not.toHaveBeenCalled()
    // The palette stays open — nothing ran.
    expect(close).not.toHaveBeenCalled()
  })

  it('a clean harness stays enabled and runs', async () => {
    const close = vi.fn()
    const items = buildPaletteItems({ closePalette: close, harnesses: [clean] })
    const item = items.find((i) => i.id === 'action:harness-run:test-fixer')
    expect(item!.disabledReason).toBeUndefined()
    await item!.run()
    expect(close).toHaveBeenCalled()
    expect(runHarness).toHaveBeenCalledWith(clean)
  })

  it('warning-only diagnostics do not disable run', async () => {
    const items = buildPaletteItems({ closePalette: () => {}, harnesses: [warned] })
    const item = items.find((i) => i.id === 'action:harness-run:warned')
    expect(item!.disabledReason).toBeUndefined()
    await item!.run()
    expect(runHarness).toHaveBeenCalledWith(warned)
  })
})

describe('palette-sources — step 5 per-agent revert entries (contracts v1.2.5)', () => {
  const commits: AgentCommits[] = [
    {
      agentId: 'test-fixer',
      shas: ['aaa1', 'aaa2'],
      lastSubject: 'fix: retry loop',
      lastDate: '2026-07-07T10:00:00.000Z'
    },
    { agentId: 'spent-agent', shas: [], lastSubject: '', lastDate: '' }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('emits entries only for agents with revertable commits', () => {
    const items = buildPaletteItems({ closePalette: () => {}, agentCommits: commits })
    const entry = items.find((i) => i.id === 'action:revert-agent:test-fixer')
    expect(entry).toBeDefined()
    expect(entry!.title).toBe('Revert harness: test-fixer')
    expect(entry!.subtitle).toContain('2 commits')
    expect(entry!.subtitle).toContain('confirm in approvals tray')
    // Zero unreverted commits ⇒ no entry.
    expect(items.find((i) => i.id === 'action:revert-agent:spent-agent')).toBeUndefined()
  })

  it('emits no revert entries when the snapshot is absent (tests, note-hit mapping)', () => {
    const items = buildPaletteItems({ closePalette: () => {} })
    expect(items.some((i) => i.id.startsWith('action:revert-agent:'))).toBe(false)
  })

  it('running an entry closes the palette and routes to the tray confirm — never reverts directly', () => {
    const close = vi.fn()
    const dispatched: Event[] = []
    const spy = vi.spyOn(window, 'dispatchEvent').mockImplementation((e) => {
      dispatched.push(e)
      return true
    })
    try {
      const items = buildPaletteItems({ closePalette: close, agentCommits: commits })
      items.find((i) => i.id === 'action:revert-agent:test-fixer')!.run()
      expect(close).toHaveBeenCalled()
      const event = dispatched.find((e) => e.type === 'te:revert-agent')
      expect(event).toBeDefined()
      expect((event as CustomEvent<string>).detail).toBe('test-fixer')
    } finally {
      spy.mockRestore()
    }
  })
})
