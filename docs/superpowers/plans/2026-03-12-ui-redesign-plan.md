# Thought Engine UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Thought Engine from a functional prototype into a polished, production-grade desktop knowledge engine with custom titlebar, IPC security, Web Worker indexing, real-time graph updates, neon highlights, and professional design coherence.

**Architecture:** Four-phase horizontal slice approach. Each phase leaves the app in a working, improved state. Phase 1 (Foundation) locks down IPC security, fixes 7 pre-existing bugs, migrates indexing to a Web Worker, and establishes the layout skeleton. Phases 2-4 layer on function, interaction, and polish. All existing 35 tests must pass throughout.

**Tech Stack:** Electron 39 + electron-vite, React 19, TypeScript, Zustand 5, Tiptap v2, CodeMirror 6, D3.js + Canvas2D, xterm.js + node-pty, Tailwind v4, Vitest

**Spec:** `docs/superpowers/specs/2026-03-12-ui-redesign-design.md` (V4, 1016 lines)

**Project:** `/Users/caseytalbot/Projects/thought-engine/`

**npm workaround:** `--cache /tmp/npm-cache-te` for all installs

---

## File Structure

### New Files (25)

| File | Responsibility |
|------|---------------|
| `src/preload/api.d.ts` | TypeScript declarations for `window.api` typed IPC surface |
| `src/main/ipc/config.ts` | `config:read` and `config:write` IPC handlers for settings persistence |
| `src/renderer/src/components/Titlebar.tsx` | Custom titlebar with traffic lights, vault tab, settings gear |
| `src/renderer/src/components/SettingsModal.tsx` | Tabbed settings modal (appearance, editor, graph, terminal, vault) |
| `src/renderer/src/components/StatusBar.tsx` | Context-sensitive status bar extracted from App.tsx |
| `src/renderer/src/components/PanelErrorBoundary.tsx` | Per-panel error boundary with retry fallback |
| `src/renderer/src/lib/config-storage.ts` | IPC-backed Zustand storage adapter with version migration |
| `src/renderer/src/engine/vault-worker.ts` | Web Worker: receives files, runs parser + graph-builder, posts results |
| `src/renderer/src/engine/useVaultWorker.ts` | Hook managing Worker lifecycle, message posting/receiving |
| `src/renderer/src/panels/sidebar/buildFileTree.ts` | Pure function: flat file paths to hierarchical tree structure |
| `src/renderer/src/panels/graph/GraphSettingsPanel.tsx` | Obsidian-style graph settings overlay (filters, display, forces) |
| `src/renderer/src/panels/graph/useGraphHighlight.ts` | Hover/click state machine, adjacency list, connected set computation |
| `src/renderer/src/panels/graph/useGraphAnimation.ts` | Enter/exit transitions, rename detection, rAF batching |
| `src/renderer/src/panels/graph/GraphContextMenu.tsx` | Right-click context menu on graph nodes |
| `src/renderer/src/panels/graph/glowSprites.ts` | Offscreen canvas glow sprite cache per artifact color |
| `src/renderer/src/panels/graph/GraphRendererInterface.ts` | Pluggable renderer abstraction (render, hitTest, resize) |
| `src/renderer/src/panels/graph/GraphMinimap.tsx` | Thumbnail inset canvas showing full graph + viewport rectangle |
| `src/renderer/src/panels/graph/useGraphKeyboard.ts` | Keyboard navigation hook for graph (Tab, arrows, Enter, Space) |
| `src/renderer/src/panels/skills/SkillsPanel.tsx` | Lists vault `.claude/commands/`, run button sends to terminal |
| `src/renderer/src/panels/editor/EditorToolbar.tsx` | Rich editor toolbar (undo, headings, formatting, lists, code) |
| `src/renderer/src/panels/editor/EditorBreadcrumb.tsx` | Back/forward nav + file path breadcrumb |
| `src/renderer/src/panels/editor/BacklinksPanel.tsx` | Collapsible panel showing files that link to current note |
| `src/renderer/src/panels/editor/FrontmatterHeader.tsx` | Collapsible metadata header rendering frontmatter as styled UI |
| `src/renderer/src/store/graph-settings-store.ts` | Graph display/force values, persisted to vault config |
| `src/renderer/src/store/settings-store.ts` | App preferences (appearance, editor, terminal) |

### Modified Files (24)

| File | What Changes |
|------|-------------|
| `src/preload/index.ts` | Replace blanket `electronAPI` with typed channel allowlist |
| `src/shared/ipc-channels.ts` | Add `window:*`, `config:*`, `terminal:process-name` channel types |
| `src/shared/types.ts` | Extend `VaultState` with session persistence fields |
| `src/main/index.ts` | `titleBarStyle: 'hidden'`, register config IPC, window IPC |
| `src/main/ipc/shell.ts` | Add `terminal:process-name` handler |
| `src/main/services/vault-watcher.ts` | Configurable ignore patterns, expanded defaults |
| `src/main/services/shell-service.ts` | Add `getProcessName()` method |
| `src/renderer/src/App.tsx` | Titlebar, error boundaries, new layout, vault loading orchestration |
| `src/renderer/src/store/vault-store.ts` | Remove VaultIndex class, add plain state fields, Worker integration |
| `src/renderer/src/store/graph-store.ts` | Add `'skills'` to contentView union |
| `src/renderer/src/panels/editor/RichEditor.tsx` | Replace `getText()` with tiptap-markdown serializer |
| `src/renderer/src/panels/editor/SourceEditor.tsx` | Fix stale closure via useRef for onChange |
| `src/renderer/src/panels/editor/EditorPanel.tsx` | Integrate toolbar, breadcrumb, frontmatter, backlinks, autosave |
| `src/renderer/src/design/components/SplitPane.tsx` | Fix mouse handler leak on unmount |
| `src/renderer/src/panels/terminal/TerminalPanel.tsx` | Tab close kills PTY, tab styling, rename, search, zoom |
| `src/renderer/src/panels/sidebar/FileTree.tsx` | Hierarchy, folders, counts, inline rename, delete |
| `src/renderer/src/panels/sidebar/Sidebar.tsx` | Action bar, sort dropdown |
| `src/renderer/src/panels/graph/GraphPanel.tsx` | Settings, highlights, animation, minimap, loading, keyboard |
| `src/renderer/src/panels/graph/GraphRenderer.ts` | Glow sprites, dimming, edge brightening, viewport culling, LOD |
| `src/renderer/src/panels/graph/GraphControls.tsx` | Graph/Skills toggle, remove Editor button |
| `src/renderer/src/design/components/CommandPalette.tsx` | Fuzzy search, recent files, `>` command prefix routing |
| `src/renderer/src/hooks/useKeyboard.ts` | Updated Cmd+G cycle (graph > skills > graph) |
| `src/renderer/src/design/tokens.ts` | Type scale, border-radius, animation/transition constants |
| `src/renderer/src/assets/index.css` | CSS custom properties, scrollbar styles, prefers-reduced-motion |
| `src/renderer/src/engine/indexer.ts` | Add `getBacklinks(id)` reverse lookup method |

---

## Chunk 1: Phase 1A (IPC Security Lockdown) + Phase 1B (Watcher Hardening)

**Why first:** All subsequent work builds on the new `window.api.*` IPC pattern. Every renderer file that calls IPC must migrate. The watcher hardening is a small, independent change that fits naturally here.

### Task 1: Add new IPC channel types

**Files:**
- Modify: `src/shared/ipc-channels.ts`

- [ ] **Step 1: Update IPC channel type definitions**

Add `window:*`, `config:*`, and `terminal:process-name` channels to the existing `IpcChannels` interface:

```typescript
// src/shared/ipc-channels.ts
import type { VaultConfig, VaultState } from './types'

export interface IpcChannels {
  // --- File system (existing) ---
  'fs:read-file': { request: { path: string }; response: string }
  'fs:write-file': { request: { path: string; content: string }; response: void }
  'fs:delete-file': { request: { path: string }; response: void }
  'fs:list-files': { request: { dir: string; pattern?: string }; response: string[] }
  'fs:list-files-recursive': { request: { dir: string }; response: string[] }
  'fs:select-vault': { request: void; response: string | null }

  // --- Vault (existing) ---
  'vault:read-config': { request: { vaultPath: string }; response: VaultConfig }
  'vault:write-config': { request: { vaultPath: string; config: VaultConfig }; response: void }
  'vault:read-state': { request: { vaultPath: string }; response: VaultState }
  'vault:write-state': { request: { vaultPath: string; state: VaultState }; response: void }
  'vault:init': { request: { vaultPath: string }; response: void }
  'vault:git-branch': { request: { vaultPath: string }; response: string | null }
  'vault:watch-start': { request: { vaultPath: string }; response: void }
  'vault:watch-stop': { request: void; response: void }

  // --- Window (new) ---
  'window:minimize': { request: void; response: void }
  'window:maximize': { request: void; response: void }
  'window:close': { request: void; response: void }

  // --- Config persistence (new) ---
  'config:read': { request: { scope: string; key: string }; response: unknown }
  'config:write': { request: { scope: string; key: string; value: unknown }; response: void }

  // --- Terminal (existing + new) ---
  'terminal:create': { request: { cwd: string; shell?: string }; response: string }
  'terminal:write': { request: { sessionId: string; data: string }; response: void }
  'terminal:resize': { request: { sessionId: string; cols: number; rows: number }; response: void }
  'terminal:kill': { request: { sessionId: string }; response: void }
  'terminal:process-name': { request: { sessionId: string }; response: string | null }
}

export interface IpcEvents {
  'terminal:data': { sessionId: string; data: string }
  'terminal:exit': { sessionId: string; code: number }
  'vault:file-changed': { path: string; event: 'add' | 'change' | 'unlink' }
}

export type IpcChannel = keyof IpcChannels
export type IpcRequest<C extends IpcChannel> = IpcChannels[C]['request']
export type IpcResponse<C extends IpcChannel> = IpcChannels[C]['response']
```

- [ ] **Step 2: Run typecheck to verify**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: PASS (additive change only)

- [ ] **Step 3: Run existing tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: 35/35 passing

- [ ] **Step 4: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/shared/ipc-channels.ts
git commit -m "feat: add window, config, and process-name IPC channel types"
```

---

### Task 2: Replace preload with typed channel allowlist

**Files:**
- Modify: `src/preload/index.ts` (full rewrite)
- Create: `src/preload/api.d.ts`

- [ ] **Step 1: Rewrite preload with typed allowlist**

Replace the entire contents of `src/preload/index.ts`:

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'
import type { VaultConfig, VaultState } from '../shared/types'

const api = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },
  config: {
    read: (scope: string, key: string) => ipcRenderer.invoke('config:read', { scope, key }),
    write: (scope: string, key: string, value: unknown) =>
      ipcRenderer.invoke('config:write', { scope, key, value }),
  },
  fs: {
    readFile: (path: string) => ipcRenderer.invoke('fs:read-file', { path }),
    writeFile: (path: string, content: string) =>
      ipcRenderer.invoke('fs:write-file', { path, content }),
    listFiles: (dir: string, pattern?: string) =>
      ipcRenderer.invoke('fs:list-files', { dir, pattern }),
    listFilesRecursive: (dir: string) => ipcRenderer.invoke('fs:list-files-recursive', { dir }),
    deleteFile: (path: string) => ipcRenderer.invoke('fs:delete-file', { path }),
    selectVault: () => ipcRenderer.invoke('fs:select-vault'),
  },
  vault: {
    init: (vaultPath: string) => ipcRenderer.invoke('vault:init', { vaultPath }),
    readConfig: (vaultPath: string) =>
      ipcRenderer.invoke('vault:read-config', { vaultPath }) as Promise<VaultConfig>,
    writeConfig: (vaultPath: string, config: VaultConfig) =>
      ipcRenderer.invoke('vault:write-config', { vaultPath, config }),
    readState: (vaultPath: string) =>
      ipcRenderer.invoke('vault:read-state', { vaultPath }) as Promise<VaultState>,
    writeState: (vaultPath: string, state: VaultState) =>
      ipcRenderer.invoke('vault:write-state', { vaultPath, state }),
    gitBranch: (vaultPath: string) =>
      ipcRenderer.invoke('vault:git-branch', { vaultPath }) as Promise<string | null>,
    watchStart: (vaultPath: string) => ipcRenderer.invoke('vault:watch-start', { vaultPath }),
    watchStop: () => ipcRenderer.invoke('vault:watch-stop'),
  },
  terminal: {
    create: (cwd: string, shell?: string) =>
      ipcRenderer.invoke('terminal:create', { cwd, shell }) as Promise<string>,
    write: (sessionId: string, data: string) =>
      ipcRenderer.invoke('terminal:write', { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', { sessionId, cols, rows }),
    kill: (sessionId: string) => ipcRenderer.invoke('terminal:kill', { sessionId }),
    getProcessName: (sessionId: string) =>
      ipcRenderer.invoke('terminal:process-name', { sessionId }) as Promise<string | null>,
  },
  on: {
    terminalData: (callback: (data: { sessionId: string; data: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: { sessionId: string; data: string }) =>
        callback(data)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.removeListener('terminal:data', handler)
    },
    terminalExit: (callback: (data: { sessionId: string; code: number }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: { sessionId: string; code: number }) =>
        callback(data)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    },
    fileChanged: (
      callback: (data: { path: string; event: 'add' | 'change' | 'unlink' }) => void
    ) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        data: { path: string; event: 'add' | 'change' | 'unlink' }
      ) => callback(data)
      ipcRenderer.on('vault:file-changed', handler)
      return () => ipcRenderer.removeListener('vault:file-changed', handler)
    },
  },
}

export type ElectronApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-expect-error fallback for non-isolated contexts
  window.api = api
}
```

- [ ] **Step 2: Create TypeScript declarations for window.api**

```typescript
// src/preload/api.d.ts
import type { ElectronApi } from './index'

declare global {
  interface Window {
    api: ElectronApi
  }
}
```

- [ ] **Step 3: Clear old preload type declarations**

The existing `src/preload/index.d.ts` has a conflicting `Window.api` declaration. Clear it to avoid duplicate type errors:

```typescript
// src/preload/index.d.ts
// Type declarations moved to src/preload/api.d.ts
// This file is intentionally empty to avoid conflicting Window.api declarations.
export {}
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck:node`
Expected: PASS (preload compiles under tsconfig.node.json)

Note: `typecheck:web` will FAIL at this point because renderer code still references `window.electron.ipcRenderer`. That is expected and fixed in Tasks 3-5.

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/preload/index.ts src/preload/api.d.ts src/preload/index.d.ts
git commit -m "feat: replace blanket electronAPI with typed IPC channel allowlist"
```

---

### Task 3: Migrate vault-store IPC calls

> **Scope note:** This task only migrates IPC call patterns (replacing `window.electron.ipcRenderer` with `window.api`). The VaultIndex class remains in store state for now. The structural replacement of VaultIndex with plain `artifacts: Artifact[]` and `graph: KnowledgeGraph` happens in Task 19 (Web Worker migration, Chunk 3), which is the correct place since it coincides with the Worker-based architecture change.

**Files:**
- Modify: `src/renderer/src/store/vault-store.ts`

- [ ] **Step 1: Replace window.electron.ipcRenderer with window.api**

The current vault-store (line 5) does `const ipcRenderer = window.electron.ipcRenderer`. Replace the entire file:

```typescript
// src/renderer/src/store/vault-store.ts
import { create } from 'zustand'
import type { Artifact, VaultConfig, VaultState, KnowledgeGraph } from '@shared/types'
import { VaultIndex } from '../engine/indexer'

interface VaultFile {
  path: string
  filename: string
  title: string
  modified: string
}

interface VaultStore {
  vaultPath: string | null
  config: VaultConfig | null
  state: VaultState | null
  files: VaultFile[]
  index: VaultIndex
  activeWorkspace: string | null
  isLoading: boolean

  setVaultPath: (path: string) => void
  setConfig: (config: VaultConfig) => void
  setState: (state: VaultState) => void
  setFiles: (files: VaultFile[]) => void
  setActiveWorkspace: (workspace: string | null) => void
  loadVault: (vaultPath: string) => Promise<void>
  getGraph: () => KnowledgeGraph
  getArtifact: (id: string) => Artifact | undefined
  search: (query: string) => Artifact[]
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  vaultPath: null,
  config: null,
  state: null,
  files: [],
  index: new VaultIndex(),
  activeWorkspace: null,
  isLoading: false,

  setVaultPath: (path) => set({ vaultPath: path }),
  setConfig: (config) => set({ config }),
  setState: (state) => set({ state }),
  setFiles: (files) => set({ files }),
  setActiveWorkspace: (workspace) => set({ activeWorkspace: workspace }),

  loadVault: async (vaultPath: string) => {
    set({ isLoading: true })
    const index = new VaultIndex()

    try {
      const config = await window.api.vault.readConfig(vaultPath)
      const state = await window.api.vault.readState(vaultPath)

      const filePaths = await window.api.fs.listFilesRecursive(vaultPath)

      const files: VaultFile[] = []
      for (const filePath of filePaths) {
        const content = await window.api.fs.readFile(filePath)
        const filename = filePath.split('/').pop() ?? filePath
        index.addFile(filePath, content)

        const id = index.getIdForFile(filePath)
        const artifact = id ? index.getArtifact(id) : undefined

        files.push({
          path: filePath,
          filename,
          title: artifact?.title ?? filename.replace(/\.md$/, ''),
          modified: artifact?.modified ?? new Date().toISOString().split('T')[0]
        })
      }

      set({ vaultPath, config, state, files, index, isLoading: false })
    } catch (err) {
      console.error('Failed to load vault:', err)
      set({ vaultPath, isLoading: false })
    }
  },

  getGraph: () => get().index.getGraph(),
  getArtifact: (id) => get().index.getArtifact(id),
  search: (query) => get().index.search(query)
}))
```

Key change: All `ipcRenderer.invoke('channel', args)` calls become `window.api.<domain>.<method>(args)`.

- [ ] **Step 2: Run typecheck:web**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck:web`
Expected: Errors in `App.tsx` and `TerminalPanel.tsx` only (they still reference old API). The vault-store should compile clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/store/vault-store.ts
git commit -m "refactor: migrate vault-store from electronAPI to typed window.api"
```

---

### Task 4: Migrate TerminalPanel IPC calls

**Files:**
- Modify: `src/renderer/src/panels/terminal/TerminalPanel.tsx`

- [ ] **Step 1: Replace all IPC calls with window.api**

The current file has `const ipcRenderer = window.electron.ipcRenderer` at line 12. Remove that line and replace all usages:

1. Line 12: Delete `const ipcRenderer = window.electron.ipcRenderer`
2. Line 33: `ipcRenderer.invoke('terminal:create', { cwd })` becomes `window.api.terminal.create(cwd)`
3. Line 68: `ipcRenderer.invoke('terminal:write', { sessionId, data })` becomes `window.api.terminal.write(sessionId, data)`
4. Lines 96-104: `ipcRenderer.on('terminal:data', ...)` becomes `window.api.on.terminalData(...)` (returns unsubscribe function directly)
5. Lines 106-116: `ipcRenderer.on('terminal:exit', ...)` becomes `window.api.on.terminalExit(...)` (returns unsubscribe function directly)
6. Line 136: `ipcRenderer.invoke('terminal:resize', ...)` becomes `window.api.terminal.resize(activeSessionId, cols, rows)`
7. Line 160: `ipcRenderer.invoke('terminal:kill', { sessionId })` becomes `window.api.terminal.kill(sessionId)`

The event listener API changes shape. The old API passed `(_event, payload)` but the new `window.api.on.*` callbacks receive the payload directly (no event argument). The return value is now a cleanup function directly (not the ipcRenderer).

Full replacement for the event listener effect:

```typescript
  // Listen for data and exit events from main process
  useEffect(() => {
    const unsubData = window.api.on.terminalData((payload) => {
      const instance = instancesRef.current.get(payload.sessionId)
      if (instance) {
        instance.terminal.write(payload.data)
      }
    })

    const unsubExit = window.api.on.terminalExit((payload) => {
      const instance = instancesRef.current.get(payload.sessionId)
      if (instance) {
        instance.terminal.writeln(`\r\n[Process exited with code ${payload.code}]`)
        instancesRef.current.delete(payload.sessionId)
      }
      removeSession(payload.sessionId)
    })

    return () => {
      unsubData()
      unsubExit()
    }
  }, [removeSession])
```

Full replacement for the cleanup effect:

```typescript
  // Cleanup all terminals on unmount
  useEffect(() => {
    const instances = instancesRef.current
    return () => {
      for (const [sessionId, instance] of instances) {
        instance.terminal.dispose()
        window.api.terminal.kill(sessionId)
      }
      instances.clear()
    }
  }, [])
```

- [ ] **Step 2: Verify no remaining references to window.electron**

Search the file for `window.electron` or `ipcRenderer`. There should be zero matches.

- [ ] **Step 3: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/terminal/TerminalPanel.tsx
git commit -m "refactor: migrate TerminalPanel from electronAPI to typed window.api"
```

---

### Task 5: Migrate App.tsx IPC call

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Replace the StatusBar IPC call**

In the `StatusBar` component (line 24), replace:
```typescript
window.electron.ipcRenderer
  .invoke('vault:git-branch', { vaultPath })
  .then(setGitBranch)
  .catch(() => setGitBranch(null))
```

With:
```typescript
window.api.vault
  .gitBranch(vaultPath)
  .then(setGitBranch)
  .catch(() => setGitBranch(null))
```

- [ ] **Step 2: Run full typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: PASS. All renderer code now uses `window.api.*` exclusively.

- [ ] **Step 3: Run all tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: 35/35 passing (tests mock at the module level, not at window.electron)

- [ ] **Step 4: Search for any remaining window.electron references**

Run: `grep -r "window\.electron" src/renderer/ --include="*.ts" --include="*.tsx"`
Expected: Zero matches.

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/App.tsx
git commit -m "refactor: migrate App.tsx git-branch call to typed window.api"
```

---

### Task 6: Harden vault watcher with configurable ignores

**Files:**
- Modify: `src/main/services/vault-watcher.ts`

- [ ] **Step 1: Write the test**

Create `tests/services/vault-watcher.test.ts`:

```typescript
// tests/services/vault-watcher.test.ts
import { describe, it, expect } from 'vitest'
import { buildIgnorePatterns, DEFAULT_IGNORE_PATTERNS } from '../../src/main/services/vault-watcher'

describe('vault-watcher ignore patterns', () => {
  it('includes default ignores', () => {
    expect(DEFAULT_IGNORE_PATTERNS).toContain('node_modules')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('.thought-engine')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('dist')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('build')
  })

  it('merges custom patterns with defaults', () => {
    const custom = ['vendor', '*.log']
    const result = buildIgnorePatterns(custom)
    // Should include all defaults plus custom
    expect(result).toContain('node_modules')
    expect(result).toContain('vendor')
    expect(result).toContain('*.log')
  })

  it('deduplicates patterns', () => {
    const custom = ['node_modules', 'vendor']
    const result = buildIgnorePatterns(custom)
    const nodeModulesCount = result.filter((p) => p === 'node_modules').length
    expect(nodeModulesCount).toBe(1)
  })

  it('handles empty custom patterns', () => {
    const result = buildIgnorePatterns([])
    expect(result.length).toBe(DEFAULT_IGNORE_PATTERNS.length)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/services/vault-watcher.test.ts`
Expected: FAIL with "cannot find module" or "buildIgnorePatterns is not exported"

- [ ] **Step 3: Implement configurable ignores**

Replace `src/main/services/vault-watcher.ts`:

```typescript
// src/main/services/vault-watcher.ts
import { watch, type FSWatcher } from 'chokidar'
import { extname } from 'path'

export type FileEvent = 'add' | 'change' | 'unlink'
export type FileChangeCallback = (path: string, event: FileEvent) => void

export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.thought-engine',
  'dist',
  'build',
  '.git',
  '.DS_Store',
] as const

export function buildIgnorePatterns(custom: readonly string[]): string[] {
  const set = new Set<string>([...DEFAULT_IGNORE_PATTERNS])
  for (const pattern of custom) {
    set.add(pattern)
  }
  return Array.from(set)
}

function patternsToChokidarIgnored(patterns: readonly string[]): RegExp[] {
  return [
    /(^|[/\\])\../, // dotfiles (existing behavior)
    ...patterns.map((p) => new RegExp(`(^|[/\\\\])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[/\\\\])`)),
  ]
}

export class VaultWatcher {
  private watcher: FSWatcher | null = null

  async start(
    vaultPath: string,
    onChange: FileChangeCallback,
    customIgnorePatterns: readonly string[] = []
  ): Promise<void> {
    await this.stop()

    const patterns = buildIgnorePatterns(customIgnorePatterns)
    const ignored = patternsToChokidarIgnored(patterns)

    this.watcher = watch(vaultPath, {
      ignored,
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
    })

    const handleEvent = (event: FileEvent) => (path: string) => {
      if (extname(path) === '.md') {
        onChange(path, event)
      }
    }

    this.watcher
      .on('add', handleEvent('add'))
      .on('change', handleEvent('change'))
      .on('unlink', handleEvent('unlink'))
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/services/vault-watcher.test.ts`
Expected: PASS

- [ ] **Step 5: Update watcher IPC to pass custom patterns**

In `src/main/ipc/watcher.ts`, update the `vault:watch-start` handler to read ignore patterns from vault config:

```typescript
// src/main/ipc/watcher.ts
import { ipcMain, type BrowserWindow } from 'electron'
import { VaultWatcher } from '../services/vault-watcher'
import { FileService } from '../services/file-service'
import { teConfigPath } from '../utils/paths'

const watcher = new VaultWatcher()
const fileService = new FileService()

export function registerWatcherIpc(mainWindow: BrowserWindow): void {
  ipcMain.handle('vault:watch-start', async (_e, args: { vaultPath: string }) => {
    // Read custom ignore patterns from vault config
    let customPatterns: string[] = []
    try {
      const configContent = await fileService.readFile(teConfigPath(args.vaultPath))
      const config = JSON.parse(configContent)
      customPatterns = config?.watcher?.ignorePatterns ?? []
    } catch {
      // Config doesn't exist or is malformed; use defaults only
    }

    await watcher.start(args.vaultPath, (path, event) => {
      mainWindow.webContents.send('vault:file-changed', { path, event })
    }, customPatterns)
  })

  ipcMain.handle('vault:watch-stop', async () => {
    await watcher.stop()
  })
}
```

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: 39/39 passing (35 existing + 4 new watcher tests)

- [ ] **Step 7: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/main/services/vault-watcher.ts src/main/ipc/watcher.ts tests/services/vault-watcher.test.ts
git commit -m "feat: add configurable ignore patterns to vault watcher"
```

---

## Chunk 2: Phase 1C (Custom Titlebar) + Phase 1D (Layout) + Phase 1E (Bug Fixes)

### Task 7: Register window and config IPC handlers in main process

**Files:**
- Modify: `src/main/index.ts`
- Create: `src/main/ipc/config.ts`

- [ ] **Step 1: Create config IPC handler**

```typescript
// src/main/ipc/config.ts
import { ipcMain } from 'electron'
import Store from 'electron-store'

const appStore = new Store({ name: 'thought-engine-settings' })

export function registerConfigIpc(): void {
  ipcMain.handle('config:read', async (_e, args: { scope: string; key: string }) => {
    if (args.scope === 'app') {
      return appStore.get(args.key, null)
    }
    // Vault-scoped config is handled by vault:read-config
    return null
  })

  ipcMain.handle(
    'config:write',
    async (_e, args: { scope: string; key: string; value: unknown }) => {
      if (args.scope === 'app') {
        appStore.set(args.key, args.value)
      }
    }
  )
}
```

- [ ] **Step 2: Update main/index.ts with window IPC and titlebar config**

```typescript
// src/main/index.ts
import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerFilesystemIpc } from './ipc/filesystem'
import { registerWatcherIpc } from './ipc/watcher'
import { registerShellIpc, getShellService } from './ipc/shell'
import { registerConfigIpc } from './ipc/config'

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function registerWindowIpc(): void {
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize()
  })
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('window:close', () => {
    mainWindow?.close()
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerFilesystemIpc()
  registerConfigIpc()
  registerWindowIpc()

  const window = createWindow()
  registerWatcherIpc(window)
  registerShellIpc(window)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  getShellService().killAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

- [ ] **Step 3: Run typecheck:node**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck:node`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/main/index.ts src/main/ipc/config.ts
git commit -m "feat: register window and config IPC handlers, enable custom titlebar"
```

---

### Task 8: Create PanelErrorBoundary component

**Files:**
- Create: `src/renderer/src/components/PanelErrorBoundary.tsx`
- Test: `tests/components/PanelErrorBoundary.test.tsx`

- [ ] **Step 1: Write the test**

```typescript
// tests/components/PanelErrorBoundary.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PanelErrorBoundary } from '../../src/renderer/src/components/PanelErrorBoundary'

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test explosion')
  return <div>Child content</div>
}

describe('PanelErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <PanelErrorBoundary name="Test">
        <ThrowingChild shouldThrow={false} />
      </PanelErrorBoundary>
    )
    expect(screen.getByText('Child content')).toBeDefined()
  })

  it('shows fallback on error', () => {
    // Suppress React error boundary console output
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <PanelErrorBoundary name="Graph">
        <ThrowingChild shouldThrow={true} />
      </PanelErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeDefined()
    expect(screen.getByText(/Graph/)).toBeDefined()

    spy.mockRestore()
  })

  it('retries on button click', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let shouldThrow = true

    function Toggler() {
      if (shouldThrow) throw new Error('boom')
      return <div>Recovered</div>
    }

    const { rerender } = render(
      <PanelErrorBoundary name="Test">
        <Toggler />
      </PanelErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeDefined()

    // Fix the error before retrying
    shouldThrow = false
    fireEvent.click(screen.getByText('Retry'))

    // After retry, the boundary re-renders children
    rerender(
      <PanelErrorBoundary name="Test">
        <Toggler />
      </PanelErrorBoundary>
    )

    // Verify the error boundary reset and children rendered successfully
    expect(screen.getByText('Recovered')).toBeDefined()
    expect(screen.queryByText('Something went wrong')).toBeNull()

    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/components/PanelErrorBoundary.test.tsx`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement PanelErrorBoundary**

```typescript
// src/renderer/src/components/PanelErrorBoundary.tsx
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { colors } from '../design/tokens'

interface Props {
  name: string
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  showDetails: boolean
}

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, showDetails: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.name}] Panel error:`, error, info.componentStack)
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, showDetails: false })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="h-full flex items-center justify-center p-6"
          style={{ backgroundColor: colors.bg.surface }}
        >
          <div className="text-center max-w-sm">
            <p style={{ color: colors.text.primary }} className="text-sm font-medium mb-1">
              Something went wrong
            </p>
            <p style={{ color: colors.text.muted }} className="text-xs mb-4">
              The {this.props.name} panel encountered an error.
            </p>
            <button
              onClick={this.handleRetry}
              className="text-xs px-3 py-1.5 rounded-md transition-colors"
              style={{
                backgroundColor: colors.accent.muted,
                color: colors.accent.default,
                border: `1px solid ${colors.border.default}`,
              }}
            >
              Retry
            </button>
            {this.state.error && (
              <button
                onClick={() => this.setState((s) => ({ showDetails: !s.showDetails }))}
                className="ml-2 text-xs px-3 py-1.5 rounded-md"
                style={{ color: colors.text.muted }}
              >
                {this.state.showDetails ? 'Hide details' : 'Show details'}
              </button>
            )}
            {this.state.showDetails && this.state.error && (
              <pre
                className="mt-3 text-left text-[11px] p-3 rounded overflow-auto max-h-40"
                style={{
                  backgroundColor: colors.bg.base,
                  color: colors.text.secondary,
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                {this.state.error.message}
                {'\n'}
                {this.state.error.stack}
              </pre>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/components/PanelErrorBoundary.test.tsx`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing

- [ ] **Step 6: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/components/PanelErrorBoundary.tsx tests/components/PanelErrorBoundary.test.tsx
git commit -m "feat: add PanelErrorBoundary with retry and error details"
```

---

### Task 9: Create Titlebar component

**Files:**
- Create: `src/renderer/src/components/Titlebar.tsx`

- [ ] **Step 1: Implement Titlebar**

```typescript
// src/renderer/src/components/Titlebar.tsx
import { colors } from '../design/tokens'

interface TitlebarProps {
  vaultName: string
  onOpenSettings: () => void
}

export function Titlebar({ vaultName, onOpenSettings }: TitlebarProps) {
  return (
    <div
      className="h-[38px] flex items-center px-3 select-none flex-shrink-0"
      style={{
        backgroundColor: colors.bg.surface,
        borderBottom: `1px solid ${colors.border.default}`,
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* Traffic light spacer (macOS renders these natively) */}
      <div className="w-[70px] flex-shrink-0" />

      {/* Vault tab */}
      <div
        className="flex items-center gap-2 px-3 py-1 rounded-md text-sm"
        style={{
          backgroundColor: colors.bg.elevated,
          color: colors.text.primary,
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <span
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: colors.accent.default }}
        />
        <span className="truncate max-w-[200px]">{vaultName}</span>
      </div>

      <div className="flex-1" />

      {/* Settings gear */}
      <button
        onClick={onOpenSettings}
        className="p-1.5 rounded-md transition-colors hover:bg-[#1A1A1D]"
        style={{
          color: colors.text.secondary,
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
        title="Settings"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z" />
          <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 001.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 003.06 4.377l-.16-.292c-.415-.764.421-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.115l.094-.319z" />
        </svg>
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/components/Titlebar.tsx
git commit -m "feat: add custom Titlebar with vault tab and settings gear"
```

---

### Task 10: Create SettingsModal stub

**Files:**
- Create: `src/renderer/src/components/SettingsModal.tsx`

- [ ] **Step 1: Implement stub**

```typescript
// src/renderer/src/components/SettingsModal.tsx
import { colors } from '../design/tokens'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl h-[500px] rounded-xl border overflow-hidden"
        style={{
          backgroundColor: colors.bg.surface,
          borderColor: colors.border.default,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="h-12 flex items-center justify-between px-4 border-b"
          style={{ borderColor: colors.border.default }}
        >
          <span className="text-sm font-medium" style={{ color: colors.text.primary }}>
            Settings
          </span>
          <button
            onClick={onClose}
            className="text-xs px-2 py-1 rounded"
            style={{ color: colors.text.muted }}
          >
            Close
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <p className="text-sm" style={{ color: colors.text.muted }}>
            Settings will be implemented in Phase 2.
          </p>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/components/SettingsModal.tsx
git commit -m "feat: add SettingsModal stub for Phase 2 implementation"
```

---

### Task 11: Update App.tsx with titlebar, error boundaries, and new layout

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Restructure App.tsx**

Replace the entire file to integrate Titlebar, PanelErrorBoundary, SettingsModal, and new layout (38px titlebar + flex panels + 24px status bar):

```typescript
// src/renderer/src/App.tsx
import { useState, useCallback, useMemo, useEffect } from 'react'
import { ThemeProvider } from './design/Theme'
import { SplitPane } from './design/components/SplitPane'
import { Sidebar } from './panels/sidebar/Sidebar'
import { EditorPanel } from './panels/editor/EditorPanel'
import { GraphPanel } from './panels/graph/GraphPanel'
import { GraphControls } from './panels/graph/GraphControls'
import { TerminalPanel } from './panels/terminal/TerminalPanel'
import { WelcomeScreen } from './panels/onboarding/WelcomeScreen'
import { CommandPalette, type CommandItem } from './design/components/CommandPalette'
import { Titlebar } from './components/Titlebar'
import { SettingsModal } from './components/SettingsModal'
import { PanelErrorBoundary } from './components/PanelErrorBoundary'
import { useKeyboard } from './hooks/useKeyboard'
import { useVaultStore } from './store/vault-store'
import { useEditorStore } from './store/editor-store'
import { useGraphStore } from './store/graph-store'
import { colors } from './design/tokens'

function StatusBar() {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const fileCount = useVaultStore((s) => s.files.length)
  const [gitBranch, setGitBranch] = useState<string | null>(null)
  const vaultName = vaultPath?.split('/').pop() ?? 'Thought Engine'

  useEffect(() => {
    if (!vaultPath) return
    window.api.vault
      .gitBranch(vaultPath)
      .then(setGitBranch)
      .catch(() => setGitBranch(null))
  }, [vaultPath])

  return (
    <div
      className="h-6 flex items-center px-3 text-[11px] border-t flex-shrink-0"
      style={{
        backgroundColor: colors.bg.surface,
        color: colors.text.muted,
        borderColor: colors.border.default,
      }}
    >
      <span>{vaultName}</span>
      <span className="mx-2">&middot;</span>
      <span>{fileCount} notes</span>
      {gitBranch && (
        <>
          <span className="mx-2">&middot;</span>
          <span>{gitBranch}</span>
        </>
      )}
    </div>
  )
}

function ContentArea() {
  const contentView = useGraphStore((s) => s.contentView)
  const setActiveNote = useEditorStore((s) => s.setActiveNote)
  const setContentView = useGraphStore((s) => s.setContentView)

  const handleNodeClick = useCallback(
    (id: string) => {
      setActiveNote(id, null)
      setContentView('editor')
    },
    [setActiveNote, setContentView]
  )

  const handleNavigate = useCallback(
    (id: string) => {
      setActiveNote(id, null)
    },
    [setActiveNote]
  )

  return (
    <div className="h-full relative">
      <GraphControls />
      {contentView === 'graph' ? (
        <GraphPanel onNodeClick={handleNodeClick} />
      ) : (
        <EditorPanel onNavigate={handleNavigate} />
      )}
    </div>
  )
}

function ConnectedSidebar() {
  const files = useVaultStore((s) => s.files)
  const config = useVaultStore((s) => s.config)
  const activeWorkspace = useVaultStore((s) => s.activeWorkspace)
  const setActiveWorkspace = useVaultStore((s) => s.setActiveWorkspace)
  const setActiveNote = useEditorStore((s) => s.setActiveNote)
  const activeNotePath = useEditorStore((s) => s.activeNotePath)

  const handleFileSelect = useCallback(
    (path: string) => {
      const file = files.find((f) => f.path === path)
      if (file) {
        setActiveNote(file.path, file.path)
      }
    },
    [files, setActiveNote]
  )

  const handleSearch = useCallback((_query: string) => {
    // TODO: wire to vault index search
  }, [])

  const handleToggleDirectory = useCallback((_path: string) => {
    // TODO: directory collapse state
  }, [])

  const treeItems = files.map((f) => ({
    path: f.path,
    filename: f.filename,
    title: f.title,
    modified: f.modified,
    isDirectory: false as const,
    depth: 0
  }))

  return (
    <Sidebar
      items={treeItems}
      workspaces={config?.workspaces ?? []}
      activeWorkspace={activeWorkspace}
      activeFilePath={activeNotePath}
      onSearch={handleSearch}
      onWorkspaceSelect={setActiveWorkspace}
      onFileSelect={handleFileSelect}
      onToggleDirectory={handleToggleDirectory}
    />
  )
}

const BUILT_IN_COMMANDS: CommandItem[] = [
  { id: 'cmd:new-note', label: 'New Note', category: 'command', shortcut: '\u2318N' },
  { id: 'cmd:toggle-view', label: 'Toggle Graph/Editor', category: 'command', shortcut: '\u2318G' },
  { id: 'cmd:toggle-sidebar', label: 'Toggle Sidebar', category: 'command', shortcut: '\u2318B' },
  { id: 'cmd:toggle-terminal', label: 'Toggle Terminal', category: 'command', shortcut: '\u2318`' },
  {
    id: 'cmd:toggle-mode',
    label: 'Toggle Source/Rich Mode',
    category: 'command',
    shortcut: '\u2318/'
  }
]

function WorkspaceShell() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const files = useVaultStore((s) => s.files)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const setActiveNote = useEditorStore((s) => s.setActiveNote)
  const contentView = useGraphStore((s) => s.contentView)
  const setContentView = useGraphStore((s) => s.setContentView)
  const mode = useEditorStore((s) => s.mode)
  const setMode = useEditorStore((s) => s.setMode)

  const vaultName = vaultPath?.split('/').pop() ?? 'Thought Engine'

  const toggleView = useCallback(() => {
    setContentView(contentView === 'editor' ? 'graph' : 'editor')
  }, [contentView, setContentView])

  const toggleSourceMode = useCallback(() => {
    setMode(mode === 'rich' ? 'source' : 'rich')
  }, [mode, setMode])

  useKeyboard({
    onCommandPalette: () => setPaletteOpen(true),
    onToggleView: toggleView,
    onToggleSourceMode: toggleSourceMode,
    onEscape: () => setPaletteOpen(false)
  })

  const paletteItems = useMemo<CommandItem[]>(() => {
    const noteItems: CommandItem[] = files.map((f) => ({
      id: `note:${f.path}`,
      label: f.title,
      category: 'note'
    }))
    return [...noteItems, ...BUILT_IN_COMMANDS]
  }, [files])

  const handlePaletteSelect = useCallback(
    (item: CommandItem) => {
      if (item.id.startsWith('note:')) {
        const path = item.id.slice(5)
        setActiveNote(path, path)
        setContentView('editor')
      } else if (item.id === 'cmd:toggle-view') {
        toggleView()
      } else if (item.id === 'cmd:toggle-mode') {
        toggleSourceMode()
      }
    },
    [setActiveNote, setContentView, toggleView, toggleSourceMode]
  )

  return (
    <div
      className="h-screen w-screen flex flex-col"
      style={{ backgroundColor: colors.bg.base, color: colors.text.primary }}
    >
      <Titlebar vaultName={vaultName} onOpenSettings={() => setSettingsOpen(true)} />
      <div className="flex-1 overflow-hidden">
        <SplitPane
          left={
            <PanelErrorBoundary name="Sidebar">
              <ConnectedSidebar />
            </PanelErrorBoundary>
          }
          right={
            <SplitPane
              left={
                <PanelErrorBoundary name="Content">
                  <ContentArea />
                </PanelErrorBoundary>
              }
              right={
                <PanelErrorBoundary name="Terminal">
                  <TerminalPanel />
                </PanelErrorBoundary>
              }
              initialLeftWidth={580}
              minLeftWidth={300}
              minRightWidth={400}
            />
          }
          initialLeftWidth={240}
          minLeftWidth={0}
          minRightWidth={500}
        />
      </div>
      <StatusBar />
      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
        onSelect={handlePaletteSelect}
      />
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

export default function App() {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const loadVault = useVaultStore((s) => s.loadVault)

  const handleVaultSelected = useCallback(
    (path: string) => {
      loadVault(path)
    },
    [loadVault]
  )

  return (
    <ThemeProvider>
      {vaultPath ? <WorkspaceShell /> : <WelcomeScreen onVaultSelected={handleVaultSelected} />}
    </ThemeProvider>
  )
}
```

Key changes:
- Uses narrow Zustand selectors (`useVaultStore(s => s.files)` instead of `useVaultStore()`)
- Wraps panels in `PanelErrorBoundary`
- Adds `Titlebar` and `SettingsModal`
- Terminal min width increased to 400px per spec
- Sidebar default width 240px per spec

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing

- [ ] **Step 4: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/App.tsx
git commit -m "feat: integrate titlebar, error boundaries, and new layout skeleton"
```

---

### Task 12: Fix RichEditor markdown serialization (Bug #1)

**Files:**
- Modify: `src/renderer/src/panels/editor/RichEditor.tsx`

- [ ] **Step 1: Install tiptap-markdown**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm install --cache /tmp/npm-cache-te tiptap-markdown`

- [ ] **Step 2: Fix the serialization**

Replace `src/renderer/src/panels/editor/RichEditor.tsx`:

```typescript
// src/renderer/src/panels/editor/RichEditor.tsx
import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect } from 'react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { colors } from '../../design/tokens'

interface RichEditorProps {
  content: string
  onChange: (markdown: string) => void
}

export function RichEditor({ content, onChange }: RichEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({
        html: false,
        transformCopiedText: true,
        transformPastedText: true,
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.storage.markdown.getMarkdown())
    },
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-full px-8 py-6',
        style: `color: ${colors.text.primary}; font-family: Inter, system-ui, sans-serif;`
      }
    }
  })

  useEffect(() => {
    if (editor && content !== editor.storage.markdown.getMarkdown()) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  return (
    <div className="h-full overflow-y-auto" style={{ backgroundColor: colors.bg.base }}>
      <EditorContent editor={editor} />
    </div>
  )
}
```

Key fix: `editor.getText()` (which strips formatting) is replaced with `editor.storage.markdown.getMarkdown()` from the tiptap-markdown extension.

- [ ] **Step 3: Run typecheck and tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/editor/RichEditor.tsx package.json package-lock.json
git commit -m "fix: use tiptap-markdown serializer instead of getText() in RichEditor"
```

---

### Task 13: Fix SourceEditor stale closure (Bug #2)

**Files:**
- Modify: `src/renderer/src/panels/editor/SourceEditor.tsx`

- [ ] **Step 1: Fix the stale closure**

The issue: `useEffect([], ...)` captures the initial `onChange` in a closure. If `onChange` identity changes, the editor calls the stale version.

Fix: store `onChange` in a `useRef` and read from it in the listener:

```typescript
// src/renderer/src/panels/editor/SourceEditor.tsx
import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { colors } from '../../design/tokens'

interface SourceEditorProps {
  content: string
  onChange: (content: string) => void
}

export function SourceEditor({ content, onChange }: SourceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)

  // Keep the ref up to date with the latest onChange
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        history(),
        markdown(),
        oneDark,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '14px' },
          '.cm-scroller': { fontFamily: '"JetBrains Mono", monospace' },
          '.cm-content': { padding: '16px 0' }
        })
      ]
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const currentContent = view.state.doc.toString()
    if (currentContent !== content) {
      view.dispatch({
        changes: { from: 0, to: currentContent.length, insert: content }
      })
    }
  }, [content])

  return (
    <div
      ref={containerRef}
      className="h-full overflow-hidden"
      style={{ backgroundColor: colors.bg.base }}
    />
  )
}
```

Key fix: `onChangeRef` is always current. The listener reads from the ref instead of the closed-over prop.

- [ ] **Step 2: Run typecheck and tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/editor/SourceEditor.tsx
git commit -m "fix: use ref for onChange in SourceEditor to prevent stale closure"
```

---

### Task 14: Fix SplitPane handler leak (Bug #3)

**Files:**
- Modify: `src/renderer/src/design/components/SplitPane.tsx`

- [ ] **Step 1: Fix the mouse handler leak**

The current code adds `mousemove`/`mouseup` listeners inside `handleMouseDown` but if the component unmounts mid-drag, they leak. Fix: track handlers in refs and clean up in useEffect return.

```typescript
// src/renderer/src/design/components/SplitPane.tsx
import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react'

interface SplitPaneProps {
  left: ReactNode
  right: ReactNode
  initialLeftWidth: number
  minLeftWidth: number
  minRightWidth: number
  onResize?: (leftWidth: number) => void
}

export function SplitPane({
  left,
  right,
  initialLeftWidth,
  minLeftWidth,
  minRightWidth,
  onResize
}: SplitPaneProps) {
  const [leftWidth, setLeftWidth] = useState(initialLeftWidth)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const handlersRef = useRef<{
    move: ((e: MouseEvent) => void) | null
    up: (() => void) | null
  }>({ move: null, up: null })

  // Clamp initial width once the container has measured
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const totalWidth = el.clientWidth
    const dividerWidth = 4
    const maxLeft = totalWidth - dividerWidth - minRightWidth
    if (leftWidth > maxLeft) {
      const clamped = Math.max(minLeftWidth, maxLeft)
      setLeftWidth(clamped)
      onResize?.(clamped)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup leaked handlers on unmount
  useEffect(() => {
    return () => {
      if (handlersRef.current.move) {
        document.removeEventListener('mousemove', handlersRef.current.move)
      }
      if (handlersRef.current.up) {
        document.removeEventListener('mouseup', handlersRef.current.up)
      }
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const handleMouseDown = useCallback(() => {
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const newLeft = Math.max(
        minLeftWidth,
        Math.min(e.clientX - rect.left, rect.width - minRightWidth)
      )
      setLeftWidth(newLeft)
      onResize?.(newLeft)
    }

    const handleMouseUp = () => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      handlersRef.current = { move: null, up: null }
    }

    handlersRef.current = { move: handleMouseMove, up: handleMouseUp }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [minLeftWidth, minRightWidth, onResize])

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden">
      <div style={{ width: leftWidth, flexShrink: 0 }} className="overflow-hidden">
        {left}
      </div>
      <div
        onMouseDown={handleMouseDown}
        className="w-[4px] cursor-col-resize bg-transparent hover:bg-[#6C63FF]/30 transition-colors flex-shrink-0"
      />
      <div className="flex-1 overflow-hidden">{right}</div>
    </div>
  )
}
```

Key fix: `handlersRef` tracks active listeners. The cleanup `useEffect` removes them on unmount.

- [ ] **Step 2: Run tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing (SplitPane.test.tsx should still pass)

- [ ] **Step 3: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/design/components/SplitPane.tsx
git commit -m "fix: clean up SplitPane mouse handlers on unmount to prevent leak"
```

---

### Task 15: Fix terminal tab close PTY kill (Bug #4)

**Files:**
- Modify: `src/renderer/src/panels/terminal/TerminalPanel.tsx`

- [ ] **Step 1: Add PTY kill and xterm dispose on tab close**

Add a `handleCloseTab` function that kills the PTY and disposes the terminal before removing the session from the store:

```typescript
  const handleCloseTab = useCallback(
    (sessionId: string) => {
      // Don't close the last tab
      if (sessions.length <= 1) return

      // Kill PTY process
      window.api.terminal.kill(sessionId)

      // Dispose xterm instance
      const instance = instancesRef.current.get(sessionId)
      if (instance) {
        instance.terminal.dispose()
        instancesRef.current.delete(sessionId)
      }

      // Remove from store
      removeSession(sessionId)
    },
    [sessions.length, removeSession]
  )
```

Pass this to `TerminalTabs`:
```typescript
<TerminalTabs onNewTab={handleNewTab} onCloseTab={handleCloseTab} />
```

Note: this requires updating `TerminalTabs` to accept and call `onCloseTab`. Check if `TerminalTabs` already has a close button. If not, this will be handled in Phase 2C (Task 28). For now, just add `handleCloseTab` to `TerminalPanel` and wire it if `TerminalTabs` supports it.

- [ ] **Step 2: Run typecheck and tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/terminal/TerminalPanel.tsx
git commit -m "fix: add PTY cleanup on terminal tab close (partial, full wiring depends on TerminalTabs close button)"
```

---

## Chunk 3: Phase 1F (Web Worker Migration) + Phase 1G (Vault Loading) + Phase 1H (Command Palette)

### Task 16: Extend VaultState with session persistence fields

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/services/file-service.ts`

- [ ] **Step 1: Extend VaultState**

Add session persistence fields per spec. In `src/shared/types.ts`, replace the existing VaultState interface:

```typescript
export interface VaultState {
  version: number
  idCounters: Record<string, number>
  lastOpenNote: string | null
  panelLayout: { sidebarWidth: number; terminalWidth: number }
  contentView: 'graph' | 'editor' | 'skills'
  graphViewport: { x: number; y: number; k: number }
  terminalSessions: string[]
  fileTreeCollapseState: Record<string, boolean>
  selectedNodeId: string | null
}
```

- [ ] **Step 2: Update default state and add migration in file-service.ts**

In `src/main/services/file-service.ts`, update the `defaultState` and add version migration when reading state. Existing `state.json` files won't have the `version` field, so default it to `1` when missing:

```typescript
    const defaultState: VaultState = {
      version: 1,
      idCounters: {},
      lastOpenNote: null,
      panelLayout: { sidebarWidth: 240, terminalWidth: 400 },
      contentView: 'graph',
      graphViewport: { x: 0, y: 0, k: 1 },
      terminalSessions: [],
      fileTreeCollapseState: {},
      selectedNodeId: null,
    }
```

In the `vault:read-state` handler, after reading the JSON, merge with defaults so missing fields get safe values:

```typescript
    ipcMain.handle('vault:read-state', async (_event, { vaultPath }: { vaultPath: string }) => {
      const statePath = path.join(vaultPath, '.thought-engine', 'state.json')
      try {
        const raw = await fs.readFile(statePath, 'utf-8')
        const parsed = JSON.parse(raw)
        // Migrate: fill missing fields from defaultState (e.g., version from pre-v1 files)
        return { ...defaultState, ...parsed, version: parsed.version ?? 1 }
      } catch {
        return { ...defaultState }
      }
    })
```

- [ ] **Step 3: Run typecheck and fix any VaultState consumers**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: May show errors where code creates VaultState without new fields. Fix each by adding defaults.

- [ ] **Step 4: Run tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/shared/types.ts src/main/services/file-service.ts
git commit -m "feat: extend VaultState with session persistence fields"
```

---

### Task 17: Create vault Web Worker

**Files:**
- Create: `src/renderer/src/engine/vault-worker.ts`
- Create: `src/renderer/src/engine/vault-worker-helpers.ts`
- Create: `src/renderer/src/engine/__tests__/vault-worker.test.ts`

- [ ] **Step 1: Write tests for Worker helper functions (TDD)**

Create `src/renderer/src/engine/__tests__/vault-worker.test.ts`. We test the pure helper functions (`addFile`, `removeFile`, `clearErrorsForPath`) by extracting them. Since the Worker script runs in a Worker context, we test the logic functions directly:

```typescript
// src/renderer/src/engine/__tests__/vault-worker.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// We test the worker logic by importing the helper functions.
// The worker script exports its helpers for testing via a conditional check.
import { createWorkerHelpers } from '../vault-worker-helpers'

// Mock parser and graph-builder
vi.mock('../parser', () => ({
  parseArtifact: vi.fn((content: string, path: string) => {
    if (content === 'INVALID') return { ok: false, error: `Parse error in ${path}` }
    return { ok: true, value: { id: `id-${path}`, title: path, modified: '2026-01-01' } }
  }),
}))

vi.mock('../graph-builder', () => ({
  buildGraph: vi.fn((artifacts: any[]) => ({ nodes: artifacts.map((a: any) => ({ id: a.id })), edges: [] })),
}))

describe('vault-worker helpers', () => {
  let helpers: ReturnType<typeof createWorkerHelpers>

  beforeEach(() => {
    helpers = createWorkerHelpers()
  })

  it('addFile stores artifact on successful parse', () => {
    helpers.addFile('test.md', '# Hello')
    const result = helpers.buildResult()
    expect(result.artifacts.length).toBe(1)
    expect(result.errors.length).toBe(0)
  })

  it('addFile records error on failed parse', () => {
    helpers.addFile('bad.md', 'INVALID')
    const result = helpers.buildResult()
    expect(result.artifacts.length).toBe(0)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0].filename).toBe('bad.md')
  })

  it('addFile clears stale errors for the same path before re-parsing', () => {
    helpers.addFile('fix.md', 'INVALID')
    expect(helpers.buildResult().errors.length).toBe(1)
    // Now the file is fixed
    helpers.addFile('fix.md', '# Fixed')
    const result = helpers.buildResult()
    expect(result.errors.length).toBe(0)
    expect(result.artifacts.length).toBe(1)
  })

  it('removeFile clears both artifact and errors for a path', () => {
    helpers.addFile('a.md', 'INVALID')
    helpers.removeFile('a.md')
    const result = helpers.buildResult()
    expect(result.artifacts.length).toBe(0)
    expect(result.errors.length).toBe(0)
  })

  it('update scenario: removeFile then addFile replaces artifact', () => {
    helpers.addFile('note.md', '# V1')
    helpers.removeFile('note.md')
    helpers.addFile('note.md', '# V2')
    const result = helpers.buildResult()
    expect(result.artifacts.length).toBe(1)
  })
})
```

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test -- --run src/renderer/src/engine/__tests__/vault-worker.test.ts`
Expected: Fails (module not found).

- [ ] **Step 2: Extract testable helpers into vault-worker-helpers.ts**

Create `src/renderer/src/engine/vault-worker-helpers.ts` with the pure logic extracted so both the Worker script and tests can use it:

```typescript
// src/renderer/src/engine/vault-worker-helpers.ts
import { parseArtifact } from './parser'
import { buildGraph } from './graph-builder'
import type { Artifact, KnowledgeGraph } from '@shared/types'

interface ParseError {
  filename: string
  error: string
}

export function createWorkerHelpers() {
  const artifacts = new Map<string, Artifact>()
  const fileToId = new Map<string, string>()
  const errors: ParseError[] = []

  function clearErrorsForPath(path: string): void {
    for (let i = errors.length - 1; i >= 0; i--) {
      if (errors[i].filename === path) errors.splice(i, 1)
    }
  }

  function addFile(path: string, content: string): void {
    clearErrorsForPath(path)
    const result = parseArtifact(content, path)
    if (result.ok) {
      artifacts.set(result.value.id, result.value)
      fileToId.set(path, result.value.id)
    } else {
      errors.push({ filename: path, error: result.error })
    }
  }

  function removeFile(path: string): void {
    clearErrorsForPath(path)
    const id = fileToId.get(path)
    if (id) {
      artifacts.delete(id)
      fileToId.delete(path)
    }
  }

  function buildResult() {
    const arts = Array.from(artifacts.values())
    const graph = buildGraph(arts)
    const fToId: Record<string, string> = {}
    for (const [k, v] of fileToId) fToId[k] = v
    return { artifacts: arts, graph, errors: [...errors], fileToId: fToId }
  }

  function clearAll(): void {
    artifacts.clear()
    fileToId.clear()
    errors.length = 0
  }

  return { addFile, removeFile, buildResult, clearAll }
}
```

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test -- --run src/renderer/src/engine/__tests__/vault-worker.test.ts`
Expected: All passing.

- [ ] **Step 3: Write the Worker script**

The Worker receives file content, delegates to helpers, posts results. Uses the extracted helper module.

```typescript
// src/renderer/src/engine/vault-worker.ts
import { createWorkerHelpers } from './vault-worker-helpers'

type WorkerInMessage =
  | { type: 'load'; files: Array<{ path: string; content: string }> }
  | { type: 'update'; path: string; content: string }
  | { type: 'remove'; path: string }

const { addFile, removeFile, buildResult, clearAll } = createWorkerHelpers()

function postResult(msgType: 'loaded' | 'updated') {
  self.postMessage({ type: msgType, ...buildResult() })
}

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data
  switch (msg.type) {
    case 'load':
      clearAll()
      for (const file of msg.files) addFile(file.path, file.content)
      postResult('loaded')
      break
    case 'update':
      removeFile(msg.path)
      addFile(msg.path, msg.content)
      postResult('updated')
      break
    case 'remove':
      removeFile(msg.path)
      postResult('updated')
      break
  }
}
```

- [ ] **Step 4: Run all tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/engine/vault-worker.ts src/renderer/src/engine/vault-worker-helpers.ts src/renderer/src/engine/__tests__/vault-worker.test.ts
git commit -m "feat: add vault Web Worker for off-thread parsing and graph building"
```

---

### Task 18: Create useVaultWorker hook

**Files:**
- Create: `src/renderer/src/engine/useVaultWorker.ts`

- [ ] **Step 1: Implement the hook**

```typescript
// src/renderer/src/engine/useVaultWorker.ts
import { useRef, useCallback, useEffect } from 'react'
import type { Artifact, KnowledgeGraph } from '@shared/types'

interface ParseError { filename: string; error: string }

interface WorkerResult {
  artifacts: Artifact[]
  graph: KnowledgeGraph
  errors: ParseError[]
  fileToId: Record<string, string>
}

export function useVaultWorker(onResult: (result: WorkerResult) => void) {
  const workerRef = useRef<Worker | null>(null)
  const onResultRef = useRef(onResult)

  useEffect(() => { onResultRef.current = onResult }, [onResult])

  useEffect(() => {
    const worker = new Worker(
      new URL('./vault-worker.ts', import.meta.url),
      { type: 'module' }
    )
    worker.onmessage = (e: MessageEvent) => onResultRef.current(e.data)
    worker.onerror = (err) => console.error('[VaultWorker] Error:', err)
    workerRef.current = worker
    return () => { worker.terminate(); workerRef.current = null }
  }, [])

  const loadFiles = useCallback((files: Array<{ path: string; content: string }>) => {
    workerRef.current?.postMessage({ type: 'load', files })
  }, [])

  const updateFile = useCallback((path: string, content: string) => {
    workerRef.current?.postMessage({ type: 'update', path, content })
  }, [])

  const removeFile = useCallback((path: string) => {
    workerRef.current?.postMessage({ type: 'remove', path })
  }, [])

  return { loadFiles, updateFile, removeFile }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/engine/useVaultWorker.ts
git commit -m "feat: add useVaultWorker hook for Worker lifecycle management"
```

---

### Task 19: Refactor vault-store to use Worker data (plain state)

**Files:**
- Modify: `src/renderer/src/store/vault-store.ts`
- Modify: `src/renderer/src/panels/editor/EditorPanel.tsx`
- Modify: `src/renderer/src/panels/graph/GraphPanel.tsx`

- [ ] **Step 1: Replace VaultIndex with plain state fields**

Replace the entire vault-store. Remove `VaultIndex` import, `index` field, `getGraph()`, `getArtifact()`, `search()`. Add `artifacts`, `graph`, `parseErrors`, `fileToId` as plain state. Add `setWorkerResult()` action.

```typescript
// src/renderer/src/store/vault-store.ts
import { create } from 'zustand'
import type { Artifact, VaultConfig, VaultState, KnowledgeGraph } from '@shared/types'

interface ParseError { filename: string; error: string }

interface VaultFile {
  path: string; filename: string; title: string; modified: string
}

interface VaultStore {
  vaultPath: string | null
  config: VaultConfig | null
  state: VaultState | null
  files: VaultFile[]
  artifacts: Artifact[]
  graph: KnowledgeGraph
  parseErrors: ParseError[]
  fileToId: Record<string, string>
  activeWorkspace: string | null
  isLoading: boolean

  setVaultPath: (path: string) => void
  setConfig: (config: VaultConfig) => void
  setState: (state: VaultState) => void
  setFiles: (files: VaultFile[]) => void
  setActiveWorkspace: (workspace: string | null) => void
  setWorkerResult: (result: { artifacts: Artifact[]; graph: KnowledgeGraph; errors: ParseError[]; fileToId: Record<string, string> }) => void
  loadVault: (vaultPath: string) => Promise<void>
}

const EMPTY_GRAPH: KnowledgeGraph = { nodes: [], edges: [] }

export const useVaultStore = create<VaultStore>((set) => ({
  vaultPath: null, config: null, state: null, files: [],
  artifacts: [], graph: EMPTY_GRAPH, parseErrors: [], fileToId: {},
  activeWorkspace: null, isLoading: false,

  setVaultPath: (path) => set({ vaultPath: path }),
  setConfig: (config) => set({ config }),
  setState: (state) => set({ state }),
  setFiles: (files) => set({ files }),
  setActiveWorkspace: (workspace) => set({ activeWorkspace: workspace }),

  setWorkerResult: (result) => set({
    artifacts: result.artifacts,
    graph: result.graph,
    parseErrors: result.errors,
    fileToId: result.fileToId,
  }),

  loadVault: async (vaultPath: string) => {
    set({ isLoading: true, vaultPath })
    try {
      const config = await window.api.vault.readConfig(vaultPath)
      const state = await window.api.vault.readState(vaultPath)
      const filePaths = await window.api.fs.listFilesRecursive(vaultPath)

      const files: VaultFile[] = filePaths.map((filePath) => {
        const filename = filePath.split('/').pop() ?? filePath
        return { path: filePath, filename, title: filename.replace(/\.md$/, ''), modified: new Date().toISOString().split('T')[0] }
      })

      set({ config, state, files, isLoading: false })
    } catch (err) {
      console.error('Failed to load vault:', err)
      set({ isLoading: false })
    }
  },
}))
```

- [ ] **Step 2: Migrate EditorPanel from getArtifact() to store selector**

`EditorPanel.tsx` actively calls `getArtifact()` which no longer exists. Replace with a store selector.

In `src/renderer/src/panels/editor/EditorPanel.tsx`, replace:

```typescript
const { getArtifact } = useVaultStore()

const artifact = activeNoteId ? getArtifact(activeNoteId) : null
```

with:

```typescript
const artifact = useVaultStore((s) =>
  activeNoteId ? s.artifacts.find((a) => a.id === activeNoteId) : null
)
```

Remove the `getArtifact` destructure entirely. The selector subscribes only when `activeNoteId` or the artifacts array changes.

- [ ] **Step 3: Update GraphPanel to use store selector**

In `src/renderer/src/panels/graph/GraphPanel.tsx`:
- Replace `const { getGraph } = useVaultStore()` with `const graph = useVaultStore((s) => s.graph)`
- Replace all `getGraph()` calls with `graph`
- Remove the `const graph = getGraph()` at line 139

- [ ] **Step 4: Run typecheck and fix remaining consumers**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`

Grep for any remaining `getArtifact`, `getGraph`, or `search` calls that reference the old vault-store API and migrate them to selectors. Common pattern: replace `useVaultStore().getArtifact(id)` with `useVaultStore((s) => s.artifacts.find((a) => a.id === id))`.

- [ ] **Step 5: Run tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing

- [ ] **Step 6: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/store/vault-store.ts src/renderer/src/panels/graph/GraphPanel.tsx src/renderer/src/panels/editor/EditorPanel.tsx
git commit -m "refactor: replace VaultIndex class in store with plain state fields from Worker"
```

---

### Task 20: Implement vault loading orchestration

> **Dependencies:** Task 16 (extend `types.ts` with session persistence fields) and Task 19 (replace VaultIndex with plain state) must be complete before this task. Task 16 adds the `ViewportState`, `TerminalScrollPositions`, and `FileTreeCollapseState` fields to `VaultState` in `src/shared/types.ts` that the orchestration logic reads/writes. Task 19 restructures the vault-store to use plain data instead of VaultIndex, which this task's Worker integration depends on.

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add Worker integration, loading skeleton, and orchestration to App component**

In the `App` component, add:
- Import `useVaultWorker` from `./engine/useVaultWorker`
- Import `useGraphStore` and `useEditorStore` for session state hydration
- Add a `LoadingSkeleton` component for the loading state
- Create a `useCallback` for `onWorkerResult` that calls `setWorkerResult` and updates file titles
- Create `orchestrateLoad` that follows the spec startup sequence:
  1. `vault:init` (ensure `.thought-engine/` dir exists)
  2. `loadVault` (read config, state, file list)
  3. Hydrate session state into graph-store and editor-store (contentView, selectedNodeId, lastOpenNote)
  4. Save vault path to app settings
  5. Start file watcher
  6. Read file contents and post to Worker
- Add startup `useEffect` that checks for saved vault path
- Add file change listener `useEffect` that forwards watcher events to Worker
- Render `LoadingSkeleton` while loading, `WelcomeScreen` when no vault, `WorkspaceShell` when loaded

```typescript
// Add to imports in App.tsx:
import { useVaultWorker } from './engine/useVaultWorker'
import { useGraphStore } from './store/graph-store'
import { useEditorStore } from './store/editor-store'

function LoadingSkeleton() {
  return (
    <div className="h-screen w-screen flex items-center justify-center" style={{ backgroundColor: colors.bg.base }}>
      <div className="text-center" style={{ color: colors.text.muted }}>
        <div className="w-8 h-8 border-2 border-current border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm">Loading vault...</p>
      </div>
    </div>
  )
}

// Replace the App component export:
export default function App() {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const isLoading = useVaultStore((s) => s.isLoading)
  const loadVault = useVaultStore((s) => s.loadVault)
  const setWorkerResult = useVaultStore((s) => s.setWorkerResult)
  const setFiles = useVaultStore((s) => s.setFiles)

  const onWorkerResult = useCallback((result: { artifacts: any[]; graph: any; errors: any[]; fileToId: Record<string, string> }) => {
    setWorkerResult(result)
    const files = useVaultStore.getState().files
    const updatedFiles = files.map((f) => {
      const id = result.fileToId[f.path]
      const artifact = id ? result.artifacts.find((a: any) => a.id === id) : undefined
      return artifact ? { ...f, title: artifact.title, modified: artifact.modified } : f
    })
    setFiles(updatedFiles)
  }, [setWorkerResult, setFiles])

  const { loadFiles, updateFile, removeFile } = useVaultWorker(onWorkerResult)

  const orchestrateLoad = useCallback(async (path: string) => {
    // Step a: ensure .thought-engine/ directory exists (spec requirement)
    await window.api.vault.init(path)
    // Step b: load vault metadata (config, state, file list)
    await loadVault(path)
    // Step c: hydrate session state into appropriate stores
    const state = useVaultStore.getState().state
    if (state) {
      if (state.contentView) useGraphStore.getState().setContentView(state.contentView)
      if (state.selectedNodeId) useGraphStore.getState().setSelectedNode(state.selectedNodeId)
      if (state.lastOpenNote) useEditorStore.getState().setActiveNote(state.lastOpenNote, state.lastOpenNote)
    }
    // Step d: save path to app settings for next launch
    window.api.config.write('app', 'lastVaultPath', path)
    // Step e: start file watcher
    await window.api.vault.watchStart(path)
    // Step f: read file contents and post to Worker for parsing
    const filePaths = useVaultStore.getState().files.map((f) => f.path)
    const filesWithContent = await Promise.all(
      filePaths.map(async (p) => ({ path: p, content: await window.api.fs.readFile(p) }))
    )
    loadFiles(filesWithContent)
  }, [loadVault, loadFiles])

  useEffect(() => {
    window.api.config.read('app', 'lastVaultPath').then((savedPath) => {
      if (typeof savedPath === 'string' && savedPath) orchestrateLoad(savedPath)
    }).catch(() => {})
  }, [orchestrateLoad])

  useEffect(() => {
    const unsub = window.api.on.fileChanged(async (data) => {
      if (data.event === 'unlink') { removeFile(data.path) }
      else {
        const content = await window.api.fs.readFile(data.path)
        updateFile(data.path, content)
      }
    })
    return unsub
  }, [updateFile, removeFile])

  return (
    <ThemeProvider>
      {isLoading ? <LoadingSkeleton /> : vaultPath ? <WorkspaceShell /> : <WelcomeScreen onVaultSelected={orchestrateLoad} />}
    </ThemeProvider>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`

- [ ] **Step 3: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/App.tsx
git commit -m "feat: implement vault loading orchestration with Worker and watcher integration"
```

---

### Task 21: Enhance CommandPalette with fuzzy search and command prefix

**Files:**
- Modify: `src/renderer/src/design/components/CommandPalette.tsx`
- Create: `src/renderer/src/design/components/__tests__/CommandPalette.test.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/shared/types.ts`
- Modify: `src/main/services/file-service.ts`

- [ ] **Step 1: Write tests for fuzzyMatch and filterItems (TDD)**

Create `src/renderer/src/design/components/__tests__/CommandPalette.test.ts`:

```typescript
// src/renderer/src/design/components/__tests__/CommandPalette.test.ts
import { describe, it, expect } from 'vitest'
import { fuzzyMatch, filterItems, type CommandItem } from '../CommandPalette'

describe('fuzzyMatch', () => {
  it('returns exact prefix match with highest score', () => {
    const result = fuzzyMatch('GraphPanel', 'graph')
    expect(result.match).toBe(true)
    expect(result.score).toBe(100)
  })

  it('returns substring match with medium score', () => {
    const result = fuzzyMatch('MyGraphPanel', 'graph')
    expect(result.match).toBe(true)
    expect(result.score).toBe(50)
  })

  it('returns fuzzy character match with low score and matched indices', () => {
    const result = fuzzyMatch('GraphPanel', 'gpl')
    expect(result.match).toBe(true)
    expect(result.score).toBe(10)
    expect(result.indices).toEqual([0, 5, 6])
  })

  it('returns no match when characters are missing', () => {
    const result = fuzzyMatch('GraphPanel', 'xyz')
    expect(result.match).toBe(false)
    expect(result.score).toBe(0)
  })

  it('is case-insensitive', () => {
    const result = fuzzyMatch('GraphPanel', 'GRAPH')
    expect(result.match).toBe(true)
  })
})

describe('filterItems', () => {
  const items: CommandItem[] = [
    { id: 'note:a', label: 'Architecture Notes', category: 'note' },
    { id: 'note:b', label: 'Bug Tracker', category: 'note' },
    { id: 'cmd:toggle', label: 'Toggle Sidebar', category: 'command' },
    { id: 'cmd:settings', label: 'Open Settings', category: 'command' },
  ]

  it('returns all items for empty query', () => {
    expect(filterItems(items, '')).toEqual(items)
  })

  it('filters by fuzzy match on label', () => {
    const result = filterItems(items, 'arch')
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('note:a')
  })

  it('> prefix filters to commands only', () => {
    const result = filterItems(items, '>')
    expect(result.every((item) => item.category === 'command')).toBe(true)
  })

  it('> prefix with query filters commands by fuzzy match', () => {
    const result = filterItems(items, '>toggle')
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('cmd:toggle')
  })

  it('/ prefix filters to commands only (future slash-command routing)', () => {
    const result = filterItems(items, '/')
    expect(result.every((item) => item.category === 'command')).toBe(true)
  })
})
```

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test -- --run src/renderer/src/design/components/__tests__/CommandPalette.test.ts`
Expected: Fails (fuzzyMatch and filterItems not exported, indices not returned).

- [ ] **Step 2: Add fuzzy matching with match indices and prefix routing**

Replace the `filterItems` function in CommandPalette.tsx. Export `fuzzyMatch` and `filterItems` for testing. Add match index tracking for highlighted characters:

```typescript
export function fuzzyMatch(
  text: string,
  query: string
): { match: boolean; score: number; indices: number[] } {
  const lower = text.toLowerCase()
  const queryLower = query.toLowerCase()

  // Exact prefix match (highest score)
  if (lower.startsWith(queryLower)) {
    return { match: true, score: 100, indices: Array.from({ length: queryLower.length }, (_, i) => i) }
  }

  // Substring match (medium score)
  const substringIdx = lower.indexOf(queryLower)
  if (substringIdx !== -1) {
    return {
      match: true,
      score: 50,
      indices: Array.from({ length: queryLower.length }, (_, i) => substringIdx + i),
    }
  }

  // Fuzzy character match (low score)
  const indices: number[] = []
  let qi = 0
  for (let i = 0; i < lower.length && qi < queryLower.length; i++) {
    if (lower[i] === queryLower[qi]) {
      indices.push(i)
      qi++
    }
  }
  return qi === queryLower.length
    ? { match: true, score: 10, indices }
    : { match: false, score: 0, indices: [] }
}

export function filterItems(
  items: ReadonlyArray<CommandItem>,
  query: string
): ReadonlyArray<CommandItem & { matchIndices?: number[] }> {
  if (query === '') return items

  // Prefix routing: > for commands, / for slash-commands (future)
  const isCommandMode = query.startsWith('>') || query.startsWith('/')
  const searchQuery = isCommandMode ? query.slice(1).trim() : query
  const candidates = isCommandMode
    ? items.filter((item) => item.category === 'command')
    : items
  if (searchQuery === '') return candidates

  return candidates
    .map((item) => {
      const result = fuzzyMatch(item.label, searchQuery)
      return { ...item, matchIndices: result.indices, ...result }
    })
    .filter((r) => r.match)
    .sort((a, b) => b.score - a.score)
    .map(({ match: _m, score: _s, ...rest }) => rest)
}
```

Update the placeholder text to: `"Search notes... (> for commands)"`

- [ ] **Step 3: Verify tests pass**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test -- --run src/renderer/src/design/components/__tests__/CommandPalette.test.ts`
Expected: All passing.

- [ ] **Step 4: Add highlighted match characters in result rendering**

In the `CommandPaletteInner` component, replace the plain `<span>{item.label}</span>` with a `HighlightedLabel` component that bolds matched character positions:

```typescript
function HighlightedLabel({ label, indices }: { label: string; indices?: number[] }) {
  if (!indices || indices.length === 0) return <span>{label}</span>
  const indexSet = new Set(indices)
  return (
    <span>
      {label.split('').map((char, i) =>
        indexSet.has(i) ? (
          <span key={i} style={{ color: colors.accent.default, fontWeight: 600 }}>{char}</span>
        ) : (
          <span key={i}>{char}</span>
        )
      )}
    </span>
  )
}
```

In the result button, replace `<span>{item.label}</span>` with:

```typescript
<HighlightedLabel label={item.label} indices={(item as any).matchIndices} />
```

- [ ] **Step 5: Add folder path and artifact type dot to note results**

Extend the `CommandItem` interface with optional metadata fields:

```typescript
export interface CommandItem {
  id: string
  label: string
  category: 'note' | 'command'
  shortcut?: string
  folderPath?: string
  artifactType?: string
  matchIndices?: number[]
}
```

In `App.tsx` where `paletteItems` are built, include folder path and type:

```typescript
const noteItems: CommandItem[] = files.map((f) => {
  const folderPath = f.path.split('/').slice(0, -1).pop() ?? ''
  return {
    id: `note:${f.path}`,
    label: f.title,
    category: 'note',
    folderPath,
  }
})
```

In `CommandPaletteInner`, add folder path and type dot to note result rows:

```typescript
<div className="flex items-center gap-2 min-w-0">
  {item.artifactType && (
    <span
      className="w-2 h-2 rounded-full flex-shrink-0"
      style={{ backgroundColor: colors.accent.default }}
    />
  )}
  <span className="truncate">
    <HighlightedLabel label={item.label} indices={item.matchIndices} />
  </span>
  {item.folderPath && (
    <span className="text-xs truncate flex-shrink-0" style={{ color: colors.text.muted }}>
      {item.folderPath}
    </span>
  )}
</div>
```

- [ ] **Step 6: Add recent files section (top 5)**

Per spec, the most recent files appear immediately when the palette opens (before typing). Use `lastOpenNote` from vault-store state and track recent files in order.

In `App.tsx`, when building palette items, sort note items so the 5 most recently opened appear first:

```typescript
const recentNoteIds = useVaultStore.getState().state?.recentFiles ?? []

const noteItems: CommandItem[] = files.map((f) => {
  const folderPath = f.path.split('/').slice(0, -1).pop() ?? ''
  return {
    id: `note:${f.path}`,
    label: f.title,
    category: 'note',
    folderPath,
  }
})

// Split into recent (top 5) and rest
const recentItems = recentNoteIds
  .slice(0, 5)
  .map((path) => noteItems.find((item) => item.id === `note:${path}`))
  .filter(Boolean) as CommandItem[]
const recentPaths = new Set(recentNoteIds.slice(0, 5))
const otherItems = noteItems.filter((item) => !recentPaths.has(item.id.slice(5)))

return [...recentItems, ...otherItems, ...BUILT_IN_COMMANDS]
```

Also add `recentFiles: string[]` to the `VaultState` interface in `src/shared/types.ts` (append to the interface added in Task 16), and add `recentFiles: []` to the `defaultState` in `file-service.ts`.

- [ ] **Step 7: Add additional spec commands**

Per spec, the command list must include: open settings, re-index vault, zoom to fit graph. Add these to `BUILT_IN_COMMANDS` in `App.tsx`:

```typescript
const BUILT_IN_COMMANDS: CommandItem[] = [
  { id: 'cmd:new-note', label: 'New Note', category: 'command', shortcut: '\u2318N' },
  { id: 'cmd:toggle-view', label: 'Toggle Graph/Editor', category: 'command', shortcut: '\u2318G' },
  { id: 'cmd:toggle-sidebar', label: 'Toggle Sidebar', category: 'command', shortcut: '\u2318B' },
  { id: 'cmd:toggle-terminal', label: 'Toggle Terminal', category: 'command', shortcut: '\u2318`' },
  { id: 'cmd:toggle-mode', label: 'Toggle Source/Rich Mode', category: 'command', shortcut: '\u2318/' },
  { id: 'cmd:open-settings', label: 'Open Settings', category: 'command' },
  { id: 'cmd:reindex-vault', label: 'Re-index Vault', category: 'command' },
  { id: 'cmd:zoom-to-fit', label: 'Zoom to Fit Graph', category: 'command' },
]
```

Add handlers in `handlePaletteSelect` for the new commands:

```typescript
} else if (item.id === 'cmd:open-settings') {
  // TODO: open settings modal when implemented
} else if (item.id === 'cmd:reindex-vault') {
  // Re-post all files to Worker for fresh parse
  const files = useVaultStore.getState().files
  Promise.all(files.map(async (f) => ({ path: f.path, content: await window.api.fs.readFile(f.path) })))
    .then(loadFiles)
} else if (item.id === 'cmd:zoom-to-fit') {
  // TODO: dispatch zoom-to-fit action to graph-store when implemented
}
```

- [ ] **Step 8: Run tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing

- [ ] **Step 9: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/design/components/CommandPalette.tsx src/renderer/src/design/components/__tests__/CommandPalette.test.ts src/renderer/src/App.tsx src/shared/types.ts src/main/services/file-service.ts
git commit -m "feat: add fuzzy search, match highlighting, recent files, and command prefix routing to CommandPalette"
```

---

## Chunk 4: Phase 2 (Function)

### Task 22: Create buildFileTree utility

**Files:**
- Create: `src/renderer/src/panels/sidebar/buildFileTree.ts`
- Test: `tests/sidebar/buildFileTree.test.ts`

- [ ] **Step 1: Write the test**

Note: The spec requires a flat data structure with `parentPath` references rather than deeply nested objects, so drag-and-drop reorder is a path update, not a tree restructure. The `buildFileTree` utility returns a flat `FlatTreeNode[]` array sorted directories-first, with `parentPath` linking children to parents.

```typescript
// tests/sidebar/buildFileTree.test.ts
import { describe, it, expect } from 'vitest'
import { buildFileTree, type FlatTreeNode } from '../../src/renderer/src/panels/sidebar/buildFileTree'

describe('buildFileTree', () => {
  it('creates flat nodes from root-level files', () => {
    const nodes = buildFileTree(['/vault/note1.md', '/vault/note2.md'], '/vault')
    expect(nodes).toHaveLength(2)
    expect(nodes[0].name).toBe('note1.md')
    expect(nodes[0].isDirectory).toBe(false)
    expect(nodes[0].parentPath).toBe('/vault')
  })

  it('creates directory nodes with parentPath references', () => {
    const nodes = buildFileTree(
      ['/vault/genes/idea1.md', '/vault/genes/idea2.md', '/vault/constraints/limit1.md'],
      '/vault'
    )
    const genesDir = nodes.find((n) => n.name === 'genes' && n.isDirectory)
    expect(genesDir).toBeDefined()
    expect(genesDir?.parentPath).toBe('/vault')
    expect(genesDir?.itemCount).toBe(2)

    const idea1 = nodes.find((n) => n.name === 'idea1.md')
    expect(idea1?.parentPath).toBe('/vault/genes')
  })

  it('handles deeply nested paths with flat output', () => {
    const nodes = buildFileTree(['/vault/a/b/c/deep.md'], '/vault')
    expect(nodes.find((n) => n.name === 'a')?.parentPath).toBe('/vault')
    expect(nodes.find((n) => n.name === 'b')?.parentPath).toBe('/vault/a')
    expect(nodes.find((n) => n.name === 'c')?.parentPath).toBe('/vault/a/b')
    expect(nodes.find((n) => n.name === 'deep.md')?.parentPath).toBe('/vault/a/b/c')
    // All nodes in a single flat array (no children property)
    expect(nodes.every((n) => !('children' in n))).toBe(true)
  })

  it('sorts directories before files at same parent', () => {
    const nodes = buildFileTree(['/vault/zebra.md', '/vault/alpha/note.md'], '/vault')
    const rootNodes = nodes.filter((n) => n.parentPath === '/vault')
    expect(rootNodes[0].name).toBe('alpha')
    expect(rootNodes[1].name).toBe('zebra.md')
  })

  it('includes item counts on directories', () => {
    const nodes = buildFileTree(['/vault/dir/a.md', '/vault/dir/b.md'], '/vault')
    const dir = nodes.find((n) => n.name === 'dir' && n.isDirectory)
    expect(dir?.itemCount).toBe(2)
  })

  it('computes depth from path segments', () => {
    const nodes = buildFileTree(['/vault/a/b/file.md'], '/vault')
    expect(nodes.find((n) => n.name === 'a')?.depth).toBe(0)
    expect(nodes.find((n) => n.name === 'b')?.depth).toBe(1)
    expect(nodes.find((n) => n.name === 'file.md')?.depth).toBe(2)
  })

  it('returns empty array for no files', () => {
    expect(buildFileTree([], '/vault')).toEqual([])
  })

  it('preserves alphabetical sort within parent groups', () => {
    const nodes = buildFileTree(['/vault/b.md', '/vault/a.md'], '/vault')
    expect(nodes[0].name).toBe('a.md')
    expect(nodes[1].name).toBe('b.md')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/sidebar/buildFileTree.test.ts`

- [ ] **Step 3: Implement buildFileTree**

```typescript
// src/renderer/src/panels/sidebar/buildFileTree.ts

export interface FlatTreeNode {
  name: string
  path: string
  parentPath: string
  isDirectory: boolean
  depth: number
  itemCount: number
}

/**
 * Builds a flat array of tree nodes from file paths.
 * Uses parentPath references instead of nested children, so future
 * drag-and-drop reorder is a path update, not a tree restructure.
 * Nodes are ordered: directories before files, alphabetical within each group,
 * with children immediately following their parent (depth-first).
 */
export function buildFileTree(filePaths: readonly string[], vaultRoot: string): FlatTreeNode[] {
  if (filePaths.length === 0) return []

  // Phase 1: Collect all unique directories and files
  const dirSet = new Map<string, { name: string; parentPath: string; depth: number }>()
  const fileEntries: { name: string; path: string; parentPath: string; depth: number }[] = []

  for (const filePath of filePaths) {
    const relative = filePath.startsWith(vaultRoot + '/')
      ? filePath.slice(vaultRoot.length + 1)
      : filePath
    const segments = relative.split('/')

    // Register intermediate directories
    for (let i = 0; i < segments.length - 1; i++) {
      const dirPath = vaultRoot + '/' + segments.slice(0, i + 1).join('/')
      if (!dirSet.has(dirPath)) {
        const parentPath = i === 0
          ? vaultRoot
          : vaultRoot + '/' + segments.slice(0, i).join('/')
        dirSet.set(dirPath, { name: segments[i], parentPath, depth: i })
      }
    }

    // Register file
    const parentPath = segments.length > 1
      ? vaultRoot + '/' + segments.slice(0, -1).join('/')
      : vaultRoot
    fileEntries.push({
      name: segments[segments.length - 1],
      path: filePath,
      parentPath,
      depth: segments.length - 1
    })
  }

  // Phase 2: Count items per directory (direct file children only)
  const itemCounts = new Map<string, number>()
  for (const file of fileEntries) {
    itemCounts.set(file.parentPath, (itemCounts.get(file.parentPath) ?? 0) + 1)
  }

  // Phase 3: Build flat output with depth-first ordering (dirs before files)
  const result: FlatTreeNode[] = []

  function emitChildren(parentPath: string): void {
    // Collect dirs at this parent
    const childDirs = Array.from(dirSet.entries())
      .filter(([_, d]) => d.parentPath === parentPath)
      .sort(([_, a], [__, b]) => a.name.localeCompare(b.name))

    // Collect files at this parent
    const childFiles = fileEntries
      .filter((f) => f.parentPath === parentPath)
      .sort((a, b) => a.name.localeCompare(b.name))

    // Emit dirs first (each followed by its children recursively)
    for (const [dirPath, dir] of childDirs) {
      result.push({
        name: dir.name,
        path: dirPath,
        parentPath: dir.parentPath,
        isDirectory: true,
        depth: dir.depth,
        itemCount: itemCounts.get(dirPath) ?? 0
      })
      emitChildren(dirPath)
    }

    // Then emit files
    for (const file of childFiles) {
      result.push({
        name: file.name,
        path: file.path,
        parentPath: file.parentPath,
        isDirectory: false,
        depth: file.depth,
        itemCount: 0
      })
    }
  }

  emitChildren(vaultRoot)
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/sidebar/buildFileTree.test.ts`

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/sidebar/buildFileTree.ts tests/sidebar/buildFileTree.test.ts
git commit -m "feat: add buildFileTree utility with flat parentPath structure"
```

---

### Task 23: Create graph-settings-store

**Files:**
- Create: `src/renderer/src/store/graph-settings-store.ts`
- Test: `tests/store/graph-settings-store.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/store/graph-settings-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useGraphSettingsStore } from '../../src/renderer/src/store/graph-settings-store'

describe('graph-settings-store', () => {
  beforeEach(() => {
    useGraphSettingsStore.setState({
      showOrphans: true,
      showExistingOnly: false,
      baseNodeSize: 4,
      nodeSizeMode: 'degree',
      linkOpacity: 0.4,
      linkThickness: 1,
      showArrows: false,
      textFadeThreshold: 1.5,
      isAnimating: true,
      showMinimap: false,
      centerForce: 0.5,
      repelForce: -120,
      linkForce: 0.3,
      linkDistance: 30,
      groups: {
        gene: { visible: true, color: '#6C63FF' },
        constraint: { visible: true, color: '#EF4444' },
        research: { visible: true, color: '#2DD4BF' },
        output: { visible: true, color: '#EC4899' },
        note: { visible: true, color: '#8B8B8E' },
        index: { visible: true, color: '#38BDF8' },
      },
    })
  })

  it('has sensible defaults', () => {
    const state = useGraphSettingsStore.getState()
    expect(state.showOrphans).toBe(true)
    expect(state.baseNodeSize).toBe(4)
    expect(state.centerForce).toBe(0.5)
    expect(state.repelForce).toBe(-120)
    expect(state.isAnimating).toBe(true)
  })

  it('updates filter settings immutably', () => {
    const { setShowOrphans } = useGraphSettingsStore.getState()
    setShowOrphans(false)
    expect(useGraphSettingsStore.getState().showOrphans).toBe(false)
  })

  it('updates force settings', () => {
    const { setCenterForce, setRepelForce } = useGraphSettingsStore.getState()
    setCenterForce(0.8)
    setRepelForce(-200)
    const state = useGraphSettingsStore.getState()
    expect(state.centerForce).toBe(0.8)
    expect(state.repelForce).toBe(-200)
  })

  it('updates display settings', () => {
    const { setBaseNodeSize, setLinkOpacity, setShowArrows } = useGraphSettingsStore.getState()
    setBaseNodeSize(8)
    setLinkOpacity(0.7)
    setShowArrows(true)
    const state = useGraphSettingsStore.getState()
    expect(state.baseNodeSize).toBe(8)
    expect(state.linkOpacity).toBe(0.7)
    expect(state.showArrows).toBe(true)
  })

  it('updates group visibility', () => {
    const { setGroupVisible } = useGraphSettingsStore.getState()
    setGroupVisible('gene', false)
    expect(useGraphSettingsStore.getState().groups.gene.visible).toBe(false)
  })

  it('updates group color', () => {
    const { setGroupColor } = useGraphSettingsStore.getState()
    setGroupColor('gene', '#FF0000')
    expect(useGraphSettingsStore.getState().groups.gene.color).toBe('#FF0000')
  })

  it('does not mutate previous state on group update', () => {
    const before = useGraphSettingsStore.getState().groups
    useGraphSettingsStore.getState().setGroupVisible('gene', false)
    const after = useGraphSettingsStore.getState().groups
    expect(before).not.toBe(after)
    expect(before.gene.visible).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/store/graph-settings-store.test.ts`

- [ ] **Step 3: Implement the store with groups and persistence**

```typescript
// src/renderer/src/store/graph-settings-store.ts
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ArtifactType } from '@shared/types'

type NodeSizeMode = 'degree' | 'uniform' | 'content'

interface GroupConfig {
  visible: boolean
  color: string
}

interface GraphSettingsState {
  showOrphans: boolean
  showExistingOnly: boolean
  baseNodeSize: number
  nodeSizeMode: NodeSizeMode
  linkOpacity: number
  linkThickness: number
  showArrows: boolean
  textFadeThreshold: number
  isAnimating: boolean
  showMinimap: boolean
  centerForce: number
  repelForce: number
  linkForce: number
  linkDistance: number
  groups: Record<ArtifactType, GroupConfig>
}

interface GraphSettingsActions {
  setShowOrphans: (v: boolean) => void
  setShowExistingOnly: (v: boolean) => void
  setBaseNodeSize: (v: number) => void
  setNodeSizeMode: (v: NodeSizeMode) => void
  setLinkOpacity: (v: number) => void
  setLinkThickness: (v: number) => void
  setShowArrows: (v: boolean) => void
  setTextFadeThreshold: (v: number) => void
  setIsAnimating: (v: boolean) => void
  setShowMinimap: (v: boolean) => void
  setCenterForce: (v: number) => void
  setRepelForce: (v: number) => void
  setLinkForce: (v: number) => void
  setLinkDistance: (v: number) => void
  setGroupVisible: (type: ArtifactType, visible: boolean) => void
  setGroupColor: (type: ArtifactType, color: string) => void
}

type GraphSettingsStore = GraphSettingsState & GraphSettingsActions

const ipcRenderer = window.electron.ipcRenderer

/**
 * Custom storage adapter that persists to vault's .thought-engine/graph-settings.json
 * via IPC. Falls back to in-memory if IPC is unavailable.
 */
const vaultStorage = createJSONStorage<GraphSettingsStore>(() => ({
  getItem: async (name: string): Promise<string | null> => {
    try {
      const vaultPath = (window as any).__vaultPath
      if (!vaultPath) return null
      const path = `${vaultPath}/.thought-engine/${name}.json`
      const content = await ipcRenderer.invoke('fs:read-file', { path })
      return content
    } catch {
      return null
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const vaultPath = (window as any).__vaultPath
      if (!vaultPath) return
      const path = `${vaultPath}/.thought-engine/${name}.json`
      await ipcRenderer.invoke('fs:write-file', { path, content: value })
    } catch {
      // Silently fail: settings stay in memory
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      const vaultPath = (window as any).__vaultPath
      if (!vaultPath) return
      const path = `${vaultPath}/.thought-engine/${name}.json`
      await ipcRenderer.invoke('fs:delete-file', { path })
    } catch {
      // Silently fail
    }
  },
}))

export const useGraphSettingsStore = create<GraphSettingsStore>()(
  persist(
    (set, get) => ({
      showOrphans: true,
      showExistingOnly: false,
      baseNodeSize: 4,
      nodeSizeMode: 'degree' as NodeSizeMode,
      linkOpacity: 0.4,
      linkThickness: 1,
      showArrows: false,
      textFadeThreshold: 1.5,
      isAnimating: true,
      showMinimap: false,
      centerForce: 0.5,
      repelForce: -120,
      linkForce: 0.3,
      linkDistance: 30,
      groups: {
        gene: { visible: true, color: '#6C63FF' },
        constraint: { visible: true, color: '#EF4444' },
        research: { visible: true, color: '#2DD4BF' },
        output: { visible: true, color: '#EC4899' },
        note: { visible: true, color: '#8B8B8E' },
        index: { visible: true, color: '#38BDF8' },
      },

      setShowOrphans: (v) => set({ showOrphans: v }),
      setShowExistingOnly: (v) => set({ showExistingOnly: v }),
      setBaseNodeSize: (v) => set({ baseNodeSize: v }),
      setNodeSizeMode: (v) => set({ nodeSizeMode: v }),
      setLinkOpacity: (v) => set({ linkOpacity: v }),
      setLinkThickness: (v) => set({ linkThickness: v }),
      setShowArrows: (v) => set({ showArrows: v }),
      setTextFadeThreshold: (v) => set({ textFadeThreshold: v }),
      setIsAnimating: (v) => set({ isAnimating: v }),
      setShowMinimap: (v) => set({ showMinimap: v }),
      setCenterForce: (v) => set({ centerForce: v }),
      setRepelForce: (v) => set({ repelForce: v }),
      setLinkForce: (v) => set({ linkForce: v }),
      setLinkDistance: (v) => set({ linkDistance: v }),
      setGroupVisible: (type, visible) => {
        const groups = { ...get().groups }
        groups[type] = { ...groups[type], visible }
        set({ groups })
      },
      setGroupColor: (type, color) => {
        const groups = { ...get().groups }
        groups[type] = { ...groups[type], color }
        set({ groups })
      },
    }),
    {
      name: 'graph-settings',
      storage: vaultStorage,
      partialize: (state) => ({
        showOrphans: state.showOrphans,
        showExistingOnly: state.showExistingOnly,
        baseNodeSize: state.baseNodeSize,
        nodeSizeMode: state.nodeSizeMode,
        linkOpacity: state.linkOpacity,
        linkThickness: state.linkThickness,
        showArrows: state.showArrows,
        textFadeThreshold: state.textFadeThreshold,
        isAnimating: state.isAnimating,
        showMinimap: state.showMinimap,
        centerForce: state.centerForce,
        repelForce: state.repelForce,
        linkForce: state.linkForce,
        linkDistance: state.linkDistance,
        groups: state.groups,
      }),
    }
  )
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/store/graph-settings-store.test.ts`

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/store/graph-settings-store.ts tests/store/graph-settings-store.test.ts
git commit -m "feat: add graph-settings-store with groups, persistence, and full test coverage"
```

---

### Task 24: Create GraphSettingsPanel

**Files:**
- Create: `src/renderer/src/panels/graph/GraphSettingsPanel.tsx`

- [ ] **Step 1: Implement the Obsidian-style settings overlay**

```typescript
// src/renderer/src/panels/graph/GraphSettingsPanel.tsx
import { useState } from 'react'
import { useGraphSettingsStore } from '../../store/graph-settings-store'
import { colors } from '../../design/tokens'
import { ARTIFACT_TYPES, type ArtifactType } from '@shared/types'

interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}

function SliderRow({ label, value, min, max, step, onChange }: SliderRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <label className="text-xs whitespace-nowrap" style={{ color: colors.text.secondary }}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-24 h-1 accent-[#6C63FF]"
        />
        <span className="text-xs w-10 text-right tabular-nums" style={{ color: colors.text.muted }}>
          {value}
        </span>
      </div>
    </div>
  )
}

interface ToggleRowProps {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}

function ToggleRow({ label, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between py-1">
      <label className="text-xs" style={{ color: colors.text.secondary }}>
        {label}
      </label>
      <button
        onClick={() => onChange(!checked)}
        className="w-8 h-4 rounded-full relative transition-colors"
        style={{
          backgroundColor: checked ? colors.accent.default : colors.bg.elevated,
          border: `1px solid ${colors.border.default}`
        }}
      >
        <span
          className="absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform"
          style={{ left: checked ? '14px' : '2px' }}
        />
      </button>
    </div>
  )
}

function SectionHeader({
  title,
  isOpen,
  onToggle
}: {
  title: string
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1 w-full py-1.5 text-xs font-medium"
      style={{ color: colors.text.primary }}
    >
      <span className="text-[10px]">{isOpen ? '\u25BE' : '\u25B8'}</span>
      {title}
    </button>
  )
}

interface GraphSettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function GraphSettingsPanel({ isOpen, onClose }: GraphSettingsPanelProps) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    filters: true,
    groups: true,
    display: true,
    forces: true,
  })

  const {
    showOrphans, showExistingOnly,
    baseNodeSize, linkOpacity, linkThickness, showArrows,
    textFadeThreshold, isAnimating, showMinimap,
    centerForce, repelForce, linkForce, linkDistance,
    groups,
    setShowOrphans, setShowExistingOnly,
    setBaseNodeSize, setLinkOpacity, setLinkThickness, setShowArrows,
    setTextFadeThreshold, setIsAnimating, setShowMinimap,
    setCenterForce, setRepelForce, setLinkForce, setLinkDistance,
    setGroupVisible, setGroupColor,
  } = useGraphSettingsStore()

  if (!isOpen) return null

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div
      className="absolute top-0 right-0 h-full w-[260px] z-20 overflow-y-auto border-l"
      style={{
        backgroundColor: colors.bg.surface,
        borderColor: colors.border.default,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: colors.border.default }}>
        <span className="text-xs font-medium" style={{ color: colors.text.primary }}>
          Graph Settings
        </span>
        <button onClick={onClose} className="text-xs px-1" style={{ color: colors.text.muted }}>
          X
        </button>
      </div>

      <div className="px-3 py-1">
        {/* Filters */}
        <SectionHeader title="Filters" isOpen={openSections.filters} onToggle={() => toggleSection('filters')} />
        {openSections.filters && (
          <div className="pl-3 pb-2">
            <ToggleRow label="Show orphans" checked={showOrphans} onChange={setShowOrphans} />
            <ToggleRow label="Existing files only" checked={showExistingOnly} onChange={setShowExistingOnly} />
          </div>
        )}

        {/* Groups (artifact type coloring config per spec 2B) */}
        <SectionHeader title="Groups" isOpen={openSections.groups} onToggle={() => toggleSection('groups')} />
        {openSections.groups && (
          <div className="pl-3 pb-2">
            {ARTIFACT_TYPES.map((type: ArtifactType) => (
              <div key={type} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={groups[type].color}
                    onChange={(e) => setGroupColor(type, e.target.value)}
                    className="w-4 h-4 rounded border-0 cursor-pointer bg-transparent"
                  />
                  <span className="text-xs capitalize" style={{ color: colors.text.secondary }}>
                    {type}
                  </span>
                </div>
                <button
                  onClick={() => setGroupVisible(type, !groups[type].visible)}
                  className="text-xs px-1"
                  style={{ color: groups[type].visible ? colors.text.secondary : colors.text.muted }}
                >
                  {groups[type].visible ? 'ON' : 'OFF'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Display */}
        <SectionHeader title="Display" isOpen={openSections.display} onToggle={() => toggleSection('display')} />
        {openSections.display && (
          <div className="pl-3 pb-2">
            <SliderRow label="Node size" value={baseNodeSize} min={1} max={20} step={1} onChange={setBaseNodeSize} />
            <SliderRow label="Link opacity" value={linkOpacity} min={0} max={1} step={0.05} onChange={setLinkOpacity} />
            <SliderRow label="Link thickness" value={linkThickness} min={0.5} max={5} step={0.5} onChange={setLinkThickness} />
            <ToggleRow label="Arrows" checked={showArrows} onChange={setShowArrows} />
            <SliderRow label="Text fade" value={textFadeThreshold} min={0.5} max={4} step={0.1} onChange={setTextFadeThreshold} />
            <ToggleRow label="Minimap" checked={showMinimap} onChange={setShowMinimap} />
          </div>
        )}

        {/* Forces */}
        <SectionHeader title="Forces" isOpen={openSections.forces} onToggle={() => toggleSection('forces')} />
        {openSections.forces && (
          <div className="pl-3 pb-2">
            <SliderRow label="Center" value={centerForce} min={0} max={1} step={0.05} onChange={setCenterForce} />
            <SliderRow label="Repel" value={repelForce} min={-500} max={0} step={10} onChange={setRepelForce} />
            <SliderRow label="Link strength" value={linkForce} min={0} max={1} step={0.05} onChange={setLinkForce} />
            <SliderRow label="Link distance" value={linkDistance} min={10} max={200} step={5} onChange={setLinkDistance} />
          </div>
        )}

        {/* Animate button */}
        <div className="pt-2 pb-3">
          <button
            onClick={() => setIsAnimating(!isAnimating)}
            className="w-full py-1.5 text-xs rounded transition-colors"
            style={{
              backgroundColor: isAnimating ? colors.accent.default : colors.bg.elevated,
              color: colors.text.primary,
              border: `1px solid ${colors.border.default}`,
            }}
          >
            {isAnimating ? 'Stop Animation' : 'Start Animation'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/graph/GraphSettingsPanel.tsx
git commit -m "feat: add GraphSettingsPanel with filters, groups, display, and force controls"
```

---

### Task 25: Add terminal:process-name IPC handler

**Files:**
- Modify: `src/main/services/shell-service.ts`
- Modify: `src/main/ipc/shell.ts`

- [ ] **Step 1: Add getProcessName to ShellService**

```typescript
// Add to ShellService class:
  getProcessName(sessionId: string): string | null {
    const pty = this.sessions.get(sessionId)
    return pty?.process ?? null
  }
```

- [ ] **Step 2: Register the IPC handler**

```typescript
// Add to registerShellIpc:
  ipcMain.handle('terminal:process-name', async (_e, args: { sessionId: string }) => {
    return shellService.getProcessName(args.sessionId)
  })
```

- [ ] **Step 3: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/main/services/shell-service.ts src/main/ipc/shell.ts
git commit -m "feat: add terminal:process-name IPC handler"
```

---

### Task 26: Create settings-store and SettingsModal full implementation

**Files:**
- Create: `src/renderer/src/store/settings-store.ts`
- Modify: `src/renderer/src/components/SettingsModal.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Create settings store with persistence**

```typescript
// src/renderer/src/store/settings-store.ts
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface SettingsState {
  fontSize: number
  fontFamily: string
  defaultEditorMode: 'rich' | 'source'
  autosaveInterval: number
  spellCheck: boolean
  terminalShell: string
  terminalFontSize: number
  scrollbackLines: number
}

interface SettingsActions {
  setFontSize: (v: number) => void
  setFontFamily: (v: string) => void
  setDefaultEditorMode: (v: 'rich' | 'source') => void
  setAutosaveInterval: (v: number) => void
  setSpellCheck: (v: boolean) => void
  setTerminalShell: (v: string) => void
  setTerminalFontSize: (v: number) => void
  setScrollbackLines: (v: number) => void
}

type SettingsStore = SettingsState & SettingsActions

/**
 * App-level settings persistence via localStorage.
 * In production this could be swapped to an IPC-backed electron-store adapter.
 */
const appStorage = createJSONStorage<SettingsStore>(() => ({
  getItem: (name: string): string | null => {
    try { return localStorage.getItem(name) } catch { return null }
  },
  setItem: (name: string, value: string): void => {
    try { localStorage.setItem(name, value) } catch { /* silent */ }
  },
  removeItem: (name: string): void => {
    try { localStorage.removeItem(name) } catch { /* silent */ }
  },
}))

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      fontSize: 13,
      fontFamily: 'Inter',
      defaultEditorMode: 'rich',
      autosaveInterval: 1500,
      spellCheck: false,
      terminalShell: '',
      terminalFontSize: 13,
      scrollbackLines: 10000,

      setFontSize: (v) => set({ fontSize: v }),
      setFontFamily: (v) => set({ fontFamily: v }),
      setDefaultEditorMode: (v) => set({ defaultEditorMode: v }),
      setAutosaveInterval: (v) => set({ autosaveInterval: v }),
      setSpellCheck: (v) => set({ spellCheck: v }),
      setTerminalShell: (v) => set({ terminalShell: v }),
      setTerminalFontSize: (v) => set({ terminalFontSize: v }),
      setScrollbackLines: (v) => set({ scrollbackLines: v }),
    }),
    {
      name: 'thought-engine-settings',
      storage: appStorage,
      partialize: (state) => ({
        fontSize: state.fontSize,
        fontFamily: state.fontFamily,
        defaultEditorMode: state.defaultEditorMode,
        autosaveInterval: state.autosaveInterval,
        spellCheck: state.spellCheck,
        terminalShell: state.terminalShell,
        terminalFontSize: state.terminalFontSize,
        scrollbackLines: state.scrollbackLines,
      }),
    }
  )
)
```

- [ ] **Step 2: Implement SettingsModal with 5 tabs**

```typescript
// src/renderer/src/components/SettingsModal.tsx
import { useState, useEffect, useCallback } from 'react'
import { useSettingsStore } from '../store/settings-store'
import { useGraphSettingsStore } from '../store/graph-settings-store'
import { useVaultStore } from '../store/vault-store'
import { colors } from '../design/tokens'

type SettingsTab = 'appearance' | 'editor' | 'graph' | 'terminal' | 'vault'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  { id: 'graph', label: 'Graph' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'vault', label: 'Vault' },
]

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2">
      <label className="text-sm" style={{ color: colors.text.secondary }}>{label}</label>
      <div>{children}</div>
    </div>
  )
}

function SliderInput({
  value, min, max, step, onChange
}: {
  value: number; min: number; max: number; step: number; onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28 h-1 accent-[#6C63FF]"
      />
      <span className="text-xs w-10 text-right tabular-nums" style={{ color: colors.text.muted }}>
        {value}
      </span>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-8 h-4 rounded-full relative transition-colors"
      style={{
        backgroundColor: checked ? colors.accent.default : colors.bg.elevated,
        border: `1px solid ${colors.border.default}`
      }}
    >
      <span
        className="absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform"
        style={{ left: checked ? '14px' : '2px' }}
      />
    </button>
  )
}

function SelectInput({
  value, options, onChange
}: {
  value: string; options: { value: string; label: string }[]; onChange: (v: string) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs px-2 py-1 rounded border bg-transparent"
      style={{ borderColor: colors.border.default, color: colors.text.primary }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  )
}

function AppearanceTab() {
  const { fontSize, fontFamily, setFontSize, setFontFamily } = useSettingsStore()
  return (
    <div>
      <h3 className="text-xs font-medium mb-3" style={{ color: colors.text.muted }}>APPEARANCE</h3>
      <SettingRow label="Font size">
        <SliderInput value={fontSize} min={10} max={24} step={1} onChange={setFontSize} />
      </SettingRow>
      <SettingRow label="Font family">
        <SelectInput
          value={fontFamily}
          options={[
            { value: 'Inter', label: 'Inter' },
            { value: 'system-ui', label: 'System' },
            { value: 'JetBrains Mono', label: 'JetBrains Mono' },
          ]}
          onChange={setFontFamily}
        />
      </SettingRow>
      <SettingRow label="Theme">
        <span className="text-xs" style={{ color: colors.text.muted }}>Dark (only)</span>
      </SettingRow>
    </div>
  )
}

function EditorTab() {
  const {
    defaultEditorMode, autosaveInterval, spellCheck,
    setDefaultEditorMode, setAutosaveInterval, setSpellCheck,
  } = useSettingsStore()
  return (
    <div>
      <h3 className="text-xs font-medium mb-3" style={{ color: colors.text.muted }}>EDITOR</h3>
      <SettingRow label="Default mode">
        <SelectInput
          value={defaultEditorMode}
          options={[{ value: 'rich', label: 'Rich' }, { value: 'source', label: 'Source' }]}
          onChange={(v) => setDefaultEditorMode(v as 'rich' | 'source')}
        />
      </SettingRow>
      <SettingRow label="Autosave (ms)">
        <SliderInput value={autosaveInterval} min={500} max={10000} step={500} onChange={setAutosaveInterval} />
      </SettingRow>
      <SettingRow label="Spell check">
        <Toggle checked={spellCheck} onChange={setSpellCheck} />
      </SettingRow>
    </div>
  )
}

function GraphTab() {
  const {
    centerForce, repelForce, linkForce, linkDistance,
    baseNodeSize, linkOpacity, showArrows,
    setCenterForce, setRepelForce, setLinkForce, setLinkDistance,
    setBaseNodeSize, setLinkOpacity, setShowArrows,
  } = useGraphSettingsStore()
  return (
    <div>
      <h3 className="text-xs font-medium mb-3" style={{ color: colors.text.muted }}>GRAPH DEFAULTS</h3>
      <SettingRow label="Node size">
        <SliderInput value={baseNodeSize} min={1} max={20} step={1} onChange={setBaseNodeSize} />
      </SettingRow>
      <SettingRow label="Link opacity">
        <SliderInput value={linkOpacity} min={0} max={1} step={0.05} onChange={setLinkOpacity} />
      </SettingRow>
      <SettingRow label="Arrows">
        <Toggle checked={showArrows} onChange={setShowArrows} />
      </SettingRow>
      <SettingRow label="Center force">
        <SliderInput value={centerForce} min={0} max={1} step={0.05} onChange={setCenterForce} />
      </SettingRow>
      <SettingRow label="Repel force">
        <SliderInput value={repelForce} min={-500} max={0} step={10} onChange={setRepelForce} />
      </SettingRow>
      <SettingRow label="Link strength">
        <SliderInput value={linkForce} min={0} max={1} step={0.05} onChange={setLinkForce} />
      </SettingRow>
      <SettingRow label="Link distance">
        <SliderInput value={linkDistance} min={10} max={200} step={5} onChange={setLinkDistance} />
      </SettingRow>
    </div>
  )
}

function TerminalTab() {
  const {
    terminalShell, terminalFontSize, scrollbackLines,
    setTerminalShell, setTerminalFontSize, setScrollbackLines,
  } = useSettingsStore()
  return (
    <div>
      <h3 className="text-xs font-medium mb-3" style={{ color: colors.text.muted }}>TERMINAL</h3>
      <SettingRow label="Shell path">
        <input
          type="text"
          value={terminalShell}
          onChange={(e) => setTerminalShell(e.target.value)}
          placeholder="Default shell"
          className="text-xs px-2 py-1 w-40 rounded border bg-transparent"
          style={{ borderColor: colors.border.default, color: colors.text.primary }}
        />
      </SettingRow>
      <SettingRow label="Font size">
        <SliderInput value={terminalFontSize} min={8} max={24} step={1} onChange={setTerminalFontSize} />
      </SettingRow>
      <SettingRow label="Scrollback">
        <SliderInput value={scrollbackLines} min={1000} max={100000} step={1000} onChange={setScrollbackLines} />
      </SettingRow>
    </div>
  )
}

function VaultTab() {
  const { vaultPath } = useVaultStore()
  const [indexing, setIndexing] = useState(false)

  const handleReindex = useCallback(async () => {
    if (!vaultPath) return
    setIndexing(true)
    try {
      const files = await window.electron.ipcRenderer.invoke(
        'fs:list-files-recursive', { dir: vaultPath }
      )
      for (const filePath of files) {
        await window.electron.ipcRenderer.invoke('fs:read-file', { path: filePath })
      }
    } finally {
      setIndexing(false)
    }
  }, [vaultPath])

  return (
    <div>
      <h3 className="text-xs font-medium mb-3" style={{ color: colors.text.muted }}>VAULT</h3>
      <SettingRow label="Vault path">
        <span className="text-xs truncate max-w-[200px] inline-block" style={{ color: colors.text.muted }}>
          {vaultPath ?? 'No vault open'}
        </span>
      </SettingRow>
      <div className="pt-2">
        <button
          onClick={handleReindex}
          disabled={indexing || !vaultPath}
          className="w-full py-1.5 text-xs rounded transition-colors"
          style={{
            backgroundColor: colors.bg.elevated,
            color: indexing ? colors.text.muted : colors.text.primary,
            border: `1px solid ${colors.border.default}`,
          }}
        >
          {indexing ? 'Re-indexing...' : 'Re-index Vault'}
        </button>
      </div>
    </div>
  )
}

const TAB_COMPONENTS: Record<SettingsTab, () => JSX.Element> = {
  appearance: AppearanceTab,
  editor: EditorTab,
  graph: GraphTab,
  terminal: TerminalTab,
  vault: VaultTab,
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const ActiveTabComponent = TAB_COMPONENTS[activeTab]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-[560px] max-h-[480px] flex rounded-lg overflow-hidden"
        style={{ backgroundColor: colors.bg.surface, border: `1px solid ${colors.border.default}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="w-[160px] flex-shrink-0 border-r py-3"
          style={{ borderColor: colors.border.default, backgroundColor: colors.bg.base }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="w-full text-left px-4 py-1.5 text-sm transition-colors"
              style={{
                backgroundColor: activeTab === tab.id ? colors.bg.elevated : 'transparent',
                color: activeTab === tab.id ? colors.text.primary : colors.text.secondary,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1 p-4 overflow-y-auto">
          <ActiveTabComponent />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire SettingsModal into App.tsx**

Verify that `SettingsModal` is rendered in `WorkspaceShell` and connected to a toggle. In `App.tsx`, inside the `WorkspaceShell` function:

```typescript
// Add import at top of App.tsx:
import { SettingsModal } from './components/SettingsModal'

// Add state in WorkspaceShell:
const [settingsOpen, setSettingsOpen] = useState(false)

// Add to handlePaletteSelect:
} else if (item.id === 'cmd:open-settings') {
  setSettingsOpen(true)
}

// Add inside WorkspaceShell return, after CommandPalette:
<SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
```

The `cmd:open-settings` command should already exist in `BUILT_IN_COMMANDS` from the CommandPalette task. If not, add it. This ensures the settings modal is reachable from `Cmd+K > Settings`.

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/store/settings-store.ts src/renderer/src/components/SettingsModal.tsx src/renderer/src/App.tsx
git commit -m "feat: add settings-store with persistence and full SettingsModal with 5 tabs"
```

---

### Task 27: Wire buildFileTree into FileTree and add Sidebar action bar

**Files:**
- Modify: `src/renderer/src/panels/sidebar/FileTree.tsx`
- Modify: `src/renderer/src/panels/sidebar/Sidebar.tsx`
- Modify: `src/renderer/src/App.tsx` (ConnectedSidebar)
- Test: `tests/sidebar/FileTree.test.ts`

- [ ] **Step 1: Write tests for FileTree rendering with flat tree nodes**

```typescript
// tests/sidebar/FileTree.test.ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileTree } from '../../src/renderer/src/panels/sidebar/FileTree'
import type { FlatTreeNode } from '../../src/renderer/src/panels/sidebar/buildFileTree'

const makeNode = (
  overrides: Partial<FlatTreeNode> & { name: string; path: string }
): FlatTreeNode => ({
  parentPath: '/vault',
  isDirectory: false,
  depth: 0,
  itemCount: 0,
  ...overrides,
})

describe('FileTree', () => {
  const baseNodes: FlatTreeNode[] = [
    makeNode({ name: 'genes', path: '/vault/genes', parentPath: '/vault', isDirectory: true, depth: 0, itemCount: 2 }),
    makeNode({ name: 'idea1.md', path: '/vault/genes/idea1.md', parentPath: '/vault/genes', depth: 1 }),
    makeNode({ name: 'idea2.md', path: '/vault/genes/idea2.md', parentPath: '/vault/genes', depth: 1 }),
    makeNode({ name: 'readme.md', path: '/vault/readme.md', parentPath: '/vault', depth: 0 }),
  ]

  it('renders directory and file nodes', () => {
    render(
      <FileTree
        nodes={baseNodes}
        activeFilePath={null}
        collapsedPaths={new Set()}
        onFileSelect={vi.fn()}
        onToggleDirectory={vi.fn()}
      />
    )
    expect(screen.getByText('genes')).toBeDefined()
    expect(screen.getByText('readme.md')).toBeDefined()
  })

  it('hides children when directory is collapsed', () => {
    render(
      <FileTree
        nodes={baseNodes}
        activeFilePath={null}
        collapsedPaths={new Set(['/vault/genes'])}
        onFileSelect={vi.fn()}
        onToggleDirectory={vi.fn()}
      />
    )
    expect(screen.getByText('genes')).toBeDefined()
    expect(screen.queryByText('idea1.md')).toBeNull()
  })

  it('highlights active file', () => {
    render(
      <FileTree
        nodes={baseNodes}
        activeFilePath="/vault/readme.md"
        collapsedPaths={new Set()}
        onFileSelect={vi.fn()}
        onToggleDirectory={vi.fn()}
      />
    )
    const activeItem = screen.getByText('readme.md').closest('div')
    expect(activeItem?.style.backgroundColor).toContain('rgba')
  })

  it('calls onFileSelect when file clicked', () => {
    const onFileSelect = vi.fn()
    render(
      <FileTree
        nodes={baseNodes}
        activeFilePath={null}
        collapsedPaths={new Set()}
        onFileSelect={onFileSelect}
        onToggleDirectory={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('readme.md'))
    expect(onFileSelect).toHaveBeenCalledWith('/vault/readme.md')
  })

  it('calls onToggleDirectory when folder clicked', () => {
    const onToggle = vi.fn()
    render(
      <FileTree
        nodes={baseNodes}
        activeFilePath={null}
        collapsedPaths={new Set()}
        onFileSelect={vi.fn()}
        onToggleDirectory={onToggle}
      />
    )
    fireEvent.click(screen.getByText('genes'))
    expect(onToggle).toHaveBeenCalledWith('/vault/genes')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/sidebar/FileTree.test.ts`

- [ ] **Step 3: Update FileTree.tsx to consume FlatTreeNode[]**

Replace the entire `FileTree.tsx` with a component that renders from the flat `FlatTreeNode[]` array. Directory collapsing is controlled by a `collapsedPaths` set passed in as a prop. When a directory is collapsed, all nodes whose `parentPath` chain includes that directory are hidden.

```typescript
// src/renderer/src/panels/sidebar/FileTree.tsx
import { colors, ARTIFACT_COLORS } from '../../design/tokens'
import type { ArtifactType } from '@shared/types'
import type { FlatTreeNode } from './buildFileTree'

interface FileTreeProps {
  nodes: FlatTreeNode[]
  activeFilePath: string | null
  collapsedPaths: Set<string>
  artifactTypes?: Map<string, ArtifactType>
  onFileSelect: (path: string) => void
  onToggleDirectory: (path: string) => void
}

/**
 * Determines if a node should be visible given the set of collapsed directories.
 * A node is hidden if any ancestor in its parentPath chain is collapsed.
 */
function isVisible(
  node: FlatTreeNode,
  collapsedPaths: Set<string>,
  allNodes: FlatTreeNode[]
): boolean {
  let currentParent = node.parentPath
  const dirPaths = new Set(allNodes.filter((n) => n.isDirectory).map((n) => n.path))
  while (dirPaths.has(currentParent)) {
    if (collapsedPaths.has(currentParent)) return false
    const parentNode = allNodes.find((n) => n.path === currentParent)
    if (!parentNode) break
    currentParent = parentNode.parentPath
  }
  return true
}

export function FileTree({
  nodes,
  activeFilePath,
  collapsedPaths,
  artifactTypes,
  onFileSelect,
  onToggleDirectory,
}: FileTreeProps) {
  return (
    <div className="text-sm select-none">
      {nodes
        .filter((node) => isVisible(node, collapsedPaths, nodes))
        .map((node) => {
          const isActive = node.path === activeFilePath
          const paddingLeft = 12 + node.depth * 16

          if (node.isDirectory) {
            const isCollapsed = collapsedPaths.has(node.path)
            return (
              <div
                key={node.path}
                onClick={() => onToggleDirectory(node.path)}
                className="flex items-center py-0.5 cursor-pointer hover:bg-[#1A1A1D] transition-colors"
                style={{ paddingLeft, color: colors.text.secondary }}
              >
                <span className="mr-1 text-xs">
                  {isCollapsed ? '\u25B8' : '\u25BE'}
                </span>
                <span className="truncate">{node.name}</span>
                {node.itemCount > 0 && (
                  <span className="ml-auto mr-2 text-xs" style={{ color: colors.text.muted }}>
                    {node.itemCount}
                  </span>
                )}
              </div>
            )
          }

          const artifactType = artifactTypes?.get(node.path)
          return (
            <div
              key={node.path}
              onClick={() => onFileSelect(node.path)}
              className="flex items-center py-0.5 cursor-pointer hover:bg-[#1A1A1D] transition-colors"
              style={{
                paddingLeft,
                backgroundColor: isActive ? colors.accent.muted : undefined,
                color: isActive ? colors.text.primary : colors.text.secondary,
              }}
            >
              {artifactType && (
                <span
                  className="w-2 h-2 rounded-full mr-2 flex-shrink-0"
                  style={{ backgroundColor: ARTIFACT_COLORS[artifactType] }}
                />
              )}
              <span className="truncate flex-1">{node.name}</span>
            </div>
          )
        })}
    </div>
  )
}
```

- [ ] **Step 4: Update Sidebar.tsx with action bar**

Add the action bar below search with New File, New Folder, and Sort dropdown per spec 2A.

```typescript
// src/renderer/src/panels/sidebar/Sidebar.tsx
import { SearchBar } from './SearchBar'
import { WorkspaceFilter } from './WorkspaceFilter'
import { FileTree } from './FileTree'
import { colors } from '../../design/tokens'
import type { FlatTreeNode } from './buildFileTree'
import type { ArtifactType } from '@shared/types'

type SortMode = 'modified' | 'name' | 'type'

interface SidebarProps {
  nodes: FlatTreeNode[]
  workspaces: string[]
  activeWorkspace: string | null
  activeFilePath: string | null
  collapsedPaths: Set<string>
  artifactTypes?: Map<string, ArtifactType>
  sortMode: SortMode
  onSearch: (query: string) => void
  onWorkspaceSelect: (workspace: string | null) => void
  onFileSelect: (path: string) => void
  onToggleDirectory: (path: string) => void
  onNewFile: () => void
  onNewFolder: () => void
  onSortChange: (mode: SortMode) => void
}

function ActionBar({
  onNewFile,
  onNewFolder,
  sortMode,
  onSortChange,
}: {
  onNewFile: () => void
  onNewFolder: () => void
  sortMode: SortMode
  onSortChange: (mode: SortMode) => void
}) {
  return (
    <div
      className="flex items-center gap-1 px-2 py-1 border-b"
      style={{ borderColor: colors.border.default }}
    >
      <button
        onClick={onNewFile}
        className="px-1.5 py-0.5 text-xs rounded hover:bg-[#1A1A1D] transition-colors"
        style={{ color: colors.text.secondary }}
        title="New file"
      >
        + File
      </button>
      <button
        onClick={onNewFolder}
        className="px-1.5 py-0.5 text-xs rounded hover:bg-[#1A1A1D] transition-colors"
        style={{ color: colors.text.secondary }}
        title="New folder"
      >
        + Folder
      </button>
      <div className="ml-auto">
        <select
          value={sortMode}
          onChange={(e) => onSortChange(e.target.value as SortMode)}
          className="text-xs bg-transparent border-0 cursor-pointer"
          style={{ color: colors.text.muted }}
        >
          <option value="modified">Modified</option>
          <option value="name">Name</option>
          <option value="type">Type</option>
        </select>
      </div>
    </div>
  )
}

export function Sidebar({
  nodes,
  workspaces,
  activeWorkspace,
  activeFilePath,
  collapsedPaths,
  artifactTypes,
  sortMode,
  onSearch,
  onWorkspaceSelect,
  onFileSelect,
  onToggleDirectory,
  onNewFile,
  onNewFolder,
  onSortChange,
}: SidebarProps) {
  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: colors.bg.surface }}>
      <div className="p-2 border-b" style={{ borderColor: colors.border.default }}>
        <SearchBar onSearch={onSearch} />
      </div>
      <ActionBar
        onNewFile={onNewFile}
        onNewFolder={onNewFolder}
        sortMode={sortMode}
        onSortChange={onSortChange}
      />
      {workspaces.length > 0 && (
        <WorkspaceFilter
          workspaces={workspaces}
          active={activeWorkspace}
          onSelect={onWorkspaceSelect}
        />
      )}
      <div className="flex-1 overflow-y-auto">
        <FileTree
          nodes={nodes}
          activeFilePath={activeFilePath}
          collapsedPaths={collapsedPaths}
          artifactTypes={artifactTypes}
          onFileSelect={onFileSelect}
          onToggleDirectory={onToggleDirectory}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Update ConnectedSidebar in App.tsx**

In `App.tsx`, update `ConnectedSidebar` to use `buildFileTree` and manage collapse/sort state:

```typescript
// Replace ConnectedSidebar in App.tsx:
import { buildFileTree } from './panels/sidebar/buildFileTree'

function ConnectedSidebar() {
  const { files, config, activeWorkspace, setActiveWorkspace, vaultPath } = useVaultStore()
  const { setActiveNote, activeNotePath } = useEditorStore()
  const collapsedRef = useRef<Set<string>>(new Set())
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<'modified' | 'name' | 'type'>('modified')

  const treeNodes = useMemo(() => {
    const paths = files.map((f) => f.path)
    return buildFileTree(paths, vaultPath ?? '')
  }, [files, vaultPath])

  const artifactTypes = useMemo(() => {
    const map = new Map<string, ArtifactType>()
    for (const f of files) {
      if (f.type) map.set(f.path, f.type)
    }
    return map
  }, [files])

  const handleFileSelect = useCallback(
    (path: string) => {
      const file = files.find((f) => f.path === path)
      if (file) setActiveNote(file.path, file.path)
    },
    [files, setActiveNote]
  )

  const handleSearch = useCallback((_query: string) => {
    // TODO: wire to vault index search
  }, [])

  const handleToggleDirectory = useCallback((path: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      collapsedRef.current = next
      return next
    })
  }, [])

  const handleNewFile = useCallback(async () => {
    if (!vaultPath) return
    const name = prompt('File name:')
    if (!name) return
    const path = `${vaultPath}/${name.endsWith('.md') ? name : name + '.md'}`
    await window.electron.ipcRenderer.invoke('fs:write-file', {
      path,
      content: `---\ntitle: ${name.replace('.md', '')}\n---\n`,
    })
  }, [vaultPath])

  const handleNewFolder = useCallback(async () => {
    if (!vaultPath) return
    const name = prompt('Folder name:')
    if (!name) return
    await window.electron.ipcRenderer.invoke('fs:write-file', {
      path: `${vaultPath}/${name}/.gitkeep`,
      content: '',
    })
  }, [vaultPath])

  return (
    <Sidebar
      nodes={treeNodes}
      workspaces={config?.workspaces ?? []}
      activeWorkspace={activeWorkspace}
      activeFilePath={activeNotePath}
      collapsedPaths={collapsedPaths}
      artifactTypes={artifactTypes}
      sortMode={sortMode}
      onSearch={handleSearch}
      onWorkspaceSelect={setActiveWorkspace}
      onFileSelect={handleFileSelect}
      onToggleDirectory={handleToggleDirectory}
      onNewFile={handleNewFile}
      onNewFolder={handleNewFolder}
      onSortChange={setSortMode}
    />
  )
}
```

- [ ] **Step 6: Run tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/sidebar/FileTree.test.ts tests/sidebar/buildFileTree.test.ts`

- [ ] **Step 7: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`

- [ ] **Step 8: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/sidebar/FileTree.tsx src/renderer/src/panels/sidebar/Sidebar.tsx src/renderer/src/App.tsx tests/sidebar/FileTree.test.ts
git commit -m "feat: wire buildFileTree into FileTree with hierarchy, action bar, and collapse state"
```

---

### Task 28: Terminal restyling with close guard, rename, search, and zoom

**Files:**
- Modify: `src/renderer/src/panels/terminal/TerminalTabs.tsx`
- Modify: `src/renderer/src/panels/terminal/TerminalPanel.tsx`
- Modify: `src/shared/ipc-channels.ts`

- [ ] **Step 1: Update TerminalTabs.tsx with full restyling**

Add: colored status dots, close guard (hide X on last tab), double-click rename, PTY process name polling.

```typescript
// src/renderer/src/panels/terminal/TerminalTabs.tsx
import { useState, useCallback, useRef, useEffect } from 'react'
import { useTerminalStore } from '../../store/terminal-store'
import { colors } from '../../design/tokens'

const ipcRenderer = window.electron.ipcRenderer

interface TerminalTabsProps {
  onNewTab: () => void
}

export function TerminalTabs({ onNewTab }: TerminalTabsProps) {
  const { sessions, activeSessionId, setActiveSession, removeSession, renameSession } =
    useTerminalStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Poll PTY process names to update tab titles
  useEffect(() => {
    const interval = setInterval(async () => {
      for (const session of sessions) {
        try {
          const processName = await ipcRenderer.invoke('terminal:process-name', {
            sessionId: session.id,
          })
          if (processName && processName !== session.title) {
            renameSession(session.id, processName)
          }
        } catch {
          // PTY may not support process name; keep existing title
        }
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [sessions, renameSession])

  const handleDoubleClick = useCallback((id: string, currentTitle: string) => {
    setEditingId(id)
    setEditValue(currentTitle)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const handleRenameConfirm = useCallback(() => {
    if (editingId && editValue.trim()) {
      renameSession(editingId, editValue.trim())
    }
    setEditingId(null)
  }, [editingId, editValue, renameSession])

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleRenameConfirm()
      if (e.key === 'Escape') setEditingId(null)
    },
    [handleRenameConfirm]
  )

  const isLastTab = sessions.length <= 1

  return (
    <div
      className="flex items-center h-8 border-b overflow-x-auto"
      style={{ backgroundColor: colors.bg.surface, borderColor: colors.border.default }}
    >
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId
        const isAgent = session.title.toLowerCase().includes('claude')
        const dotColor = isAgent ? '#A78BFA' : '#34D399'

        return (
          <div
            key={session.id}
            onClick={() => setActiveSession(session.id)}
            onDoubleClick={() => handleDoubleClick(session.id, session.title)}
            className="flex items-center gap-1.5 px-3 py-1 text-xs cursor-pointer border-r transition-colors"
            style={{
              borderColor: colors.border.default,
              backgroundColor: isActive ? colors.bg.elevated : 'transparent',
              color: isActive ? colors.text.primary : colors.text.secondary,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: dotColor, opacity: isActive ? 1 : 0.5 }}
            />
            {editingId === session.id ? (
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleRenameConfirm}
                onKeyDown={handleRenameKeyDown}
                className="bg-transparent border-0 outline-none text-xs w-20"
                style={{ color: colors.text.primary }}
              />
            ) : (
              <span className="truncate max-w-[100px]">{session.title}</span>
            )}
            {!isLastTab && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  removeSession(session.id)
                }}
                className="ml-1 hover:text-white"
                style={{ color: colors.text.muted }}
              >
                x
              </button>
            )}
          </div>
        )
      })}
      <button
        onClick={onNewTab}
        className="px-2 py-1 text-xs transition-colors"
        style={{ color: colors.text.muted }}
      >
        +
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Update TerminalPanel.tsx with Cmd+F search and Cmd+=/- zoom**

Add these modifications to `TerminalPanel.tsx`:

```typescript
// 1. Add state at top of TerminalPanel function:
const [searchOpen, setSearchOpen] = useState(false)
const [searchQuery, setSearchQuery] = useState('')
const [termFontSize, setTermFontSize] = useState(13)
const searchInputRef = useRef<HTMLInputElement>(null)
const searchAddonsRef = useRef<Map<string, SearchAddon>>(new Map())

// 2. In createTerminalInstance, after `const searchAddon = new SearchAddon()`, add:
searchAddonsRef.current.set(sessionId, searchAddon)

// 3. Add keyboard handler useEffect:
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    const isMeta = e.metaKey || e.ctrlKey

    if (isMeta && e.key === 'f') {
      e.preventDefault()
      setSearchOpen((prev) => !prev)
      requestAnimationFrame(() => searchInputRef.current?.focus())
    }

    if (isMeta && e.key === '=') {
      e.preventDefault()
      setTermFontSize((prev) => {
        const next = Math.min(prev + 1, 28)
        for (const [, instance] of instancesRef.current) {
          instance.terminal.options.fontSize = next
          instance.fitAddon.fit()
        }
        return next
      })
    }

    if (isMeta && e.key === '-') {
      e.preventDefault()
      setTermFontSize((prev) => {
        const next = Math.max(prev - 1, 8)
        for (const [, instance] of instancesRef.current) {
          instance.terminal.options.fontSize = next
          instance.fitAddon.fit()
        }
        return next
      })
    }
  }

  const container = containerRef.current
  if (container) {
    container.addEventListener('keydown', handler)
    return () => container.removeEventListener('keydown', handler)
  }
}, [])

// 4. Add search execution effect:
useEffect(() => {
  if (!activeSessionId || !searchQuery) return
  const addon = searchAddonsRef.current.get(activeSessionId)
  if (addon) addon.findNext(searchQuery)
}, [searchQuery, activeSessionId])

// 5. Insert search bar JSX after <TerminalTabs onNewTab={handleNewTab} />:
{searchOpen && (
  <div
    className="flex items-center gap-2 px-2 py-1 border-b"
    style={{ borderColor: colors.border.default, backgroundColor: colors.bg.surface }}
  >
    <input
      ref={searchInputRef}
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const addon = activeSessionId
            ? searchAddonsRef.current.get(activeSessionId) : null
          if (addon) addon.findNext(searchQuery)
        }
        if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery('') }
      }}
      placeholder="Search terminal..."
      className="flex-1 text-xs bg-transparent border rounded px-2 py-0.5 outline-none"
      style={{ borderColor: colors.border.default, color: colors.text.primary }}
    />
    <button
      onClick={() => { setSearchOpen(false); setSearchQuery('') }}
      className="text-xs"
      style={{ color: colors.text.muted }}
    >
      x
    </button>
  </div>
)}
```

- [ ] **Step 3: Add terminal:process-name to IPC type definitions**

```typescript
// Add to IpcChannels in src/shared/ipc-channels.ts:
  'terminal:process-name': { request: { sessionId: string }; response: string | null }
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/terminal/TerminalTabs.tsx src/renderer/src/panels/terminal/TerminalPanel.tsx src/shared/ipc-channels.ts
git commit -m "feat: restyle terminal tabs with close guard, rename, search, and zoom"
```

---

### Task 29: Wire GraphPanel to consume graph-settings-store

**Files:**
- Modify: `src/renderer/src/panels/graph/GraphPanel.tsx`
- Modify: `src/renderer/src/panels/graph/GraphRenderer.ts`

- [ ] **Step 1: Update GraphPanel to read settings from useGraphSettingsStore**

Import `useGraphSettingsStore` and pass its values to the simulation and render calls. The settings store controls force parameters, filter toggles, display options, and group visibility.

```typescript
// In GraphPanel.tsx, add imports:
import { useGraphSettingsStore } from '../../store/graph-settings-store'
import { GraphSettingsPanel } from './GraphSettingsPanel'

// At top of GraphPanel function, add state and read settings:
const [settingsOpen, setSettingsOpen] = useState(false)

const {
  showOrphans, showExistingOnly,
  baseNodeSize, linkOpacity, linkThickness, showArrows,
  textFadeThreshold, isAnimating,
  centerForce, repelForce, linkForce: linkForceStrength, linkDistance,
  groups,
} = useGraphSettingsStore()

// Replace the render callback to pass display settings:
const render = useCallback(() => {
  const canvas = canvasRef.current
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.save()
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const t = transformRef.current
  ctx.translate(t.x, t.y)
  ctx.scale(t.k, t.k)
  renderGraph(
    ctx, nodesRef.current, edgesRef.current,
    canvas.width, canvas.height, selectedNodeId, hoveredNodeId,
    {
      baseNodeSize,
      linkOpacity,
      linkThickness,
      showArrows,
      textFadeThreshold,
      zoomLevel: t.k,
      groupColors: Object.fromEntries(
        Object.entries(groups).map(([type, cfg]) => [type, cfg.color])
      ) as Record<string, string>,
    }
  )
  ctx.restore()
}, [selectedNodeId, hoveredNodeId, baseNodeSize, linkOpacity, linkThickness,
    showArrows, textFadeThreshold, groups])

// Replace the simulation creation useEffect to apply filters and configurable forces:
useEffect(() => {
  const canvas = canvasRef.current
  if (!canvas) return

  const graph = getGraph()

  // Apply filters
  let filteredNodes = graph.nodes
  if (!showOrphans) {
    const connectedIds = new Set(graph.edges.flatMap((e) => [e.source, e.target]))
    filteredNodes = filteredNodes.filter((n) => connectedIds.has(n.id))
  }
  if (showExistingOnly) {
    const filePaths = new Set(useVaultStore.getState().files.map((f) => f.path))
    filteredNodes = filteredNodes.filter((n) => filePaths.has(n.id))
  }
  filteredNodes = filteredNodes.filter((n) => groups[n.type]?.visible !== false)

  const nodeIds = new Set(filteredNodes.map((n) => n.id))
  const nodes: SimNode[] = filteredNodes.map((n) => ({
    ...n,
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
  }))
  const edges: SimEdge[] = graph.edges
    .filter((e) => nodeIds.has(e.source as string) && nodeIds.has(e.target as string))
    .map((e) => ({ ...e }))

  nodesRef.current = nodes
  edgesRef.current = edges

  let sim: ReturnType<typeof createSimulation> | null = null
  if (nodes.length > 0) {
    sim = createSimulation(nodes, edges, canvas.width, canvas.height, {
      centerForce, repelForce, linkForce: linkForceStrength, linkDistance,
    })
    sim.on('tick', render)
    if (!isAnimating) sim.stop()
    simRef.current = sim
  } else {
    render()
  }

  const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([0.1, 4])
    .on('zoom', (event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
      transformRef.current = event.transform
      render()
    })

  const selection = select(canvas).call(zoomBehavior)
  return () => { sim?.stop(); selection.on('.zoom', null) }
}, [getGraph, render, showOrphans, showExistingOnly, groups,
    centerForce, repelForce, linkForceStrength, linkDistance, isAnimating])
```

Add settings toggle button and panel to the return JSX:

```typescript
// In the return JSX, inside the existing relative div, add before isEmpty check:

<button
  onClick={() => setSettingsOpen((prev) => !prev)}
  className="absolute top-3 right-3 z-10 w-7 h-7 flex items-center justify-center rounded transition-colors"
  style={{
    backgroundColor: colors.bg.surface,
    border: `1px solid ${colors.border.default}`,
    color: colors.text.muted,
  }}
  title="Graph Settings"
>
  S
</button>

<GraphSettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
```

- [ ] **Step 2: Update createSimulation to accept configurable force parameters**

```typescript
// In GraphRenderer.ts, update createSimulation:
interface SimulationConfig {
  centerForce: number
  repelForce: number
  linkForce: number
  linkDistance: number
}

export function createSimulation(
  nodes: SimNode[],
  edges: SimEdge[],
  width: number,
  height: number,
  config: SimulationConfig = { centerForce: 0.5, repelForce: -120, linkForce: 0.3, linkDistance: 30 }
): Simulation<SimNode, SimEdge> {
  return forceSimulation<SimNode>(nodes)
    .force(
      'link',
      forceLink<SimNode, SimEdge>(edges)
        .id((d) => d.id)
        .strength(config.linkForce)
        .distance(config.linkDistance)
    )
    .force('charge', forceManyBody<SimNode>().strength(config.repelForce))
    .force('center', forceCenter(width / 2, height / 2).strength(config.centerForce))
    .force('collide', forceCollide<SimNode>().radius((d) => nodeRadius(d.connectionCount) + 4))
}
```

- [ ] **Step 3: Update renderGraph to accept display settings**

```typescript
// In GraphRenderer.ts, add RenderConfig interface and update renderGraph:
interface RenderConfig {
  baseNodeSize: number
  linkOpacity: number
  linkThickness: number
  showArrows: boolean
  textFadeThreshold: number
  zoomLevel: number
  groupColors: Record<string, string>
}

export function renderGraph(
  ctx: CanvasRenderingContext2D,
  nodes: SimNode[],
  edges: SimEdge[],
  width: number,
  height: number,
  selectedId: string | null,
  hoveredId: string | null,
  config: RenderConfig = {
    baseNodeSize: 4, linkOpacity: 0.4, linkThickness: 1,
    showArrows: false, textFadeThreshold: 1.5, zoomLevel: 1, groupColors: {},
  }
): void {
  ctx.clearRect(0, 0, width, height)

  const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2)
  gradient.addColorStop(0, '#111113')
  gradient.addColorStop(1, colors.bg.base)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  // Edges with configurable opacity and thickness
  for (const edge of edges) {
    const source = edge.source as SimNode
    const target = edge.target as SimNode
    if (!source.x || !target.x) continue

    ctx.beginPath()
    ctx.moveTo(source.x, source.y)
    ctx.lineTo(target.x, target.y)
    ctx.globalAlpha = config.linkOpacity
    ctx.lineWidth = config.linkThickness

    switch (edge.kind) {
      case 'connection': ctx.strokeStyle = colors.border.default; ctx.setLineDash([]); break
      case 'cluster': ctx.strokeStyle = colors.semantic.cluster; ctx.setLineDash([]); break
      case 'tension': ctx.strokeStyle = colors.semantic.tension; ctx.setLineDash([4, 4]); break
      case 'appears_in': ctx.strokeStyle = '#3A3A3E'; ctx.setLineDash([]); break
    }
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1

    if (config.showArrows) {
      const dx = (target.x ?? 0) - (source.x ?? 0)
      const dy = (target.y ?? 0) - (source.y ?? 0)
      const angle = Math.atan2(dy, dx)
      const arrowLen = 6
      const targetR = nodeRadius((target as SimNode).connectionCount ?? 0)
      const ax = (target.x ?? 0) - Math.cos(angle) * targetR
      const ay = (target.y ?? 0) - Math.sin(angle) * targetR
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(ax - arrowLen * Math.cos(angle - 0.4), ay - arrowLen * Math.sin(angle - 0.4))
      ctx.lineTo(ax - arrowLen * Math.cos(angle + 0.4), ay - arrowLen * Math.sin(angle + 0.4))
      ctx.closePath()
      ctx.fillStyle = ctx.strokeStyle
      ctx.globalAlpha = config.linkOpacity
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }

  // Nodes with configurable size and group colors
  for (const node of nodes) {
    if (!node.x || !node.y) continue
    const baseR = nodeRadius(node.connectionCount)
    const r = baseR * (config.baseNodeSize / 4)
    const color = config.groupColors[node.type] || ARTIFACT_COLORS[node.type] || ARTIFACT_COLORS.note
    const opacity = SIGNAL_OPACITY[node.signal] || 0.4
    const isSelected = node.id === selectedId
    const isHovered = node.id === hoveredId

    if (isSelected || isHovered) { ctx.shadowColor = color; ctx.shadowBlur = 12 }

    ctx.beginPath()
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.globalAlpha = opacity
    ctx.fill()
    ctx.globalAlpha = 1

    if (isSelected) { ctx.strokeStyle = colors.accent.default; ctx.lineWidth = 2; ctx.stroke() }

    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0

    const showLabel = isHovered || config.zoomLevel >= config.textFadeThreshold
    if (showLabel) {
      ctx.fillStyle = colors.text.primary
      ctx.font = '12px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.globalAlpha = isHovered ? 1 : Math.min(1, (config.zoomLevel - config.textFadeThreshold) / 0.5)
      ctx.fillText(node.title, node.x, node.y - r - 6)
      ctx.globalAlpha = 1
    }
  }
}
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/graph/GraphPanel.tsx src/renderer/src/panels/graph/GraphRenderer.ts
git commit -m "feat: wire GraphPanel to consume graph-settings-store for forces, filters, and display"
```

---

## Chunk 5: Phase 3 — Interaction

### Task 30: Create useGraphHighlight hook (hover/click state machine)

**Files:**
- Create: `src/renderer/src/panels/graph/useGraphHighlight.ts`
- Test: `tests/graph/useGraphHighlight.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/graph/useGraphHighlight.test.ts
import { describe, it, expect } from 'vitest'
import { buildAdjacencyList, computeConnectedSet, easeOut, interpolateGlow } from '../../src/renderer/src/panels/graph/useGraphHighlight'
import type { SimEdge } from '../../src/renderer/src/panels/graph/GraphRenderer'

describe('buildAdjacencyList', () => {
  const edges: SimEdge[] = [
    { source: 'a', target: 'b', kind: 'connection' },
    { source: 'b', target: 'c', kind: 'cluster' },
    { source: 'a', target: 'c', kind: 'tension' },
  ]

  it('builds bidirectional adjacency from edges with string IDs', () => {
    const adj = buildAdjacencyList(edges)
    expect(adj.get('a')).toEqual(new Set(['b', 'c']))
    expect(adj.get('b')).toEqual(new Set(['a', 'c']))
    expect(adj.get('c')).toEqual(new Set(['b', 'a']))
  })

  it('handles edges where source/target are SimNode objects', () => {
    const objEdges: SimEdge[] = [
      { source: { id: 'x', title: 'X', type: 'note', signal: 'untested', connectionCount: 0, x: 0, y: 0 } as any, target: { id: 'y', title: 'Y', type: 'note', signal: 'untested', connectionCount: 0, x: 0, y: 0 } as any, kind: 'connection' },
    ]
    const adj = buildAdjacencyList(objEdges)
    expect(adj.get('x')).toEqual(new Set(['y']))
    expect(adj.get('y')).toEqual(new Set(['x']))
  })

  it('returns empty map for no edges', () => {
    const adj = buildAdjacencyList([])
    expect(adj.size).toBe(0)
  })
})

describe('computeConnectedSet', () => {
  const adj = new Map<string, Set<string>>([
    ['a', new Set(['b', 'c'])],
    ['b', new Set(['a', 'c'])],
    ['c', new Set(['b', 'a'])],
    ['d', new Set(['e'])],
    ['e', new Set(['d'])],
  ])

  it('returns the node itself and its immediate neighbors', () => {
    const result = computeConnectedSet('a', adj)
    expect(result).toEqual(new Set(['a', 'b', 'c']))
  })

  it('returns singleton set for a node with no neighbors', () => {
    const result = computeConnectedSet('z', adj)
    expect(result).toEqual(new Set(['z']))
  })

  it('returns correct set for isolated cluster', () => {
    const result = computeConnectedSet('d', adj)
    expect(result).toEqual(new Set(['d', 'e']))
  })
})

describe('easeOut', () => {
  it('returns 0 at t=0', () => {
    expect(easeOut(0)).toBe(0)
  })

  it('returns 1 at t=1', () => {
    expect(easeOut(1)).toBe(1)
  })

  it('returns values between 0 and 1 for intermediate t', () => {
    const mid = easeOut(0.5)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
  })

  it('decelerates (second half covers less distance than first)', () => {
    const firstHalf = easeOut(0.5) - easeOut(0)
    const secondHalf = easeOut(1) - easeOut(0.5)
    expect(firstHalf).toBeGreaterThan(secondHalf)
  })
})

describe('interpolateGlow', () => {
  it('returns startValue at elapsed=0', () => {
    const result = interpolateGlow(0, 1, 1000, 1000)
    expect(result.value).toBe(0)
    expect(result.done).toBe(false)
  })

  it('returns target when fully elapsed (fade-in, 200ms)', () => {
    const result = interpolateGlow(0, 1, 1000, 1200)
    expect(result.value).toBe(1)
    expect(result.done).toBe(true)
  })

  it('returns target when fully elapsed (fade-out, 300ms)', () => {
    const result = interpolateGlow(1, 0, 1000, 1300)
    expect(result.value).toBe(0)
    expect(result.done).toBe(true)
  })

  it('interpolates partially for mid-transition', () => {
    // 100ms into a 200ms fade-in
    const result = interpolateGlow(0, 1, 1000, 1100)
    expect(result.value).toBeGreaterThan(0)
    expect(result.value).toBeLessThan(1)
    expect(result.done).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/graph/useGraphHighlight.test.ts`
Expected: FAIL with "cannot find module" or export not found

- [ ] **Step 3: Implement the hook and pure functions**

```typescript
// src/renderer/src/panels/graph/useGraphHighlight.ts
import { useRef, useCallback, useMemo, useState, useEffect } from 'react'
import { useGraphStore } from '../../store/graph-store'
import type { SimNode, SimEdge } from './GraphRenderer'

export type HighlightMode = 'idle' | 'hover' | 'click'

export interface HighlightState {
  mode: HighlightMode
  focusedNodeId: string | null
  connectedSet: ReadonlySet<string>
  /** Current glow intensity 0-1, interpolated over time per spec 3A */
  glowIntensity: number
}

const EMPTY_SET: ReadonlySet<string> = new Set()

// Spec 3A: 200ms ease-out in, 300ms ease-out out
const GLOW_FADE_IN_MS = 200
const GLOW_FADE_OUT_MS = 300

function getEdgeNodeId(node: string | SimNode): string {
  return typeof node === 'string' ? node : node.id
}

export function buildAdjacencyList(edges: readonly SimEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>()
  for (const edge of edges) {
    const sourceId = getEdgeNodeId(edge.source)
    const targetId = getEdgeNodeId(edge.target)

    if (!adj.has(sourceId)) adj.set(sourceId, new Set())
    if (!adj.has(targetId)) adj.set(targetId, new Set())

    adj.get(sourceId)!.add(targetId)
    adj.get(targetId)!.add(sourceId)
  }
  return adj
}

export function computeConnectedSet(
  nodeId: string,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>
): ReadonlySet<string> {
  const neighbors = adjacency.get(nodeId)
  if (!neighbors) return new Set([nodeId])
  return new Set([nodeId, ...neighbors])
}

/**
 * Easing function: ease-out (decelerate).
 * Used for both fade-in and fade-out glow transitions per spec 3A.
 */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 2)
}

/**
 * Interpolates glow intensity from startValue toward target over the
 * appropriate duration (200ms in, 300ms out). Returns the new value
 * and whether the transition is still active.
 */
export function interpolateGlow(
  startValue: number,
  target: number,
  startTime: number,
  now: number
): { value: number; done: boolean } {
  const duration = target > startValue ? GLOW_FADE_IN_MS : GLOW_FADE_OUT_MS
  const elapsed = now - startTime
  const progress = Math.min(1, elapsed / duration)
  const eased = easeOut(progress)
  const value = startValue + (target - startValue) * eased
  return { value, done: progress >= 1 }
}

export function useGraphHighlight(edges: readonly SimEdge[]) {
  const { selectedNodeId, hoveredNodeId, setSelectedNode, setHoveredNode } = useGraphStore()
  const clickLockedRef = useRef<string | null>(null)

  // Glow interpolation state (spec 3A: 200ms ease-out in, 300ms ease-out out)
  const glowRef = useRef({
    current: 0,      // current interpolated intensity 0-1
    target: 0,       // target intensity (1 when focused, 0 when idle)
    startTime: 0,    // timestamp when transition started
    startValue: 0,   // intensity at transition start
  })
  const rafRef = useRef<number | null>(null)
  const [glowIntensity, setGlowIntensity] = useState(0)

  const adjacency = useMemo(() => buildAdjacencyList(edges), [edges])

  const focusedNodeId = clickLockedRef.current ?? hoveredNodeId
  const mode: HighlightMode = clickLockedRef.current
    ? 'click'
    : hoveredNodeId
      ? 'hover'
      : 'idle'

  const connectedSet = useMemo(() => {
    if (!focusedNodeId) return EMPTY_SET
    return computeConnectedSet(focusedNodeId, adjacency)
  }, [focusedNodeId, adjacency])

  // Drive glow interpolation via rAF
  const tickGlow = useCallback(() => {
    const g = glowRef.current
    const now = performance.now()
    const { value, done } = interpolateGlow(g.startValue, g.target, g.startTime, now)

    g.current = value
    setGlowIntensity(value)

    if (!done) {
      rafRef.current = requestAnimationFrame(tickGlow)
    } else {
      rafRef.current = null
    }
  }, [])

  // Start a new glow transition whenever the target changes
  const setGlowTarget = useCallback(
    (target: number) => {
      const g = glowRef.current
      if (target === g.target) return
      g.startValue = g.current
      g.target = target
      g.startTime = performance.now()
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(tickGlow)
      }
    },
    [tickGlow]
  )

  // Update glow target when focus changes
  useEffect(() => {
    setGlowTarget(focusedNodeId ? 1 : 0)
  }, [focusedNodeId, setGlowTarget])

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const handleHover = useCallback(
    (nodeId: string | null) => {
      setHoveredNode(nodeId)
    },
    [setHoveredNode]
  )

  const handleClick = useCallback(
    (nodeId: string | null) => {
      if (nodeId) {
        clickLockedRef.current = nodeId
        setSelectedNode(nodeId)
      } else {
        // Clicked empty canvas: deselect
        clickLockedRef.current = null
        setSelectedNode(null)
      }
    },
    [setSelectedNode]
  )

  const handleDoubleClick = useCallback(
    (nodeId: string) => {
      clickLockedRef.current = null
      setSelectedNode(null)
      setHoveredNode(null)
    },
    [setSelectedNode, setHoveredNode]
  )

  const state: HighlightState = { mode, focusedNodeId, connectedSet, glowIntensity }

  return {
    state,
    adjacency,
    handleHover,
    handleClick,
    handleDoubleClick,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/graph/useGraphHighlight.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing

- [ ] **Step 6: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/graph/useGraphHighlight.ts tests/graph/useGraphHighlight.test.ts
git commit -m "feat: add useGraphHighlight hook with adjacency list and connected set computation"
```

---

### Task 31: Create glow sprite cache

**Files:**
- Create: `src/renderer/src/panels/graph/glowSprites.ts`
- Test: `tests/graph/glowSprites.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/graph/glowSprites.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { GlowSpriteCache } from '../../src/renderer/src/panels/graph/glowSprites'

// Mock OffscreenCanvas for Node test environment
class MockOffscreenCanvas {
  width: number
  height: number
  private _ctx: any

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this._ctx = {
      clearRect: () => {},
      beginPath: () => {},
      arc: () => {},
      fill: () => {},
      shadowColor: '',
      shadowBlur: 0,
      fillStyle: '',
      globalAlpha: 1,
    }
  }

  getContext() {
    return this._ctx
  }

  transferToImageBitmap() {
    return { width: this.width, height: this.height, close: () => {} }
  }
}

// @ts-expect-error Polyfill for test environment
globalThis.OffscreenCanvas = MockOffscreenCanvas

describe('GlowSpriteCache', () => {
  let cache: GlowSpriteCache

  beforeEach(() => {
    cache = new GlowSpriteCache()
  })

  it('creates a sprite for a given color and radius', () => {
    const sprite = cache.get('#6C63FF', 5)
    expect(sprite).toBeDefined()
    expect(sprite.width).toBeGreaterThan(0)
  })

  it('returns the same sprite for repeated calls with same params', () => {
    const sprite1 = cache.get('#6C63FF', 5)
    const sprite2 = cache.get('#6C63FF', 5)
    expect(sprite1).toBe(sprite2)
  })

  it('returns different sprites for different colors', () => {
    const sprite1 = cache.get('#6C63FF', 5)
    const sprite2 = cache.get('#EF4444', 5)
    expect(sprite1).not.toBe(sprite2)
  })

  it('returns different sprites for different radii', () => {
    const sprite1 = cache.get('#6C63FF', 5)
    const sprite2 = cache.get('#6C63FF', 10)
    expect(sprite1).not.toBe(sprite2)
  })

  it('clears all cached sprites', () => {
    cache.get('#6C63FF', 5)
    cache.get('#EF4444', 5)
    cache.clear()
    // After clear, a new call should create a fresh sprite
    const sprite = cache.get('#6C63FF', 5)
    expect(sprite).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/graph/glowSprites.test.ts`
Expected: FAIL with "cannot find module"

- [ ] **Step 3: Implement the glow sprite cache**

```typescript
// src/renderer/src/panels/graph/glowSprites.ts

interface GlowSprite {
  bitmap: ImageBitmap | { width: number; height: number; close: () => void }
  width: number
  height: number
}

const GLOW_PADDING = 16
const AMBIENT_BLUR = 8

function makeCacheKey(color: string, radius: number): string {
  return `${color}:${radius}`
}

export class GlowSpriteCache {
  private cache = new Map<string, GlowSprite>()

  get(color: string, radius: number): GlowSprite {
    const key = makeCacheKey(color, radius)
    const existing = this.cache.get(key)
    if (existing) return existing

    const sprite = createGlowSprite(color, radius)
    this.cache.set(key, sprite)
    return sprite
  }

  clear(): void {
    for (const sprite of this.cache.values()) {
      if ('close' in sprite.bitmap) {
        sprite.bitmap.close()
      }
    }
    this.cache.clear()
  }
}

function createGlowSprite(color: string, radius: number): GlowSprite {
  const size = (radius + GLOW_PADDING) * 2
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to get 2d context from OffscreenCanvas')
  }

  const cx = size / 2
  const cy = size / 2

  ctx.clearRect(0, 0, size, size)

  // Draw the ambient glow
  ctx.shadowColor = color
  ctx.shadowBlur = AMBIENT_BLUR
  ctx.fillStyle = color
  ctx.globalAlpha = 0.3

  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fill()

  // Reset shadow for the solid core
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.globalAlpha = 1.0

  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fill()

  const bitmap = canvas.transferToImageBitmap()
  return { bitmap, width: size, height: size }
}

export function drawGlowSprite(
  ctx: CanvasRenderingContext2D,
  sprite: GlowSprite,
  x: number,
  y: number,
  alpha: number
): void {
  const prevAlpha = ctx.globalAlpha
  ctx.globalAlpha = alpha
  ctx.drawImage(
    sprite.bitmap as ImageBitmap,
    x - sprite.width / 2,
    y - sprite.height / 2
  )
  ctx.globalAlpha = prevAlpha
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/graph/glowSprites.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/graph/glowSprites.ts tests/graph/glowSprites.test.ts
git commit -m "feat: add offscreen canvas glow sprite cache for graph node rendering"
```

---

### Task 32: Enhance GraphRenderer with glow sprites, dimming, edge brightening, labels, frame budget, and edge LOD

**Files:**
- Modify: `src/renderer/src/panels/graph/GraphRenderer.ts`

- [ ] **Step 1: Rewrite renderGraph with highlight-aware rendering, frame budget monitoring, and edge LOD**

Replace the entire `renderGraph` function and add the new `computeNodeRadius` function. Keep `createSimulation`, `SimNode`, `SimEdge`, and `findNodeAt` unchanged. Key changes from spec:
- **NodeSizeMode**: imported from `graph-settings-store` (canonical location) and re-exported (issue #27)
- **Extreme zoom-out edge LOD** (spec 3E): at `k < 0.2`, edges are drawn as a single low-alpha overlay instead of individually
- **Frame budget monitoring** (spec 3E): `performance.now()` instrumentation, warns when frame exceeds 16ms, returns frame duration for adaptive quality reduction
- **Adaptive quality**: `skipAmbientSprites` option allows caller to skip glow sprites when budget is exceeded

```typescript
// src/renderer/src/panels/graph/GraphRenderer.ts
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation
} from 'd3-force'
import type { GraphNode, RelationshipKind } from '@shared/types'
import { ARTIFACT_COLORS, colors } from '../../design/tokens'
import { SIGNAL_OPACITY } from '@shared/types'
import { GlowSpriteCache, drawGlowSprite } from './glowSprites'
import type { HighlightState } from './useGraphHighlight'
// NodeSizeMode is canonically defined in graph-settings-store (single source of truth)
import type { NodeSizeMode } from '../../store/graph-settings-store'
export type { NodeSizeMode }

export interface SimNode extends GraphNode {
  x: number
  y: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

export interface SimEdge {
  source: string | SimNode
  target: string | SimNode
  kind: RelationshipKind
}

const LINK_STRENGTH: Record<RelationshipKind, number> = {
  connection: 0.3,
  cluster: 0.6,
  tension: -0.2,
  appears_in: 0.2
}

export interface NodeSizeConfig {
  mode: NodeSizeMode
  baseSize: number
}

const DEFAULT_SIZE_CONFIG: NodeSizeConfig = { mode: 'degree', baseSize: 4 }

export function createSimulation(
  nodes: SimNode[],
  edges: SimEdge[],
  width: number,
  height: number
): Simulation<SimNode, SimEdge> {
  return forceSimulation<SimNode>(nodes)
    .force(
      'link',
      forceLink<SimNode, SimEdge>(edges)
        .id((d) => d.id)
        .strength((d) => Math.abs(LINK_STRENGTH[d.kind]))
    )
    .force('charge', forceManyBody<SimNode>().strength(-120))
    .force('center', forceCenter(width / 2, height / 2))
    .force(
      'collide',
      forceCollide<SimNode>().radius((d) => computeNodeRadius(d, DEFAULT_SIZE_CONFIG) + 4)
    )
}

export function computeNodeRadius(
  node: Pick<SimNode, 'connectionCount'>,
  config: NodeSizeConfig,
  charCount?: number
): number {
  const base = config.baseSize
  switch (config.mode) {
    case 'uniform':
      return base
    case 'content': {
      const chars = charCount ?? 500
      return base + Math.log(Math.max(chars, 100) / 100) * 2
    }
    case 'degree':
    default:
      return base + Math.sqrt(node.connectionCount) * 2.5
  }
}

// Legacy alias used by findNodeAt and collide force
export function nodeRadius(connectionCount: number): number {
  return computeNodeRadius({ connectionCount }, DEFAULT_SIZE_CONFIG)
}

const spriteCache = new GlowSpriteCache()

const EDGE_COLOR_MAP: Record<RelationshipKind, { color: string; width: number; dash: number[] }> = {
  connection: { color: colors.border.default, width: 1, dash: [] },
  cluster: { color: colors.semantic.cluster + '66', width: 1.5, dash: [] },
  tension: { color: colors.semantic.tension + '66', width: 1, dash: [4, 4] },
  appears_in: { color: '#3A3A3E', width: 1, dash: [] },
}

const HIGHLIGHT_EDGE_WIDTH = 1.5
const HIGHLIGHT_EDGE_ALPHA = 0.7
const DIM_ALPHA = 0.08
const HOVER_SHADOW_BLUR = 14
const LABEL_FONT = '12px Inter, sans-serif'
const SELECTED_RING_OFFSET = 4
const SELECTED_RING_ALPHA = 0.4

function getEdgeNodeId(node: string | SimNode): string {
  return typeof node === 'string' ? node : node.id
}

interface RenderOptions {
  highlight: HighlightState
  sizeConfig: NodeSizeConfig
  transform: { x: number; y: number; k: number }
  canvasWidth: number
  canvasHeight: number
  reducedMotion: boolean
  /** When true, skip ambient glow sprites to reduce frame time (adaptive quality) */
  skipAmbientSprites?: boolean
}

/**
 * Render one frame of the graph. Returns the frame duration in ms for
 * budget monitoring (spec 3E). Caller should set skipAmbientSprites=true
 * on the next frame if the returned duration exceeds 16ms.
 */
export function renderGraph(
  ctx: CanvasRenderingContext2D,
  nodes: readonly SimNode[],
  edges: readonly SimEdge[],
  width: number,
  height: number,
  selectedId: string | null,
  hoveredId: string | null,
  options?: RenderOptions
): number {
  ctx.clearRect(0, 0, width, height)

  // Background gradient
  const gradient = ctx.createRadialGradient(
    width / 2, height / 2, 0,
    width / 2, height / 2, width / 2
  )
  gradient.addColorStop(0, '#111113')
  gradient.addColorStop(1, colors.bg.base)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  const hasHighlight = options?.highlight.mode !== 'idle' && options?.highlight.focusedNodeId
  const connectedSet = options?.highlight.connectedSet ?? new Set<string>()
  const sizeConfig = options?.sizeConfig ?? DEFAULT_SIZE_CONFIG

  // Viewport culling bounds (in graph-space coordinates)
  let cullMinX = -Infinity
  let cullMinY = -Infinity
  let cullMaxX = Infinity
  let cullMaxY = Infinity
  if (options?.transform) {
    const t = options.transform
    const cw = options.canvasWidth / window.devicePixelRatio
    const ch = options.canvasHeight / window.devicePixelRatio
    cullMinX = -t.x / t.k
    cullMinY = -t.y / t.k
    cullMaxX = cullMinX + cw / t.k
    cullMaxY = cullMinY + ch / t.k
  }

  const CULL_MARGIN = 40 // extra margin for glow overflow

  // --- Frame budget monitoring (spec 3E) ---
  const frameStart = performance.now()

  // --- Extreme zoom-out edge LOD (spec 3E) ---
  // At k < 0.2, draw a single low-alpha overlay instead of individual edges
  const zoomK = options?.transform.k ?? 1
  const useEdgeOverlay = zoomK < 0.2

  if (useEdgeOverlay && edges.length > 0) {
    // Draw all edges as a single batch with very low alpha
    ctx.beginPath()
    for (const edge of edges) {
      const source = edge.source as SimNode
      const target = edge.target as SimNode
      if (!source.x || !target.x) continue
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(target.x, target.y)
    }
    ctx.strokeStyle = colors.border.default
    ctx.lineWidth = 0.5
    ctx.globalAlpha = 0.06
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // --- Draw edges (individual, skipped at extreme zoom-out) ---
  if (!useEdgeOverlay)
  for (const edge of edges) {
    const source = edge.source as SimNode
    const target = edge.target as SimNode
    if (!source.x || !target.x) continue

    // Cull edges fully outside viewport
    const edgeMinX = Math.min(source.x, target.x)
    const edgeMaxX = Math.max(source.x, target.x)
    const edgeMinY = Math.min(source.y, target.y)
    const edgeMaxY = Math.max(source.y, target.y)
    if (
      edgeMaxX < cullMinX - CULL_MARGIN || edgeMinX > cullMaxX + CULL_MARGIN ||
      edgeMaxY < cullMinY - CULL_MARGIN || edgeMinY > cullMaxY + CULL_MARGIN
    ) continue

    const sourceId = getEdgeNodeId(edge.source)
    const targetId = getEdgeNodeId(edge.target)
    const isConnected = hasHighlight && connectedSet.has(sourceId) && connectedSet.has(targetId)

    ctx.beginPath()
    ctx.moveTo(source.x, source.y)
    ctx.lineTo(target.x, target.y)

    if (hasHighlight) {
      if (isConnected) {
        // Highlighted edge: accent color, brighter
        ctx.strokeStyle = colors.accent.default
        ctx.lineWidth = HIGHLIGHT_EDGE_WIDTH
        ctx.globalAlpha = HIGHLIGHT_EDGE_ALPHA
        ctx.setLineDash([])
      } else {
        // Dimmed edge
        const style = EDGE_COLOR_MAP[edge.kind]
        ctx.strokeStyle = style.color
        ctx.lineWidth = style.width
        ctx.globalAlpha = DIM_ALPHA
        ctx.setLineDash(style.dash)
      }
    } else {
      const style = EDGE_COLOR_MAP[edge.kind]
      ctx.strokeStyle = style.color
      ctx.lineWidth = style.width
      ctx.globalAlpha = 0.4
      ctx.setLineDash(style.dash)
    }

    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  // --- LOD: determine detail level based on zoom ---
  const zoomLevel = options?.transform.k ?? 1
  const isLowDetail = zoomLevel < 0.4
  const showLabelsAtZoom = zoomLevel >= 1.0

  // --- Draw nodes ---
  for (const node of nodes) {
    if (!node.x || !node.y) continue

    const r = computeNodeRadius(node, sizeConfig)

    // Cull nodes outside viewport
    if (
      node.x + r < cullMinX - CULL_MARGIN || node.x - r > cullMaxX + CULL_MARGIN ||
      node.y + r < cullMinY - CULL_MARGIN || node.y - r > cullMaxY + CULL_MARGIN
    ) continue

    const color = ARTIFACT_COLORS[node.type] || ARTIFACT_COLORS.note
    const opacity = SIGNAL_OPACITY[node.signal] || 0.4
    const isSelected = node.id === selectedId
    const isHovered = node.id === hoveredId
    const isFocused = node.id === options?.highlight.focusedNodeId
    const isInConnected = hasHighlight && connectedSet.has(node.id)

    // Determine effective alpha
    let nodeAlpha = opacity
    if (hasHighlight && !isInConnected) {
      nodeAlpha = DIM_ALPHA
    }

    if (isLowDetail) {
      // LOD: simple fillRect for very zoomed-out views
      ctx.fillStyle = color
      ctx.globalAlpha = nodeAlpha
      const size = Math.max(2, r * 0.8)
      ctx.fillRect(node.x - size / 2, node.y - size / 2, size, size)
      ctx.globalAlpha = 1
      continue
    }

    // Ambient glow via sprite (idle, non-dimmed nodes)
    // Skipped when adaptive quality reduction is active (spec 3E)
    if ((!hasHighlight || isInConnected) && !options?.skipAmbientSprites) {
      const sprite = spriteCache.get(color, Math.round(r))
      drawGlowSprite(ctx, sprite, node.x, node.y, nodeAlpha * 0.6)
    }

    // Real-time shadowBlur for hovered/focused node and connected neighbors
    if ((isFocused || (isInConnected && hasHighlight)) && !options?.reducedMotion) {
      ctx.shadowColor = color
      ctx.shadowBlur = isFocused ? HOVER_SHADOW_BLUR + 2 : HOVER_SHADOW_BLUR
    }

    // Draw node circle
    ctx.beginPath()
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.globalAlpha = nodeAlpha
    ctx.fill()
    ctx.globalAlpha = 1

    // Selected node outer ring
    if (isSelected) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, r + SELECTED_RING_OFFSET, 0, Math.PI * 2)
      ctx.strokeStyle = colors.accent.default
      ctx.lineWidth = 2
      ctx.globalAlpha = SELECTED_RING_ALPHA
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // Reset shadow
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0

    // Labels: show on hovered/focused node and connected neighbors
    const shouldShowLabel =
      (isFocused || isHovered || (isInConnected && hasHighlight)) && showLabelsAtZoom
    if (shouldShowLabel) {
      ctx.fillStyle = colors.text.primary
      ctx.font = LABEL_FONT
      ctx.textAlign = 'center'
      ctx.globalAlpha = isFocused ? 1.0 : 0.85
      ctx.fillText(node.title, node.x, node.y - r - 6)
      ctx.globalAlpha = 1
    }
  }

  // --- Frame budget monitoring (spec 3E) ---
  // Target: 16ms (60fps). If exceeded, log warning and reduce quality next frame.
  const frameEnd = performance.now()
  const frameDuration = frameEnd - frameStart
  if (frameDuration > 16) {
    console.warn(
      `[GraphRenderer] Frame budget exceeded: ${frameDuration.toFixed(1)}ms (target: 16ms, nodes: ${nodes.length}, edges: ${edges.length})`
    )
  }

  return frameDuration
}

export function findNodeAt(nodes: readonly SimNode[], x: number, y: number): SimNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]
    const r = nodeRadius(node.connectionCount)
    const dx = x - (node.x || 0)
    const dy = y - (node.y || 0)
    if (dx * dx + dy * dy < r * r) return node
  }
  return null
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: PASS (renderGraph signature is backward-compatible, new parameters are optional)

- [ ] **Step 3: Run all tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing

- [ ] **Step 4: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/graph/GraphRenderer.ts
git commit -m "feat: enhance GraphRenderer with glow sprites, dimming, edge brightening, viewport culling, LOD, frame budget, edge overlay"
```

---

### Task 33: Create useGraphAnimation hook (enter/exit transitions, rename detection, rAF batching)

**Files:**
- Create: `src/renderer/src/panels/graph/useGraphAnimation.ts`
- Test: `tests/graph/useGraphAnimation.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/graph/useGraphAnimation.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  diffNodes,
  detectRenames,
  type NodeDiff,
} from '../../src/renderer/src/panels/graph/useGraphAnimation'
import type { SimNode } from '../../src/renderer/src/panels/graph/GraphRenderer'

function makeNode(id: string, title: string = id, x: number = 0, y: number = 0): SimNode {
  return {
    id, title, type: 'note', signal: 'untested', connectionCount: 0, x, y
  }
}

describe('diffNodes', () => {
  it('detects added nodes', () => {
    const prev = [makeNode('a')]
    const next = [makeNode('a'), makeNode('b')]
    const diff = diffNodes(prev, next)
    expect(diff.added.map((n) => n.id)).toEqual(['b'])
    expect(diff.removed).toHaveLength(0)
    expect(diff.kept.map((n) => n.id)).toEqual(['a'])
  })

  it('detects removed nodes', () => {
    const prev = [makeNode('a'), makeNode('b')]
    const next = [makeNode('a')]
    const diff = diffNodes(prev, next)
    expect(diff.removed.map((n) => n.id)).toEqual(['b'])
    expect(diff.added).toHaveLength(0)
  })

  it('handles empty arrays', () => {
    const diff = diffNodes([], [])
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.kept).toHaveLength(0)
  })

  it('detects simultaneous adds and removes', () => {
    const prev = [makeNode('a'), makeNode('b')]
    const next = [makeNode('b'), makeNode('c')]
    const diff = diffNodes(prev, next)
    expect(diff.added.map((n) => n.id)).toEqual(['c'])
    expect(diff.removed.map((n) => n.id)).toEqual(['a'])
    expect(diff.kept.map((n) => n.id)).toEqual(['b'])
  })
})

describe('detectRenames', () => {
  it('matches a remove+add with the same id as a rename', () => {
    const removed = [makeNode('art-001', 'Old Title', 100, 200)]
    const added = [makeNode('art-001', 'New Title')]
    const renames = detectRenames(removed, added)
    expect(renames).toHaveLength(1)
    expect(renames[0].id).toBe('art-001')
    expect(renames[0].oldX).toBe(100)
    expect(renames[0].oldY).toBe(200)
  })

  it('returns empty when no matching IDs', () => {
    const removed = [makeNode('art-001')]
    const added = [makeNode('art-002')]
    const renames = detectRenames(removed, added)
    expect(renames).toHaveLength(0)
  })

  it('handles multiple renames', () => {
    const removed = [makeNode('a', 'A', 10, 20), makeNode('b', 'B', 30, 40)]
    const added = [makeNode('a', 'A2'), makeNode('b', 'B2')]
    const renames = detectRenames(removed, added)
    expect(renames).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/graph/useGraphAnimation.test.ts`
Expected: FAIL with "cannot find module"

- [ ] **Step 3: Implement the hook**

```typescript
// src/renderer/src/panels/graph/useGraphAnimation.ts
import { useRef, useCallback, useEffect } from 'react'
import type { SimNode } from './GraphRenderer'

export interface NodeDiff {
  added: readonly SimNode[]
  removed: readonly SimNode[]
  kept: readonly SimNode[]
}

export interface RenameEntry {
  id: string
  oldX: number
  oldY: number
}

export interface AnimatingNode {
  id: string
  progress: number    // 0 to 1
  type: 'enter' | 'exit'
  startTime: number
}

const ENTER_DURATION = 400
const EXIT_DURATION = 200
const REHEAT_ALPHA = 0.3

export function diffNodes(
  prev: readonly SimNode[],
  next: readonly SimNode[]
): NodeDiff {
  const prevIds = new Set(prev.map((n) => n.id))
  const nextIds = new Set(next.map((n) => n.id))

  const added = next.filter((n) => !prevIds.has(n.id))
  const removed = prev.filter((n) => !nextIds.has(n.id))
  const kept = next.filter((n) => prevIds.has(n.id))

  return { added, removed, kept }
}

export function detectRenames(
  removed: readonly SimNode[],
  added: readonly SimNode[]
): readonly RenameEntry[] {
  const removedMap = new Map<string, SimNode>()
  for (const node of removed) {
    removedMap.set(node.id, node)
  }

  const renames: RenameEntry[] = []
  for (const node of added) {
    const old = removedMap.get(node.id)
    if (old) {
      renames.push({ id: node.id, oldX: old.x, oldY: old.y })
    }
  }
  return renames
}

interface AnimationBatch {
  enterNodes: Map<string, AnimatingNode>
  exitNodes: Map<string, AnimatingNode>
}

export function useGraphAnimation(
  onRestart: (alpha: number) => void,
  reducedMotion: boolean
) {
  const batchRef = useRef<AnimationBatch>({ enterNodes: new Map(), exitNodes: new Map() })
  const pendingChangesRef = useRef<Array<{ type: 'add' | 'remove'; nodes: SimNode[] }>>([])
  const rafIdRef = useRef<number | null>(null)

  // Accumulate changes and flush on next rAF
  const scheduleFlush = useCallback(() => {
    if (rafIdRef.current !== null) return
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      flushPendingChanges()
    })
  }, [])

  const flushPendingChanges = useCallback(() => {
    const changes = pendingChangesRef.current
    if (changes.length === 0) return
    pendingChangesRef.current = []

    const batch = batchRef.current
    const now = performance.now()

    for (const change of changes) {
      if (change.type === 'add') {
        for (const node of change.nodes) {
          if (reducedMotion) continue
          batch.enterNodes.set(node.id, {
            id: node.id,
            progress: 0,
            type: 'enter',
            startTime: now,
          })
        }
      } else {
        for (const node of change.nodes) {
          if (reducedMotion) continue
          batch.exitNodes.set(node.id, {
            id: node.id,
            progress: 0,
            type: 'exit',
            startTime: now,
          })
        }
      }
    }

    // Gentle reheat, not a full re-layout
    onRestart(REHEAT_ALPHA)
  }, [onRestart, reducedMotion])

  const queueEnter = useCallback(
    (nodes: readonly SimNode[]) => {
      if (nodes.length === 0) return
      pendingChangesRef.current.push({ type: 'add', nodes: [...nodes] })
      scheduleFlush()
    },
    [scheduleFlush]
  )

  const queueExit = useCallback(
    (nodes: readonly SimNode[]) => {
      if (nodes.length === 0) return
      pendingChangesRef.current.push({ type: 'remove', nodes: [...nodes] })
      scheduleFlush()
    },
    [scheduleFlush]
  )

  /**
   * Returns the opacity and scale for a given node at the current time.
   * Call this during renderGraph to apply enter/exit transitions.
   */
  const getNodeTransition = useCallback(
    (nodeId: string, now: number): { opacity: number; scale: number } => {
      if (reducedMotion) return { opacity: 1, scale: 1 }

      const batch = batchRef.current

      const enterAnim = batch.enterNodes.get(nodeId)
      if (enterAnim) {
        const elapsed = now - enterAnim.startTime
        const progress = Math.min(1, elapsed / ENTER_DURATION)
        if (progress >= 1) batch.enterNodes.delete(nodeId)
        // Ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3)
        return { opacity: eased, scale: 0.5 + 0.5 * eased }
      }

      const exitAnim = batch.exitNodes.get(nodeId)
      if (exitAnim) {
        const elapsed = now - exitAnim.startTime
        const progress = Math.min(1, elapsed / EXIT_DURATION)
        if (progress >= 1) {
          batch.exitNodes.delete(nodeId)
          return { opacity: 0, scale: 0.5 }
        }
        const remaining = 1 - progress
        return { opacity: remaining, scale: 0.5 + 0.5 * remaining }
      }

      return { opacity: 1, scale: 1 }
    },
    [reducedMotion]
  )

  const hasActiveAnimations = useCallback((): boolean => {
    const batch = batchRef.current
    return batch.enterNodes.size > 0 || batch.exitNodes.size > 0
  }, [])

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }
    }
  }, [])

  return {
    queueEnter,
    queueExit,
    getNodeTransition,
    hasActiveAnimations,
    diffNodes,
    detectRenames,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/graph/useGraphAnimation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/graph/useGraphAnimation.ts tests/graph/useGraphAnimation.test.ts
git commit -m "feat: add useGraphAnimation hook with enter/exit transitions, rename detection, rAF batching"
```

---

### Task 34: Create SkillsPanel

**Files:**
- Create: `src/renderer/src/panels/skills/SkillsPanel.tsx`
- Modify: `src/main/ipc/filesystem.ts` (register `vault:list-commands` and `vault:read-file` handlers)
- Modify: `src/preload/index.ts` (add `listCommands`, `readFile`, and `deleteFile` to the `vault` namespace)
- Modify: `src/preload/api.d.ts` (declare the new vault methods on `window.api`)

> **Note**: This task adds two new IPC handlers to `src/main/ipc/filesystem.ts`: `vault:list-commands` (lists `.md` files in a directory) and `vault:read-file` (reads a file's UTF-8 content). These are exposed as `window.api.vault.listCommands()` and `window.api.vault.readFile()` via the preload. A `deleteFile` method is also added to the `vault` namespace (delegating to the existing `fs:delete-file` handler) for use by Task 40's `GraphContextMenu`.

- [ ] **Step 1: Register IPC handlers and preload API**

Add to `src/main/ipc/filesystem.ts` (alongside the existing `fs:*` handlers):
```typescript
ipcMain.handle('vault:list-commands', async (_event, dirPath: string): Promise<string[]> => {
  const { readdir } = await import('node:fs/promises')
  try {
    const entries = await readdir(dirPath)
    return entries.filter((f) => f.endsWith('.md')).map((f) => `${dirPath}/${f}`)
  } catch {
    return []
  }
})

ipcMain.handle('vault:read-file', async (_event, filePath: string): Promise<string> => {
  const { readFile } = await import('node:fs/promises')
  return readFile(filePath, 'utf-8')
})
```

Add to the `vault` namespace in `src/preload/index.ts` (inside the existing `api.vault` object):
```typescript
listCommands: (dirPath: string): Promise<string[]> =>
  ipcRenderer.invoke('vault:list-commands', dirPath),
readFile: (filePath: string): Promise<string> =>
  ipcRenderer.invoke('vault:read-file', filePath),
deleteFile: (filePath: string): Promise<void> =>
  ipcRenderer.invoke('fs:delete-file', { path: filePath }),
```

> **Note**: `deleteFile` is added here because Task 40's `GraphContextMenu` needs it. It delegates to the existing `fs:delete-file` IPC handler, so no main-process change is needed for it.

Update the `ElectronApi` type in `src/preload/api.d.ts`. Since `api.d.ts` uses `typeof api` from `./index`, the types are inferred automatically from the new methods added above. No manual type declaration is needed as long as the methods are added to the `api` object in `src/preload/index.ts`.

- [ ] **Step 2: Implement the SkillsPanel**

```typescript
// src/renderer/src/panels/skills/SkillsPanel.tsx
import { useState, useEffect, useCallback } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { colors } from '../../design/tokens'

interface SkillEntry {
  name: string
  description: string
  path: string
}

function parseSkillDescription(content: string): string {
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#') && !trimmed.startsWith('##')) {
      continue
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
      return trimmed.replace(/^\/\/\s*/, '').replace(/^#\s*/, '')
    }
    if (trimmed.length > 0 && !trimmed.startsWith('---')) {
      return trimmed.slice(0, 120)
    }
  }
  return 'No description'
}

function EmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center h-full px-8 text-center"
      style={{ color: colors.text.muted }}
    >
      <div className="text-4xl mb-4">&#x2318;</div>
      <p className="text-sm mb-2" style={{ color: colors.text.secondary }}>
        No skills found
      </p>
      <p className="text-xs leading-relaxed max-w-[280px]">
        Add Claude commands to your vault at{' '}
        <code
          className="px-1 py-0.5 rounded text-[11px]"
          style={{ backgroundColor: colors.bg.elevated, color: colors.accent.default }}
        >
          .claude/commands/
        </code>{' '}
        to see them here. Each{' '}
        <code
          className="px-1 py-0.5 rounded text-[11px]"
          style={{ backgroundColor: colors.bg.elevated, color: colors.accent.default }}
        >
          .md
        </code>{' '}
        file becomes a runnable skill.
      </p>
    </div>
  )
}

function SkillCard({
  skill,
  onRun,
}: {
  skill: SkillEntry
  onRun: (skill: SkillEntry) => void
}) {
  return (
    <div
      className="flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors cursor-default group"
      style={{
        backgroundColor: colors.bg.surface,
        border: `1px solid ${colors.border.default}`,
      }}
    >
      <div className="flex-1 min-w-0 mr-3">
        <div
          className="text-sm font-medium truncate"
          style={{ color: colors.text.primary }}
        >
          {skill.name}
        </div>
        <div
          className="text-xs truncate mt-0.5"
          style={{ color: colors.text.muted }}
        >
          {skill.description}
        </div>
      </div>
      <button
        onClick={() => onRun(skill)}
        className="shrink-0 px-2.5 py-1 text-xs rounded-md transition-colors opacity-0 group-hover:opacity-100"
        style={{
          backgroundColor: colors.accent.muted,
          color: colors.accent.default,
          border: `1px solid ${colors.accent.default}33`,
        }}
      >
        Run
      </button>
    </div>
  )
}

export function SkillsPanel() {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const [skills, setSkills] = useState<readonly SkillEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!vaultPath) {
      setSkills([])
      setIsLoading(false)
      return
    }

    let cancelled = false

    async function loadSkills() {
      setIsLoading(true)
      try {
        // Use existing IPC pattern: vault:list-commands and vault:read-file
        // (window.api.fs does not exist; all filesystem access goes through typed IPC)
        const commandsDir = `${vaultPath}/.claude/commands`
        const files: string[] = await window.api.vault.listCommands(commandsDir)

        if (cancelled) return

        const entries: SkillEntry[] = []
        for (const filePath of files) {
          const content: string = await window.api.vault.readFile(filePath)
          if (cancelled) return
          const filename = filePath.split('/').pop() ?? filePath
          entries.push({
            name: filename.replace(/\.md$/, ''),
            description: parseSkillDescription(content),
            path: filePath,
          })
        }

        entries.sort((a, b) => a.name.localeCompare(b.name))
        setSkills(entries)
      } catch {
        // .claude/commands/ doesn't exist or can't be read
        if (!cancelled) setSkills([])
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadSkills()
    return () => { cancelled = true }
  }, [vaultPath])

  const handleRun = useCallback((skill: SkillEntry) => {
    // Send the skill command to the active terminal session
    // The command format is: /[skill-name] which Claude Code recognizes
    const command = `/${skill.name}\n`
    // Find the first terminal session and write to it
    // This uses the terminal:write IPC through the existing terminal infrastructure
    // For now, emit a custom event that TerminalPanel can listen for
    window.dispatchEvent(
      new CustomEvent('run-skill', { detail: { command: skill.name, path: skill.path } })
    )
  }, [])

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: colors.text.muted }}
      >
        <div className="text-sm">Loading skills...</div>
      </div>
    )
  }

  if (skills.length === 0) {
    return <EmptyState />
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: colors.bg.base }}>
      <div
        className="px-3 py-2 text-xs font-medium uppercase tracking-wider"
        style={{ color: colors.text.muted, letterSpacing: '0.05em' }}
      >
        Skills ({skills.length})
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5">
        {skills.map((skill) => (
          <SkillCard key={skill.path} skill={skill} onRun={handleRun} />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/main/ipc/filesystem.ts src/preload/index.ts src/renderer/src/panels/skills/SkillsPanel.tsx
git commit -m "feat: add SkillsPanel with vault IPC for reading .claude/commands/"
```

---

### Task 35: Refactor GraphControls to Graph/Skills toggle and update graph-store

**Files:**
- Modify: `src/renderer/src/store/graph-store.ts`
- Modify: `src/renderer/src/panels/graph/GraphControls.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Update graph-store ContentView union**

Add `'skills'` to the `ContentView` type:

```typescript
// src/renderer/src/store/graph-store.ts
import { create } from 'zustand'
import type { ArtifactType, Signal } from '@shared/types'

type ContentView = 'editor' | 'graph' | 'skills'

interface GraphStore {
  contentView: ContentView
  selectedNodeId: string | null
  hoveredNodeId: string | null
  typeFilters: Set<ArtifactType>
  signalFilter: Signal | null

  setContentView: (view: ContentView) => void
  setSelectedNode: (id: string | null) => void
  setHoveredNode: (id: string | null) => void
  toggleTypeFilter: (type: ArtifactType) => void
  setSignalFilter: (signal: Signal | null) => void
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  contentView: 'editor',
  selectedNodeId: null,
  hoveredNodeId: null,
  typeFilters: new Set(['gene', 'constraint', 'research', 'output', 'note', 'index']),
  signalFilter: null,

  setContentView: (view) => set({ contentView: view }),
  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setHoveredNode: (id) => set({ hoveredNodeId: id }),
  toggleTypeFilter: (type) => {
    const current = new Set(get().typeFilters)
    if (current.has(type)) current.delete(type)
    else current.add(type)
    set({ typeFilters: current })
  },
  setSignalFilter: (signal) => set({ signalFilter: signal })
}))
```

- [ ] **Step 2: Refactor GraphControls to Graph/Skills pill toggle**

Replace the entire GraphControls component. Remove the Editor button, replace with Skills:

```typescript
// src/renderer/src/panels/graph/GraphControls.tsx
import { useGraphStore } from '../../store/graph-store'
import { colors } from '../../design/tokens'

export function GraphControls() {
  const { contentView, setContentView } = useGraphStore()

  // Only show the toggle when in graph or skills view
  if (contentView === 'editor') return null

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 z-10">
      <div
        className="flex items-center gap-0.5 rounded-lg px-1 py-0.5"
        style={{ backgroundColor: colors.bg.surface, border: `1px solid ${colors.border.default}` }}
      >
        <button
          onClick={() => setContentView('graph')}
          className="px-3 py-1 text-sm rounded-md transition-colors"
          style={{
            backgroundColor: contentView === 'graph' ? colors.accent.muted : 'transparent',
            color: contentView === 'graph' ? colors.text.primary : colors.text.muted
          }}
        >
          Graph
        </button>
        <button
          onClick={() => setContentView('skills')}
          className="px-3 py-1 text-sm rounded-md transition-colors"
          style={{
            backgroundColor: contentView === 'skills' ? colors.accent.muted : 'transparent',
            color: contentView === 'skills' ? colors.text.primary : colors.text.muted
          }}
        >
          Skills
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Update App.tsx ContentArea to render SkillsPanel and update command palette entry**

In `src/renderer/src/App.tsx`, add the SkillsPanel import and update ContentArea to handle the three-way content view. Also update the `BUILT_IN_COMMANDS` entry for `cmd:toggle-view`.

Add import at top:
```typescript
import { SkillsPanel } from './panels/skills/SkillsPanel'
```

Replace the `ContentArea` function:
```typescript
function ContentArea() {
  const { contentView } = useGraphStore()
  const { setActiveNote } = useEditorStore()
  const { setContentView } = useGraphStore()

  const handleNodeClick = useCallback(
    (id: string) => {
      setActiveNote(id, null)
      setContentView('editor')
    },
    [setActiveNote, setContentView]
  )

  const handleNavigate = useCallback(
    (id: string) => {
      setActiveNote(id, null)
    },
    [setActiveNote]
  )

  return (
    <div className="h-full relative">
      <GraphControls />
      {contentView === 'graph' && <GraphPanel onNodeClick={handleNodeClick} />}
      {contentView === 'editor' && <EditorPanel onNavigate={handleNavigate} />}
      {contentView === 'skills' && <SkillsPanel />}
    </div>
  )
}
```

Update the `BUILT_IN_COMMANDS` array entry for toggle-view:
```typescript
const BUILT_IN_COMMANDS: CommandItem[] = [
  { id: 'cmd:new-note', label: 'New Note', category: 'command', shortcut: '\u2318N' },
  { id: 'cmd:toggle-view', label: 'Cycle View', category: 'command', shortcut: '\u2318G' },
  { id: 'cmd:toggle-sidebar', label: 'Toggle Sidebar', category: 'command', shortcut: '\u2318B' },
  { id: 'cmd:toggle-terminal', label: 'Toggle Terminal', category: 'command', shortcut: '\u2318`' },
  {
    id: 'cmd:toggle-mode',
    label: 'Toggle Source/Rich Mode',
    category: 'command',
    shortcut: '\u2318/'
  }
]
```

Update the `toggleView` callback in `WorkspaceShell`:
```typescript
  const toggleView = useCallback(() => {
    if (contentView === 'editor') {
      setContentView('graph')
    } else if (contentView === 'graph') {
      setContentView('skills')
    } else {
      setContentView('graph')
    }
  }, [contentView, setContentView])
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing

- [ ] **Step 6: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/store/graph-store.ts src/renderer/src/panels/graph/GraphControls.tsx src/renderer/src/App.tsx
git commit -m "feat: refactor content view to graph/skills toggle, add skills to ContentArea"
```

---

### Task 36: Update useKeyboard with Cmd+G cycle logic

**Files:**
- Modify: `src/renderer/src/hooks/useKeyboard.ts`

- [ ] **Step 1: Verify the existing handler name stays compatible**

The `onToggleView` callback in `useKeyboard` is already bound to `Cmd+G` via the `META_KEY_BINDINGS` array. The cycle logic lives in `WorkspaceShell`'s `toggleView` callback (updated in Task 35). The `useKeyboard` hook itself does not need structural changes because it delegates to the `onToggleView` callback.

However, for clarity and to match the spec's naming, rename the callback from `onToggleView` to `onCycleView` across the hook and its consumers:

```typescript
// src/renderer/src/hooks/useKeyboard.ts
import { useEffect } from 'react'

interface KeyboardConfig {
  onToggleSidebar?: () => void
  onToggleTerminal?: () => void
  onNewNote?: () => void
  onCycleView?: () => void
  onToggleSourceMode?: () => void
  onCommandPalette?: () => void
  onSave?: () => void
  onNewTerminalTab?: () => void
  onEscape?: () => void
}

const META_KEY_BINDINGS: ReadonlyArray<{
  key: string
  handler: keyof KeyboardConfig
}> = [
  { key: 'b', handler: 'onToggleSidebar' },
  { key: '`', handler: 'onToggleTerminal' },
  { key: 'n', handler: 'onNewNote' },
  { key: 'g', handler: 'onCycleView' },
  { key: '/', handler: 'onToggleSourceMode' },
  { key: 'k', handler: 'onCommandPalette' },
  { key: 's', handler: 'onSave' },
  { key: 't', handler: 'onNewTerminalTab' }
]

export function useKeyboard(config: KeyboardConfig): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && config.onEscape) {
        e.preventDefault()
        config.onEscape()
        return
      }

      if (!e.metaKey) return

      for (const binding of META_KEY_BINDINGS) {
        if (e.key === binding.key) {
          const handler = config[binding.handler]
          if (handler) {
            e.preventDefault()
            handler()
          }
          return
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [config])
}
```

- [ ] **Step 2: Update the consumer in App.tsx WorkspaceShell**

In `src/renderer/src/App.tsx`, update the `useKeyboard` call to use the new callback name:

```typescript
  useKeyboard({
    onCommandPalette: () => setPaletteOpen(true),
    onCycleView: toggleView,
    onToggleSourceMode: toggleSourceMode,
    onEscape: () => setPaletteOpen(false)
  })
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run all tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/hooks/useKeyboard.ts src/renderer/src/App.tsx
git commit -m "refactor: rename onToggleView to onCycleView in useKeyboard for graph/skills cycle"
```

---

### Task 37: Add node sizing modes to GraphSettingsPanel and GraphRenderer

**Files:**
- Modify: `src/renderer/src/store/graph-settings-store.ts`
- Modify: `src/renderer/src/panels/graph/GraphSettingsPanel.tsx`

- [ ] **Step 1: Verify graph-settings-store exports NodeSizeMode**

The store created in Task 23 already includes `nodeSizeMode: NodeSizeMode`, `baseNodeSize: number`, `groups: Record<ArtifactType, GroupConfig>`, `setGroupVisible`, `setGroupColor`, and the `persist` middleware with `vaultStorage`. Verify the `NodeSizeMode` type is **exported**. If it is not, add the `export` keyword.

> **Important**: Do NOT replace the full store definition. Task 23 established `groups`, `GroupConfig`, `setGroupVisible`, `setGroupColor`, the `persist` middleware, and `vaultStorage`. All must be preserved. This step only adds the `export` keyword to the existing `NodeSizeMode` type.

In `src/renderer/src/store/graph-settings-store.ts`, change:
```typescript
type NodeSizeMode = 'degree' | 'uniform' | 'content'
```
to:
```typescript
export type NodeSizeMode = 'degree' | 'uniform' | 'content'
```

- [ ] **Step 2: Add Node Size Mode dropdown to GraphSettingsPanel**

In `src/renderer/src/panels/graph/GraphSettingsPanel.tsx`, add a mode dropdown in the Display section. Locate the "Node size" slider and add a dropdown above it:

```typescript
// Add to the Display section in GraphSettingsPanel.tsx, above the node size slider:

<div className="mb-3">
  <label
    className="block text-xs mb-1"
    style={{ color: colors.text.secondary }}
  >
    Size mode
  </label>
  <select
    value={nodeSizeMode}
    onChange={(e) => setNodeSizeMode(e.target.value as NodeSizeMode)}
    className="w-full px-2 py-1 text-xs rounded"
    style={{
      backgroundColor: colors.bg.elevated,
      color: colors.text.primary,
      border: `1px solid ${colors.border.default}`,
      outline: 'none',
    }}
  >
    <option value="degree">Degree (connections)</option>
    <option value="uniform">Uniform</option>
    <option value="content">Content length</option>
  </select>
</div>
```

Import the `NodeSizeMode` type from the store:
```typescript
import { useGraphSettingsStore, type NodeSizeMode } from '../../store/graph-settings-store'
```

Add the selector:
```typescript
const { nodeSizeMode, setNodeSizeMode, /* ...existing destructured values... */ } = useGraphSettingsStore()
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/store/graph-settings-store.ts src/renderer/src/panels/graph/GraphSettingsPanel.tsx
git commit -m "feat: add node size mode dropdown to graph settings (degree, uniform, content)"
```

---

### Task 38: Create GraphRendererInterface abstraction

**Files:**
- Create: `src/renderer/src/panels/graph/GraphRendererInterface.ts`

- [ ] **Step 1: Implement the pluggable renderer interface**

```typescript
// src/renderer/src/panels/graph/GraphRendererInterface.ts
import type { SimNode, SimEdge, NodeSizeConfig } from './GraphRenderer'
import { renderGraph, findNodeAt } from './GraphRenderer'
import type { HighlightState } from './useGraphHighlight'

/**
 * Pluggable renderer abstraction for the graph visualization.
 *
 * The current Canvas2D implementation satisfies this interface. Future
 * renderers (pixi.js, regl, WebGPU) can implement the same contract
 * and be swapped in via GraphPanel without changing stores or hooks.
 */
export interface GraphRendererInterface {
  /**
   * Render one frame of the graph.
   * Called on every D3 simulation tick and on user interaction.
   */
  render(params: RenderParams): void

  /**
   * Hit-test a point in graph-space coordinates.
   * Returns the topmost node at (x, y) or null.
   */
  hitTest(nodes: readonly SimNode[], x: number, y: number): SimNode | null

  /**
   * Handle canvas/container resize.
   * The implementation should update its internal dimensions and
   * re-render if necessary.
   */
  resize(width: number, height: number, dpr: number): void

  /**
   * Clean up any resources (cached sprites, GPU buffers, etc.).
   * Called when the renderer is swapped out or the panel unmounts.
   */
  dispose(): void
}

export interface RenderParams {
  ctx: CanvasRenderingContext2D
  nodes: readonly SimNode[]
  edges: readonly SimEdge[]
  width: number
  height: number
  selectedId: string | null
  hoveredId: string | null
  highlight: HighlightState
  sizeConfig: NodeSizeConfig
  transform: { x: number; y: number; k: number }
  canvasWidth: number
  canvasHeight: number
  reducedMotion: boolean
}

/**
 * Canvas2D renderer conforming to GraphRendererInterface.
 *
 * This wraps the existing renderGraph and findNodeAt functions,
 * providing the pluggable interface without changing the rendering logic.
 */
export class Canvas2DGraphRenderer implements GraphRendererInterface {
  private width = 0
  private height = 0
  private dpr = 1

  render(params: RenderParams): void {
    renderGraph(
      params.ctx,
      params.nodes,
      params.edges,
      params.width,
      params.height,
      params.selectedId,
      params.hoveredId,
      {
        highlight: params.highlight,
        sizeConfig: params.sizeConfig,
        transform: params.transform,
        canvasWidth: params.canvasWidth,
        canvasHeight: params.canvasHeight,
        reducedMotion: params.reducedMotion,
      }
    )
  }

  hitTest(nodes: readonly SimNode[], x: number, y: number): SimNode | null {
    return findNodeAt(nodes, x, y)
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width
    this.height = height
    this.dpr = dpr
  }

  dispose(): void {
    // Canvas2D has no GPU resources to release.
    // The GlowSpriteCache is module-scoped and persists across renders.
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/graph/GraphRendererInterface.ts
git commit -m "feat: add GraphRendererInterface abstraction for pluggable graph renderers"
```

---

### Task 39: Create GraphMinimap component

**Files:**
- Create: `src/renderer/src/panels/graph/GraphMinimap.tsx`

- [ ] **Step 1: Implement the minimap**

```typescript
// src/renderer/src/panels/graph/GraphMinimap.tsx
import { useRef, useEffect, useCallback } from 'react'
import type { SimNode, SimEdge } from './GraphRenderer'
import { ARTIFACT_COLORS, colors } from '../../design/tokens'

interface GraphMinimapProps {
  nodes: readonly SimNode[]
  edges: readonly SimEdge[]
  transform: { x: number; y: number; k: number }
  canvasWidth: number
  canvasHeight: number
  onPan: (x: number, y: number) => void
}

const MINIMAP_WIDTH = 120
const MINIMAP_HEIGHT = 80
const MINIMAP_PADDING = 8
const NODE_DOT_SIZE = 2
const VIEWPORT_RECT_COLOR = 'rgba(108, 99, 255, 0.5)'
const VIEWPORT_RECT_BORDER = 'rgba(108, 99, 255, 0.8)'
const MINIMAP_BG = 'rgba(17, 17, 19, 0.85)'

function computeGraphBounds(nodes: readonly SimNode[]): {
  minX: number; minY: number; maxX: number; maxY: number
} {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of nodes) {
    if (!node.x || !node.y) continue
    if (node.x < minX) minX = node.x
    if (node.x > maxX) maxX = node.x
    if (node.y < minY) minY = node.y
    if (node.y > maxY) maxY = node.y
  }

  // Add padding so edge nodes aren't clipped
  const padX = (maxX - minX) * 0.1 || 50
  const padY = (maxY - minY) * 0.1 || 50
  return {
    minX: minX - padX,
    minY: minY - padY,
    maxX: maxX + padX,
    maxY: maxY + padY,
  }
}

export function GraphMinimap({
  nodes,
  edges,
  transform,
  canvasWidth,
  canvasHeight,
  onPan,
}: GraphMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const renderMinimap = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio
    canvas.width = MINIMAP_WIDTH * dpr
    canvas.height = MINIMAP_HEIGHT * dpr
    ctx.scale(dpr, dpr)

    // Clear
    ctx.fillStyle = MINIMAP_BG
    ctx.fillRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT)
    ctx.strokeStyle = colors.border.default
    ctx.lineWidth = 1
    ctx.strokeRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT)

    const bounds = computeGraphBounds(nodes)
    const graphWidth = bounds.maxX - bounds.minX
    const graphHeight = bounds.maxY - bounds.minY

    if (graphWidth <= 0 || graphHeight <= 0) return

    const scaleX = (MINIMAP_WIDTH - MINIMAP_PADDING * 2) / graphWidth
    const scaleY = (MINIMAP_HEIGHT - MINIMAP_PADDING * 2) / graphHeight
    const scale = Math.min(scaleX, scaleY)

    const offsetX = MINIMAP_PADDING + ((MINIMAP_WIDTH - MINIMAP_PADDING * 2) - graphWidth * scale) / 2
    const offsetY = MINIMAP_PADDING + ((MINIMAP_HEIGHT - MINIMAP_PADDING * 2) - graphHeight * scale) / 2

    function toMinimapX(gx: number): number {
      return offsetX + (gx - bounds.minX) * scale
    }
    function toMinimapY(gy: number): number {
      return offsetY + (gy - bounds.minY) * scale
    }

    // Draw edges as faint lines
    ctx.globalAlpha = 0.15
    ctx.strokeStyle = colors.border.default
    ctx.lineWidth = 0.5
    for (const edge of edges) {
      const source = edge.source as SimNode
      const target = edge.target as SimNode
      if (!source.x || !target.x) continue
      ctx.beginPath()
      ctx.moveTo(toMinimapX(source.x), toMinimapY(source.y))
      ctx.lineTo(toMinimapX(target.x), toMinimapY(target.y))
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    // Draw nodes as simple dots (no glow, no labels)
    for (const node of nodes) {
      if (!node.x || !node.y) continue
      const color = ARTIFACT_COLORS[node.type] || ARTIFACT_COLORS.note
      ctx.fillStyle = color
      ctx.globalAlpha = 0.7
      ctx.fillRect(
        toMinimapX(node.x) - NODE_DOT_SIZE / 2,
        toMinimapY(node.y) - NODE_DOT_SIZE / 2,
        NODE_DOT_SIZE,
        NODE_DOT_SIZE
      )
    }
    ctx.globalAlpha = 1

    // Draw viewport rectangle
    const viewWidth = canvasWidth / (window.devicePixelRatio * transform.k)
    const viewHeight = canvasHeight / (window.devicePixelRatio * transform.k)
    const viewX = -transform.x / transform.k
    const viewY = -transform.y / transform.k

    const rectX = toMinimapX(viewX)
    const rectY = toMinimapY(viewY)
    const rectW = viewWidth * scale
    const rectH = viewHeight * scale

    ctx.fillStyle = VIEWPORT_RECT_COLOR
    ctx.globalAlpha = 0.15
    ctx.fillRect(rectX, rectY, rectW, rectH)
    ctx.globalAlpha = 1

    ctx.strokeStyle = VIEWPORT_RECT_BORDER
    ctx.lineWidth = 1
    ctx.strokeRect(rectX, rectY, rectW, rectH)
  }, [nodes, edges, transform, canvasWidth, canvasHeight])

  useEffect(() => {
    renderMinimap()
  }, [renderMinimap])

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const clickY = e.clientY - rect.top

      const bounds = computeGraphBounds(nodes)
      const graphWidth = bounds.maxX - bounds.minX
      const graphHeight = bounds.maxY - bounds.minY

      if (graphWidth <= 0 || graphHeight <= 0) return

      const scaleX = (MINIMAP_WIDTH - MINIMAP_PADDING * 2) / graphWidth
      const scaleY = (MINIMAP_HEIGHT - MINIMAP_PADDING * 2) / graphHeight
      const scale = Math.min(scaleX, scaleY)

      const offsetX = MINIMAP_PADDING + ((MINIMAP_WIDTH - MINIMAP_PADDING * 2) - graphWidth * scale) / 2
      const offsetY = MINIMAP_PADDING + ((MINIMAP_HEIGHT - MINIMAP_PADDING * 2) - graphHeight * scale) / 2

      // Convert minimap click to graph-space coordinates
      const graphX = bounds.minX + (clickX - offsetX) / scale
      const graphY = bounds.minY + (clickY - offsetY) / scale

      onPan(graphX, graphY)
    },
    [nodes, onPan]
  )

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      className="absolute bottom-3 left-3 cursor-crosshair rounded"
      style={{
        width: MINIMAP_WIDTH,
        height: MINIMAP_HEIGHT,
        border: `1px solid ${colors.border.default}`,
        zIndex: 10,
      }}
    />
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/graph/GraphMinimap.tsx
git commit -m "feat: add GraphMinimap component with thumbnail rendering and click-to-pan"
```

---

### Task 40: Create GraphContextMenu component

**Files:**
- Create: `src/renderer/src/panels/graph/GraphContextMenu.tsx`
- Test: `tests/graph/GraphContextMenu.test.ts`

The integration task (Task 41) imports `GraphContextMenu` but no prior task creates it. This task implements the right-click context menu for graph nodes per spec 3A: 4 menu items (Open in editor, Reveal in sidebar, Copy path, Delete with confirmation).

- [ ] **Step 1: Write the test**

```typescript
// tests/graph/GraphContextMenu.test.ts
import { describe, it, expect, vi } from 'vitest'
import { CONTEXT_MENU_ITEMS } from '../../src/renderer/src/panels/graph/GraphContextMenu'

// Test the exported menu item configuration to ensure the component's
// actual data matches expectations (not a local copy).

describe('GraphContextMenu items', () => {
  it('has exactly 4 menu items', () => {
    expect(CONTEXT_MENU_ITEMS).toHaveLength(4)
  })

  it('marks only Delete as dangerous', () => {
    const dangerous = CONTEXT_MENU_ITEMS.filter((item) => item.dangerous)
    expect(dangerous).toHaveLength(1)
    expect(dangerous[0].label).toBe('Delete')
  })

  it('has unique action identifiers', () => {
    const actions = CONTEXT_MENU_ITEMS.map((item) => item.action)
    expect(new Set(actions).size).toBe(actions.length)
  })

  it('has non-empty labels for all items', () => {
    for (const item of CONTEXT_MENU_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/graph/GraphContextMenu.test.ts`
Expected: FAIL with "cannot find module" (component not yet created)

- [ ] **Step 3: Implement the GraphContextMenu component**

```typescript
// src/renderer/src/panels/graph/GraphContextMenu.tsx
import { useEffect, useRef, useCallback, useState } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { colors } from '../../design/tokens'

interface GraphContextMenuProps {
  x: number
  y: number
  nodeId: string
  onClose: () => void
  onOpenInEditor: (id: string) => void
}

export interface ContextMenuItem {
  label: string
  action: string
  dangerous?: boolean
}

export const CONTEXT_MENU_ITEMS: readonly ContextMenuItem[] = [
  { label: 'Open in editor', action: 'open' },
  { label: 'Reveal in sidebar', action: 'reveal' },
  { label: 'Copy file path', action: 'copy-path' },
  { label: 'Delete', action: 'delete', dangerous: true },
]

export function GraphContextMenu({
  x,
  y,
  nodeId,
  onClose,
  onOpenInEditor,
}: GraphContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const files = useVaultStore((s) => s.files)
  const [showConfirm, setShowConfirm] = useState(false)

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Use setTimeout to avoid closing immediately from the triggering right-click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const filePath = files.find((f) => f.id === nodeId)?.path ?? null

  const handleAction = useCallback(
    (action: string) => {
      switch (action) {
        case 'open':
          onOpenInEditor(nodeId)
          break
        case 'reveal':
          // Dispatch event for sidebar to scroll to this file
          window.dispatchEvent(
            new CustomEvent('reveal-in-sidebar', { detail: { nodeId } })
          )
          onClose()
          break
        case 'copy-path':
          if (filePath) {
            navigator.clipboard.writeText(filePath)
          }
          onClose()
          break
        case 'delete':
          setShowConfirm(true)
          return // Don't close yet
      }
    },
    [nodeId, filePath, onOpenInEditor, onClose]
  )

  const handleConfirmDelete = useCallback(() => {
    if (filePath) {
      window.api.vault.deleteFile(filePath)
    }
    onClose()
  }, [filePath, onClose])

  return (
    <div
      ref={menuRef}
      className="fixed z-50 py-1 rounded-lg shadow-xl min-w-[180px]"
      style={{
        left: x,
        top: y,
        backgroundColor: colors.bg.elevated,
        border: `1px solid ${colors.border.default}`,
      }}
    >
      {!showConfirm ? (
        CONTEXT_MENU_ITEMS.map((item) => (
          <button
            key={item.action}
            onClick={() => handleAction(item.action)}
            className="w-full text-left px-3 py-1.5 text-sm transition-colors"
            style={{
              color: item.dangerous ? '#EF4444' : colors.text.primary,
              backgroundColor: 'transparent',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = colors.bg.surface
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            {item.label}
          </button>
        ))
      ) : (
        <div className="px-3 py-2">
          <p className="text-xs mb-2" style={{ color: colors.text.secondary }}>
            Delete this note? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowConfirm(false)}
              className="flex-1 px-2 py-1 text-xs rounded"
              style={{
                backgroundColor: colors.bg.surface,
                color: colors.text.secondary,
                border: `1px solid ${colors.border.default}`,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmDelete}
              className="flex-1 px-2 py-1 text-xs rounded"
              style={{
                backgroundColor: '#EF444433',
                color: '#EF4444',
                border: '1px solid #EF444466',
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing

- [ ] **Step 6: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/graph/GraphContextMenu.tsx tests/graph/GraphContextMenu.test.ts
git commit -m "feat: add GraphContextMenu with open, reveal, copy path, and delete actions"
```

---

### Task 41: Integrate highlights, animation, minimap, and loading into GraphPanel

**Files:**
- Modify: `src/renderer/src/panels/graph/GraphPanel.tsx`

- [ ] **Step 1: Rewrite GraphPanel with full Phase 3 integration**

Replace the entire file. This integrates: `useGraphHighlight`, `useGraphAnimation`, `GraphMinimap`, the enhanced `renderGraph` with options, double-click to open in editor, right-click context menu, loading skeleton, and `prefers-reduced-motion` detection.

```typescript
// src/renderer/src/panels/graph/GraphPanel.tsx
import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom'
import { select } from 'd3-selection'
import { useVaultStore } from '../../store/vault-store'
import { useGraphStore } from '../../store/graph-store'
import { useGraphSettingsStore } from '../../store/graph-settings-store'
import {
  createSimulation,
  renderGraph,
  findNodeAt,
  type SimNode,
  type SimEdge,
  type NodeSizeConfig,
} from './GraphRenderer'
import { useGraphHighlight, type HighlightState } from './useGraphHighlight'
import { useGraphAnimation } from './useGraphAnimation'
import { GraphMinimap } from './GraphMinimap'
import { GraphContextMenu } from './GraphContextMenu'
import { colors } from '../../design/tokens'

interface GraphPanelProps {
  onNodeClick: (id: string) => void
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mql.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return reduced
}

function LoadingSkeleton() {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
      style={{ color: colors.text.muted }}
    >
      <div className="flex gap-2">
        <div
          className="w-2 h-2 rounded-full animate-pulse"
          style={{ backgroundColor: colors.accent.default, animationDelay: '0ms' }}
        />
        <div
          className="w-2 h-2 rounded-full animate-pulse"
          style={{ backgroundColor: colors.accent.default, animationDelay: '200ms' }}
        />
        <div
          className="w-2 h-2 rounded-full animate-pulse"
          style={{ backgroundColor: colors.accent.default, animationDelay: '400ms' }}
        />
      </div>
    </div>
  )
}

export function GraphPanel({ onNodeClick }: GraphPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef = useRef<ReturnType<typeof createSimulation> | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const edgesRef = useRef<SimEdge[]>([])
  const transformRef = useRef({ x: 0, y: 0, k: 1 })
  const zoomBehaviorRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null)
  const prevNodesRef = useRef<SimNode[]>([])

  const graph = useVaultStore((s) => s.graph)
  const { selectedNodeId, hoveredNodeId, setSelectedNode, setHoveredNode, setContentView } =
    useGraphStore()
  const { baseNodeSize, nodeSizeMode, showMinimap } = useGraphSettingsStore()

  const reducedMotion = useReducedMotion()
  const [isSimulating, setIsSimulating] = useState(true)
  // Adaptive quality: skip ambient sprites when frame budget is exceeded (spec 3E)
  const skipSpritesRef = useRef(false)

  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; nodeId: string
  } | null>(null)

  const sizeConfig = useMemo<NodeSizeConfig>(
    () => ({ mode: nodeSizeMode, baseSize: baseNodeSize }),
    [nodeSizeMode, baseNodeSize]
  )

  const highlightHook = useGraphHighlight(edgesRef.current)

  const handleSimRestart = useCallback((alpha: number) => {
    simRef.current?.alpha(alpha).restart()
  }, [])

  const animation = useGraphAnimation(handleSimRestart, reducedMotion)

  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.save()
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const t = transformRef.current
    ctx.translate(t.x, t.y)
    ctx.scale(t.k, t.k)

    const frameDuration = renderGraph(
      ctx,
      nodesRef.current,
      edgesRef.current,
      canvas.width / window.devicePixelRatio,
      canvas.height / window.devicePixelRatio,
      selectedNodeId,
      hoveredNodeId,
      {
        highlight: highlightHook.state,
        sizeConfig,
        transform: transformRef.current,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        reducedMotion,
        skipAmbientSprites: skipSpritesRef.current,
      }
    )
    ctx.restore()

    // Adaptive quality reduction (spec 3E): skip ambient sprites next frame
    // if this frame exceeded budget, restore if back under budget
    skipSpritesRef.current = frameDuration > 16

    // Drive enter/exit animations
    if (animation.hasActiveAnimations()) {
      requestAnimationFrame(render)
    }
  }, [selectedNodeId, hoveredNodeId, highlightHook.state, sizeConfig, reducedMotion, animation])

  // --- Setup simulation, zoom, and graph data pipeline ---
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const graphData = graph
    const nodes: SimNode[] = graphData.nodes.map((n) => ({
      ...n,
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
    }))
    const edges: SimEdge[] = graphData.edges.map((e) => ({ ...e }))

    // Diff against previous nodes for enter/exit animations
    const prevNodes = prevNodesRef.current
    if (prevNodes.length > 0) {
      const diff = animation.diffNodes(prevNodes, nodes)
      const renames = animation.detectRenames(diff.removed, diff.added)
      const renameIds = new Set(renames.map((r) => r.id))

      // Preserve positions for renamed nodes
      for (const rename of renames) {
        const node = nodes.find((n) => n.id === rename.id)
        if (node) {
          node.x = rename.oldX
          node.y = rename.oldY
        }
      }

      // Queue enter animations for truly new nodes (not renames)
      const newNodes = diff.added.filter((n) => !renameIds.has(n.id))
      animation.queueEnter(newNodes)

      // Queue exit animations for truly removed nodes (not renames)
      const removedNodes = diff.removed.filter((n) => !renameIds.has(n.id))
      animation.queueExit(removedNodes)
    }

    prevNodesRef.current = nodes
    nodesRef.current = nodes
    edgesRef.current = edges

    let sim: ReturnType<typeof createSimulation> | null = null
    if (nodes.length > 0) {
      sim = createSimulation(nodes, edges, canvas.width, canvas.height)
      sim.on('tick', () => {
        render()
        // Spec 3E: hide loading skeleton when alpha drops below 0.1 (not 'end' which
        // fires at alpha < 0.001, making the skeleton visible far too long)
        if (sim && sim.alpha() < 0.1) {
          setIsSimulating(false)
        }
      })
      simRef.current = sim
      setIsSimulating(true)
    } else {
      setIsSimulating(false)
      render()
    }

    const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        transformRef.current = event.transform
        render()
      })

    zoomBehaviorRef.current = zoomBehavior
    const selection = select(canvas).call(zoomBehavior)

    return () => {
      sim?.stop()
      selection.on('.zoom', null)
    }
  }, [graph, render, animation])

  // --- Mouse event handlers ---
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const t = transformRef.current
      const x = (e.clientX - rect.left - t.x) / t.k
      const y = (e.clientY - rect.top - t.y) / t.k
      const node = findNodeAt(nodesRef.current, x, y)
      highlightHook.handleHover(node?.id ?? null)
      canvas.style.cursor = node ? 'pointer' : 'default'
    },
    [highlightHook]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const t = transformRef.current
      const x = (e.clientX - rect.left - t.x) / t.k
      const y = (e.clientY - rect.top - t.y) / t.k
      const node = findNodeAt(nodesRef.current, x, y)

      setContextMenu(null)

      if (node) {
        highlightHook.handleClick(node.id)
        onNodeClick(node.id)
      } else {
        highlightHook.handleClick(null)
      }
    },
    [highlightHook, onNodeClick]
  )

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const t = transformRef.current
      const x = (e.clientX - rect.left - t.x) / t.k
      const y = (e.clientY - rect.top - t.y) / t.k
      const node = findNodeAt(nodesRef.current, x, y)

      if (node) {
        highlightHook.handleDoubleClick(node.id)
        setContentView('editor')
        onNodeClick(node.id)
      }
    },
    [highlightHook, setContentView, onNodeClick]
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault()
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const t = transformRef.current
      const x = (e.clientX - rect.left - t.x) / t.k
      const y = (e.clientY - rect.top - t.y) / t.k
      const node = findNodeAt(nodesRef.current, x, y)

      if (node) {
        setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id })
      } else {
        setContextMenu(null)
      }
    },
    []
  )

  // --- Minimap pan handler ---
  const handleMinimapPan = useCallback(
    (graphX: number, graphY: number) => {
      const canvas = canvasRef.current
      const zb = zoomBehaviorRef.current
      if (!canvas || !zb) return

      const t = transformRef.current
      const canvasW = canvas.width / window.devicePixelRatio
      const canvasH = canvas.height / window.devicePixelRatio

      const newX = canvasW / 2 - graphX * t.k
      const newY = canvasH / 2 - graphY * t.k

      const newTransform = zoomIdentity.translate(newX, newY).scale(t.k)
      select(canvas).transition().duration(300).call(zb.transform, newTransform)
    },
    []
  )

  // --- Resize observer ---
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => {
      canvas.width = canvas.clientWidth * window.devicePixelRatio
      canvas.height = canvas.clientHeight * window.devicePixelRatio
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
      render()
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [render])

  const isEmpty = graph.nodes.length === 0

  return (
    <div className="h-full relative" style={{ backgroundColor: colors.bg.base }}>
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ backgroundColor: colors.bg.base }}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      />

      {/* Loading skeleton while simulation is running */}
      {isSimulating && !isEmpty && <LoadingSkeleton />}

      {/* Empty state */}
      {isEmpty && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ color: colors.text.muted }}
        >
          <div className="text-center">
            <p className="text-lg mb-2">No notes yet</p>
            <p className="text-sm">Create a note to see your knowledge graph</p>
          </div>
        </div>
      )}

      {/* Minimap */}
      {showMinimap && !isEmpty && (
        <GraphMinimap
          nodes={nodesRef.current}
          edges={edgesRef.current}
          transform={transformRef.current}
          canvasWidth={canvasRef.current?.width ?? 0}
          canvasHeight={canvasRef.current?.height ?? 0}
          onPan={handleMinimapPan}
        />
      )}

      {/* Context menu */}
      {contextMenu && (
        <GraphContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeId={contextMenu.nodeId}
          onClose={() => setContextMenu(null)}
          onOpenInEditor={(id) => {
            setContentView('editor')
            onNodeClick(id)
            setContextMenu(null)
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing

- [ ] **Step 4: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/graph/GraphPanel.tsx
git commit -m "feat: integrate highlights, animation, minimap, context menu, and loading into GraphPanel"
```

---

## Chunk 6: Phase 4 -- Polish

### Task 42: Extend tokens.ts with type scale, border-radius, and animation constants

**Files:**
- Modify: `src/renderer/src/design/tokens.ts`
- Test: `tests/design/tokens.test.ts`

- [ ] **Step 1: Update the test to cover new token sections**

Replace the existing test file with this version that covers the new `typeScale`, `borderRadius`, `transitions`, and `animations` sections:

```typescript
// tests/design/tokens.test.ts
import { describe, it, expect } from 'vitest'
import { colors, ARTIFACT_COLORS, typeScale, borderRadius, transitions, animations } from '../../src/renderer/src/design/tokens'

describe('design tokens', () => {
  it('has all background layers', () => {
    expect(colors.bg.base).toBe('#0A0A0B')
    expect(colors.bg.surface).toBe('#111113')
    expect(colors.bg.elevated).toBe('#1A1A1D')
    expect(colors.border.default).toBe('#2A2A2E')
  })

  it('has artifact type colors for all types', () => {
    expect(ARTIFACT_COLORS.gene).toBe('#6C63FF')
    expect(ARTIFACT_COLORS.constraint).toBe('#EF4444')
    expect(ARTIFACT_COLORS.research).toBe('#2DD4BF')
    expect(ARTIFACT_COLORS.output).toBe('#EC4899')
    expect(ARTIFACT_COLORS.note).toBe('#8B8B8E')
    expect(ARTIFACT_COLORS.index).toBe('#38BDF8')
  })

  it('has no color collisions between artifact types and semantic colors', () => {
    const semanticColors = [colors.semantic.cluster, colors.semantic.tension]
    const artifactColorValues = Object.values(ARTIFACT_COLORS)
    for (const sc of semanticColors) {
      expect(artifactColorValues).not.toContain(sc)
    }
  })

  it('has complete type scale with all roles', () => {
    expect(typeScale.display.pageTitle.size).toBe('20px')
    expect(typeScale.display.pageTitle.weight).toBe(600)
    expect(typeScale.display.sectionHeading.size).toBe('15px')
    expect(typeScale.display.body.size).toBe('13px')
    expect(typeScale.display.secondary.size).toBe('12px')
    expect(typeScale.display.label.size).toBe('12px')
    expect(typeScale.display.label.textTransform).toBe('uppercase')
    expect(typeScale.display.label.letterSpacing).toBe('0.05em')
    expect(typeScale.mono.terminal.size).toBe('13px')
    expect(typeScale.mono.source.size).toBe('12px')
    expect(typeScale.mono.inline.size).toBe('12px')
  })

  it('has border-radius constants', () => {
    expect(borderRadius.container).toBe(6)
    expect(borderRadius.inline).toBe(4)
    expect(borderRadius.round).toBe('50%')
  })

  it('has transition timing constants', () => {
    expect(transitions.hover).toBe('150ms ease-out')
    expect(transitions.tooltip).toBe('100ms ease-in')
    expect(transitions.focusRing).toBe('100ms ease-out')
    expect(transitions.settingsSlide).toBe('250ms ease-out')
    expect(transitions.modalFade).toBe('200ms ease-in')
    expect(transitions.commandPalette).toBe('150ms ease-out')
  })

  it('has animation timing constants', () => {
    expect(animations.graphNodeHoverGlow).toBe('200ms ease-out')
    expect(animations.graphNetworkReveal).toBe('200ms ease-out')
    expect(animations.graphNetworkDim).toBe('300ms ease-out')
    expect(animations.graphNodeEnter).toBe('400ms ease-out')
    expect(animations.graphNodeExit).toBe('200ms ease-out')
    expect(animations.spatialTransition).toBe('250ms ease-out')
  })

  it('enforces max animation duration of 400ms', () => {
    const allDurations = [
      ...Object.values(transitions),
      ...Object.values(animations),
    ]
    for (const timing of allDurations) {
      const ms = parseInt(timing, 10)
      expect(ms).toBeLessThanOrEqual(400)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/design/tokens.test.ts`

- [ ] **Step 3: Add type scale, border-radius, and animation constants to tokens.ts**

```typescript
// src/renderer/src/design/tokens.ts
import type { ArtifactType } from '@shared/types'

export const colors = {
  bg: {
    base: '#0A0A0B',
    surface: '#111113',
    elevated: '#1A1A1D'
  },
  border: {
    default: '#2A2A2E'
  },
  text: {
    primary: '#EDEDEF',
    secondary: '#8B8B8E',
    muted: '#5A5A5E'
  },
  accent: {
    default: '#6C63FF',
    hover: '#7B73FF',
    muted: 'rgba(108, 99, 255, 0.12)'
  },
  semantic: {
    cluster: '#34D399',
    tension: '#F59E0B'
  }
} as const

export const ARTIFACT_COLORS: Record<ArtifactType, string> = {
  gene: '#6C63FF',
  constraint: '#EF4444',
  research: '#2DD4BF',
  output: '#EC4899',
  note: '#8B8B8E',
  index: '#38BDF8'
}

export const spacing = {
  unit: 4,
  panelGap: 1,
  contentPadX: 32,
  contentPadY: 24,
  sidebarWidth: 260,
  terminalMinWidth: 320
} as const

export const typography = {
  fontFamily: {
    display: 'Inter, system-ui, sans-serif',
    body: 'Inter, system-ui, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", monospace'
  },
  metadata: {
    size: '11px',
    letterSpacing: '0.05em',
    textTransform: 'uppercase' as const
  }
} as const

export const typeScale = {
  display: {
    pageTitle: { size: '20px', weight: 600, color: colors.text.primary },
    sectionHeading: { size: '15px', weight: 600, color: colors.text.primary },
    body: { size: '13px', weight: 400, color: colors.text.primary },
    secondary: { size: '12px', weight: 400, color: colors.text.secondary },
    label: {
      size: '12px',
      weight: 400,
      color: colors.text.muted,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.05em'
    }
  },
  mono: {
    terminal: { size: '13px' },
    source: { size: '12px' },
    inline: { size: '12px' }
  },
  minSize: '12px'
} as const

export const borderRadius = {
  container: 6,
  inline: 4,
  round: '50%'
} as const

export const transitions = {
  default: '150ms ease-out',
  hover: '150ms ease-out',
  tooltip: '100ms ease-in',
  focusRing: '100ms ease-out',
  settingsSlide: '250ms ease-out',
  modalFade: '200ms ease-in',
  commandPalette: '150ms ease-out'
} as const

export const animations = {
  graphNodeHoverGlow: '200ms ease-out',
  graphNetworkReveal: '200ms ease-out',
  graphNetworkDim: '300ms ease-out',
  graphNodeEnter: '400ms ease-out',
  graphNodeExit: '200ms ease-out',
  spatialTransition: '250ms ease-out'
} as const

export const focusRing = {
  color: colors.accent.default,
  opacity: 0.3,
  offset: 2,
  width: 2
} as const
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/design/tokens.test.ts`

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/design/tokens.ts tests/design/tokens.test.ts
git commit -m "feat: extend tokens with type scale, border-radius, and animation constants"
```

---

### Task 43: Add CSS custom properties, scrollbar styling, and prefers-reduced-motion

**Files:**
- Modify: `src/renderer/src/assets/index.css`

- [ ] **Step 1: Replace index.css with full design system CSS**

```css
/* src/renderer/src/assets/index.css */
@import 'tailwindcss';

/* ===== Design System CSS Custom Properties ===== */

:root {
  /* Type scale (display font) */
  --font-display: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --text-page-title: 20px;
  --text-section-heading: 15px;
  --text-body: 13px;
  --text-secondary: 12px;
  --text-label: 12px;

  /* Mono type scale */
  --text-mono-terminal: 13px;
  --text-mono-source: 12px;
  --text-mono-inline: 12px;

  /* Border radius */
  --radius-container: 6px;
  --radius-inline: 4px;
  --radius-round: 50%;

  /* Transitions */
  --transition-hover: 150ms ease-out;
  --transition-tooltip: 100ms ease-in;
  --transition-focus-ring: 100ms ease-out;
  --transition-settings-slide: 250ms ease-out;
  --transition-modal-fade: 200ms ease-in;
  --transition-command-palette: 150ms ease-out;

  /* Colors as custom properties for Tailwind consumption */
  --color-bg-base: #0A0A0B;
  --color-bg-surface: #111113;
  --color-bg-elevated: #1A1A1D;
  --color-border-default: #2A2A2E;
  --color-text-primary: #EDEDEF;
  --color-text-secondary: #8B8B8E;
  --color-text-muted: #5A5A5E;
  --color-accent-default: #6C63FF;
  --color-accent-hover: #7B73FF;
  --color-accent-muted: rgba(108, 99, 255, 0.12);
}

/* Non-Retina scale bump: shift type scale up 1px across the board */
@media (resolution < 2dppx) {
  :root {
    --text-page-title: 21px;
    --text-section-heading: 16px;
    --text-body: 14px;
    --text-secondary: 13px;
    --text-label: 13px;
    --text-mono-terminal: 14px;
    --text-mono-source: 13px;
    --text-mono-inline: 13px;
  }
}

/* ===== Scrollbar Styling ===== */

* {
  scrollbar-width: thin;
  scrollbar-color: var(--color-bg-elevated) transparent;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--color-bg-elevated);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--color-border-default);
}

/* ===== Focus Ring Utility ===== */

.focus-ring:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(108, 99, 255, 0.3);
}

/* ===== Interactive Element Base ===== */

.interactive-hover {
  transition: background-color var(--transition-hover);
}

.interactive-hover:hover {
  background-color: var(--color-bg-elevated);
}

/* ===== Gradient Panel Separator ===== */

.panel-separator-h {
  width: 1px;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    var(--color-border-default) 20%,
    var(--color-border-default) 80%,
    transparent 100%
  );
}

.panel-separator-v {
  height: 1px;
  background: linear-gradient(
    to right,
    transparent 0%,
    var(--color-border-default) 20%,
    var(--color-border-default) 80%,
    transparent 100%
  );
}

/* ===== Prefers Reduced Motion ===== */

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing

- [ ] **Step 3: Apply gradient panel separators to SplitPane**

The CSS classes `panel-separator-h` and `panel-separator-v` defined above must be applied to the actual split pane divider element. Modify `src/renderer/src/design/components/SplitPane.tsx`:

In the divider element (the `<div>` with the drag handler between the two panes), replace the existing hard border styling with the gradient separator class:

```typescript
// In SplitPane.tsx, update the divider element:
// For horizontal split (side by side panels):
<div
  className={`panel-separator-h cursor-col-resize flex-shrink-0`}
  onMouseDown={handleMouseDown}
  style={{ minWidth: '1px' }}
/>

// For vertical split (stacked panels):
<div
  className={`panel-separator-v cursor-row-resize flex-shrink-0`}
  onMouseDown={handleMouseDown}
  style={{ minHeight: '1px' }}
/>
```

Remove any inline `borderLeft`, `borderRight`, `borderTop`, or `borderBottom` styling that was previously used for the divider, since the gradient classes handle the visual appearance.

- [ ] **Step 4: Run tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/assets/index.css src/renderer/src/design/components/SplitPane.tsx
git commit -m "feat: add CSS custom properties, scrollbar styling, gradient separators, and prefers-reduced-motion"
```

---

### Task 44: Add getBacklinks() method to VaultIndex

**Files:**
- Modify: `src/renderer/src/engine/indexer.ts`
- Test: `tests/engine/indexer.test.ts`

- [ ] **Step 1: Add test for getBacklinks**

Append to the existing `tests/engine/indexer.test.ts`:

```typescript
// Add these tests inside the existing describe('VaultIndex', () => { ... }) block:

  it('returns backlinks for a target node', () => {
    const index = new VaultIndex()
    for (const [f, c] of Object.entries(FILES)) index.addFile(f, c)
    const backlinks = index.getBacklinks('g2')
    expect(backlinks).toHaveLength(1)
    expect(backlinks[0].id).toBe('g1')
  })

  it('returns empty array when no backlinks exist', () => {
    const index = new VaultIndex()
    for (const [f, c] of Object.entries(FILES)) index.addFile(f, c)
    const backlinks = index.getBacklinks('g1-nonexistent')
    expect(backlinks).toEqual([])
  })

  it('returns multiple backlinks from different sources', () => {
    const index = new VaultIndex()
    for (const [f, c] of Object.entries(FILES)) index.addFile(f, c)
    // c1 has tension with g1 (edge target = g1), and g1 has non-directional
    // connection/cluster edges to g2, so the reverse check also returns g2.
    const backlinks = index.getBacklinks('g1')
    expect(backlinks).toHaveLength(2)
    const ids = backlinks.map((b) => b.id).sort()
    expect(ids).toEqual(['c1', 'g2'])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/indexer.test.ts`

- [ ] **Step 3: Implement getBacklinks on VaultIndex**

Add the `getBacklinks` method to the `VaultIndex` class in `src/renderer/src/engine/indexer.ts`:

```typescript
// Add this method to the VaultIndex class, after the getErrors() method:

  getBacklinks(targetId: string): Artifact[] {
    const graph = this.getGraph()
    const sourceIds = new Set<string>()

    for (const edge of graph.edges) {
      if (edge.target === targetId && edge.source !== targetId) {
        sourceIds.add(edge.source)
      }
      // For non-directional edges (connection, cluster, tension), also check reverse
      if (edge.source === targetId && edge.target !== targetId && edge.kind !== 'appears_in') {
        sourceIds.add(edge.target)
      }
    }

    const results: Artifact[] = []
    for (const sourceId of sourceIds) {
      const artifact = this.artifacts.get(sourceId)
      if (artifact) {
        results.push(artifact)
      }
    }
    return results
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/indexer.test.ts`

- [ ] **Step 5: Add `getBacklinks` action to vault-store**

After Task 19 (Web Worker migration), vault-store holds `graph` and `artifacts` as plain state. Add a `getBacklinks` action that computes backlinks from graph edges, so Task 49 can call `useVaultStore((s) => s.getBacklinks(activeNoteId))`.

Add to `src/renderer/src/store/vault-store.ts`, inside the store's action object:

```typescript
// Add to vault-store actions (after Web Worker migration, graph is plain state):
getBacklinks: (targetId: string): Artifact[] => {
  const { graph, artifacts } = get()
  const sourceIds = new Set<string>()
  for (const edge of graph.edges) {
    if (edge.target === targetId && edge.source !== targetId) {
      sourceIds.add(edge.source)
    }
    if (edge.source === targetId && edge.target !== targetId && edge.kind !== 'appears_in') {
      sourceIds.add(edge.target)
    }
  }
  return artifacts.filter((a) => sourceIds.has(a.id))
}
```

Also add `getBacklinks` to the vault-store TypeScript interface (the `VaultState` type or equivalent):

```typescript
getBacklinks: (targetId: string) => Artifact[]
```

- [ ] **Step 6: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/engine/indexer.ts src/renderer/src/store/vault-store.ts tests/engine/indexer.test.ts
git commit -m "feat: add getBacklinks() reverse lookup to VaultIndex and vault-store"
```

---

### Task 45: Create EditorToolbar component

**Files:**
- Create: `src/renderer/src/panels/editor/EditorToolbar.tsx`

- [ ] **Step 1: Implement the toolbar with Tiptap command buttons**

```typescript
// src/renderer/src/panels/editor/EditorToolbar.tsx
import { useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import { colors, transitions, borderRadius } from '../../design/tokens'

interface ToolbarButtonProps {
  label: string
  icon: string
  isActive?: boolean
  onClick: () => void
  title: string
}

function ToolbarButton({ icon, isActive = false, onClick, title }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center justify-center w-7 h-7 text-xs"
      style={{
        backgroundColor: isActive ? colors.accent.muted : 'transparent',
        color: isActive ? colors.accent.default : colors.text.secondary,
        borderRadius: borderRadius.inline,
        transition: `background-color ${transitions.hover}, color ${transitions.hover}`,
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.backgroundColor = colors.bg.elevated
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.backgroundColor = 'transparent'
        }
      }}
    >
      {icon}
    </button>
  )
}

function ToolbarSeparator() {
  return (
    <div
      className="w-px h-4 mx-1"
      style={{ backgroundColor: colors.border.default }}
    />
  )
}

interface EditorToolbarProps {
  editor: Editor | null
  mode: 'rich' | 'source'
  onToggleMode: () => void
}

export function EditorToolbar({ editor, mode, onToggleMode }: EditorToolbarProps) {
  const runCommand = useCallback(
    (command: (chain: ReturnType<NonNullable<typeof editor>['chain']>) => ReturnType<NonNullable<typeof editor>['chain']>) => {
      if (!editor) return
      command(editor.chain().focus()).run()
    },
    [editor]
  )

  const isActive = useCallback(
    (name: string, attrs?: Record<string, unknown>): boolean => {
      if (!editor) return false
      return editor.isActive(name, attrs)
    },
    [editor]
  )

  if (mode === 'source') {
    return (
      <div
        className="flex items-center h-9 px-3 border-b"
        style={{
          borderColor: colors.border.default,
          backgroundColor: colors.bg.surface,
        }}
      >
        <div className="flex-1" />
        <button
          onClick={onToggleMode}
          className="text-xs px-2 py-1"
          style={{
            color: colors.accent.default,
            backgroundColor: colors.accent.muted,
            borderRadius: borderRadius.inline,
            transition: `background-color ${transitions.hover}`,
          }}
        >
          Source
        </button>
      </div>
    )
  }

  return (
    <div
      className="flex items-center h-9 px-3 border-b"
      style={{
        borderColor: colors.border.default,
        backgroundColor: colors.bg.surface,
      }}
    >
      {/* Undo / Redo */}
      <ToolbarButton
        label="Undo"
        icon="↩"
        onClick={() => runCommand((c) => c.undo())}
        title="Undo (Cmd+Z)"
      />
      <ToolbarButton
        label="Redo"
        icon="↪"
        onClick={() => runCommand((c) => c.redo())}
        title="Redo (Cmd+Shift+Z)"
      />

      <ToolbarSeparator />

      {/* Headings */}
      <ToolbarButton
        label="H1"
        icon="H1"
        isActive={isActive('heading', { level: 1 })}
        onClick={() => runCommand((c) => c.toggleHeading({ level: 1 }))}
        title="Heading 1"
      />
      <ToolbarButton
        label="H2"
        icon="H2"
        isActive={isActive('heading', { level: 2 })}
        onClick={() => runCommand((c) => c.toggleHeading({ level: 2 }))}
        title="Heading 2"
      />
      <ToolbarButton
        label="H3"
        icon="H3"
        isActive={isActive('heading', { level: 3 })}
        onClick={() => runCommand((c) => c.toggleHeading({ level: 3 }))}
        title="Heading 3"
      />
      <ToolbarButton
        label="H4"
        icon="H4"
        isActive={isActive('heading', { level: 4 })}
        onClick={() => runCommand((c) => c.toggleHeading({ level: 4 }))}
        title="Heading 4"
      />

      <ToolbarSeparator />

      {/* Inline formatting */}
      <ToolbarButton
        label="Bold"
        icon="B"
        isActive={isActive('bold')}
        onClick={() => runCommand((c) => c.toggleBold())}
        title="Bold (Cmd+B)"
      />
      <ToolbarButton
        label="Italic"
        icon="I"
        isActive={isActive('italic')}
        onClick={() => runCommand((c) => c.toggleItalic())}
        title="Italic (Cmd+I)"
      />
      <ToolbarButton
        label="Strikethrough"
        icon="S̶"
        isActive={isActive('strike')}
        onClick={() => runCommand((c) => c.toggleStrike())}
        title="Strikethrough"
      />

      <ToolbarSeparator />

      {/* Lists */}
      <ToolbarButton
        label="Bullet List"
        icon="•"
        isActive={isActive('bulletList')}
        onClick={() => runCommand((c) => c.toggleBulletList())}
        title="Bullet List"
      />
      <ToolbarButton
        label="Ordered List"
        icon="1."
        isActive={isActive('orderedList')}
        onClick={() => runCommand((c) => c.toggleOrderedList())}
        title="Ordered List"
      />
      <ToolbarButton
        label="Task List"
        icon="☑"
        isActive={isActive('taskList')}
        onClick={() => runCommand((c) => c.toggleTaskList())}
        title="Task List"
      />

      <ToolbarSeparator />

      {/* Code & Link */}
      <ToolbarButton
        label="Code Block"
        icon="<>"
        isActive={isActive('codeBlock')}
        onClick={() => runCommand((c) => c.toggleCodeBlock())}
        title="Code Block"
      />
      <ToolbarButton
        label="Link"
        icon="🔗"
        isActive={isActive('link')}
        onClick={() => {
          if (!editor) return
          if (editor.isActive('link')) {
            editor.chain().focus().unsetLink().run()
          } else {
            const url = window.prompt('Enter URL:')
            if (url) {
              editor.chain().focus().setLink({ href: url }).run()
            }
          }
        }}
        title="Link (Cmd+K)"
      />

      {/* Right-aligned: Source mode toggle */}
      <div className="flex-1" />
      <button
        onClick={onToggleMode}
        className="text-xs px-2 py-1"
        style={{
          color: colors.text.muted,
          backgroundColor: 'transparent',
          borderRadius: borderRadius.inline,
          transition: `background-color ${transitions.hover}, color ${transitions.hover}`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = colors.bg.elevated
          e.currentTarget.style.color = colors.text.secondary
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = colors.text.muted
        }}
      >
        Rich
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/editor/EditorToolbar.tsx
git commit -m "feat: add EditorToolbar with Tiptap command buttons and source mode toggle"
```

---

### Task 46: Create EditorBreadcrumb component

**Files:**
- Create: `src/renderer/src/panels/editor/EditorBreadcrumb.tsx`

- [ ] **Step 1: Implement back/forward navigation with file path breadcrumb**

```typescript
// src/renderer/src/panels/editor/EditorBreadcrumb.tsx
import { useState, useCallback, useRef, useEffect } from 'react'
import { colors, transitions, borderRadius } from '../../design/tokens'

interface EditorBreadcrumbProps {
  filePath: string | null
  vaultPath: string | null
  onNavigateBack: () => void
  onNavigateForward: () => void
  canGoBack: boolean
  canGoForward: boolean
  onFolderClick?: (folderPath: string) => void
}

interface BreadcrumbSegment {
  name: string
  path: string
  isFile: boolean
}

export function parseBreadcrumb(filePath: string, vaultPath: string): readonly BreadcrumbSegment[] {
  const relative = filePath.startsWith(vaultPath + '/')
    ? filePath.slice(vaultPath.length + 1)
    : filePath
  const parts = relative.split('/')
  const segments: BreadcrumbSegment[] = []

  let currentPath = vaultPath
  for (let i = 0; i < parts.length; i++) {
    currentPath = `${currentPath}/${parts[i]}`
    segments.push({
      name: parts[i],
      path: currentPath,
      isFile: i === parts.length - 1,
    })
  }

  return segments
}

function NavButton({
  label,
  icon,
  enabled,
  onClick,
}: {
  label: string
  icon: string
  enabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      title={label}
      className="flex items-center justify-center w-6 h-6 text-xs"
      style={{
        color: enabled ? colors.text.secondary : colors.text.muted,
        opacity: enabled ? 1 : 0.4,
        borderRadius: borderRadius.inline,
        transition: `background-color ${transitions.hover}`,
        cursor: enabled ? 'pointer' : 'default',
      }}
      onMouseEnter={(e) => {
        if (enabled) e.currentTarget.style.backgroundColor = colors.bg.elevated
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      {icon}
    </button>
  )
}

export function EditorBreadcrumb({
  filePath,
  vaultPath,
  onNavigateBack,
  onNavigateForward,
  canGoBack,
  canGoForward,
  onFolderClick,
}: EditorBreadcrumbProps) {
  if (!filePath || !vaultPath) return null

  const segments = parseBreadcrumb(filePath, vaultPath)

  return (
    <div
      className="flex items-center h-7 px-3 gap-1 border-b"
      style={{
        borderColor: colors.border.default,
        backgroundColor: colors.bg.surface,
      }}
    >
      <NavButton
        label="Go back"
        icon="←"
        enabled={canGoBack}
        onClick={onNavigateBack}
      />
      <NavButton
        label="Go forward"
        icon="→"
        enabled={canGoForward}
        onClick={onNavigateForward}
      />

      <div className="mx-1 w-px h-3.5" style={{ backgroundColor: colors.border.default }} />

      <div className="flex items-center gap-0.5 text-xs overflow-hidden min-w-0">
        {segments.map((segment, i) => (
          <span key={segment.path} className="flex items-center gap-0.5 min-w-0">
            {i > 0 && (
              <span style={{ color: colors.text.muted }}>/</span>
            )}
            {segment.isFile ? (
              <span
                className="truncate"
                style={{ color: colors.text.primary }}
              >
                {segment.name}
              </span>
            ) : (
              <button
                onClick={() => onFolderClick?.(segment.path)}
                className="truncate"
                style={{
                  color: colors.text.secondary,
                  transition: `color ${transitions.hover}`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = colors.text.primary
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = colors.text.secondary
                }}
              >
                {segment.name}
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * Hook to manage navigation history for back/forward breadcrumb navigation.
 * Maintains an immutable stack of visited note IDs with a cursor.
 */
export function useNavigationHistory() {
  const historyRef = useRef<readonly string[]>([])
  const cursorRef = useRef(-1)
  const [, forceUpdate] = useState(0)

  const push = useCallback((noteId: string) => {
    const history = historyRef.current
    const cursor = cursorRef.current

    // If we're not at the end, truncate forward history
    const newHistory = cursor < history.length - 1
      ? [...history.slice(0, cursor + 1), noteId]
      : [...history, noteId]

    historyRef.current = newHistory
    cursorRef.current = newHistory.length - 1
    forceUpdate((n) => n + 1)
  }, [])

  const goBack = useCallback((): string | null => {
    if (cursorRef.current <= 0) return null
    cursorRef.current -= 1
    forceUpdate((n) => n + 1)
    return historyRef.current[cursorRef.current] ?? null
  }, [])

  const goForward = useCallback((): string | null => {
    if (cursorRef.current >= historyRef.current.length - 1) return null
    cursorRef.current += 1
    forceUpdate((n) => n + 1)
    return historyRef.current[cursorRef.current] ?? null
  }, [])

  return {
    push,
    goBack,
    goForward,
    canGoBack: cursorRef.current > 0,
    canGoForward: cursorRef.current < historyRef.current.length - 1,
  } as const
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/editor/EditorBreadcrumb.tsx
git commit -m "feat: add EditorBreadcrumb with back/forward navigation and file path"
```

---

### Task 47: Create FrontmatterHeader component

**Files:**
- Create: `src/renderer/src/panels/editor/FrontmatterHeader.tsx`

- [ ] **Step 1: Implement collapsible frontmatter metadata header**

```typescript
// src/renderer/src/panels/editor/FrontmatterHeader.tsx
import { useState, useMemo } from 'react'
import type { Artifact } from '@shared/types'
import { colors, ARTIFACT_COLORS, transitions, borderRadius, typeScale } from '../../design/tokens'

interface FrontmatterHeaderProps {
  artifact: Artifact
  mode: 'rich' | 'source'
}

interface MetadataEntry {
  key: string
  value: string
  color?: string
}

export function buildMetadataEntries(artifact: Artifact): readonly MetadataEntry[] {
  const entries: MetadataEntry[] = [
    { key: 'Type', value: artifact.type, color: ARTIFACT_COLORS[artifact.type] },
    { key: 'ID', value: artifact.id },
    { key: 'Signal', value: artifact.signal },
    { key: 'Created', value: artifact.created },
    { key: 'Modified', value: artifact.modified },
  ]

  if (artifact.source) {
    entries.push({ key: 'Source', value: artifact.source })
  }

  if (artifact.frame) {
    entries.push({ key: 'Frame', value: artifact.frame })
  }

  if (artifact.tags.length > 0) {
    entries.push({ key: 'Tags', value: artifact.tags.join(', ') })
  }

  return entries
}

function MetadataTag({ label, color }: { label: string; color?: string }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 text-xs"
      style={{
        borderRadius: borderRadius.inline,
        backgroundColor: color
          ? `${color}1A`
          : colors.bg.elevated,
        color: color ?? colors.text.secondary,
      }}
    >
      {label}
    </span>
  )
}

export function FrontmatterHeader({ artifact, mode }: FrontmatterHeaderProps) {
  const [collapsed, setCollapsed] = useState(true)

  const entries = useMemo(
    () => buildMetadataEntries(artifact),
    [artifact]
  )

  // In source mode, frontmatter is shown as raw YAML by CodeMirror
  if (mode === 'source') return null

  const typeColor = ARTIFACT_COLORS[artifact.type]

  return (
    <div
      className="border-b"
      style={{
        borderColor: colors.border.default,
        backgroundColor: colors.bg.surface,
      }}
    >
      {/* Summary row (always visible) */}
      <button
        onClick={() => setCollapsed((prev) => !prev)}
        className="flex items-center gap-2 w-full px-8 py-2 text-left"
        style={{
          transition: `background-color ${transitions.hover}`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = colors.bg.elevated
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
        }}
      >
        {/* Type dot */}
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: typeColor }}
        />

        {/* Type badge */}
        <MetadataTag label={artifact.type} color={typeColor} />

        {/* Signal badge */}
        <MetadataTag
          label={artifact.signal}
          color={artifact.signal === 'core' ? colors.accent.default : undefined}
        />

        {/* Tags */}
        {artifact.tags.slice(0, 3).map((tag) => (
          <MetadataTag key={tag} label={tag} />
        ))}
        {artifact.tags.length > 3 && (
          <span
            className="text-xs"
            style={{ color: colors.text.muted }}
          >
            +{artifact.tags.length - 3}
          </span>
        )}

        {/* Expand/collapse chevron */}
        <span
          className="ml-auto text-xs flex-shrink-0"
          style={{
            color: colors.text.muted,
            transition: `transform ${transitions.hover}`,
            transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
          }}
        >
          ▾
        </span>
      </button>

      {/* Expanded metadata (shown when not collapsed) */}
      {!collapsed && (
        <div
          className="px-8 pb-3 grid gap-y-1"
          style={{
            gridTemplateColumns: 'auto 1fr',
            columnGap: '12px',
          }}
        >
          {entries.map((entry) => (
            <div key={entry.key} className="contents">
              <span
                className="text-xs py-0.5"
                style={{
                  color: colors.text.muted,
                  fontSize: typeScale.display.label.size,
                  textTransform: typeScale.display.label.textTransform,
                  letterSpacing: typeScale.display.label.letterSpacing,
                }}
              >
                {entry.key}
              </span>
              <span
                className="text-xs py-0.5"
                style={{ color: entry.color ?? colors.text.secondary }}
              >
                {entry.value}
              </span>
            </div>
          ))}

          {/* Connections summary */}
          {artifact.connections.length > 0 && (
            <div className="contents">
              <span
                className="text-xs py-0.5"
                style={{
                  color: colors.text.muted,
                  fontSize: typeScale.display.label.size,
                  textTransform: typeScale.display.label.textTransform,
                  letterSpacing: typeScale.display.label.letterSpacing,
                }}
              >
                Connections
              </span>
              <span
                className="text-xs py-0.5"
                style={{ color: colors.text.secondary }}
              >
                {artifact.connections.join(', ')}
              </span>
            </div>
          )}

          {artifact.clusters_with.length > 0 && (
            <div className="contents">
              <span
                className="text-xs py-0.5"
                style={{
                  color: colors.text.muted,
                  fontSize: typeScale.display.label.size,
                  textTransform: typeScale.display.label.textTransform,
                  letterSpacing: typeScale.display.label.letterSpacing,
                }}
              >
                Clusters
              </span>
              <span
                className="text-xs py-0.5"
                style={{ color: colors.semantic.cluster }}
              >
                {artifact.clusters_with.join(', ')}
              </span>
            </div>
          )}

          {artifact.tensions_with.length > 0 && (
            <div className="contents">
              <span
                className="text-xs py-0.5"
                style={{
                  color: colors.text.muted,
                  fontSize: typeScale.display.label.size,
                  textTransform: typeScale.display.label.textTransform,
                  letterSpacing: typeScale.display.label.letterSpacing,
                }}
              >
                Tensions
              </span>
              <span
                className="text-xs py-0.5"
                style={{ color: colors.semantic.tension }}
              >
                {artifact.tensions_with.join(', ')}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/editor/FrontmatterHeader.tsx
git commit -m "feat: add FrontmatterHeader with collapsible metadata display"
```

---

### Task 48: Create BacklinksPanel component

**Files:**
- Create: `src/renderer/src/panels/editor/BacklinksPanel.tsx`

- [ ] **Step 1: Implement collapsible backlinks panel**

```typescript
// src/renderer/src/panels/editor/BacklinksPanel.tsx
import { useState, useMemo } from 'react'
import type { Artifact } from '@shared/types'
import { colors, ARTIFACT_COLORS, transitions, borderRadius, typeScale } from '../../design/tokens'

interface BacklinkEntry {
  artifact: Artifact
  contextLine: string
}

interface BacklinksPanelProps {
  currentNoteId: string
  backlinks: readonly Artifact[]
  onNavigate: (id: string) => void
}

export function extractContext(body: string, targetId: string): string {
  const lines = body.split('\n')
  for (const line of lines) {
    if (line.includes(targetId)) {
      const idx = line.indexOf(targetId)
      const start = Math.max(0, idx - 50)
      const end = Math.min(line.length, idx + targetId.length + 50)
      const prefix = start > 0 ? '...' : ''
      const suffix = end < line.length ? '...' : ''
      return `${prefix}${line.slice(start, end)}${suffix}`
    }
  }
  // Fallback: return first 100 chars of body
  return body.length > 100 ? `${body.slice(0, 100)}...` : body
}

function BacklinkItem({
  entry,
  onNavigate,
}: {
  entry: BacklinkEntry
  onNavigate: (id: string) => void
}) {
  const typeColor = ARTIFACT_COLORS[entry.artifact.type]

  return (
    <button
      onClick={() => onNavigate(entry.artifact.id)}
      className="w-full text-left px-4 py-2 flex items-start gap-2"
      style={{
        transition: `background-color ${transitions.hover}`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = colors.bg.elevated
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      {/* Artifact type dot */}
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
        style={{ backgroundColor: typeColor }}
      />

      <div className="min-w-0 flex-1">
        {/* Title */}
        <div
          className="text-xs truncate"
          style={{ color: colors.text.primary }}
        >
          {entry.artifact.title}
        </div>

        {/* Context line */}
        <div
          className="text-xs mt-0.5 line-clamp-2"
          style={{
            color: colors.text.muted,
            fontSize: typeScale.display.secondary.size,
          }}
        >
          {entry.contextLine}
        </div>
      </div>
    </button>
  )
}

export function BacklinksPanel({
  currentNoteId,
  backlinks,
  onNavigate,
}: BacklinksPanelProps) {
  const [expanded, setExpanded] = useState(false)

  const entries: readonly BacklinkEntry[] = useMemo(
    () =>
      backlinks.map((artifact) => ({
        artifact,
        contextLine: extractContext(artifact.body, currentNoteId),
      })),
    [backlinks, currentNoteId]
  )

  if (backlinks.length === 0) return null

  return (
    <div
      className="border-t"
      style={{
        borderColor: colors.border.default,
        backgroundColor: colors.bg.surface,
      }}
    >
      {/* Toggle button */}
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-2 w-full px-4 py-1.5 text-left"
        style={{
          transition: `background-color ${transitions.hover}`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = colors.bg.elevated
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
        }}
      >
        <span
          className="text-xs"
          style={{
            color: colors.text.muted,
            transition: `transform ${transitions.hover}`,
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          ▸
        </span>
        <span
          className="text-xs"
          style={{
            color: colors.text.secondary,
            fontSize: typeScale.display.label.size,
            textTransform: typeScale.display.label.textTransform,
            letterSpacing: typeScale.display.label.letterSpacing,
          }}
        >
          Backlinks ({backlinks.length})
        </span>
      </button>

      {/* Backlink entries */}
      {expanded && (
        <div className="pb-1">
          {entries.map((entry) => (
            <BacklinkItem
              key={entry.artifact.id}
              entry={entry}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/editor/BacklinksPanel.tsx
git commit -m "feat: add BacklinksPanel with context extraction and navigation"
```

---

### Task 49: Integrate toolbar, breadcrumb, frontmatter, and backlinks into EditorPanel

**Files:**
- Modify: `src/renderer/src/store/editor-store.ts`
- Modify: `src/renderer/src/panels/editor/EditorPanel.tsx`

- [ ] **Step 1: Add cursor position state and action to editor-store**

Add `cursorLine`, `cursorCol`, and `setCursorPosition` to `src/renderer/src/store/editor-store.ts`:

```typescript
// Add to editor-store state interface:
cursorLine: number
cursorCol: number

// Add to editor-store actions:
setCursorPosition: (line: number, col: number) => void

// Add to initial state:
cursorLine: 1,
cursorCol: 1,

// Add to actions implementation:
setCursorPosition: (line: number, col: number) => set({ cursorLine: line, cursorCol: col }),
```

- [ ] **Step 2: Replace EditorPanel with integrated version**

```typescript
// src/renderer/src/panels/editor/EditorPanel.tsx
import { useCallback, useRef } from 'react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import { useEditorStore } from '../../store/editor-store'
import { useVaultStore } from '../../store/vault-store'
import { EditorToolbar } from './EditorToolbar'
import { EditorBreadcrumb, useNavigationHistory } from './EditorBreadcrumb'
import { FrontmatterHeader } from './FrontmatterHeader'
import { BacklinksPanel } from './BacklinksPanel'
import { RichEditor } from './RichEditor'
import { SourceEditor } from './SourceEditor'
import { colors } from '../../design/tokens'

interface EditorPanelProps {
  onNavigate: (id: string) => void
}

export function EditorPanel({ onNavigate }: EditorPanelProps) {
  const { activeNoteId, activeNotePath, mode, content, setMode, setContent } = useEditorStore()
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const artifacts = useVaultStore((s) => s.artifacts)
  // Lift useEditor into EditorPanel so the editor instance is shared
  // between EditorToolbar (needs it for commands) and RichEditor (renders
  // with it). This avoids the dead-toolbar bug where a ref-based approach
  // left editorRef.current always null because RichEditor created its own
  // internal editor.
  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false }),
    ],
    content,
    onUpdate: ({ editor: e }) => {
      setContent(e.getHTML())
    },
    // Track cursor position for StatusBar (see Task 50)
    onSelectionUpdate: ({ editor: e }) => {
      const { from } = e.state.selection
      const textBefore = e.state.doc.textBetween(0, from, '\n')
      const lines = textBefore.split('\n')
      useEditorStore.getState().setCursorPosition(lines.length, (lines.at(-1)?.length ?? 0) + 1)
    },
  })

  const artifact = activeNoteId ? artifacts.find((a) => a.id === activeNoteId) ?? null : null

  const { push, goBack, goForward, canGoBack, canGoForward } = useNavigationHistory()

  // Track navigation in breadcrumb history
  const prevNoteRef = useRef<string | null>(null)
  if (activeNoteId && activeNoteId !== prevNoteRef.current) {
    prevNoteRef.current = activeNoteId
    push(activeNoteId)
  }

  const handleNavigateBack = useCallback(() => {
    const id = goBack()
    if (id) onNavigate(id)
  }, [goBack, onNavigate])

  const handleNavigateForward = useCallback(() => {
    const id = goForward()
    if (id) onNavigate(id)
  }, [goForward, onNavigate])

  const handleToggleMode = useCallback(() => {
    setMode(mode === 'rich' ? 'source' : 'rich')
  }, [mode, setMode])

  // Backlinks: use the getBacklinks store action (exposed on vault-store).
  // After Task 19 (Web Worker migration), vault-store holds graph as plain
  // state. getBacklinks uses graph.edges to build a reverse lookup, avoiding
  // the fragile (store as any).index cast.
  const backlinks = useVaultStore((s) => {
    if (!activeNoteId) return []
    return s.getBacklinks(activeNoteId)
  })

  if (!artifact) {
    return (
      <div
        className="h-full flex items-center justify-center"
        style={{ backgroundColor: colors.bg.base, color: colors.text.muted }}
      >
        <div className="text-center">
          <p className="text-lg mb-2">No note selected</p>
          <p className="text-sm">Select a note from the sidebar or press Cmd+N to create one</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: colors.bg.base }}>
      {/* Breadcrumb navigation */}
      <EditorBreadcrumb
        filePath={activeNotePath}
        vaultPath={vaultPath}
        onNavigateBack={handleNavigateBack}
        onNavigateForward={handleNavigateForward}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
      />

      {/* Toolbar: receives the lifted editor instance directly */}
      <EditorToolbar
        editor={editor}
        mode={mode}
        onToggleMode={handleToggleMode}
      />

      {/* Frontmatter header */}
      <FrontmatterHeader artifact={artifact} mode={mode} />

      {/* Editor content: RichEditor receives the lifted editor instance */}
      <div className="flex-1 overflow-hidden">
        {mode === 'rich' ? (
          <RichEditor editor={editor} />
        ) : (
          <SourceEditor content={content} onChange={setContent} />
        )}
      </div>

      {/* Backlinks panel */}
      <BacklinksPanel
        currentNoteId={activeNoteId!}
        backlinks={backlinks}
        onNavigate={onNavigate}
      />
    </div>
  )
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`

- [ ] **Step 4: Run tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/store/editor-store.ts src/renderer/src/panels/editor/EditorPanel.tsx
git commit -m "feat: integrate toolbar, breadcrumb, frontmatter, and backlinks into EditorPanel"
```

> **Note on RichEditor interface change**: With `useEditor` lifted into EditorPanel, the
> `RichEditor` component no longer creates its own editor. Its props change from
> `{ content: string; onChange: (c: string) => void }` to `{ editor: Editor | null }`.
> RichEditor becomes a thin wrapper rendering `<EditorContent editor={editor} />` with
> styling. This is a minimal change to RichEditor (remove internal `useEditor` call,
> accept the `editor` prop, keep the `EditorContent` render).

---

### Task 50: Create StatusBar component

**Files:**
- Create: `src/renderer/src/components/StatusBar.tsx`

- [ ] **Step 1: Implement context-sensitive status bar**

```typescript
// src/renderer/src/components/StatusBar.tsx
import { useState, useEffect, useMemo } from 'react'
import { useVaultStore } from '../store/vault-store'
import { useEditorStore } from '../store/editor-store'
import { useGraphStore } from '../store/graph-store'
import { colors, transitions, typeScale } from '../design/tokens'

interface GitStatus {
  branch: string | null
  isDirty: boolean
}

function useGitStatus(vaultPath: string | null): GitStatus {
  const [branch, setBranch] = useState<string | null>(null)
  // TODO: Git dirty status requires a `vault:git-status` IPC call that does
  // not exist yet. When implemented, it should run `git status --porcelain`
  // and return whether the working tree has uncommitted changes. For now,
  // isDirty defaults to false (always shows green dot). Add the IPC handler
  // to src/main/ipc/ and wire it through the preload allowlist.
  const [isDirty] = useState(false)

  useEffect(() => {
    if (!vaultPath) return
    // TODO: Add vault:git-branch to window.api surface
    // Git branch detection is deferred until IPC expansion.
    // When added, call: window.api.vault.gitBranch(vaultPath)
    // For now, branch remains null (no git info shown).
    setBranch(null)
  }, [vaultPath])

  return { branch, isDirty }
}

function StatusDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full"
      style={{ backgroundColor: color }}
    />
  )
}

interface EditorStatusProps {
  content: string
  cursorLine: number
  cursorCol: number
}

function EditorStatus({ content, cursorLine, cursorCol }: EditorStatusProps) {
  const wordCount = useMemo(() => {
    const trimmed = content.trim()
    if (trimmed.length === 0) return 0
    return trimmed.split(/\s+/).length
  }, [content])

  return (
    <div className="flex items-center gap-3">
      <span>Ln {cursorLine}, Col {cursorCol}</span>
      <span>{wordCount} words</span>
      <span>UTF-8</span>
    </div>
  )
}

interface GraphStatusProps {
  nodeCount: number
  edgeCount: number
  selectedNodeName: string | null
}

function GraphStatus({ nodeCount, edgeCount, selectedNodeName }: GraphStatusProps) {
  return (
    <div className="flex items-center gap-3">
      <span>{nodeCount} nodes</span>
      <span>{edgeCount} edges</span>
      {selectedNodeName && (
        <span style={{ color: colors.text.secondary }}>{selectedNodeName}</span>
      )}
    </div>
  )
}

export function StatusBar() {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const files = useVaultStore((s) => s.files)
  const contentView = useGraphStore((s) => s.contentView)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const content = useEditorStore((s) => s.content)

  const { branch, isDirty } = useGitStatus(vaultPath)
  const vaultName = vaultPath?.split('/').pop() ?? 'Thought Engine'

  // Graph data for status (after Task 19, vault-store holds graph as plain state)
  const graph = useVaultStore((s) => s.graph)

  const selectedNodeName = useMemo(() => {
    if (!selectedNodeId || !graph) return null
    const node = graph.nodes.find((n) => n.id === selectedNodeId)
    return node?.title ?? null
  }, [selectedNodeId, graph])

  // Cursor position: read from editor-store (set by EditorPanel's
  // onSelectionUpdate callback via setCursorPosition action)
  const cursorLine = useEditorStore((s) => s.cursorLine)
  const cursorCol = useEditorStore((s) => s.cursorCol)

  return (
    <div
      className="h-6 flex items-center px-3 text-xs select-none"
      style={{
        backgroundColor: colors.bg.surface,
        color: colors.text.muted,
        fontSize: typeScale.display.secondary.size,
        borderTop: `1px solid ${colors.border.default}`,
      }}
    >
      {/* Left side: always visible */}
      <div className="flex items-center gap-2">
        <span style={{ color: colors.text.secondary }}>{vaultName}</span>
        <span>&middot;</span>
        <span>{files.length} notes</span>
        {branch && (
          <>
            <span>&middot;</span>
            <span className="flex items-center gap-1">
              <StatusDot color={isDirty ? colors.semantic.tension : colors.semantic.cluster} />
              {branch}
            </span>
          </>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side: context-sensitive */}
      <div style={{ color: colors.text.muted }}>
        {contentView === 'editor' ? (
          <EditorStatus
            content={content}
            cursorLine={cursorLine}
            cursorCol={cursorCol}
          />
        ) : (
          <GraphStatus
            nodeCount={graph.nodes.length}
            edgeCount={graph.edges.length}
            selectedNodeName={selectedNodeName}
          />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/components/StatusBar.tsx
git commit -m "feat: add context-sensitive StatusBar with editor/graph modes"
```

> **Note on editor-store cursor tracking**: StatusBar reads `cursorLine` and `cursorCol`
> from editor-store. These fields and the `setCursorPosition` action are added in Task 49
> Step 1. The `onSelectionUpdate` callback in EditorPanel (Task 49 Step 2) calls
> `setCursorPosition` whenever the Tiptap selection changes. For SourceEditor (CodeMirror),
> add an equivalent `EditorView.updateListener` that calls `setCursorPosition` from the
> CodeMirror cursor state.

---

### Task 51: Replace inline StatusBar in App.tsx with new component

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Replace the inline StatusBar function and import the new component**

Remove the `StatusBar` function defined inline in App.tsx (lines 17-46) and replace it with an import of the new component.

In the imports section, add:

```typescript
import { StatusBar } from './components/StatusBar'
```

Remove the entire inline `function StatusBar() { ... }` block (the one that uses `useState`, `useEffect`, `useVaultStore` for git branch fetching, and renders a div with vault name, note count, and git branch).

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`

- [ ] **Step 3: Run tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing

- [ ] **Step 4: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/App.tsx
git commit -m "refactor: replace inline StatusBar with extracted component"
```

---

### Task 52: Create useGraphKeyboard hook

**Files:**
- Create: `src/renderer/src/panels/graph/useGraphKeyboard.ts`
- Test: `tests/engine/graph-keyboard.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/engine/graph-keyboard.test.ts
import { describe, it, expect } from 'vitest'
import { sortNodesAlphabetically, findNearestNeighbor } from '../../src/renderer/src/panels/graph/useGraphKeyboard'

describe('useGraphKeyboard helpers', () => {
  const nodes = [
    { id: 'c1', title: 'Constraint', x: 100, y: 200 },
    { id: 'g1', title: 'Alpha Gene', x: 0, y: 0 },
    { id: 'g2', title: 'Beta Gene', x: 200, y: 0 },
    { id: 'n1', title: 'Zeta Note', x: 300, y: 300 },
  ]

  const edges = [
    { source: 'g1', target: 'g2', kind: 'connection' as const },
    { source: 'g1', target: 'c1', kind: 'tension' as const },
  ]

  it('sorts nodes alphabetically by title', () => {
    const sorted = sortNodesAlphabetically(nodes)
    expect(sorted.map((n) => n.id)).toEqual(['g1', 'g2', 'c1', 'n1'])
  })

  it('finds nearest neighbor to the right', () => {
    const neighbor = findNearestNeighbor(nodes[1], nodes, edges, 'ArrowRight')
    // g2 is at x=200, c1 is at x=100; both connected to g1. g2 has larger x delta
    // c1 is at y=200 (below and right), g2 is at y=0 (directly right)
    // For ArrowRight, we want the node with the largest positive x delta among neighbors
    expect(neighbor?.id).toBe('g2')
  })

  it('finds nearest neighbor downward', () => {
    const neighbor = findNearestNeighbor(nodes[1], nodes, edges, 'ArrowDown')
    // c1 is at y=200 (below), g2 is at y=0 (same level). c1 is the downward neighbor
    expect(neighbor?.id).toBe('c1')
  })

  it('returns null when no neighbor in that direction', () => {
    const neighbor = findNearestNeighbor(nodes[1], nodes, edges, 'ArrowLeft')
    // g1 is at 0,0; no connected node is to the left
    expect(neighbor).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/graph-keyboard.test.ts`

- [ ] **Step 3: Implement the keyboard navigation hook**

```typescript
// src/renderer/src/panels/graph/useGraphKeyboard.ts
import { useCallback, useEffect, useRef } from 'react'

interface PositionedNode {
  id: string
  title: string
  x: number
  y: number
}

type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

/** Sort nodes alphabetically by title for Tab/Shift+Tab cycling. */
export function sortNodesAlphabetically<T extends { title: string }>(
  nodes: readonly T[]
): readonly T[] {
  return [...nodes].sort((a, b) => a.title.localeCompare(b.title))
}

/** Find the nearest connected neighbor in the given arrow key direction. */
export function findNearestNeighbor(
  current: PositionedNode,
  allNodes: readonly PositionedNode[],
  edges: readonly { source: string; target: string; kind: string }[],
  direction: ArrowKey
): PositionedNode | null {
  // Build set of connected node IDs
  const connectedIds = new Set<string>()
  for (const edge of edges) {
    const sourceId = typeof edge.source === 'string' ? edge.source : (edge.source as any).id
    const targetId = typeof edge.target === 'string' ? edge.target : (edge.target as any).id
    if (sourceId === current.id) connectedIds.add(targetId)
    if (targetId === current.id) connectedIds.add(sourceId)
  }

  // Filter to connected nodes with positions
  const neighbors = allNodes.filter(
    (n) => connectedIds.has(n.id) && n.x !== undefined && n.y !== undefined
  )

  if (neighbors.length === 0) return null

  // Filter by direction
  const candidates = neighbors.filter((n) => {
    const dx = n.x - current.x
    const dy = n.y - current.y
    switch (direction) {
      case 'ArrowRight':
        return dx > 0 && Math.abs(dx) >= Math.abs(dy)
      case 'ArrowLeft':
        return dx < 0 && Math.abs(dx) >= Math.abs(dy)
      case 'ArrowDown':
        return dy > 0 && Math.abs(dy) >= Math.abs(dx)
      case 'ArrowUp':
        return dy < 0 && Math.abs(dy) >= Math.abs(dx)
      default:
        return false
    }
  })

  if (candidates.length === 0) return null

  // Pick the closest by Euclidean distance
  let closest = candidates[0]
  let closestDist = Infinity
  for (const c of candidates) {
    const dist = Math.hypot(c.x - current.x, c.y - current.y)
    if (dist < closestDist) {
      closestDist = dist
      closest = c
    }
  }

  return closest
}

interface UseGraphKeyboardOptions {
  nodes: readonly PositionedNode[]
  edges: readonly { source: string; target: string; kind: string }[]
  selectedNodeId: string | null
  onSelectNode: (id: string | null) => void
  onOpenNode: (id: string) => void
  onToggleSelect: (id: string) => void
  enabled: boolean
}

export function useGraphKeyboard({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onOpenNode,
  onToggleSelect,
  enabled,
}: UseGraphKeyboardOptions) {
  const sortedRef = useRef<readonly PositionedNode[]>([])

  // Keep sorted list in sync
  useEffect(() => {
    sortedRef.current = sortNodesAlphabetically(nodes)
  }, [nodes])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled || nodes.length === 0) return

      const sorted = sortedRef.current

      switch (e.key) {
        case 'Tab': {
          e.preventDefault()
          if (sorted.length === 0) return

          if (selectedNodeId === null) {
            // Select first node
            onSelectNode(sorted[0].id)
            return
          }

          const currentIdx = sorted.findIndex((n) => n.id === selectedNodeId)
          if (e.shiftKey) {
            // Previous node
            const prevIdx = currentIdx <= 0 ? sorted.length - 1 : currentIdx - 1
            onSelectNode(sorted[prevIdx].id)
          } else {
            // Next node
            const nextIdx = currentIdx >= sorted.length - 1 ? 0 : currentIdx + 1
            onSelectNode(sorted[nextIdx].id)
          }
          return
        }

        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault()
          if (!selectedNodeId) return

          const current = nodes.find((n) => n.id === selectedNodeId)
          if (!current) return

          const neighbor = findNearestNeighbor(current, nodes, edges, e.key as ArrowKey)
          if (neighbor) {
            onSelectNode(neighbor.id)
          }
          return
        }

        case 'Enter': {
          e.preventDefault()
          if (selectedNodeId) {
            onOpenNode(selectedNodeId)
          }
          return
        }

        case ' ': {
          e.preventDefault()
          if (selectedNodeId) {
            onToggleSelect(selectedNodeId)
          }
          return
        }

        case 'Escape': {
          e.preventDefault()
          onSelectNode(null)
          return
        }
      }
    },
    [enabled, nodes, edges, selectedNodeId, onSelectNode, onOpenNode, onToggleSelect]
  )

  return { handleKeyDown }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/graph-keyboard.test.ts`

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/graph/useGraphKeyboard.ts tests/engine/graph-keyboard.test.ts
git commit -m "feat: add useGraphKeyboard hook with Tab cycling and arrow key navigation"
```

---

### Task 53: Integrate keyboard navigation into GraphPanel

**Files:**
- Modify: `src/renderer/src/panels/graph/GraphPanel.tsx`

- [ ] **Step 1: Add keyboard handler integration, tabIndex, and focus management**

Add the following changes to `src/renderer/src/panels/graph/GraphPanel.tsx`:

Import the keyboard hook at the top:

```typescript
import { useGraphKeyboard } from './useGraphKeyboard'
```

Inside the `GraphPanel` component, after the existing `handleClick` callback, add the keyboard hook setup:

Add a type guard function before the component (or at the top of the file):

```typescript
/** Type guard that narrows SimNode to a node with concrete x/y positions.
 * TypeScript cannot narrow through Array.filter() without an explicit type predicate. */
interface SimNode { id: string; title: string; x?: number; y?: number }
function hasPosition(n: SimNode): n is SimNode & { x: number; y: number } {
  return n.x !== undefined && n.y !== undefined
}
```

Inside the `GraphPanel` component, after the existing `handleClick` callback, add:

```typescript
  const [isFocused, setIsFocused] = useState(false)

  // Derive from graph state (reactive value that changes when nodes update),
  // not getGraph (stable function reference that never changes).
  const graph = useVaultStore((s) => s.graph)

  // Build positioned nodes for keyboard navigation.
  // Uses type guard hasPosition() so TypeScript narrows x/y to number
  // through the .filter() call (plain arrow predicates don't narrow).
  const positionedNodes = useMemo(
    () =>
      nodesRef.current
        .filter(hasPosition)
        .map((n) => ({ id: n.id, title: n.title, x: n.x, y: n.y })),
    // Depend on graph (reactive state) so this recomputes when nodes change.
    // getGraph is a stable function reference that never triggers recomputation.
    [graph]
  )

  const handleOpenNode = useCallback(
    (id: string) => {
      setSelectedNode(id)
      onNodeClick(id)
    },
    [setSelectedNode, onNodeClick]
  )

  const handleToggleSelect = useCallback(
    (id: string) => {
      setSelectedNode(selectedNodeId === id ? null : id)
    },
    [selectedNodeId, setSelectedNode]
  )

  const { handleKeyDown: graphKeyDown } = useGraphKeyboard({
    nodes: positionedNodes,
    edges: edgesRef.current,
    selectedNodeId,
    onSelectNode: setSelectedNode,
    onOpenNode: handleOpenNode,
    onToggleSelect: handleToggleSelect,
    enabled: isFocused,
  })

  useEffect(() => {
    if (!isFocused) return
    const handler = (e: KeyboardEvent) => graphKeyDown(e)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isFocused, graphKeyDown])
```

Add `useState` and `useMemo` to the existing React imports.

Update the canvas wrapper div to include `tabIndex`, focus ring styling, and focus/blur handlers:

```typescript
  return (
    <div
      className="h-full relative focus-ring"
      style={{ backgroundColor: colors.bg.base }}
      tabIndex={0}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ backgroundColor: colors.bg.base }}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
      />
      {isEmpty && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ color: colors.text.muted }}
        >
          <div className="text-center">
            <p className="text-lg mb-2">No notes yet</p>
            <p className="text-sm">Create a note to see your knowledge graph</p>
          </div>
        </div>
      )}
    </div>
  )
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`

- [ ] **Step 3: Run tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing

- [ ] **Step 4: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/graph/GraphPanel.tsx
git commit -m "feat: integrate keyboard navigation into GraphPanel with focus management"
```

---

### Task 54: Add animation helpers to GraphRenderer

**Files:**
- Modify: `src/renderer/src/panels/graph/GraphRenderer.ts`

- [ ] **Step 1: Add reduced motion detection and animation timing utilities**

Add the following at the top of `GraphRenderer.ts`, after the existing imports:

```typescript
import { animations } from '../../design/tokens'

/** Check if the user prefers reduced motion. Cache result for the session. */
let _prefersReducedMotion: boolean | null = null
export function prefersReducedMotion(): boolean {
  if (_prefersReducedMotion === null) {
    _prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // Listen for changes
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
      _prefersReducedMotion = e.matches
    })
  }
  return _prefersReducedMotion
}

/** Parse a timing string like '200ms ease-out' into milliseconds. */
export function parseAnimationMs(timing: string): number {
  const match = timing.match(/^(\d+)ms/)
  return match ? parseInt(match[1], 10) : 0
}

/**
 * Animation durations from tokens, in milliseconds.
 * When prefers-reduced-motion is active, all durations return 0.
 */
export const ANIMATION_MS = {
  nodeHoverGlow: () => prefersReducedMotion() ? 0 : parseAnimationMs(animations.graphNodeHoverGlow),
  networkReveal: () => prefersReducedMotion() ? 0 : parseAnimationMs(animations.graphNetworkReveal),
  networkDim: () => prefersReducedMotion() ? 0 : parseAnimationMs(animations.graphNetworkDim),
  nodeEnter: () => prefersReducedMotion() ? 0 : parseAnimationMs(animations.graphNodeEnter),
  nodeExit: () => prefersReducedMotion() ? 0 : parseAnimationMs(animations.graphNodeExit),
  spatialTransition: () => prefersReducedMotion() ? 0 : parseAnimationMs(animations.spatialTransition),
} as const
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`

- [ ] **Step 3: Run tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All passing

- [ ] **Step 4: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/graph/GraphRenderer.ts
git commit -m "feat: add reduced motion detection and animation timing utilities to GraphRenderer"
```

---

### Task 55: Audit and replace hardcoded hex colors with design tokens

**Files:**
- Modify: Multiple renderer source files (audit pass)

Spec 4A requires all hardcoded hex colors to be replaced with references from `tokens.ts`. This task performs a systematic audit and replacement.

- [ ] **Step 1: Search for hardcoded hex colors in renderer source**

Run: `cd /Users/caseytalbot/Projects/thought-engine && grep -rn '#[0-9A-Fa-f]\{6\}' src/renderer/src/ --include='*.tsx' --include='*.ts' | grep -v 'tokens.ts' | grep -v 'node_modules' | grep -v '.test.'`

This identifies every file with a hardcoded hex color that is not in `tokens.ts` itself.

- [ ] **Step 2: Replace hardcoded colors with token references**

For each file found in Step 1, replace hardcoded hex values with the corresponding token from `tokens.ts`:

| Hardcoded value | Token replacement |
|-----------------|-------------------|
| `#0A0A0B` | `colors.bg.base` |
| `#111113` | `colors.bg.surface` |
| `#1A1A1D` | `colors.bg.elevated` |
| `#2A2A2E` | `colors.border.default` |
| `#EDEDEF` | `colors.text.primary` |
| `#8B8B8E` | `colors.text.secondary` |
| `#5A5A5E` | `colors.text.muted` |
| `#6C63FF` | `colors.accent.default` |
| `#7B73FF` | `colors.accent.hover` |
| `#EF4444` | `ARTIFACT_COLORS.constraint` |
| `#2DD4BF` | `ARTIFACT_COLORS.research` |
| `#EC4899` | `ARTIFACT_COLORS.output` |
| `#38BDF8` | `ARTIFACT_COLORS.index` |
| `#34D399` | `colors.semantic.cluster` |
| `#F59E0B` | `colors.semantic.tension` |

For any hex color not in the mapping table above, add it to `tokens.ts` under the appropriate category before replacing the reference.

Import `colors` (and `ARTIFACT_COLORS` if needed) from `../../design/tokens` in each modified file.

- [ ] **Step 3: Verify no remaining hardcoded colors**

Run: `cd /Users/caseytalbot/Projects/thought-engine && grep -rn '#[0-9A-Fa-f]\{6\}' src/renderer/src/ --include='*.tsx' --include='*.ts' | grep -v 'tokens.ts' | grep -v 'node_modules' | grep -v '.test.' | grep -v '\.css'`

Expected: No output (all hex colors are in tokens.ts or CSS custom properties)

- [ ] **Step 4: Run typecheck and tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck && npm test`
Expected: All passing

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/
git commit -m "refactor: replace hardcoded hex colors with design token references"
```

---

### Task 56: Add tests for Phase 4 component pure logic functions

**Files:**
- Create: `tests/editor/editor-components.test.ts`
- Create: `tests/components/status-bar.test.ts`

Five new components from Phase 4 (EditorToolbar, EditorBreadcrumb, FrontmatterHeader, BacklinksPanel, StatusBar) contain pure logic functions that should be tested. This task covers the extractable pure logic, not the React rendering.

- [ ] **Step 1: Write tests for editor component logic**

```typescript
// tests/editor/editor-components.test.ts
import { describe, it, expect } from 'vitest'

// Import pure functions. These must be exported from their respective modules.
// parseBreadcrumb is exported from EditorBreadcrumb.tsx
// buildMetadataEntries is exported from FrontmatterHeader.tsx
// extractContext is exported from BacklinksPanel.tsx

describe('parseBreadcrumb', () => {
  // Dynamically import to avoid JSX transform issues in pure test file
  it('parses a file path into breadcrumb segments', async () => {
    const { parseBreadcrumb } = await import(
      '../../src/renderer/src/panels/editor/EditorBreadcrumb'
    )
    const segments = parseBreadcrumb('/vault/folder/note.md', '/vault')
    expect(segments).toHaveLength(2)
    expect(segments[0]).toEqual({
      name: 'folder',
      path: '/vault/folder',
      isFile: false,
    })
    expect(segments[1]).toEqual({
      name: 'note.md',
      path: '/vault/folder/note.md',
      isFile: true,
    })
  })

  it('handles deeply nested paths', async () => {
    const { parseBreadcrumb } = await import(
      '../../src/renderer/src/panels/editor/EditorBreadcrumb'
    )
    const segments = parseBreadcrumb('/vault/a/b/c/d.md', '/vault')
    expect(segments).toHaveLength(4)
    expect(segments[3].isFile).toBe(true)
    expect(segments[0].isFile).toBe(false)
  })

  it('handles root-level file', async () => {
    const { parseBreadcrumb } = await import(
      '../../src/renderer/src/panels/editor/EditorBreadcrumb'
    )
    const segments = parseBreadcrumb('/vault/root.md', '/vault')
    expect(segments).toHaveLength(1)
    expect(segments[0].isFile).toBe(true)
    expect(segments[0].name).toBe('root.md')
  })
})

describe('buildMetadataEntries', () => {
  it('builds entries from artifact fields', async () => {
    const { buildMetadataEntries } = await import(
      '../../src/renderer/src/panels/editor/FrontmatterHeader'
    )
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
      body: 'test body',

    }
    const entries = buildMetadataEntries(artifact)
    expect(entries.length).toBeGreaterThanOrEqual(5)
    expect(entries[0].key).toBe('Type')
    expect(entries[0].value).toBe('gene')
    expect(entries.find((e) => e.key === 'Tags')?.value).toBe('ai, design')
  })

  it('omits optional fields when absent', async () => {
    const { buildMetadataEntries } = await import(
      '../../src/renderer/src/panels/editor/FrontmatterHeader'
    )
    const artifact = {
      id: 'test-2',
      type: 'note' as const,
      title: 'Minimal',
      signal: 'supporting' as const,
      created: '2026-03-01',
      modified: '2026-03-01',
      tags: [],
      connections: [],
      clusters_with: [],
      tensions_with: [],
      appears_in: [],
      body: '',

    }
    const entries = buildMetadataEntries(artifact)
    expect(entries.find((e) => e.key === 'Source')).toBeUndefined()
    expect(entries.find((e) => e.key === 'Tags')).toBeUndefined()
  })
})

describe('extractContext', () => {
  it('extracts context around target ID in body', async () => {
    const { extractContext } = await import(
      '../../src/renderer/src/panels/editor/BacklinksPanel'
    )
    const body = 'Some text before the target-id and some text after'
    const result = extractContext(body, 'target-id')
    expect(result).toContain('target-id')
    expect(result.length).toBeLessThanOrEqual(120) // ~50 chars each side + id
  })

  it('returns fallback when target not found in body', async () => {
    const { extractContext } = await import(
      '../../src/renderer/src/panels/editor/BacklinksPanel'
    )
    const body = 'This body does not contain the reference anywhere'
    const result = extractContext(body, 'nonexistent-id')
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThanOrEqual(103) // 100 chars + "..."
  })
})
```

> **Note**: `parseBreadcrumb`, `buildMetadataEntries`, and `extractContext` must be
> exported from their respective component files. They are already standalone functions
> in the plan code, but ensure they have `export` keywords. If not already exported,
> add `export` before `function parseBreadcrumb`, `function buildMetadataEntries`,
> and `function extractContext` in their respective files.

- [ ] **Step 2: Write tests for StatusBar word count and graph keyboard helpers**

```typescript
// tests/components/status-bar.test.ts
import { describe, it, expect } from 'vitest'

describe('StatusBar word count', () => {
  // Word count logic extracted from EditorStatus component
  function countWords(content: string): number {
    const trimmed = content.trim()
    if (trimmed.length === 0) return 0
    return trimmed.split(/\s+/).length
  }

  it('counts words in normal text', () => {
    expect(countWords('hello world foo bar')).toBe(4)
  })

  it('returns 0 for empty content', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
  })

  it('handles single word', () => {
    expect(countWords('hello')).toBe(1)
  })

  it('handles multiple whitespace between words', () => {
    expect(countWords('hello    world')).toBe(2)
  })

  it('handles newlines and tabs', () => {
    expect(countWords('hello\nworld\tfoo')).toBe(3)
  })
})

describe('sortNodesAlphabetically (graph keyboard)', () => {
  it('sorts nodes alphabetically by title', async () => {
    const { sortNodesAlphabetically } = await import(
      '../../src/renderer/src/panels/graph/useGraphKeyboard'
    )
    const nodes = [
      { id: 'c1', title: 'Constraint', x: 100, y: 200 },
      { id: 'g1', title: 'Alpha Gene', x: 0, y: 0 },
      { id: 'n1', title: 'Zeta Note', x: 300, y: 300 },
    ]
    const sorted = sortNodesAlphabetically(nodes)
    expect(sorted.map((n) => n.title)).toEqual(['Alpha Gene', 'Constraint', 'Zeta Note'])
  })

  it('returns empty array for empty input', async () => {
    const { sortNodesAlphabetically } = await import(
      '../../src/renderer/src/panels/graph/useGraphKeyboard'
    )
    expect(sortNodesAlphabetically([])).toEqual([])
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/editor/editor-components.test.ts tests/components/status-bar.test.ts`

- [ ] **Step 4: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add tests/editor/editor-components.test.ts tests/components/status-bar.test.ts
git commit -m "test: add unit tests for Phase 4 component pure logic functions"
```

---

### Task 57: Final verification and integration test

**Files:**
- No new files

- [ ] **Step 1: Run full typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: PASS, no type errors

- [ ] **Step 2: Run full test suite**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All tests passing (original 35 + new tests from this plan)

- [ ] **Step 3: Verify app builds**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run build`
Expected: PASS, clean build

- [ ] **Step 4: Final commit (if any fixups were needed)**

```bash
cd /Users/caseytalbot/Projects/thought-engine
# Stage only the specific files that were fixed up. Review changes first with git diff.
git add src/ tests/
git commit -m "chore: final Phase 4 verification and fixups"
```

---

## Execution Handoff

This implementation plan covers 57 tasks across 6 chunks, transforming Thought Engine from a functional prototype into a polished, production-grade desktop knowledge engine.

### Chunk Summary

| Chunk | Phase | Tasks | Focus |
|-------|-------|-------|-------|
| 1 | 1A + 1B | 1-6 | IPC security lockdown, typed channel allowlist, watcher hardening |
| 2 | 1C + 1D + 1E | 7-15 | Custom titlebar, layout skeleton, error boundaries, 4 bug fixes |
| 3 | 1F + 1G + 1H | 16-21 | Web Worker migration, vault loading orchestration, command palette |
| 4 | 2 (Function) | 22-29 | File tree, graph settings, terminal process name, settings modal, sidebar wiring, terminal restyling, graph settings wiring |
| 5 | 3 (Interaction) | 30-41 | Graph highlights, glow sprites, animations, skills panel, graph controls, node sizing, renderer interface, minimap, context menu, GraphPanel integration |
| 6 | 4 (Polish) | 42-57 | Design tokens, CSS system, typography, editor toolbar/breadcrumb/frontmatter/backlinks, status bar, animation standards, graph keyboard nav, color audit, component tests, final verification |

### Execution Order

Chunks must be executed in order (1 through 6). Within each chunk, tasks are ordered by dependency. Each task leaves the app in a working state with all tests passing.

### Key Invariants

- All 35 existing tests pass at every commit boundary
- No IPC calls outside the typed `window.api` surface after Chunk 1
- No hardcoded hex colors after Chunk 6 (all reference tokens)
- `prefers-reduced-motion` respected for all CSS and Canvas2D animations
- Files stay under 800 lines; immutable data patterns throughout
- Commit format: `<type>: <description>`

---
