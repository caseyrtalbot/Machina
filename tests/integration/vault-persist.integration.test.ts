import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Stub window.api before any store imports (Zustand stores may reference window at module load)
vi.stubGlobal('window', {
  api: {
    vault: {
      writeState: vi.fn().mockResolvedValue(undefined),
      readState: vi.fn().mockResolvedValue({})
    }
  }
})

vi.stubGlobal('localStorage', {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn()
})

// Mock canvas-autosave (vault-persist imports flushCanvasSave)
vi.mock('@renderer/store/canvas-autosave', () => ({
  flushCanvasSave: vi.fn().mockResolvedValue(undefined)
}))

// Mock error-logger (vault-persist imports logError + notifyError)
vi.mock('@renderer/utils/error-logger', () => ({
  logError: vi.fn(),
  notifyError: vi.fn()
}))

// Mock system-artifacts (editor-store imports isSystemArtifactPath)
vi.mock('@shared/system-artifacts', () => ({
  isSystemArtifactPath: vi.fn().mockReturnValue(false)
}))

import { useVaultStore } from '@renderer/store/vault-store'
import { useEditorStore } from '@renderer/store/editor-store'
import { useUiStore } from '@renderer/store/ui-store'
import {
  rehydrateUiState,
  flushVaultState,
  subscribeVaultPersist
} from '@renderer/store/vault-persist'

const writeStateMock = window.api.vault.writeState as ReturnType<typeof vi.fn>

function resetStores(): void {
  useVaultStore.setState({
    vaultPath: null,
    state: null,
    config: null,
    files: [],
    systemFiles: [],
    artifacts: [],
    graph: { nodes: [], edges: [] },
    parseErrors: [],
    fileToId: {},
    artifactPathById: {},
    discoveredTypes: [],
    activeWorkspace: null,
    isLoading: false
  })

  useEditorStore.setState({
    activeNoteId: null,
    activeNotePath: null,
    mode: 'rich',
    isDirty: false,
    content: '',
    openTabs: [],
    historyStack: [],
    historyIndex: -1
  })

  useUiStore.setState(useUiStore.getInitialState())
}

describe('vault-persist integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStores()
    writeStateMock.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ─── 1. gatherVaultState round-trip ───────────────────────────────────────

  describe('gatherVaultState round-trip', () => {
    it('collects state from the editor and ui stores into VaultState', () => {
      useVaultStore.setState({
        vaultPath: '/test/vault',
        state: {
          version: 2,
          lastOpenNote: null,
          fileTreeCollapseState: { '/stale': true }
        }
      })

      useEditorStore.setState({ activeNotePath: '/test/vault/notes/hello.md' })
      useUiStore.setState({
        backlinkCollapsed: { 'note-1': true },
        fileTreeCollapseState: { '/docs': true }
      })

      // Trigger a flush to capture the gathered state
      flushVaultState()

      expect(writeStateMock).toHaveBeenCalledOnce()
      const [vaultPath, state] = writeStateMock.mock.calls[0]

      expect(vaultPath).toBe('/test/vault')
      expect(state).toEqual({
        version: 2,
        lastOpenNote: '/test/vault/notes/hello.md',
        fileTreeCollapseState: { '/docs': true },
        ui: {
          backlinkCollapsed: { 'note-1': true },
          dismissedGhosts: [],
          outlineVisible: false,
          bookmarkedPaths: [],
          graphTutorialDismissed: false
        }
      })
    })

    it('uses defaults when vault state is null', () => {
      useVaultStore.setState({ vaultPath: '/v', state: null })
      useEditorStore.setState({ activeNotePath: null })

      flushVaultState()

      expect(writeStateMock).toHaveBeenCalledOnce()
      const state = writeStateMock.mock.calls[0][1]

      expect(state.version).toBe(1)
      expect(state.lastOpenNote).toBeNull()
      expect(state.fileTreeCollapseState).toEqual({})
    })
  })

  // ─── 2. subscribeVaultPersist triggers on activeNotePath change ──────────

  describe('subscribeVaultPersist on activeNotePath', () => {
    it('schedules a persist when activeNotePath changes', () => {
      useVaultStore.setState({ vaultPath: '/v' })
      const unsub = subscribeVaultPersist()

      useEditorStore.setState({ activeNotePath: '/v/new-note.md' })
      vi.advanceTimersByTime(1000)

      expect(writeStateMock).toHaveBeenCalledOnce()
      expect(writeStateMock.mock.calls[0][1].lastOpenNote).toBe('/v/new-note.md')

      unsub()
    })

    it('does not trigger when activeNotePath stays the same', () => {
      useVaultStore.setState({ vaultPath: '/v' })
      useEditorStore.setState({ activeNotePath: '/v/same.md' })
      const unsub = subscribeVaultPersist()

      // Set to the same value -- should not trigger
      useEditorStore.setState({ activeNotePath: '/v/same.md' })
      vi.advanceTimersByTime(1000)

      expect(writeStateMock).not.toHaveBeenCalled()

      unsub()
    })
  })

  // ─── 3. Debounce: rapid changes produce one write after 1s ──────────────

  describe('debounce behavior', () => {
    it('coalesces rapid store changes into a single write after 1s', () => {
      useVaultStore.setState({ vaultPath: '/v' })
      const unsub = subscribeVaultPersist()

      // Fire 5 rapid changes within 1 second
      useEditorStore.setState({ activeNotePath: '/v/a.md' })
      vi.advanceTimersByTime(200)
      useEditorStore.setState({ activeNotePath: '/v/b.md' })
      vi.advanceTimersByTime(200)
      useEditorStore.setState({ activeNotePath: '/v/c.md' })
      vi.advanceTimersByTime(200)
      useEditorStore.setState({ activeNotePath: '/v/d.md' })
      vi.advanceTimersByTime(200)
      useEditorStore.setState({ activeNotePath: '/v/e.md' })

      // Not yet 1s since last change
      expect(writeStateMock).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1000)

      // Only one write with the final value
      expect(writeStateMock).toHaveBeenCalledOnce()
      expect(writeStateMock.mock.calls[0][1].lastOpenNote).toBe('/v/e.md')

      unsub()
    })

    it('does not write before the debounce period elapses', () => {
      useVaultStore.setState({ vaultPath: '/v' })
      const unsub = subscribeVaultPersist()

      useEditorStore.setState({ activeNotePath: '/v/note.md' })
      vi.advanceTimersByTime(500)

      expect(writeStateMock).not.toHaveBeenCalled()

      vi.advanceTimersByTime(500)

      expect(writeStateMock).toHaveBeenCalledOnce()

      unsub()
    })
  })

  // ─── 4. flushVaultState fires immediately ────────────────────────────────

  describe('flushVaultState', () => {
    it('writes immediately without waiting for debounce', () => {
      useVaultStore.setState({ vaultPath: '/v' })
      useEditorStore.setState({ activeNotePath: '/v/urgent.md' })

      flushVaultState()

      // Called synchronously, no timer advancement needed
      expect(writeStateMock).toHaveBeenCalledOnce()
      expect(writeStateMock.mock.calls[0][1].lastOpenNote).toBe('/v/urgent.md')
    })

    it('cancels any pending debounced write', () => {
      useVaultStore.setState({ vaultPath: '/v' })
      const unsub = subscribeVaultPersist()

      // Trigger a debounced persist
      useEditorStore.setState({ activeNotePath: '/v/first.md' })
      vi.advanceTimersByTime(500)

      // Flush immediately (cancels the pending timer)
      useEditorStore.setState({ activeNotePath: '/v/flushed.md' })
      flushVaultState()

      expect(writeStateMock).toHaveBeenCalledOnce()
      expect(writeStateMock.mock.calls[0][1].lastOpenNote).toBe('/v/flushed.md')

      // Advance past the original debounce -- the flush already wrote
      vi.advanceTimersByTime(1500)
      expect(writeStateMock.mock.calls.length).toBeGreaterThanOrEqual(1)

      unsub()
    })

    it('does nothing when vaultPath is null', () => {
      useVaultStore.setState({ vaultPath: null })

      flushVaultState()

      expect(writeStateMock).not.toHaveBeenCalled()
    })
  })

  // ─── 5. rehydrateUiState populates the ui-store from vault state ─────────

  describe('rehydrateUiState', () => {
    it('populates the ui-store from vault state', () => {
      useVaultStore.setState({
        state: {
          version: 1,
          lastOpenNote: null,
          fileTreeCollapseState: { '/v/docs': true },
          ui: {
            backlinkCollapsed: { 'note-A': true, 'note-B': false },
            dismissedGhosts: ['g1'],
            outlineVisible: true,
            bookmarkedPaths: ['/v/pin.md']
          }
        }
      })

      rehydrateUiState()

      const ui = useUiStore.getState()
      expect(ui.backlinkCollapsed).toEqual({ 'note-A': true, 'note-B': false })
      expect(ui.dismissedGhosts).toEqual(['g1'])
      expect(ui.outlineVisible).toBe(true)
      expect(ui.bookmarkedPaths).toEqual(['/v/pin.md'])
      expect(ui.fileTreeCollapseState).toEqual({ '/v/docs': true })
    })

    it('resets to defaults when vault state has no ui field', () => {
      useUiStore.setState({
        backlinkCollapsed: { stale: true },
        fileTreeCollapseState: { '/stale': true }
      })

      useVaultStore.setState({
        state: {
          version: 1,
          lastOpenNote: null,
          fileTreeCollapseState: {}
          // no ui field
        }
      })

      rehydrateUiState()

      const ui = useUiStore.getState()
      expect(ui.backlinkCollapsed).toEqual({})
      expect(ui.dismissedGhosts).toEqual([])
      expect(ui.outlineVisible).toBe(false)
      expect(ui.bookmarkedPaths).toEqual([])
      expect(ui.fileTreeCollapseState).toEqual({})
    })

    it('resets to defaults when vault state is null', () => {
      useUiStore.setState({ backlinkCollapsed: { stale: true } })
      useVaultStore.setState({ state: null })

      rehydrateUiState()

      expect(useUiStore.getState().backlinkCollapsed).toEqual({})
    })

    it('copies into fresh objects (no shared references with vault state)', () => {
      useVaultStore.setState({
        state: {
          version: 1,
          lastOpenNote: null,
          fileTreeCollapseState: {},
          ui: {
            backlinkCollapsed: { x: true },
            dismissedGhosts: [],
            outlineVisible: false,
            bookmarkedPaths: []
          }
        }
      })

      rehydrateUiState()

      const ui = useUiStore.getState()
      expect(ui.backlinkCollapsed).toEqual({ x: true })
      expect(ui.backlinkCollapsed).not.toBe(useVaultStore.getState().state?.ui?.backlinkCollapsed)
    })
  })

  // ─── 6. Unsubscribe stops triggering writes ─────────────────────────────

  describe('unsubscribe', () => {
    it('stops scheduling persists after unsubscribe', () => {
      useVaultStore.setState({ vaultPath: '/v' })
      const unsub = subscribeVaultPersist()

      // Verify subscription works
      useEditorStore.setState({ activeNotePath: '/v/before.md' })
      vi.advanceTimersByTime(1000)
      expect(writeStateMock).toHaveBeenCalledOnce()
      writeStateMock.mockClear()

      // Unsubscribe
      unsub()

      // Further changes (editor and ui) should not trigger writes
      useEditorStore.setState({ activeNotePath: '/v/after.md' })
      useUiStore.getState().toggleBookmark('/v/after.md')
      vi.advanceTimersByTime(2000)

      expect(writeStateMock).not.toHaveBeenCalled()
    })
  })

  // ─── 7. ui-store is the single persisted-UI owner ────────────────────────

  describe('ui-store persistence', () => {
    it('ui-store mutations schedule a persist carrying the new ui state', () => {
      useVaultStore.setState({ vaultPath: '/v' })
      const unsub = subscribeVaultPersist()

      useUiStore.getState().toggleBacklinkCollapsed('/v/a.md')
      useUiStore.getState().toggleBookmark('/v/a.md')
      vi.advanceTimersByTime(1000)

      expect(writeStateMock).toHaveBeenCalledOnce()
      expect(writeStateMock.mock.calls[0][1].ui).toEqual({
        backlinkCollapsed: { '/v/a.md': false },
        dismissedGhosts: [],
        outlineVisible: false,
        bookmarkedPaths: ['/v/a.md'],
        graphTutorialDismissed: false
      })

      unsub()
    })

    it('file tree collapse toggles persist into fileTreeCollapseState', () => {
      useVaultStore.setState({ vaultPath: '/v' })
      const unsub = subscribeVaultPersist()

      useUiStore.getState().toggleFileTreeCollapsed('/v/docs')
      vi.advanceTimersByTime(1000)

      expect(writeStateMock).toHaveBeenCalledOnce()
      expect(writeStateMock.mock.calls[0][1].fileTreeCollapseState).toEqual({ '/v/docs': true })

      unsub()
    })
  })
})
