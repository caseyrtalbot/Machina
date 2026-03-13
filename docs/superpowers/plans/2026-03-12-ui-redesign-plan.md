# Thought Engine UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Thought Engine from a functional prototype into a polished, production-grade desktop knowledge engine with custom titlebar, IPC security, Web Worker indexing, real-time graph updates, neon highlights, and professional design coherence.

**Architecture:** Four-phase horizontal slice approach. Each phase leaves the app in a working, improved state. Phase 1 (Foundation) locks down IPC security, fixes 7 pre-existing bugs, migrates indexing to a Web Worker, and establishes the layout skeleton. Phases 2-4 layer on function, interaction, and polish. All existing 35 tests must pass throughout.

**Tech Stack:** Electron 39 + electron-vite, React 19, TypeScript, Zustand 5, Tiptap v3 (`@tiptap/react: ^3.20.1`), CodeMirror 6, D3.js v3 + Canvas2D, xterm.js 5 + node-pty, Tailwind v4, Vitest

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
| `src/renderer/src/panels/editor/RichEditor.tsx` | Replace `getText()` with `@tiptap/markdown` `editor.getMarkdown()` |
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

## Critical Corrections (Audit 2026-03-13)

These corrections MUST be applied during execution. Code snippets in the tasks below may contain the original (incorrect) patterns.

| # | Severity | Correction | Affects |
|---|----------|-----------|---------|
| 1 | **CRITICAL** | Package is `@tiptap/markdown` (NOT `tiptap-markdown`). Install: `npm install @tiptap/markdown`. API: `editor.getMarkdown()` (NOT `editor.storage.markdown.getMarkdown()`). Config: `Markdown.configure({})` with official options only. | Task 12 |
| 2 | **CRITICAL** | `window.api.*` IPC surface is built by Tasks 1-2. Code in later tasks that uses `window.api.vault.*`, `window.api.fs.*`, `window.api.config.*`, `window.api.on.*` is correct AFTER Chunk 1 completes. If you see `window.electron.ipcRenderer.invoke(...)` in Chunks 4-6, use `window.api.*` instead (Chunk 1 migrates everything). | Tasks 11,15,19,20,34,40 |
| 3 | **CRITICAL** | `gray-matter` uses Node.js `Buffer`/`fs`. Web Workers don't have Node.js APIs. The Worker (Tasks 17-18) needs either: (a) a `buffer` polyfill in the Worker bundle (electron-vite can configure this), or (b) move parsing to main process and only send results to Worker, or (c) use Electron's `nodeIntegrationInWorker: true`. Resolve at execution time. | Tasks 17-18 |
| 4 | **CRITICAL** | `d3-transition` is NOT installed. Remove the animated `.transition().duration(300)` call in minimap pan (Task 41). Use immediate transform: `select(canvas).call(zoomBehavior.transform, newTransform)`. | Task 41 |
| 5 | **CRITICAL** | Missing Tiptap extension packages. Install before Task 49: `npm install @tiptap/extension-task-list @tiptap/extension-task-item @tiptap/extension-link`. | Task 49 |
| 6 | **CRITICAL** | Task 49 must include a step to modify `RichEditor.tsx`: remove internal `useEditor`, change props to `{ editor: Editor \| null }`, render `<EditorContent editor={editor} />`. | Task 49 |
| 7 | **HIGH** | `VaultFile` has no `type` property. Task 27's `ConnectedSidebar` must look up artifact type via the vault store's artifact data, not `f.type`. | Task 27 |
| 8 | **HIGH** | `VaultFile` has no `id` field. Task 40's `GraphContextMenu` file lookup via `files.find(f => f.id === nodeId)` must use a different strategy (e.g., store's `fileToId` map). | Task 40 |
| 9 | **HIGH** | `(window as any).__vaultPath` does not exist. Use `useVaultStore.getState().vaultPath` for the graph-settings-store vault storage adapter. Wrap in a lazy getter to avoid circular imports. | Task 23 |
| 10 | **HIGH** | Module-scope `window.electron.ipcRenderer` in graph-settings-store will crash in test environments. Use a lazy getter: `const getIpc = () => window.electron.ipcRenderer`. | Task 23 |
| 11 | **MEDIUM** | Task 44 Step 3 (adding `getBacklinks` to VaultIndex class) is dead code -- Task 19 already removed VaultIndex from vault-store. Skip Step 3; only implement the vault-store action (Step 5). | Task 44 |
| 12 | **MEDIUM** | Zustand 5 `partialize` needs explicit type params to avoid returning full store type. Use `persist<StoreType, StateOnlyType>(...)`. | Tasks 23, 26 |
| 13 | **MEDIUM** | `useVaultStore((s) => s.getBacklinks(id))` in a selector creates new array every render. Use `useMemo` with separate `graph`/`artifacts` selectors instead. | Task 49 |
| 14 | **MEDIUM** | Invalid Signal type `'supporting'` in test. Use `'untested'`, `'emerging'`, `'validated'`, or `'core'`. | Task 56 |
| 15 | **MEDIUM** | `createJSONStorage<SettingsStore>` should be `createJSONStorage(() => localStorage)` (simpler, correct Zustand 5 pattern). | Task 26 |

## Standard Conventions

To reduce verbosity, the following shorthands are used throughout:

**Verify & Commit (V&C):** Unless otherwise noted, every task ends with:
1. `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck` (expect PASS)
2. `cd /Users/caseytalbot/Projects/thought-engine && npm test` (expect all passing)
3. Stage relevant files and commit with the message shown

**TDD Red-Green:** When a test file is created before implementation, "Run test (expect FAIL)" means run the specific test and confirm it fails with a module/import error. "Run test (expect PASS)" means run after implementation.

**Code blocks:** Show only NEW code or CHANGED lines. When a task says "modify file X", the code block contains only the additions/changes, not the full file. Unchanged code is indicated by `// ... existing code unchanged ...`.

**IPC pattern:** After Chunk 1, all renderer IPC uses `window.api.<domain>.<method>(args)`. The preload in Task 2 defines the full API surface.

---
---

## Chunk 1: Phase 1A (IPC Security Lockdown) + Phase 1B (Watcher Hardening)

**Why first:** All subsequent work builds on the new `window.api.*` IPC pattern. Every renderer file that calls IPC must migrate. The watcher hardening is a small, independent change that fits naturally here.

### Task 1: Add new IPC channel types

**Files:** Modify `src/shared/ipc-channels.ts`

- [ ] **Step 1: Add new channels to existing IpcChannels interface**

Add these to the existing `IpcChannels` interface:

```typescript
  // --- Window (new) ---
  'window:minimize': { request: void; response: void }
  'window:maximize': { request: void; response: void }
  'window:close': { request: void; response: void }

  // --- Config persistence (new) ---
  'config:read': { request: { scope: string; key: string }; response: unknown }
  'config:write': { request: { scope: string; key: string; value: unknown }; response: void }

  // --- Terminal (new) ---
  'terminal:process-name': { request: { sessionId: string }; response: string | null }
```

- [ ] **Step 2: Typecheck + test**

Run `npm run typecheck` (PASS, additive only) then `npm test` (35/35).

**V&C:** `"feat: add window, config, and process-name IPC channel types"` (files: `src/shared/ipc-channels.ts`)

---

### Task 2: Replace preload with typed channel allowlist

**Files:** Modify `src/preload/index.ts` (full rewrite), Create `src/preload/api.d.ts`

- [ ] **Step 1: Rewrite preload with typed allowlist**

Replace the entire contents of `src/preload/index.ts`:

```typescript
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

Create `src/preload/api.d.ts`:

```typescript
import type { ElectronApi } from './index'

declare global {
  interface Window {
    api: ElectronApi
  }
}
```

- [ ] **Step 3: Clear old preload type declarations**

If `src/preload/index.d.ts` exists and has a conflicting `Window.api` declaration, replace its contents with:

```typescript
export {}
```

- [ ] **Step 4: Typecheck (node only)**

Run `npm run typecheck:node` (PASS). Note: `typecheck:web` will FAIL because renderer code still references `window.electron.ipcRenderer`. Fixed in Tasks 3-5.

**V&C:** `"feat: replace blanket electronAPI with typed IPC channel allowlist"` (files: `src/preload/index.ts`, `src/preload/api.d.ts`, `src/preload/index.d.ts`)

---

### Task 3: Migrate vault-store IPC calls

> **Scope note:** This task only migrates IPC call patterns. VaultIndex stays in store state for now. The structural replacement with plain `artifacts`/`graph` happens in Task 19 (Web Worker migration, Chunk 3).

**Files:** Modify `src/renderer/src/store/vault-store.ts`

- [ ] **Step 1: Replace IPC calls with window.api**

Delete line 5 (`const ipcRenderer = window.electron.ipcRenderer`) and replace all IPC calls in `loadVault`:

| Old pattern | New pattern |
|---|---|
| `ipcRenderer.invoke('vault:read-config', { vaultPath })` | `window.api.vault.readConfig(vaultPath)` |
| `ipcRenderer.invoke('vault:read-state', { vaultPath })` | `window.api.vault.readState(vaultPath)` |
| `ipcRenderer.invoke('fs:list-files-recursive', { dir: vaultPath })` | `window.api.fs.listFilesRecursive(vaultPath)` |
| `ipcRenderer.invoke('fs:read-file', { path: filePath })` | `window.api.fs.readFile(filePath)` |

Remove the `VaultConfig` and `VaultState` type annotations on the `const` declarations (they're inferred from the typed API now).

- [ ] **Step 2: Typecheck (web only)**

Run `npm run typecheck:web`. Expected: errors in `App.tsx` and `TerminalPanel.tsx` only. The vault-store should compile clean.

**V&C:** `"refactor: migrate vault-store from electronAPI to typed window.api"` (files: `src/renderer/src/store/vault-store.ts`)

---

### Task 4: Migrate TerminalPanel IPC calls

**Files:** Modify `src/renderer/src/panels/terminal/TerminalPanel.tsx`

- [ ] **Step 1: Replace all IPC calls with window.api**

Delete line 12 (`const ipcRenderer = window.electron.ipcRenderer`) and replace all usages:

| Old pattern | New pattern |
|---|---|
| `ipcRenderer.invoke('terminal:create', { cwd })` | `window.api.terminal.create(cwd)` |
| `ipcRenderer.invoke('terminal:write', { sessionId, data })` | `window.api.terminal.write(sessionId, data)` |
| `ipcRenderer.invoke('terminal:resize', { sessionId: activeSessionId, cols, rows })` | `window.api.terminal.resize(activeSessionId, cols, rows)` |
| `ipcRenderer.invoke('terminal:kill', { sessionId })` | `window.api.terminal.kill(sessionId)` |

The event listener API changes shape. Old: `ipcRenderer.on(channel, (_event, payload) => ...)`. New: `window.api.on.*((payload) => ...)` -- no event argument, returns cleanup function directly.

| Old pattern | New pattern |
|---|---|
| `ipcRenderer.on('terminal:data', (_event, payload) => ...)` | `window.api.on.terminalData((payload) => ...)` |
| `ipcRenderer.on('terminal:exit', (_event, payload) => ...)` | `window.api.on.terminalExit((payload) => ...)` |

Both return an unsubscribe function directly. Replace cleanup effect's `ipcRenderer.invoke('terminal:kill', { sessionId })` with `window.api.terminal.kill(sessionId)`.

- [ ] **Step 2: Verify zero remaining `window.electron` references in the file**

**V&C:** `"refactor: migrate TerminalPanel from electronAPI to typed window.api"` (files: `src/renderer/src/panels/terminal/TerminalPanel.tsx`)

---

### Task 5: Migrate App.tsx IPC call

**Files:** Modify `src/renderer/src/App.tsx`

- [ ] **Step 1: Replace the StatusBar IPC call**

In the `StatusBar` component, replace:

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

- [ ] **Step 2: Full typecheck + tests**

Run `npm run typecheck` (PASS, all renderer code now uses `window.api.*` exclusively) then `npm test` (35/35).

- [ ] **Step 3: Verify zero remaining `window.electron` references**

Run: `grep -r "window\.electron" src/renderer/ --include="*.ts" --include="*.tsx"` (zero matches).

**V&C:** `"refactor: migrate App.tsx git-branch call to typed window.api"` (files: `src/renderer/src/App.tsx`)

---

### Task 6: Harden vault watcher with configurable ignores

**Files:** Modify `src/main/services/vault-watcher.ts`, Modify `src/main/ipc/watcher.ts`, Create `tests/services/vault-watcher.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/services/vault-watcher.test.ts`:

```typescript
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
    const result = buildIgnorePatterns(['vendor', '*.log'])
    expect(result).toContain('node_modules')
    expect(result).toContain('vendor')
    expect(result).toContain('*.log')
  })

  it('deduplicates patterns', () => {
    const result = buildIgnorePatterns(['node_modules', 'vendor'])
    const count = result.filter((p) => p === 'node_modules').length
    expect(count).toBe(1)
  })

  it('handles empty custom patterns', () => {
    const result = buildIgnorePatterns([])
    expect(result.length).toBe(DEFAULT_IGNORE_PATTERNS.length)
  })
})
```

- [ ] **Step 2: Red** -- run test, confirm FAIL (`buildIgnorePatterns` not exported).

- [ ] **Step 3: Implement configurable ignores**

Modify `src/main/services/vault-watcher.ts`. Add these exports before the `VaultWatcher` class:

```typescript
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
    /(^|[/\\])\../,
    ...patterns.map((p) => new RegExp(`(^|[/\\\\])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[/\\\\])`)),
  ]
}
```

Then update the `VaultWatcher.start` signature and body:
- Add third param: `customIgnorePatterns: readonly string[] = []`
- Replace hardcoded `ignored: [/(^|[/\\])\../, /node_modules/]` with: `ignored: patternsToChokidarIgnored(buildIgnorePatterns(customIgnorePatterns))`

- [ ] **Step 4: Green** -- run test, confirm PASS.

- [ ] **Step 5: Update watcher IPC to pass custom patterns**

Modify `src/main/ipc/watcher.ts`. Add imports for `FileService` and `teConfigPath`, then in the `vault:watch-start` handler, read custom patterns from vault config before calling `watcher.start`:

```typescript
import { FileService } from '../services/file-service'
import { teConfigPath } from '../utils/paths'

const fileService = new FileService()
```

Inside the handler, before `watcher.start(...)`:

```typescript
    let customPatterns: string[] = []
    try {
      const configContent = await fileService.readFile(teConfigPath(args.vaultPath))
      const config = JSON.parse(configContent)
      customPatterns = config?.watcher?.ignorePatterns ?? []
    } catch {
      // Config doesn't exist or is malformed; use defaults only
    }
```

Pass `customPatterns` as third arg to `watcher.start(..., customPatterns)`.

- [ ] **Step 6: Full test suite**

Run `npm test`. Expected: 39/39 passing (35 existing + 4 new watcher tests).

**V&C:** `"feat: add configurable ignore patterns to vault watcher"` (files: `src/main/services/vault-watcher.ts`, `src/main/ipc/watcher.ts`, `tests/services/vault-watcher.test.ts`)

---
## Chunk 2: Phase 1C (Custom Titlebar) + Phase 1D (Layout) + Phase 1E (Bug Fixes)

### Task 7: Register window and config IPC handlers in main process

**Files:** Modify `src/main/index.ts` | Create `src/main/ipc/config.ts`

- [ ] **Step 1: Create config IPC handler**

```typescript
import { ipcMain } from 'electron'
import Store from 'electron-store'

const appStore = new Store({ name: 'thought-engine-settings' })

export function registerConfigIpc(): void {
  ipcMain.handle('config:read', async (_e, args: { scope: string; key: string }) => {
    if (args.scope === 'app') return appStore.get(args.key, null)
    return null
  })
  ipcMain.handle(
    'config:write',
    async (_e, args: { scope: string; key: string; value: unknown }) => {
      if (args.scope === 'app') appStore.set(args.key, args.value)
    }
  )
}
```

- [ ] **Step 2: Update main/index.ts** (diff)

Add import:
```typescript
import { registerConfigIpc } from './ipc/config'
```

Hoist `mainWindow` to module scope, add titlebar options:
```diff
+let mainWindow: BrowserWindow | null = null
+
 function createWindow(): BrowserWindow {
-  const mainWindow = new BrowserWindow({
+  mainWindow = new BrowserWindow({
     ...
     autoHideMenuBar: true,
+    titleBarStyle: 'hidden',
+    trafficLightPosition: { x: 12, y: 12 },
     ...(process.platform === 'linux' ? { icon } : {}),
```

Add after `createWindow`:
```typescript
function registerWindowIpc(): void {
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
}
```

In `app.whenReady()`, remove `ipcMain.on('ping', ...)`, add registrations:
```diff
   registerFilesystemIpc()
+  registerConfigIpc()
+  registerWindowIpc()
-  const mainWindow = createWindow()
-  registerWatcherIpc(mainWindow)
-  registerShellIpc(mainWindow)
+  const window = createWindow()
+  registerWatcherIpc(window)
+  registerShellIpc(window)
```

Remove all boilerplate comments.

- [ ] **Step 3: Typecheck** `npm run typecheck:node`
- [ ] **Step 4: V&C** `git add src/main/index.ts src/main/ipc/config.ts` | `feat: register window and config IPC handlers, enable custom titlebar`

---

### Task 8: Create PanelErrorBoundary component

**Files:** Create `src/renderer/src/components/PanelErrorBoundary.tsx` | Create `tests/components/PanelErrorBoundary.test.tsx`

- [ ] **Step 1: Write the test**

Test file: `tests/components/PanelErrorBoundary.test.tsx`

Helper: `ThrowingChild({ shouldThrow })` throws or renders `<div>Child content</div>`.

Three tests:
- `renders children when no error` -- render with `shouldThrow={false}`, assert `'Child content'` present
- `shows fallback on error` -- wrap `shouldThrow={true}` in `<PanelErrorBoundary name="Graph">`, assert `'Something went wrong'` and `/Graph/`. Suppress console.error.
- `retries on button click` -- `Toggler` initially throws. Assert fallback. Set flag false, click `'Retry'`, rerender, assert `'Recovered'` visible, fallback gone.

- [ ] **Step 2: Verify test fails** (module not found)
- [ ] **Step 3: Implement PanelErrorBoundary**

Class component. Props: `name: string`, `children: ReactNode`. State: `hasError`, `error`, `showDetails`.

```typescript
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { colors } from '../design/tokens'

interface Props { name: string; children: ReactNode }
interface State { hasError: boolean; error: Error | null; showDetails: boolean }

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
        <div className="h-full flex items-center justify-center p-6"
          style={{ backgroundColor: colors.bg.surface }}>
          <div className="text-center max-w-sm">
            <p style={{ color: colors.text.primary }} className="text-sm font-medium mb-1">
              Something went wrong
            </p>
            <p style={{ color: colors.text.muted }} className="text-xs mb-4">
              The {this.props.name} panel encountered an error.
            </p>
            <button onClick={this.handleRetry}
              className="text-xs px-3 py-1.5 rounded-md transition-colors"
              style={{
                backgroundColor: colors.accent.muted,
                color: colors.accent.default,
                border: `1px solid ${colors.border.default}`,
              }}>
              Retry
            </button>
            {this.state.error && (
              <button
                onClick={() => this.setState((s) => ({ showDetails: !s.showDetails }))}
                className="ml-2 text-xs px-3 py-1.5 rounded-md"
                style={{ color: colors.text.muted }}>
                {this.state.showDetails ? 'Hide details' : 'Show details'}
              </button>
            )}
            {this.state.showDetails && this.state.error && (
              <pre className="mt-3 text-left text-[11px] p-3 rounded overflow-auto max-h-40"
                style={{
                  backgroundColor: colors.bg.base,
                  color: colors.text.secondary,
                  fontFamily: '"JetBrains Mono", monospace',
                }}>
                {this.state.error.message}{'\n'}{this.state.error.stack}
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

- [ ] **Step 4: Verify test passes, then full suite** `npm test`
- [ ] **Step 5: V&C** `git add src/renderer/src/components/PanelErrorBoundary.tsx tests/components/PanelErrorBoundary.test.tsx` | `feat: add PanelErrorBoundary with retry and error details`

---

### Task 9: Create Titlebar component

**Files:** Create `src/renderer/src/components/Titlebar.tsx`

- [ ] **Step 1: Implement Titlebar**

```typescript
import { colors } from '../design/tokens'

interface TitlebarProps { vaultName: string; onOpenSettings: () => void }

export function Titlebar({ vaultName, onOpenSettings }: TitlebarProps) {
  return (
    <div className="h-[38px] flex items-center px-3 select-none flex-shrink-0"
      style={{
        backgroundColor: colors.bg.surface,
        borderBottom: `1px solid ${colors.border.default}`,
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}>
      {/* Traffic light spacer (macOS native) */}
      <div className="w-[70px] flex-shrink-0" />
      {/* Vault tab */}
      <div className="flex items-center gap-2 px-3 py-1 rounded-md text-sm"
        style={{
          backgroundColor: colors.bg.elevated, color: colors.text.primary,
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}>
        <span className="w-2 h-2 rounded-full"
          style={{ backgroundColor: colors.accent.default }} />
        <span className="truncate max-w-[200px]">{vaultName}</span>
      </div>
      <div className="flex-1" />
      {/* Settings gear */}
      <button onClick={onOpenSettings}
        className="p-1.5 rounded-md transition-colors hover:bg-[#1A1A1D]"
        style={{ color: colors.text.secondary, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        title="Settings">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z" />
          <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 001.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 003.06 4.377l-.16-.292c-.415-.764.421-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.115l.094-.319z" />
        </svg>
      </button>
    </div>
  )
}
```

- [ ] **Step 2: V&C** `git add src/renderer/src/components/Titlebar.tsx` | `feat: add custom Titlebar with vault tab and settings gear`

---

### Task 10: Create SettingsModal stub

**Files:** Create `src/renderer/src/components/SettingsModal.tsx`

- [ ] **Step 1: Implement stub**

```typescript
import { colors } from '../design/tokens'

interface SettingsModalProps { isOpen: boolean; onClose: () => void }

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }} onClick={onClose}>
      <div className="w-full max-w-2xl h-[500px] rounded-xl border overflow-hidden"
        style={{ backgroundColor: colors.bg.surface, borderColor: colors.border.default }}
        onClick={(e) => e.stopPropagation()}>
        <div className="h-12 flex items-center justify-between px-4 border-b"
          style={{ borderColor: colors.border.default }}>
          <span className="text-sm font-medium" style={{ color: colors.text.primary }}>
            Settings
          </span>
          <button onClick={onClose} className="text-xs px-2 py-1 rounded"
            style={{ color: colors.text.muted }}>Close</button>
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

- [ ] **Step 2: V&C** `git add src/renderer/src/components/SettingsModal.tsx` | `feat: add SettingsModal stub for Phase 2 implementation`

---

### Task 11: Update App.tsx with titlebar, error boundaries, and new layout

**Files:** Modify `src/renderer/src/App.tsx`

- [ ] **Step 1: Restructure App.tsx** (all changes are diffs from current file)

**(a) Add imports** after existing imports:
```typescript
import { Titlebar } from './components/Titlebar'
import { SettingsModal } from './components/SettingsModal'
import { PanelErrorBoundary } from './components/PanelErrorBoundary'
```

**(b) StatusBar** -- narrow selectors, token-based styles, typed IPC:
```diff
-  const { vaultPath, files } = useVaultStore()
+  const vaultPath = useVaultStore((s) => s.vaultPath)
+  const fileCount = useVaultStore((s) => s.files.length)
```
```diff
-    window.electron.ipcRenderer.invoke('vault:git-branch', { vaultPath })
+    window.api.vault.gitBranch(vaultPath)
```
```diff
-      className="h-6 flex items-center px-3 text-[11px] text-[#5A5A5E] border-t border-[#2A2A2E]"
-      style={{ backgroundColor: colors.bg.surface }}
+      className="h-6 flex items-center px-3 text-[11px] border-t flex-shrink-0"
+      style={{ backgroundColor: colors.bg.surface, color: colors.text.muted, borderColor: colors.border.default }}
```
```diff
-      <span>{files.length} notes</span>
+      <span>{fileCount} notes</span>
```

**(c) ContentArea** -- narrow selectors:
```diff
-  const { contentView } = useGraphStore()
-  const { setActiveNote } = useEditorStore()
-  const { setContentView } = useGraphStore()
+  const contentView = useGraphStore((s) => s.contentView)
+  const setActiveNote = useEditorStore((s) => s.setActiveNote)
+  const setContentView = useGraphStore((s) => s.setContentView)
```

**(d) ConnectedSidebar** -- narrow selectors:
```diff
-  const { files, config, activeWorkspace, setActiveWorkspace } = useVaultStore()
-  const { setActiveNote, activeNotePath } = useEditorStore()
+  const files = useVaultStore((s) => s.files)
+  const config = useVaultStore((s) => s.config)
+  const activeWorkspace = useVaultStore((s) => s.activeWorkspace)
+  const setActiveWorkspace = useVaultStore((s) => s.setActiveWorkspace)
+  const setActiveNote = useEditorStore((s) => s.setActiveNote)
+  const activeNotePath = useEditorStore((s) => s.activeNotePath)
```

**(e) WorkspaceShell** -- narrow selectors, settings state, Titlebar, error boundaries, widths:
```diff
   const [paletteOpen, setPaletteOpen] = useState(false)
-  const { files } = useVaultStore()
-  const { setActiveNote } = useEditorStore()
-  const { contentView, setContentView } = useGraphStore()
-  const { mode, setMode } = useEditorStore()
+  const [settingsOpen, setSettingsOpen] = useState(false)
+  const files = useVaultStore((s) => s.files)
+  const vaultPath = useVaultStore((s) => s.vaultPath)
+  const setActiveNote = useEditorStore((s) => s.setActiveNote)
+  const contentView = useGraphStore((s) => s.contentView)
+  const setContentView = useGraphStore((s) => s.setContentView)
+  const mode = useEditorStore((s) => s.mode)
+  const setMode = useEditorStore((s) => s.setMode)
+  const vaultName = vaultPath?.split('/').pop() ?? 'Thought Engine'
```

JSX:
```diff
     >
+      <Titlebar vaultName={vaultName} onOpenSettings={() => setSettingsOpen(true)} />
       <div className="flex-1 overflow-hidden">
         <SplitPane
-          left={<ConnectedSidebar />}
+          left={<PanelErrorBoundary name="Sidebar"><ConnectedSidebar /></PanelErrorBoundary>}
           right={
             <SplitPane
-              left={<ContentArea />}
-              right={<TerminalPanel />}
+              left={<PanelErrorBoundary name="Content"><ContentArea /></PanelErrorBoundary>}
+              right={<PanelErrorBoundary name="Terminal"><TerminalPanel /></PanelErrorBoundary>}
               initialLeftWidth={580}
               minLeftWidth={300}
-              minRightWidth={320}
+              minRightWidth={400}
             />
           }
-          initialLeftWidth={260}
+          initialLeftWidth={240}
```
After `<CommandPalette ... />`:
```diff
+      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
```

**(f) App()** -- narrow selectors:
```diff
-  const { vaultPath, loadVault } = useVaultStore()
+  const vaultPath = useVaultStore((s) => s.vaultPath)
+  const loadVault = useVaultStore((s) => s.loadVault)
```

- [ ] **Step 2: Typecheck** `npm run typecheck`
- [ ] **Step 3: Tests** `npm test`
- [ ] **Step 4: V&C** `git add src/renderer/src/App.tsx` | `feat: integrate titlebar, error boundaries, and new layout skeleton`

---

### Task 12: Fix RichEditor markdown serialization (Bug #1)

**Files:** Modify `src/renderer/src/panels/editor/RichEditor.tsx`

- [ ] **Step 1: Install @tiptap/markdown**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm install --cache /tmp/npm-cache-te @tiptap/markdown`

- [ ] **Step 2: Fix the serialization** (diff)

```diff
 import StarterKit from '@tiptap/starter-kit'
+import { Markdown } from '@tiptap/markdown'
 import { colors } from '../../design/tokens'
```
```diff
-    extensions: [StarterKit],
+    extensions: [
+      StarterKit,
+      Markdown.configure({ html: false, transformCopiedText: true, transformPastedText: true }),
+    ],
     content,
     onUpdate: ({ editor }) => {
-      onChange(editor.getText())
+      onChange(editor.getMarkdown())
     },
```
```diff
-    if (editor && content !== editor.getText()) {
+    if (editor && content !== editor.getMarkdown()) {
```

The bug: `editor.getText()` strips all formatting. `@tiptap/markdown` adds `editor.getMarkdown()` for proper serialization.

- [ ] **Step 3: Typecheck and tests** `npm run typecheck && npm test`
- [ ] **Step 4: V&C** `git add src/renderer/src/panels/editor/RichEditor.tsx package.json package-lock.json` | `fix: use @tiptap/markdown serializer instead of getText() in RichEditor`

---

### Task 13: Fix SourceEditor stale closure (Bug #2)

**Files:** Modify `src/renderer/src/panels/editor/SourceEditor.tsx`

- [ ] **Step 1: Fix the stale closure** (diff)

The bug: `useEffect([], ...)` captures initial `onChange` in a closure. If identity changes, editor calls stale version.

```diff
   const viewRef = useRef<EditorView | null>(null)
+  const onChangeRef = useRef(onChange)
+
+  useEffect(() => { onChangeRef.current = onChange }, [onChange])
```
```diff
           if (update.docChanged) {
-            onChange(update.state.doc.toString())
+            onChangeRef.current(update.state.doc.toString())
           }
```

No other changes.

- [ ] **Step 2: Typecheck and tests** `npm run typecheck && npm test`
- [ ] **Step 3: V&C** `git add src/renderer/src/panels/editor/SourceEditor.tsx` | `fix: use ref for onChange in SourceEditor to prevent stale closure`

---

### Task 14: Fix SplitPane handler leak (Bug #3)

**Files:** Modify `src/renderer/src/design/components/SplitPane.tsx`

- [ ] **Step 1: Fix the mouse handler leak** (diff)

The bug: `mousemove`/`mouseup` listeners leak if component unmounts mid-drag.

```diff
   const dragging = useRef(false)
+  const handlersRef = useRef<{
+    move: ((e: MouseEvent) => void) | null
+    up: (() => void) | null
+  }>({ move: null, up: null })
```

After the clamp `useEffect`, add cleanup:
```typescript
  useEffect(() => {
    return () => {
      if (handlersRef.current.move)
        document.removeEventListener('mousemove', handlersRef.current.move)
      if (handlersRef.current.up)
        document.removeEventListener('mouseup', handlersRef.current.up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])
```

Inside `handleMouseDown`, at end of `handleMouseUp`:
```diff
       document.removeEventListener('mouseup', handleMouseUp)
+      handlersRef.current = { move: null, up: null }
     }
+    handlersRef.current = { move: handleMouseMove, up: handleMouseUp }
     document.addEventListener('mousemove', handleMouseMove)
```

- [ ] **Step 2: Tests** `npm test`
- [ ] **Step 3: V&C** `git add src/renderer/src/design/components/SplitPane.tsx` | `fix: clean up SplitPane mouse handlers on unmount to prevent leak`

---

### Task 15: Fix terminal tab close PTY kill (Bug #4)

**Files:** Modify `src/renderer/src/panels/terminal/TerminalPanel.tsx` | Modify `src/renderer/src/panels/terminal/TerminalTabs.tsx`

- [ ] **Step 1: Add PTY kill and xterm dispose on tab close**

TerminalTabs ALREADY has a close button, but it calls `removeSession(session.id)` directly, skipping PTY kill and xterm dispose. Wire through `onCloseTab` prop instead.

Add to `TerminalPanel`:
```typescript
  const handleCloseTab = useCallback(
    (sessionId: string) => {
      if (sessions.length <= 1) return
      window.api.terminal.kill(sessionId)
      const instance = instancesRef.current.get(sessionId)
      if (instance) {
        instance.terminal.dispose()
        instancesRef.current.delete(sessionId)
      }
      removeSession(sessionId)
    },
    [sessions.length, removeSession]
  )
```

```diff
-<TerminalTabs onNewTab={handleNewTab} />
+<TerminalTabs onNewTab={handleNewTab} onCloseTab={handleCloseTab} />
```

Update `TerminalTabs`:
```diff
-interface TerminalTabsProps { onNewTab: () => void }
-export function TerminalTabs({ onNewTab }: TerminalTabsProps) {
-  const { sessions, activeSessionId, setActiveSession, removeSession } = useTerminalStore()
+interface TerminalTabsProps { onNewTab: () => void; onCloseTab: (sessionId: string) => void }
+export function TerminalTabs({ onNewTab, onCloseTab }: TerminalTabsProps) {
+  const { sessions, activeSessionId, setActiveSession } = useTerminalStore()
```
```diff
-              removeSession(session.id)
+              onCloseTab(session.id)
```

- [ ] **Step 2: Typecheck and tests** `npm run typecheck && npm test`
- [ ] **Step 3: V&C** `git add src/renderer/src/panels/terminal/TerminalPanel.tsx src/renderer/src/panels/terminal/TerminalTabs.tsx` | `fix: kill PTY and dispose xterm on terminal tab close`

---
## Chunk 3: Phase 1F (Web Worker Migration) + Phase 1G (Vault Loading) + Phase 1H (Command Palette)

### Task 16: Extend VaultState with session persistence fields

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/services/file-service.ts`

> **Note:** The `'skills'` value in `contentView` requires Task 35 (SkillsPanel). Until then, only `'graph' | 'editor'` are valid at runtime.

- [ ] **Step 1: Extend VaultState**

In `src/shared/types.ts`, replace the existing VaultState interface:

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

Update `defaultState` and merge with defaults on read so missing fields get safe values:

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

In the `vault:read-state` handler:

```typescript
    ipcMain.handle('vault:read-state', async (_event, { vaultPath }: { vaultPath: string }) => {
      const statePath = path.join(vaultPath, '.thought-engine', 'state.json')
      try {
        const raw = await fs.readFile(statePath, 'utf-8')
        const parsed = JSON.parse(raw)
        return { ...defaultState, ...parsed, version: parsed.version ?? 1 }
      } catch {
        return { ...defaultState }
      }
    })
```

- [ ] **Step 3: Typecheck and fix VaultState consumers**

Run `npm run typecheck`. Fix any sites that create VaultState without the new fields.

**V&C:** `npm test`, then commit `src/shared/types.ts src/main/services/file-service.ts` with `"feat: extend VaultState with session persistence fields"`.

---

### Task 17: Create vault Web Worker

**Files:**
- Create: `src/renderer/src/engine/vault-worker.ts`
- Create: `src/renderer/src/engine/vault-worker-helpers.ts`
- Create: `src/renderer/src/engine/__tests__/vault-worker.test.ts`

> **WARNING:** `vault-worker-helpers.ts` imports `parser` which may use `gray-matter`. gray-matter calls Node.js APIs (`Buffer`, `fs`). In a Web Worker context these are unavailable. If parser uses gray-matter, you must either: (a) polyfill `Buffer` in the Worker bundler config, or (b) replace gray-matter with a browser-safe frontmatter parser. Verify at implementation time.

- [ ] **Step 1: Write tests for Worker helper functions (TDD)**

Create `src/renderer/src/engine/__tests__/vault-worker.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWorkerHelpers } from '../vault-worker-helpers'

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
  beforeEach(() => { helpers = createWorkerHelpers() })

  it('addFile stores artifact on successful parse', () => { /* addFile('test.md', '# Hello'), expect artifacts=1, errors=0 */ })
  it('addFile records error on failed parse', () => { /* addFile('bad.md', 'INVALID'), expect artifacts=0, errors=1, errors[0].filename='bad.md' */ })
  it('addFile clears stale errors for same path before re-parsing', () => { /* addFile INVALID then valid, expect errors=0, artifacts=1 */ })
  it('removeFile clears both artifact and errors for a path', () => { /* addFile INVALID, removeFile, expect both empty */ })
  it('update scenario: removeFile then addFile replaces artifact', () => { /* addFile V1, removeFile, addFile V2, expect artifacts=1 */ })
})
```

Run targeted test; expected: fails (module not found).

- [ ] **Step 2: Extract testable helpers into vault-worker-helpers.ts**

```typescript
import { parseArtifact } from './parser'
import { buildGraph } from './graph-builder'
import type { Artifact, KnowledgeGraph } from '@shared/types'

interface ParseError { filename: string; error: string }

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

Run targeted test; expected: all passing.

- [ ] **Step 3: Write the Worker script**

```typescript
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

**V&C:** `npm test`, then commit all three files with `"feat: add vault Web Worker for off-thread parsing and graph building"`.

---

### Task 18: Create useVaultWorker hook

**Files:**
- Create: `src/renderer/src/engine/useVaultWorker.ts`

> **WARNING:** Same gray-matter/Node.js API concern as Task 17 applies here, since this hook instantiates the Worker that imports vault-worker-helpers.

- [ ] **Step 1: Implement the hook**

```typescript
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

**V&C:** Commit `src/renderer/src/engine/useVaultWorker.ts` with `"feat: add useVaultWorker hook for Worker lifecycle management"`.

---

### Task 19: Refactor vault-store to use Worker data (plain state)

**Files:**
- Modify: `src/renderer/src/store/vault-store.ts`
- Modify: `src/renderer/src/panels/editor/EditorPanel.tsx`
- Modify: `src/renderer/src/panels/graph/GraphPanel.tsx`

- [ ] **Step 1: Replace VaultIndex with plain state fields**

Remove `VaultIndex` import, `index` field, `getGraph()`, `getArtifact()`, `search()`. Add these plain state fields and action:

```diff
+ artifacts: Artifact[]
+ graph: KnowledgeGraph        // init: { nodes: [], edges: [] }
+ parseErrors: ParseError[]
+ fileToId: Record<string, string>
+
+ setWorkerResult: (result: { artifacts, graph, errors, fileToId }) => void
- index: VaultIndex | null
- getGraph(): KnowledgeGraph
- getArtifact(id: string): Artifact | undefined
- search(query: string): Artifact[]
```

Full replacement store is in the original plan. Key: `setWorkerResult` spreads the Worker result into the four fields.

- [ ] **Step 2: Migrate EditorPanel from getArtifact() to store selector**

In `EditorPanel.tsx`, replace:

```typescript
// Before:
const { getArtifact } = useVaultStore()
const artifact = activeNoteId ? getArtifact(activeNoteId) : null

// After:
const artifact = useVaultStore((s) =>
  activeNoteId ? s.artifacts.find((a) => a.id === activeNoteId) : null
)
```

- [ ] **Step 3: Update GraphPanel to use store selector**

In `GraphPanel.tsx`: replace `const { getGraph } = useVaultStore()` with `const graph = useVaultStore((s) => s.graph)`. Replace all `getGraph()` calls with `graph`.

- [ ] **Step 4: Typecheck and fix remaining consumers**

Run `npm run typecheck`. Grep for `getArtifact`, `getGraph`, `search` referencing old API. Migrate to selectors: `useVaultStore((s) => s.artifacts.find((a) => a.id === id))`.

**V&C:** `npm test`, then commit `vault-store.ts GraphPanel.tsx EditorPanel.tsx` with `"refactor: replace VaultIndex class in store with plain state fields from Worker"`.

---

### Task 20: Implement vault loading orchestration

> **Dependencies:** Task 16 (VaultState fields) and Task 19 (plain state store) must be complete.

> **Note:** `lastOpenNote` semantics need clarification at implementation time: determine whether it stores an artifact id or a file path, and ensure `setActiveNote` receives the correct type. The current plan passes it as both arguments to `setActiveNote(state.lastOpenNote, state.lastOpenNote)` which may be incorrect.

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add Worker integration, loading skeleton, and orchestration**

Add imports: `useVaultWorker`, `useGraphStore`, `useEditorStore`.

Add `LoadingSkeleton` component (centered spinner + "Loading vault..." text, uses `colors.bg.base` / `colors.text.muted`).

Replace the `App` component with:

```typescript
export default function App() {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const isLoading = useVaultStore((s) => s.isLoading)
  const loadVault = useVaultStore((s) => s.loadVault)
  const setWorkerResult = useVaultStore((s) => s.setWorkerResult)
  const setFiles = useVaultStore((s) => s.setFiles)

  // onWorkerResult: calls setWorkerResult, then updates file titles/modified from artifacts
  const onWorkerResult = useCallback((result) => {
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

  // orchestrateLoad: vault:init > loadVault > hydrate session > save path > watchStart > read files > post to Worker
  const orchestrateLoad = useCallback(async (path: string) => {
    await window.api.vault.init(path)
    await loadVault(path)
    const state = useVaultStore.getState().state
    if (state) {
      if (state.contentView) useGraphStore.getState().setContentView(state.contentView)
      if (state.selectedNodeId) useGraphStore.getState().setSelectedNode(state.selectedNodeId)
      if (state.lastOpenNote) useEditorStore.getState().setActiveNote(state.lastOpenNote, state.lastOpenNote)
    }
    window.api.config.write('app', 'lastVaultPath', path)
    await window.api.vault.watchStart(path)
    const filePaths = useVaultStore.getState().files.map((f) => f.path)
    const filesWithContent = await Promise.all(
      filePaths.map(async (p) => ({ path: p, content: await window.api.fs.readFile(p) }))
    )
    loadFiles(filesWithContent)
  }, [loadVault, loadFiles])

  // Startup: auto-load saved vault path from config
  useEffect(() => {
    window.api.config.read('app', 'lastVaultPath').then((savedPath) => {
      if (typeof savedPath === 'string' && savedPath) orchestrateLoad(savedPath)
    }).catch(() => {})
  }, [orchestrateLoad])

  // File watcher: forward events to Worker (unlink => removeFile, else readFile => updateFile)
  useEffect(() => {
    const unsub = window.api.on.fileChanged(async (data) => {
      if (data.event === 'unlink') { removeFile(data.path) }
      else { updateFile(data.path, await window.api.fs.readFile(data.path)) }
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

**V&C:** `npm run typecheck`, then commit `src/renderer/src/App.tsx` with `"feat: implement vault loading orchestration with Worker and watcher integration"`.

---

### Task 21: Enhance CommandPalette with fuzzy search and command prefix

**Files:**
- Modify: `src/renderer/src/design/components/CommandPalette.tsx`
- Create: `src/renderer/src/design/components/__tests__/CommandPalette.test.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/shared/types.ts`
- Modify: `src/main/services/file-service.ts`

- [ ] **Step 1: Write tests for fuzzyMatch and filterItems (TDD)**

Create `src/renderer/src/design/components/__tests__/CommandPalette.test.ts`. Import `fuzzyMatch`, `filterItems`, `CommandItem` from `../CommandPalette`.

```typescript
describe('fuzzyMatch', () => {
  it('returns exact prefix match with score 100', () => { /* fuzzyMatch('GraphPanel','graph') => match:true, score:100 */ })
  it('returns substring match with score 50', () => { /* fuzzyMatch('MyGraphPanel','graph') => match:true, score:50 */ })
  it('returns fuzzy character match with score 10 and matched indices', () => { /* fuzzyMatch('GraphPanel','gpl') => score:10, indices:[0,5,6] */ })
  it('returns no match when characters are missing', () => { /* fuzzyMatch('GraphPanel','xyz') => match:false, score:0 */ })
  it('is case-insensitive', () => { /* fuzzyMatch('GraphPanel','GRAPH') => match:true */ })
})

describe('filterItems', () => {
  // items: 2 notes (Architecture Notes, Bug Tracker), 2 commands (Toggle Sidebar, Open Settings)
  it('returns all items for empty query', () => { /* filterItems(items, '') => items */ })
  it('filters by fuzzy match on label', () => { /* 'arch' => only note:a */ })
  it('> prefix filters to commands only', () => { /* '>' => all command category */ })
  it('> prefix with query filters commands by fuzzy match', () => { /* '>toggle' => cmd:toggle only */ })
  it('/ prefix filters to commands only', () => { /* '/' => all command category */ })
})
```

Run targeted test; expected: fails (functions not exported).

- [ ] **Step 2: Add fuzzy matching with match indices and prefix routing**

Export `fuzzyMatch` and `filterItems` from CommandPalette.tsx. Replace existing filter logic:

```typescript
export function fuzzyMatch(
  text: string,
  query: string
): { match: boolean; score: number; indices: number[] } {
  const lower = text.toLowerCase()
  const queryLower = query.toLowerCase()

  if (lower.startsWith(queryLower)) {
    return { match: true, score: 100, indices: Array.from({ length: queryLower.length }, (_, i) => i) }
  }

  const substringIdx = lower.indexOf(queryLower)
  if (substringIdx !== -1) {
    return {
      match: true, score: 50,
      indices: Array.from({ length: queryLower.length }, (_, i) => substringIdx + i),
    }
  }

  const indices: number[] = []
  let qi = 0
  for (let i = 0; i < lower.length && qi < queryLower.length; i++) {
    if (lower[i] === queryLower[qi]) { indices.push(i); qi++ }
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

Update placeholder text to `"Search notes... (> for commands)"`.

- [ ] **Step 3: Verify tests pass**

Run targeted test; expected: all passing.

- [ ] **Step 4: Add highlighted match characters in result rendering**

Add `HighlightedLabel({ label, indices })` component: builds a `Set` from indices, maps each char to a `<span>` with accent color + fontWeight 600 if index is in set. Replace `<span>{item.label}</span>` in result rows with `<HighlightedLabel label={item.label} indices={(item as any).matchIndices} />`.

- [ ] **Step 5: Add folder path and artifact type dot to note results**

Extend `CommandItem` interface:

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

In `App.tsx` where `paletteItems` are built, include `folderPath` from the file's parent directory. In result rows, render the type dot and folder path alongside the highlighted label.

- [ ] **Step 6: Add recent files section (top 5)**

Add `recentFiles: string[]` to `VaultState` in `src/shared/types.ts` and `recentFiles: []` to `defaultState` in `file-service.ts`.

In `App.tsx`, when building palette items, split notes into recent (top 5 from `state.recentFiles`) and rest. Return `[...recentItems, ...otherItems, ...BUILT_IN_COMMANDS]`.

- [ ] **Step 7: Add additional spec commands**

Extend `BUILT_IN_COMMANDS` in `App.tsx`:

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

Add handlers in `handlePaletteSelect`: `cmd:open-settings` (TODO), `cmd:reindex-vault` (re-post all files to Worker), `cmd:zoom-to-fit` (TODO: dispatch to graph-store).

**V&C:** `npm test`, then commit `CommandPalette.tsx __tests__/CommandPalette.test.ts App.tsx types.ts file-service.ts` with `"feat: add fuzzy search, match highlighting, recent files, and command prefix routing to CommandPalette"`.

---
## Chunk 4: Phase 2 (Function)

**Scope:** buildFileTree utility, graph-settings-store, GraphSettingsPanel, terminal:process-name IPC, settings-store + SettingsModal, sidebar wiring, terminal restyling, GraphPanel settings consumption.

**IPC pattern reminder:** All renderer IPC uses `window.api.<domain>.<method>(args)` (established by Chunk 1).

---

### Task 22: Create buildFileTree utility

**Files:**
- Create: `src/renderer/src/panels/sidebar/buildFileTree.ts`
- Test: `tests/sidebar/buildFileTree.test.ts`

- [ ] **Step 1: Write the test**

Test file: `tests/sidebar/buildFileTree.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { buildFileTree, type FlatTreeNode } from '../../src/renderer/src/panels/sidebar/buildFileTree'
```

Test names (all against `buildFileTree`):
- `creates flat nodes from root-level files` -- 2 files at root, verify length, name, isDirectory=false, parentPath=vaultRoot
- `creates directory nodes with parentPath references` -- nested paths, verify dir node exists with parentPath=vaultRoot, itemCount=2, child parentPath points to dir
- `handles deeply nested paths with flat output` -- `/vault/a/b/c/deep.md`, verify parentPath chain per depth, no `children` property on any node
- `sorts directories before files at same parent` -- dir before file at root level
- `includes item counts on directories` -- 2 files in dir, itemCount=2
- `computes depth from path segments` -- depth 0/1/2 for nested segments
- `returns empty array for no files`
- `preserves alphabetical sort within parent groups`

- [ ] **Step 2: Run test (expect FAIL)**

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
```

**Algorithm:**
1. **Collect phase:** For each file path, strip vault root prefix, split into segments. Register each intermediate directory in a `Map<dirPath, {name, parentPath, depth}>`. Register each file with its parentPath and depth.
2. **Count phase:** Count direct file children per directory path into `itemCounts` map.
3. **Emit phase:** Recursive depth-first `emitChildren(parentPath)`:
   - Collect child dirs at this parent, sort by name
   - Collect child files at this parent, sort by name
   - Emit dirs first (each followed by recursive children), then files
   - Each node has `itemCount: itemCounts.get(dirPath) ?? 0` for dirs, `0` for files

Key design: flat array with `parentPath` references (no nested `children`), so drag-and-drop is a path update, not a tree restructure.

- [ ] **Step 4: Run test (expect PASS)**

**V&C:**
```
git add src/renderer/src/panels/sidebar/buildFileTree.ts tests/sidebar/buildFileTree.test.ts
git commit -m "feat: add buildFileTree utility with flat parentPath structure"
```

---

### Task 23: Create graph-settings-store

**Files:**
- Create: `src/renderer/src/store/graph-settings-store.ts`
- Test: `tests/store/graph-settings-store.test.ts`

- [ ] **Step 1: Write the test**

Test file: `tests/store/graph-settings-store.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useGraphSettingsStore } from '../../src/renderer/src/store/graph-settings-store'
```

`beforeEach`: reset store to defaults via `setState(...)`.

Test names:
- `has sensible defaults` -- showOrphans=true, baseNodeSize=4, centerForce=0.5, repelForce=-120, isAnimating=true
- `updates filter settings immutably` -- setShowOrphans(false)
- `updates force settings` -- setCenterForce(0.8), setRepelForce(-200)
- `updates display settings` -- setBaseNodeSize(8), setLinkOpacity(0.7), setShowArrows(true)
- `updates group visibility` -- setGroupVisible('gene', false)
- `updates group color` -- setGroupColor('gene', '#FF0000')
- `does not mutate previous state on group update` -- snapshot before, mutate, verify before !== after

- [ ] **Step 2: Run test (expect FAIL)**

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

// PersistedState: explicit type for partialize
type GraphSettingsPersistedState = Omit<GraphSettingsState, never>
```

**Actions:** One setter per state field, following the pattern `setFieldName: (v) => set({ fieldName: v })`. Group mutations use immutable spread:

```typescript
setGroupVisible: (type, visible) => {
  const groups = { ...get().groups }
  groups[type] = { ...groups[type], visible }
  set({ groups })
}
// setGroupColor follows same pattern
```

**Defaults:**

| Field | Default |
|-------|---------|
| showOrphans | `true` |
| showExistingOnly | `false` |
| baseNodeSize | `4` |
| nodeSizeMode | `'degree'` |
| linkOpacity | `0.4` |
| linkThickness | `1` |
| showArrows | `false` |
| textFadeThreshold | `1.5` |
| isAnimating | `true` |
| showMinimap | `false` |
| centerForce | `0.5` |
| repelForce | `-120` |
| linkForce | `0.3` |
| linkDistance | `30` |
| groups | gene=#6C63FF, constraint=#EF4444, research=#2DD4BF, output=#EC4899, note=#8B8B8E, index=#38BDF8 (all visible) |

**Storage adapter:** Custom vault-scoped persistence to `.thought-engine/graph-settings.json`:

```typescript
// CORRECTED: Use lazy getter for vaultPath (not window.__vaultPath)
// CORRECTED: Use lazy getter for IPC to avoid crash in test env
const getVaultPath = () => useVaultStore.getState().vaultPath

const vaultStorage = createJSONStorage<GraphSettingsPersistedState>(() => ({
  getItem: async (name: string): Promise<string | null> => {
    try {
      const vaultPath = getVaultPath()
      if (!vaultPath) return null
      const path = `${vaultPath}/.thought-engine/${name}.json`
      return await window.api.fs.readFile(path)
    } catch { return null }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const vaultPath = getVaultPath()
      if (!vaultPath) return
      const path = `${vaultPath}/.thought-engine/${name}.json`
      await window.api.fs.writeFile(path, value)
    } catch { /* silent */ }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      const vaultPath = getVaultPath()
      if (!vaultPath) return
      const path = `${vaultPath}/.thought-engine/${name}.json`
      await window.api.fs.deleteFile(path)
    } catch { /* silent */ }
  },
}))
```

**Persist config:**

```typescript
persist<GraphSettingsStore, GraphSettingsPersistedState>(
  (set, get) => ({ /* ...state + actions... */ }),
  {
    name: 'graph-settings',
    storage: vaultStorage,
    partialize: (state) => ({
      // All state fields (not actions)
    }),
  }
)
```

- [ ] **Step 4: Run test (expect PASS)**

**V&C:**
```
git add src/renderer/src/store/graph-settings-store.ts tests/store/graph-settings-store.test.ts
git commit -m "feat: add graph-settings-store with groups, persistence, and full test coverage"
```

---

### Task 24: Create GraphSettingsPanel

**Files:**
- Create: `src/renderer/src/panels/graph/GraphSettingsPanel.tsx`

- [ ] **Step 1: Implement the Obsidian-style settings overlay**

An absolute-positioned panel (260px wide, right side, z-20) with collapsible sections. Uses `useGraphSettingsStore` for all state.

**Helper components:**

| Component | Purpose |
|-----------|---------|
| `SliderRow` | Label + `<input type="range">` + numeric display. Props: label, value, min, max, step, onChange. |
| `ToggleRow` | Label + toggle button (w-8 h-4 rounded-full). Props: label, checked, onChange. |
| `SectionHeader` | Collapsible section header with triangle indicator. Props: title, isOpen, onToggle. |

**Props:** `{ isOpen: boolean; onClose: () => void }`

**Sections and controls:**

| Section | Controls |
|---------|----------|
| **Filters** | `showOrphans` (toggle), `showExistingOnly` (toggle) |
| **Groups** | Per `ARTIFACT_TYPES`: color picker (`<input type="color">`), visibility ON/OFF toggle |
| **Display** | `baseNodeSize` (slider 1-20), `linkOpacity` (slider 0-1 step 0.05), `linkThickness` (slider 0.5-5 step 0.5), `showArrows` (toggle), `textFadeThreshold` (slider 0.5-4 step 0.1), `showMinimap` (toggle) |
| **Forces** | `centerForce` (slider 0-1 step 0.05), `repelForce` (slider -500-0 step 10), `linkForce` (slider 0-1 step 0.05), `linkDistance` (slider 10-200 step 5) |

Footer: full-width "Stop/Start Animation" button toggling `isAnimating`.

Section collapse managed by local `useState<Record<string, boolean>>` (all default open).

**V&C:**
```
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

**V&C:**
```
git add src/main/services/shell-service.ts src/main/ipc/shell.ts
git commit -m "feat: add terminal:process-name IPC handler"
```

---

### Task 26: Create settings-store and SettingsModal

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

// PersistedState: explicit type for partialize
type SettingsPersistedState = Omit<SettingsState, never>
```

**Actions:** One setter per field (same pattern as Task 23).

**Defaults:** fontSize=13, fontFamily='Inter', defaultEditorMode='rich', autosaveInterval=1500, spellCheck=false, terminalShell='', terminalFontSize=13, scrollbackLines=10000.

**Storage:** CORRECTED: Use simple `createJSONStorage(() => localStorage)` (Zustand 5 pattern).

```typescript
export const useSettingsStore = create<SettingsStore>()(
  persist<SettingsStore, SettingsPersistedState>(
    (set) => ({ /* ...defaults + setters... */ }),
    {
      name: 'thought-engine-settings',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ /* all state fields */ }),
    }
  )
)
```

- [ ] **Step 2: Implement SettingsModal with 5 tabs**

File: `src/renderer/src/components/SettingsModal.tsx`

**Props:** `{ isOpen: boolean; onClose: () => void }`

**Helper components:**

| Component | Purpose |
|-----------|---------|
| `SettingRow` | Label + children in flex row. |
| `SliderInput` | Range input + numeric display. Props: value, min, max, step, onChange. |
| `Toggle` | Same toggle button pattern as GraphSettingsPanel. |
| `SelectInput` | `<select>` with options array. |

**Tabs:** `appearance | editor | graph | terminal | vault`

| Tab | Settings |
|-----|----------|
| **Appearance** | fontSize (slider 10-24), fontFamily (select: Inter/System/JetBrains Mono), Theme (read-only "Dark (only)") |
| **Editor** | defaultEditorMode (select: Rich/Source), autosaveInterval (slider 500-10000 step 500), spellCheck (toggle) |
| **Graph** | Mirrors GraphSettingsPanel subset: baseNodeSize, linkOpacity, showArrows, centerForce, repelForce, linkForce, linkDistance |
| **Terminal** | terminalShell (text input), terminalFontSize (slider 8-24), scrollbackLines (slider 1000-100000 step 1000) |
| **Vault** | vaultPath (read-only from `useVaultStore`), "Re-index Vault" button (reads all files via `window.api.fs.listFilesRecursive` + `window.api.fs.readFile`) |

**Layout:** Fixed overlay (z-50), centered 560x480 modal. Left sidebar (160px) with tab buttons, right content area. Escape key closes. Backdrop click closes.

- [ ] **Step 3: Wire SettingsModal into App.tsx**

In `WorkspaceShell`:
1. Add `const [settingsOpen, setSettingsOpen] = useState(false)`
2. In `handlePaletteSelect`, add case for `'cmd:open-settings'` that sets `settingsOpen(true)`
3. Render `<SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />` after CommandPalette

**V&C:**
```
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

- [ ] **Step 1: Write tests for FileTree rendering**

Test file: `tests/sidebar/FileTree.test.ts`

Helper: `makeNode(overrides)` creates a `FlatTreeNode` with sensible defaults.

Test names:
- `renders directory and file nodes`
- `hides children when directory is collapsed`
- `highlights active file`
- `calls onFileSelect when file clicked`
- `calls onToggleDirectory when folder clicked`

- [ ] **Step 2: Run test (expect FAIL)**

- [ ] **Step 3: Update FileTree.tsx to consume FlatTreeNode[]**

Replace FileTree with a component rendering from flat `FlatTreeNode[]`.

**Props:**
```typescript
interface FileTreeProps {
  nodes: FlatTreeNode[]
  activeFilePath: string | null
  collapsedPaths: Set<string>
  artifactTypes?: Map<string, ArtifactType>
  onFileSelect: (path: string) => void
  onToggleDirectory: (path: string) => void
}
```

**Visibility logic:** `isVisible(node, collapsedPaths, allNodes)` walks up the parentPath chain. If any ancestor is in `collapsedPaths`, the node is hidden.

**Rendering:** Flat map over visible nodes. Directories show collapse triangle + name + itemCount badge. Files show optional artifact color dot + name. `paddingLeft = 12 + depth * 16`.

- [ ] **Step 4: Update Sidebar.tsx with action bar**

**Sidebar props:** nodes, workspaces, activeWorkspace, activeFilePath, collapsedPaths, artifactTypes, sortMode, onSearch, onWorkspaceSelect, onFileSelect, onToggleDirectory, onNewFile, onNewFolder, onSortChange.

**ActionBar** sub-component: "+ File" button, "+ Folder" button, sort dropdown (Modified/Name/Type). Placed between SearchBar and WorkspaceFilter.

**Layout:** Vertical flex: SearchBar > ActionBar > WorkspaceFilter (if workspaces) > FileTree (flex-1 overflow-y-auto).

- [ ] **Step 5: Update ConnectedSidebar in App.tsx**

```typescript
import { buildFileTree } from './panels/sidebar/buildFileTree'

function ConnectedSidebar() {
  const { files, config, activeWorkspace, setActiveWorkspace, vaultPath } = useVaultStore()
  const { setActiveNote, activeNotePath } = useEditorStore()
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<'modified' | 'name' | 'type'>('modified')

  const treeNodes = useMemo(() => {
    const paths = files.map((f) => f.path)
    return buildFileTree(paths, vaultPath ?? '')
  }, [files, vaultPath])

  // CORRECTED: VaultFile has no `type` field. Look up artifact type via store.
  const artifactTypes = useMemo(() => {
    const map = new Map<string, ArtifactType>()
    const { getArtifact } = useVaultStore.getState()
    for (const f of files) {
      const artifact = getArtifact(f.path)
      if (artifact) map.set(f.path, artifact.type)
    }
    return map
  }, [files])

  // Handlers:
  // handleFileSelect: find file by path, call setActiveNote
  // handleSearch: placeholder (TODO: wire to vault index search)
  // handleToggleDirectory: immutable Set toggle
  // handleNewFile: prompt for name, window.api.fs.writeFile with frontmatter template
  // handleNewFolder: prompt for name, window.api.fs.writeFile .gitkeep

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

Run: `npx vitest run tests/sidebar/FileTree.test.ts tests/sidebar/buildFileTree.test.ts`

**V&C:**
```
git add src/renderer/src/panels/sidebar/FileTree.tsx src/renderer/src/panels/sidebar/Sidebar.tsx src/renderer/src/App.tsx tests/sidebar/FileTree.test.ts
git commit -m "feat: wire buildFileTree into FileTree with hierarchy, action bar, and collapse state"
```

---

### Task 28: Terminal restyling with close guard, rename, search, and zoom

**Files:**
- Modify: `src/renderer/src/panels/terminal/TerminalTabs.tsx`
- Modify: `src/renderer/src/panels/terminal/TerminalPanel.tsx`
- Modify: `src/shared/ipc-channels.ts`

- [ ] **Step 1: Update TerminalTabs.tsx**

Features to add:
- **Colored status dots:** Green (#34D399) for shell, purple (#A78BFA) if title contains "claude" (agent session)
- **Close guard:** Hide the X button when `sessions.length <= 1`
- **Double-click rename:** Track `editingId` state. Double-click sets editing mode with inline `<input>`. Enter confirms, Escape cancels, blur confirms.
- **PTY process name polling:** `useEffect` with 2s interval, calls `window.api.terminal.processName(session.id)`. If result differs from current title, call `renameSession`.

- [ ] **Step 2: Update TerminalPanel.tsx with search and zoom**

Features to add:
- **Cmd+F search:** Toggle `searchOpen` state. Renders a search bar below tabs with text input. Uses xterm `SearchAddon` stored in `searchAddonsRef` map. Enter calls `findNext`, Escape closes.
- **Cmd+=/- zoom:** Adjusts `termFontSize` state (min 8, max 28). Updates all terminal instances' `fontSize` option and calls `fitAddon.fit()`.
- **Store search addons:** In `createTerminalInstance`, after creating SearchAddon, store it in `searchAddonsRef.current.set(sessionId, searchAddon)`.
- **Search execution effect:** When `searchQuery` changes, call `addon.findNext(searchQuery)` on active session's addon.

Keyboard handler uses `container.addEventListener('keydown', ...)` on the terminal container ref.

- [ ] **Step 3: Add terminal:process-name to IPC type definitions**

```typescript
// Add to IpcChannels in src/shared/ipc-channels.ts:
'terminal:process-name': { request: { sessionId: string }; response: string | null }
```

**V&C:**
```
git add src/renderer/src/panels/terminal/TerminalTabs.tsx src/renderer/src/panels/terminal/TerminalPanel.tsx src/shared/ipc-channels.ts
git commit -m "feat: restyle terminal tabs with close guard, rename, search, and zoom"
```

---

### Task 29: Wire GraphPanel to consume graph-settings-store

**Files:**
- Modify: `src/renderer/src/panels/graph/GraphPanel.tsx`
- Modify: `src/renderer/src/panels/graph/GraphRenderer.ts`

- [ ] **Step 1: Update GraphPanel to read settings**

Import `useGraphSettingsStore` and `GraphSettingsPanel`.

Add `const [settingsOpen, setSettingsOpen] = useState(false)`.

Read all settings from store: showOrphans, showExistingOnly, baseNodeSize, linkOpacity, linkThickness, showArrows, textFadeThreshold, isAnimating, centerForce, repelForce, linkForce (aliased as linkForceStrength), linkDistance, groups.

**Render callback:** Pass display settings to `renderGraph` via a `RenderConfig` object:

```typescript
interface RenderConfig {
  baseNodeSize: number
  linkOpacity: number
  linkThickness: number
  showArrows: boolean
  textFadeThreshold: number
  zoomLevel: number
  groupColors: Record<string, string>
}
```

Build `groupColors` from `Object.entries(groups).map(([type, cfg]) => [type, cfg.color])`.

**Simulation creation effect:** Apply filters before creating simulation:
1. If `!showOrphans`: filter to only nodes that appear in at least one edge
2. If `showExistingOnly`: filter to nodes matching vault file paths
3. Filter out nodes whose group `visible === false`
4. Filter edges to only those connecting remaining nodes
5. Pass `{ centerForce, repelForce, linkForce, linkDistance }` to `createSimulation`
6. If `!isAnimating`: call `sim.stop()` after creation

**Settings toggle button:** Absolute-positioned (top-3 right-3 z-10) in the canvas container. Toggles `settingsOpen`.

Render `<GraphSettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />` inside the container.

- [ ] **Step 2: Update createSimulation to accept configurable force parameters**

```typescript
// In GraphRenderer.ts:
interface SimulationConfig {
  centerForce: number
  repelForce: number
  linkForce: number
  linkDistance: number
}

export function createSimulation(
  nodes: SimNode[], edges: SimEdge[],
  width: number, height: number,
  config: SimulationConfig = { centerForce: 0.5, repelForce: -120, linkForce: 0.3, linkDistance: 30 }
): Simulation<SimNode, SimEdge> {
  return forceSimulation<SimNode>(nodes)
    .force('link', forceLink<SimNode, SimEdge>(edges)
      .id((d) => d.id).strength(config.linkForce).distance(config.linkDistance))
    .force('charge', forceManyBody<SimNode>().strength(config.repelForce))
    .force('center', forceCenter(width / 2, height / 2).strength(config.centerForce))
    .force('collide', forceCollide<SimNode>().radius((d) => nodeRadius(d.connectionCount) + 4))
}
```

- [ ] **Step 3: Update renderGraph to accept display settings**

Add `RenderConfig` parameter (interface defined above) with defaults.

**Rendering changes:**
- Edges: use `config.linkOpacity` for globalAlpha, `config.linkThickness` for lineWidth
- Arrows: only render if `config.showArrows` is true. Arrow geometry: 6px arrowhead at target end, offset by target node radius.
- Nodes: scale radius by `config.baseNodeSize / 4`. Use `config.groupColors[node.type]` with fallback to `ARTIFACT_COLORS`.
- Labels: show if hovered OR `config.zoomLevel >= config.textFadeThreshold`. Alpha fades in over 0.5 zoom units above threshold.

**V&C:**
```
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
```

Tests to write:

**buildAdjacencyList:**
- `builds bidirectional adjacency from edges with string IDs`
- `handles edges where source/target are SimNode objects`
- `returns empty map for no edges`

**computeConnectedSet:**
- `returns the node itself and its immediate neighbors`
- `returns singleton set for a node with no neighbors`
- `returns correct set for isolated cluster`

**easeOut:**
- `returns 0 at t=0`
- `returns 1 at t=1`
- `returns values between 0 and 1 for intermediate t`
- `decelerates (second half covers less distance than first)`

**interpolateGlow:**
- `returns startValue at elapsed=0`
- `returns target when fully elapsed (fade-in, 200ms)`
- `returns target when fully elapsed (fade-out, 300ms)`
- `interpolates partially for mid-transition`

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
```

**Pure functions** (exported for testing):

- `getEdgeNodeId(node: string | SimNode): string` -- extracts ID from either string or SimNode
- `buildAdjacencyList(edges: readonly SimEdge[]): Map<string, Set<string>>` -- bidirectional adjacency from edges
- `computeConnectedSet(nodeId: string, adjacency: ReadonlyMap<string, ReadonlySet<string>>): ReadonlySet<string>` -- node + immediate neighbors
- `easeOut(t: number): number` -- `1 - Math.pow(1 - t, 2)` deceleration curve
- `interpolateGlow(startValue: number, target: number, startTime: number, now: number): { value: number; done: boolean }` -- uses GLOW_FADE_IN_MS for fade-in, GLOW_FADE_OUT_MS for fade-out, applies easeOut

**Hook** `useGraphHighlight(edges: readonly SimEdge[])`:

State machine driven by `clickLockedRef` and `hoveredNodeId` from graph store:
- `focusedNodeId = clickLockedRef.current ?? hoveredNodeId`
- `mode`: `'click'` if click-locked, `'hover'` if hoveredNodeId, else `'idle'`
- `connectedSet`: memoized from `computeConnectedSet(focusedNodeId, adjacency)`

Glow interpolation via rAF loop:
- `glowRef` tracks `{ current, target, startValue, startTime }`
- `tickGlow` callback reads `glowRef`, calls `interpolateGlow`, updates state, schedules next rAF if not done
- `setGlowTarget(target)` starts a new transition when focus changes
- Effect drives `setGlowTarget(focusedNodeId ? 1 : 0)` on focusedNodeId change
- Cleanup cancels rAF on unmount

Returns:
```typescript
return {
  state: { mode, focusedNodeId, connectedSet, glowIntensity },
  adjacency,
  handleHover: (nodeId: string | null) => setHoveredNode(nodeId),
  handleClick: (nodeId: string | null) => { /* sets clickLockedRef + setSelectedNode */ },
  handleDoubleClick: (nodeId: string) => { /* clears lock + selection + hover */ },
}
```

**V&C:**
Run tests, then full suite. Commit: `feat: add useGraphHighlight hook with adjacency list and connected set computation`

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
```

Mock `OffscreenCanvas` for Node test environment with `getContext()` returning a stub 2d context and `transferToImageBitmap()` returning `{ width, height, close: () => {} }`. Polyfill via `globalThis.OffscreenCanvas = MockOffscreenCanvas`.

Tests:
- `creates a sprite for a given color and radius`
- `returns the same sprite for repeated calls with same params`
- `returns different sprites for different colors`
- `returns different sprites for different radii`
- `clears all cached sprites`

- [ ] **Step 2: Run test to verify it fails**

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
```

**`GlowSpriteCache` class:**
- `private cache = new Map<string, GlowSprite>()`
- `get(color: string, radius: number): GlowSprite` -- cache key is `${color}:${radius}`, creates on miss
- `clear(): void` -- closes all bitmaps, clears map

**`createGlowSprite(color, radius)`:** Creates `OffscreenCanvas` of size `(radius + GLOW_PADDING) * 2`. Draws ambient glow (shadowColor, shadowBlur=AMBIENT_BLUR, globalAlpha=0.3) then solid core (full alpha). Returns `{ bitmap: canvas.transferToImageBitmap(), width: size, height: size }`.

**`drawGlowSprite(ctx, sprite, x, y, alpha): void`:** Draws sprite.bitmap centered at (x,y) with given alpha, restoring previous globalAlpha.

**V&C:**
Run tests. Commit: `feat: add offscreen canvas glow sprite cache for graph node rendering`

---

### Task 32: Enhance GraphRenderer with glow sprites, dimming, edge brightening, labels, frame budget, and edge LOD

**Files:**
- Modify: `src/renderer/src/panels/graph/GraphRenderer.ts`

- [ ] **Step 1: Rewrite renderGraph with highlight-aware rendering, frame budget monitoring, and edge LOD**

Keep `createSimulation`, `SimNode`, `SimEdge`, and `findNodeAt` unchanged. Key changes from spec:
- **NodeSizeMode**: imported from `graph-settings-store` (canonical location) and re-exported (issue #27)
- **Extreme zoom-out edge LOD** (spec 3E): at `k < 0.2`, edges drawn as single low-alpha overlay
- **Frame budget monitoring** (spec 3E): `performance.now()` instrumentation, warns >16ms, returns frame duration
- **Adaptive quality**: `skipAmbientSprites` option skips glow sprites when budget exceeded

**New imports:**
```typescript
import { ARTIFACT_COLORS, colors } from '../../design/tokens'
import { SIGNAL_OPACITY } from '@shared/types'
import { GlowSpriteCache, drawGlowSprite } from './glowSprites'
import type { HighlightState } from './useGraphHighlight'
import type { NodeSizeMode } from '../../store/graph-settings-store'
export type { NodeSizeMode }
```

**New types and constants:**
```typescript
export interface NodeSizeConfig {
  mode: NodeSizeMode
  baseSize: number
}

const DEFAULT_SIZE_CONFIG: NodeSizeConfig = { mode: 'degree', baseSize: 4 }

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

interface RenderOptions {
  highlight: HighlightState
  sizeConfig: NodeSizeConfig
  transform: { x: number; y: number; k: number }
  canvasWidth: number
  canvasHeight: number
  reducedMotion: boolean
  skipAmbientSprites?: boolean
}
```

**`computeNodeRadius(node, config, charCount?): number`:** Switch on `config.mode`:
- `'uniform'`: return base
- `'content'`: `base + Math.log(Math.max(chars, 100) / 100) * 2`
- `'degree'` (default): `base + Math.sqrt(node.connectionCount) * 2.5`

**`nodeRadius(connectionCount): number`:** Legacy alias using DEFAULT_SIZE_CONFIG.

**`renderGraph(ctx, nodes, edges, width, height, selectedId, hoveredId, options?): number`:**

Returns frame duration in ms. Rendering pipeline (8 stages):

1. **Clear + background gradient** -- radial from `#111113` center to `colors.bg.base`
2. **Compute highlight context** -- extract connectedSet, sizeConfig from options
3. **Compute viewport culling bounds** -- transform options to graph-space min/max with CULL_MARGIN=40
4. **Edge LOD check** -- if `zoomK < 0.2`, batch all edges into single beginPath/stroke at alpha 0.06
5. **Draw individual edges** (skip if LOD overlay) -- per-edge viewport culling, highlight-aware coloring: connected edges get accent color + HIGHLIGHT_EDGE_WIDTH, dimmed edges get DIM_ALPHA, normal edges get 0.4 alpha
6. **Determine LOD level** -- `isLowDetail = zoomLevel < 0.4`, `showLabelsAtZoom = zoomLevel >= 1.0`
7. **Draw nodes** -- per-node viewport culling, then for each visible node:
   - If `isLowDetail`: simple fillRect, continue
   - If not dimmed and not skipAmbientSprites: draw glow sprite at 0.6 alpha
   - If focused/connected and not reducedMotion: real-time shadowBlur (14 or 16)
   - Draw node circle with artifact color and signal opacity (dimmed to DIM_ALPHA if not in connectedSet)
   - If selected: outer ring at +4px offset, accent color, 0.4 alpha
   - Reset shadow
   - If label should show (focused/hovered/connected AND showLabelsAtZoom): draw title above node
8. **Frame budget** -- measure duration, warn if >16ms, return duration

- [ ] **Step 2: Run typecheck + all tests**

**V&C:**
Commit: `feat: enhance GraphRenderer with glow sprites, dimming, edge brightening, viewport culling, LOD, frame budget, edge overlay`

---

### Task 33: Create useGraphAnimation hook (enter/exit transitions, rename detection, rAF batching)

**Files:**
- Create: `src/renderer/src/panels/graph/useGraphAnimation.ts`
- Test: `tests/graph/useGraphAnimation.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/graph/useGraphAnimation.test.ts
import { describe, it, expect } from 'vitest'
import { diffNodes, detectRenames } from '../../src/renderer/src/panels/graph/useGraphAnimation'
import type { SimNode } from '../../src/renderer/src/panels/graph/GraphRenderer'

function makeNode(id: string, title: string = id, x: number = 0, y: number = 0): SimNode {
  return { id, title, type: 'note', signal: 'untested', connectionCount: 0, x, y }
}
```

Tests:

**diffNodes:**
- `detects added nodes`
- `detects removed nodes`
- `handles empty arrays`
- `detects simultaneous adds and removes`

**detectRenames:**
- `matches a remove+add with the same id as a rename`
- `returns empty when no matching IDs`
- `handles multiple renames`

- [ ] **Step 2: Run test to verify it fails**

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
```

**Pure functions** (exported for testing):

- `diffNodes(prev, next): NodeDiff` -- set-based diff on node IDs
- `detectRenames(removed, added): readonly RenameEntry[]` -- matching IDs between removed/added lists, captures old position

**Hook** `useGraphAnimation(onRestart: (alpha: number) => void, reducedMotion: boolean)`:

Internal state:
- `batchRef`: `{ enterNodes: Map<string, AnimatingNode>, exitNodes: Map<string, AnimatingNode> }`
- `pendingChangesRef`: accumulates add/remove changes
- `rafIdRef`: coalesces flush to single rAF

Behavior:
- `queueEnter(nodes)` / `queueExit(nodes)`: push to pendingChangesRef, schedule flush via rAF
- `flushPendingChanges`: processes pending changes into enter/exit maps (skipped if reducedMotion), calls `onRestart(REHEAT_ALPHA)` for gentle reheat
- `getNodeTransition(nodeId, now): { opacity: number; scale: number }` -- returns interpolated values for enter (400ms ease-out cubic, scale 0.5->1) or exit (200ms, scale 1->0.5, opacity 1->0). Cleans up completed animations. Returns `{ opacity: 1, scale: 1 }` for non-animating nodes.
- `hasActiveAnimations(): boolean` -- checks both maps

Returns: `{ queueEnter, queueExit, getNodeTransition, hasActiveAnimations, diffNodes, detectRenames }`

**V&C:**
Run tests. Commit: `feat: add useGraphAnimation hook with enter/exit transitions, rename detection, rAF batching`

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

> **Note**: `deleteFile` delegates to the existing `fs:delete-file` IPC handler. No main-process change needed. Types in `api.d.ts` are inferred automatically from the preload methods.

- [ ] **Step 2: Implement the SkillsPanel**

Component: `src/renderer/src/panels/skills/SkillsPanel.tsx`

**Interfaces:**
```typescript
interface SkillEntry {
  name: string
  description: string
  path: string
}
```

**`parseSkillDescription(content: string): string`:** Scans lines for first meaningful content (skipping `#` headings, `---`). Returns up to 120 chars, or `'No description'`.

**`EmptyState` component:** Centered message explaining `.claude/commands/` directory with code snippets styled in `colors.bg.elevated` / `colors.accent.default`.

**`SkillCard` component:** Flex row with name (truncated, `colors.text.primary`), description (truncated, `colors.text.muted`), and a "Run" button that appears on group hover. Styled with `colors.bg.surface` background, `colors.border.default` border.

**`SkillsPanel` component:**
- Reads `vaultPath` from `useVaultStore`
- Effect loads skills: calls `window.api.vault.listCommands(${vaultPath}/.claude/commands)`, then `window.api.vault.readFile` for each file, parses descriptions, sorts alphabetically. Uses cancellation flag for cleanup.
- `handleRun`: dispatches `CustomEvent('run-skill', { detail: { command: skill.name, path: skill.path } })` for TerminalPanel to listen for
- Renders: loading state, empty state (no skills), or header ("Skills (N)") + scrollable list of SkillCards

- [ ] **Step 3: Run typecheck**

**V&C:**
Commit: `feat: add SkillsPanel with vault IPC for reading .claude/commands/`

---

### Task 35: Refactor GraphControls to Graph/Skills toggle and update graph-store

> **Key change**: This task adds `'skills'` to the `ContentView` type in graph-store.

**Files:**
- Modify: `src/renderer/src/store/graph-store.ts`
- Modify: `src/renderer/src/panels/graph/GraphControls.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Update graph-store ContentView union**

Add `'skills'` to the `ContentView` type:

```typescript
type ContentView = 'editor' | 'graph' | 'skills'
```

No other changes to graph-store. All existing fields (`selectedNodeId`, `hoveredNodeId`, `typeFilters`, `signalFilter`) and actions remain unchanged.

- [ ] **Step 2: Refactor GraphControls to Graph/Skills pill toggle**

Replace the entire GraphControls component. Remove the Editor button, replace with Skills. Only renders when `contentView !== 'editor'`:

```typescript
export function GraphControls() {
  const { contentView, setContentView } = useGraphStore()
  if (contentView === 'editor') return null
  // Pill toggle with Graph and Skills buttons
  // Active: backgroundColor = colors.accent.muted, color = colors.text.primary
  // Inactive: transparent bg, color = colors.text.muted
}
```

Container: absolute positioned `top-3 left-1/2 -translate-x-1/2`, z-10. Inner pill: `colors.bg.surface` bg, `colors.border.default` border, `rounded-lg`.

- [ ] **Step 3: Update App.tsx ContentArea to render SkillsPanel and update command palette entry**

Import `SkillsPanel` and update ContentArea to handle three-way content view:

```typescript
{contentView === 'graph' && <GraphPanel onNodeClick={handleNodeClick} />}
{contentView === 'editor' && <EditorPanel onNavigate={handleNavigate} />}
{contentView === 'skills' && <SkillsPanel />}
```

Update `BUILT_IN_COMMANDS`: change `cmd:toggle-view` label to `'Cycle View'`.

Update `toggleView` callback in `WorkspaceShell` to cycle: `editor -> graph -> skills -> graph`:

```typescript
const toggleView = useCallback(() => {
  if (contentView === 'editor') setContentView('graph')
  else if (contentView === 'graph') setContentView('skills')
  else setContentView('graph')
}, [contentView, setContentView])
```

**V&C:**
Run typecheck, tests. Commit: `feat: refactor content view to graph/skills toggle, add skills to ContentArea`

---

### Task 36: Update useKeyboard with Cmd+G cycle logic

**Files:**
- Modify: `src/renderer/src/hooks/useKeyboard.ts`

- [ ] **Step 1: Rename callback from `onToggleView` to `onCycleView`**

The cycle logic lives in `WorkspaceShell`'s `toggleView` callback (updated in Task 35). The hook delegates to it. This task renames the callback for clarity:

In `KeyboardConfig` interface: `onCycleView?: () => void`

In `META_KEY_BINDINGS` array: `{ key: 'g', handler: 'onCycleView' }`

- [ ] **Step 2: Update the consumer in App.tsx WorkspaceShell**

```typescript
useKeyboard({
  onCommandPalette: () => setPaletteOpen(true),
  onCycleView: toggleView,
  onToggleSourceMode: toggleSourceMode,
  onEscape: () => setPaletteOpen(false)
})
```

**V&C:**
Run typecheck, tests. Commit: `refactor: rename onToggleView to onCycleView in useKeyboard for graph/skills cycle`

---

### Task 37: Add node sizing modes to GraphSettingsPanel and GraphRenderer

**Files:**
- Modify: `src/renderer/src/store/graph-settings-store.ts`
- Modify: `src/renderer/src/panels/graph/GraphSettingsPanel.tsx`

- [ ] **Step 1: Verify graph-settings-store exports NodeSizeMode**

Task 23 established `groups`, `GroupConfig`, `setGroupVisible`, `setGroupColor`, `persist` middleware, and `vaultStorage`. All must be preserved. This step ONLY adds the `export` keyword:

```typescript
// Change:  type NodeSizeMode = 'degree' | 'uniform' | 'content'
// To:
export type NodeSizeMode = 'degree' | 'uniform' | 'content'
```

- [ ] **Step 2: Add Node Size Mode dropdown to GraphSettingsPanel**

Import `type NodeSizeMode` from the store. Add selector for `nodeSizeMode`, `setNodeSizeMode`.

Add dropdown in the Display section (above the existing node size slider):

```typescript
<select value={nodeSizeMode} onChange={(e) => setNodeSizeMode(e.target.value as NodeSizeMode)}>
  <option value="degree">Degree (connections)</option>
  <option value="uniform">Uniform</option>
  <option value="content">Content length</option>
</select>
```

Styled: `colors.bg.elevated` bg, `colors.text.primary` text, `colors.border.default` border.

**V&C:**
Run typecheck. Commit: `feat: add node size mode dropdown to graph settings (degree, uniform, content)`

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

export interface GraphRendererInterface {
  render(params: RenderParams): void
  hitTest(nodes: readonly SimNode[], x: number, y: number): SimNode | null
  resize(width: number, height: number, dpr: number): void
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
```

**`Canvas2DGraphRenderer` class** implements `GraphRendererInterface`:
- `render(params)`: delegates to `renderGraph(params.ctx, params.nodes, params.edges, params.width, params.height, params.selectedId, params.hoveredId, { highlight, sizeConfig, transform, canvasWidth, canvasHeight, reducedMotion })`
- `hitTest(nodes, x, y)`: delegates to `findNodeAt(nodes, x, y)`
- `resize(width, height, dpr)`: stores dimensions internally
- `dispose()`: no-op (Canvas2D has no GPU resources; GlowSpriteCache is module-scoped)

**V&C:**
Run typecheck. Commit: `feat: add GraphRendererInterface abstraction for pluggable graph renderers`

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
```

**`computeGraphBounds(nodes): { minX, minY, maxX, maxY }`:** Scans all nodes for min/max coordinates, adds 10% padding. Returns `{ 0, 0, 100, 100 }` for empty arrays.

**`GraphMinimap` component:**

Rendering (via `renderMinimap` callback, called in effect on prop changes):
1. Set up canvas at `MINIMAP_WIDTH x MINIMAP_HEIGHT` with DPR scaling
2. Fill background with `MINIMAP_BG`, stroke border
3. Compute graph bounds and scale factor to fit minimap with padding
4. Draw edges as faint lines (alpha 0.15, lineWidth 0.5)
5. Draw nodes as colored dots (`fillRect`, alpha 0.7, `NODE_DOT_SIZE`)
6. Compute viewport rectangle from transform and draw filled (alpha 0.15) + stroked

Click handler: converts minimap click coordinates back to graph-space using the same bounds/scale math, calls `onPan(graphX, graphY)`.

Positioned: `absolute bottom-3 left-3`, cursor-crosshair, rounded, z-10.

**V&C:**
Run typecheck. Commit: `feat: add GraphMinimap component with thumbnail rendering and click-to-pan`

---

### Task 40: Create GraphContextMenu component

> **Correction**: `VaultFile` has no `id` field. Use `fileToId` map from vault-store to resolve `nodeId` to file path. Also, `deleteFile` call must be awaited.

**Files:**
- Create: `src/renderer/src/panels/graph/GraphContextMenu.tsx`
- Test: `tests/graph/GraphContextMenu.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/graph/GraphContextMenu.test.ts
import { describe, it, expect } from 'vitest'
import { CONTEXT_MENU_ITEMS } from '../../src/renderer/src/panels/graph/GraphContextMenu'
```

Tests:
- `has exactly 4 menu items`
- `marks only Delete as dangerous`
- `has unique action identifiers`
- `has non-empty labels for all items`

- [ ] **Step 2: Run test to verify it fails**

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
```

**File path resolution** (corrected -- VaultFile has no `id` field):
```typescript
// Use fileToId map (inverted) to find file path from nodeId
const fileToId = useVaultStore((s) => s.fileToId)
const filePath = Object.entries(fileToId).find(([, id]) => id === nodeId)?.[0] ?? null
```

**Behavior:**
- Click outside listener (deferred via `setTimeout(0)` to avoid triggering on the opening right-click)
- Escape key listener
- `handleAction(action)`:
  - `'open'`: calls `onOpenInEditor(nodeId)`
  - `'reveal'`: dispatches `CustomEvent('reveal-in-sidebar', { detail: { nodeId } })`, then `onClose()`
  - `'copy-path'`: `navigator.clipboard.writeText(filePath)`, then `onClose()`
  - `'delete'`: sets `showConfirm = true` (does not close yet)
- `handleConfirmDelete` (corrected -- await the deleteFile call):
  ```typescript
  const handleConfirmDelete = useCallback(async () => {
    if (filePath) {
      await window.api.vault.deleteFile(filePath)
    }
    onClose()
  }, [filePath, onClose])
  ```

**Rendering:**
- Fixed positioned at `(x, y)`, z-50, `min-w-[180px]`, `colors.bg.elevated` bg, `colors.border.default` border
- Normal mode: maps CONTEXT_MENU_ITEMS to buttons with hover highlight. Delete items styled red (`#EF4444`).
- Confirm mode (showConfirm): "Delete this note? This cannot be undone." with Cancel and Delete buttons

**V&C:**
Run typecheck, tests. Commit: `feat: add GraphContextMenu with open, reveal, copy path, and delete actions`

---

### Task 41: Integrate highlights, animation, minimap, and loading into GraphPanel

> **Correction**: `d3-transition` is NOT installed. The minimap pan handler must NOT use `.transition().duration(300)`. Use immediate transform: `select(canvas).call(zoomBehavior.transform, newTransform)`.

**Files:**
- Modify: `src/renderer/src/panels/graph/GraphPanel.tsx`

- [ ] **Step 1: Rewrite GraphPanel with full Phase 3 integration**

Replace the entire file. Integrates: `useGraphHighlight`, `useGraphAnimation`, `GraphMinimap`, enhanced `renderGraph` with options, double-click to open editor, right-click context menu, loading skeleton, `prefers-reduced-motion`.

**Imports:**
```typescript
import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom'
import { select } from 'd3-selection'
import { useVaultStore } from '../../store/vault-store'
import { useGraphStore } from '../../store/graph-store'
import { useGraphSettingsStore } from '../../store/graph-settings-store'
import { createSimulation, renderGraph, findNodeAt, type SimNode, type SimEdge, type NodeSizeConfig } from './GraphRenderer'
import { useGraphHighlight, type HighlightState } from './useGraphHighlight'
import { useGraphAnimation } from './useGraphAnimation'
import { GraphMinimap } from './GraphMinimap'
import { GraphContextMenu } from './GraphContextMenu'
import { colors } from '../../design/tokens'
```

**`useReducedMotion(): boolean`:** Listens to `window.matchMedia('(prefers-reduced-motion: reduce)')` changes.

**`LoadingSkeleton` component:** Three pulsing dots with staggered animation delays (0ms, 200ms, 400ms), `colors.accent.default`, centered absolutely.

**`GraphPanel({ onNodeClick }: { onNodeClick: (id: string) => void })`:**

**Refs:**
- `canvasRef`, `simRef`, `nodesRef`, `edgesRef`, `transformRef`, `zoomBehaviorRef`, `prevNodesRef`
- `skipSpritesRef` for adaptive quality

**Store selectors:**
- `graph` from vault-store
- `selectedNodeId`, `hoveredNodeId`, `setSelectedNode`, `setHoveredNode`, `setContentView` from graph-store
- `baseNodeSize`, `nodeSizeMode`, `showMinimap` from graph-settings-store

**Hooks:**
- `sizeConfig = useMemo<NodeSizeConfig>(() => ({ mode: nodeSizeMode, baseSize: baseNodeSize }), [...])`
- `highlightHook = useGraphHighlight(edgesRef.current)`
- `animation = useGraphAnimation(handleSimRestart, reducedMotion)`

**`render` callback:**
1. Save context, clear, apply transform (translate + scale)
2. Call `renderGraph(ctx, nodes, edges, ...)` with full options including `highlight`, `sizeConfig`, `transform`, `skipAmbientSprites`
3. Restore context
4. Adaptive quality: set `skipSpritesRef.current = frameDuration > 16`
5. If active animations, schedule next rAF

**Graph data pipeline effect** (on `graph` change):
1. Map graph.nodes to SimNode[] with random initial positions
2. Diff against `prevNodesRef.current` via `animation.diffNodes`
3. Detect renames, preserve positions for renamed nodes
4. Queue enter (truly new, not renames) and exit (truly removed, not renames) animations
5. Create simulation, listen to `tick` for render. Set `isSimulating = false` when `alpha < 0.1` (not at `'end'`)
6. Setup zoom behavior: `zoom().scaleExtent([0.1, 4])`, store transform on zoom event
7. Cleanup: stop sim, remove zoom listener

**Mouse handler pattern** (all 4 follow same structure):
1. Get canvas, compute bounding rect
2. Convert client coords to graph-space: `x = (clientX - rect.left - t.x) / t.k`
3. Hit-test via `findNodeAt(nodesRef.current, x, y)`
4. Dispatch to appropriate handler

Handlers:
- **mousemove**: `highlightHook.handleHover(node?.id ?? null)`, set cursor
- **click**: clear context menu, `highlightHook.handleClick(node?.id ?? null)`, `onNodeClick` if node
- **dblclick**: `highlightHook.handleDoubleClick(node.id)`, `setContentView('editor')`, `onNodeClick`
- **contextmenu**: `e.preventDefault()`, set context menu state `{ x: e.clientX, y: e.clientY, nodeId }` or clear

**Minimap pan handler** (corrected -- no d3-transition):
```typescript
const handleMinimapPan = useCallback((graphX: number, graphY: number) => {
  const canvas = canvasRef.current
  const zb = zoomBehaviorRef.current
  if (!canvas || !zb) return

  const t = transformRef.current
  const canvasW = canvas.width / window.devicePixelRatio
  const canvasH = canvas.height / window.devicePixelRatio

  const newX = canvasW / 2 - graphX * t.k
  const newY = canvasH / 2 - graphY * t.k

  const newTransform = zoomIdentity.translate(newX, newY).scale(t.k)
  select(canvas).call(zb.transform, newTransform)
}, [])
```

**Resize observer effect:** Observes canvas, updates `width`/`height` with DPR, re-renders.

**JSX structure:**
```
<div className="h-full relative" style={{ backgroundColor: colors.bg.base }}>
  <canvas ... onMouseMove onDoubleClick onClick onContextMenu />
  {isSimulating && !isEmpty && <LoadingSkeleton />}
  {isEmpty && <EmptyState message />}
  {showMinimap && !isEmpty && <GraphMinimap ... onPan={handleMinimapPan} />}
  {contextMenu && <GraphContextMenu ... onClose onOpenInEditor />}
</div>
```

**V&C:**
Run typecheck, tests. Commit: `feat: integrate highlights, animation, minimap, context menu, and loading into GraphPanel`

---
## Chunk 6: Phase 4 -- Polish

### Task 42: Extend tokens.ts with type scale, border-radius, and animation constants

**Files:**
- Modify: `src/renderer/src/design/tokens.ts`
- Test: `tests/design/tokens.test.ts`

- [ ] **Step 1: Update the test to cover new token sections**

Add tests for the NEW `typeScale`, `borderRadius`, `transitions`, and `animations` exports. Append to the existing test file:

```typescript
// tests/design/tokens.test.ts -- ADD these tests (keep existing ones)
import { typeScale, borderRadius, transitions, animations } from '../../src/renderer/src/design/tokens'

describe('extended design tokens', () => {
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

- [ ] **Step 3: Add NEW exports to tokens.ts**

Append these new exports after the existing `typography` and `spacing` exports. Do NOT reproduce the existing `colors`, `ARTIFACT_COLORS`, `spacing`, or `typography` objects:

```typescript
// src/renderer/src/design/tokens.ts -- APPEND after existing exports

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

**V&C:** `git add src/renderer/src/design/tokens.ts tests/design/tokens.test.ts && git commit -m "feat: extend tokens with type scale, border-radius, and animation constants"`

---

### Task 43: Add CSS custom properties, scrollbar styling, and prefers-reduced-motion

**Files:**
- Modify: `src/renderer/src/assets/index.css`
- Modify: `src/renderer/src/design/components/SplitPane.tsx`

- [ ] **Step 1: Replace index.css with full design system CSS**

```css
/* src/renderer/src/assets/index.css */
@import 'tailwindcss';

:root {
  --font-display: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --text-page-title: 20px;
  --text-section-heading: 15px;
  --text-body: 13px;
  --text-secondary: 12px;
  --text-label: 12px;
  --text-mono-terminal: 13px;
  --text-mono-source: 12px;
  --text-mono-inline: 12px;

  --radius-container: 6px;
  --radius-inline: 4px;
  --radius-round: 50%;

  --transition-hover: 150ms ease-out;
  --transition-tooltip: 100ms ease-in;
  --transition-focus-ring: 100ms ease-out;
  --transition-settings-slide: 250ms ease-out;
  --transition-modal-fade: 200ms ease-in;
  --transition-command-palette: 150ms ease-out;

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

* {
  scrollbar-width: thin;
  scrollbar-color: var(--color-bg-elevated) transparent;
}

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--color-bg-elevated); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--color-border-default); }

.focus-ring:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(108, 99, 255, 0.3);
}

.interactive-hover { transition: background-color var(--transition-hover); }
.interactive-hover:hover { background-color: var(--color-bg-elevated); }

.panel-separator-h {
  width: 1px;
  background: linear-gradient(
    to bottom,
    transparent 0%, var(--color-border-default) 20%,
    var(--color-border-default) 80%, transparent 100%
  );
}

.panel-separator-v {
  height: 1px;
  background: linear-gradient(
    to right,
    transparent 0%, var(--color-border-default) 20%,
    var(--color-border-default) 80%, transparent 100%
  );
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 2: Apply gradient panel separators to SplitPane**

In `src/renderer/src/design/components/SplitPane.tsx`, replace the divider element's hard border styling with gradient separator classes:

```typescript
// For horizontal split (side by side):
<div
  className={`panel-separator-h cursor-col-resize flex-shrink-0`}
  onMouseDown={handleMouseDown}
  style={{ minWidth: '1px' }}
/>

// For vertical split (stacked):
<div
  className={`panel-separator-v cursor-row-resize flex-shrink-0`}
  onMouseDown={handleMouseDown}
  style={{ minHeight: '1px' }}
/>
```

Remove any inline `borderLeft`, `borderRight`, `borderTop`, or `borderBottom` styling on the divider.

- [ ] **Step 3: Run tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`

**V&C:** `git add src/renderer/src/assets/index.css src/renderer/src/design/components/SplitPane.tsx && git commit -m "feat: add CSS custom properties, scrollbar styling, gradient separators, and prefers-reduced-motion"`

---

### Task 44: Add getBacklinks() action to vault-store

**Files:**
- Modify: `src/renderer/src/store/vault-store.ts`
- Test: `tests/engine/indexer.test.ts`

> **Note:** VaultIndex already has the graph data needed. This task adds `getBacklinks` as a vault-store action (not a VaultIndex method), since after Task 19 the store holds `graph` and `artifacts` as plain state.

- [ ] **Step 1: Add backlink tests**

Append to the existing `tests/engine/indexer.test.ts`:

```typescript
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
    const backlinks = index.getBacklinks('g1')
    expect(backlinks).toHaveLength(2)
    const ids = backlinks.map((b) => b.id).sort()
    expect(ids).toEqual(['c1', 'g2'])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/indexer.test.ts`

- [ ] **Step 3: Add `getBacklinks` action to vault-store**

Add to `src/renderer/src/store/vault-store.ts` interface and actions:

```typescript
// Add to VaultState type:
getBacklinks: (targetId: string) => Artifact[]

// Add to store actions:
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/indexer.test.ts`

**V&C:** `git add src/renderer/src/store/vault-store.ts tests/engine/indexer.test.ts && git commit -m "feat: add getBacklinks() reverse lookup to vault-store"`

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
        if (!isActive) e.currentTarget.style.backgroundColor = colors.bg.elevated
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      {icon}
    </button>
  )
}

function ToolbarSeparator() {
  return (
    <div className="w-px h-4 mx-1" style={{ backgroundColor: colors.border.default }} />
  )
}
```

Toolbar button config (all use `runCommand` and `isActive` pattern):

| Group | label | icon | isActive check | command |
|-------|-------|------|---------------|---------|
| History | Undo | `↩` | -- | `c.undo()` |
| History | Redo | `↪` | -- | `c.redo()` |
| Headings | H1 | `H1` | `heading`, `{ level: 1 }` | `c.toggleHeading({ level: 1 })` |
| Headings | H2 | `H2` | `heading`, `{ level: 2 }` | `c.toggleHeading({ level: 2 })` |
| Headings | H3 | `H3` | `heading`, `{ level: 3 }` | `c.toggleHeading({ level: 3 })` |
| Headings | H4 | `H4` | `heading`, `{ level: 4 }` | `c.toggleHeading({ level: 4 })` |
| Inline | Bold | `B` | `bold` | `c.toggleBold()` |
| Inline | Italic | `I` | `italic` | `c.toggleItalic()` |
| Inline | Strikethrough | `S̶` | `strike` | `c.toggleStrike()` |
| Lists | Bullet List | `•` | `bulletList` | `c.toggleBulletList()` |
| Lists | Ordered List | `1.` | `orderedList` | `c.toggleOrderedList()` |
| Lists | Task List | `☑` | `taskList` | `c.toggleTaskList()` |
| Code | Code Block | `<>` | `codeBlock` | `c.toggleCodeBlock()` |

Separators between each group. Link button toggles `setLink`/`unsetLink` with `window.prompt`.

```typescript
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

  // Source mode: minimal bar with right-aligned "Source" toggle (accent color)
  if (mode === 'source') {
    return (
      <div className="flex items-center h-9 px-3 border-b"
        style={{ borderColor: colors.border.default, backgroundColor: colors.bg.surface }}>
        <div className="flex-1" />
        <button onClick={onToggleMode} className="text-xs px-2 py-1"
          style={{ color: colors.accent.default, backgroundColor: colors.accent.muted, borderRadius: borderRadius.inline }}>
          Source
        </button>
      </div>
    )
  }

  // Rich mode: full toolbar with all buttons from table above.
  // Render ToolbarButton for each row, ToolbarSeparator between groups.
  // Right-aligned "Rich" mode toggle button (muted color, hover elevates).
  return (
    <div className="flex items-center h-9 px-3 border-b"
      style={{ borderColor: colors.border.default, backgroundColor: colors.bg.surface }}>
      {/* Render all ToolbarButton entries from table, with ToolbarSeparator between groups */}
      {/* ... History buttons, separator, Heading buttons, separator, Inline buttons, separator, List buttons, separator, Code + Link buttons ... */}
      <div className="flex-1" />
      <button onClick={onToggleMode} className="text-xs px-2 py-1"
        style={{ color: colors.text.muted, borderRadius: borderRadius.inline,
          transition: `background-color ${transitions.hover}, color ${transitions.hover}` }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = colors.bg.elevated; e.currentTarget.style.color = colors.text.secondary }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = colors.text.muted }}>
        Rich
      </button>
    </div>
  )
}
```

**V&C:** `git add src/renderer/src/panels/editor/EditorToolbar.tsx && git commit -m "feat: add EditorToolbar with Tiptap command buttons and source mode toggle"`

---

### Task 46: Create EditorBreadcrumb component

**Files:**
- Create: `src/renderer/src/panels/editor/EditorBreadcrumb.tsx`

- [ ] **Step 1: Implement back/forward navigation with file path breadcrumb**

```typescript
// src/renderer/src/panels/editor/EditorBreadcrumb.tsx
import { useState, useCallback, useRef } from 'react'
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
```

`NavButton`: 6x6 box, `borderRadius.inline`, disabled state dims opacity to 0.4. Hover sets `colors.bg.elevated`.

`EditorBreadcrumb` component: h-7 bar with `colors.bg.surface`, border-b. Contains:
- Back/Forward NavButtons
- Vertical separator (1px, colors.border.default)
- Breadcrumb segments mapped with `/` separators. File segments use `colors.text.primary`, folder segments are buttons with `colors.text.secondary` that hover to primary.

```typescript
export function useNavigationHistory() {
  const historyRef = useRef<readonly string[]>([])
  const cursorRef = useRef(-1)
  const [, forceUpdate] = useState(0)

  const push = useCallback((noteId: string) => {
    const history = historyRef.current
    const cursor = cursorRef.current
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

**V&C:** `git add src/renderer/src/panels/editor/EditorBreadcrumb.tsx && git commit -m "feat: add EditorBreadcrumb with back/forward navigation and file path"`

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

interface MetadataEntry { key: string; value: string; color?: string }

export function buildMetadataEntries(artifact: Artifact): readonly MetadataEntry[] {
  const entries: MetadataEntry[] = [
    { key: 'Type', value: artifact.type, color: ARTIFACT_COLORS[artifact.type] },
    { key: 'ID', value: artifact.id },
    { key: 'Signal', value: artifact.signal },
    { key: 'Created', value: artifact.created },
    { key: 'Modified', value: artifact.modified },
  ]
  if (artifact.source) entries.push({ key: 'Source', value: artifact.source })
  if (artifact.frame) entries.push({ key: 'Frame', value: artifact.frame })
  if (artifact.tags.length > 0) entries.push({ key: 'Tags', value: artifact.tags.join(', ') })
  return entries
}
```

`MetadataTag`: inline pill with `borderRadius.inline`, tinted background (`${color}1A` or `colors.bg.elevated`).

`FrontmatterHeader({ artifact, mode })`: Returns null in source mode. Otherwise:
- border-b container with `colors.bg.surface`
- **Summary row** (always visible, clickable to toggle): type dot + MetadataTag for type + signal + first 3 tags + overflow count + chevron
- **Expanded grid** (`collapsed` state, default true): 2-column grid of all `buildMetadataEntries` results. Label column uses `typeScale.display.label` styling. Then relationship blocks:

```typescript
// Relationship blocks pattern (connections, clusters, tensions):
// Each follows this structure -- show once, repeat for all three:
{artifact.connections.length > 0 && (
  <div className="contents">
    <span className="text-xs py-0.5" style={{
      color: colors.text.muted,
      fontSize: typeScale.display.label.size,
      textTransform: typeScale.display.label.textTransform,
      letterSpacing: typeScale.display.label.letterSpacing,
    }}>
      Connections
    </span>
    <span className="text-xs py-0.5" style={{ color: colors.text.secondary }}>
      {artifact.connections.join(', ')}
    </span>
  </div>
)}
// Repeat for clusters_with (color: colors.semantic.cluster)
// Repeat for tensions_with (color: colors.semantic.tension)
```

Hover handler pattern (used on summary button):
```typescript
onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = colors.bg.elevated }}
onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
```

**V&C:** `git add src/renderer/src/panels/editor/FrontmatterHeader.tsx && git commit -m "feat: add FrontmatterHeader with collapsible metadata display"`

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

interface BacklinkEntry { artifact: Artifact; contextLine: string }
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
  return body.length > 100 ? `${body.slice(0, 100)}...` : body
}
```

`BacklinkItem`: Button with type-color dot, truncated title (`colors.text.primary`), context line (`colors.text.muted`, `typeScale.display.secondary.size`, `line-clamp-2`). Uses standard hover handler.

`BacklinksPanel`: Returns null when `backlinks.length === 0`. Otherwise: border-t container, toggle button with `expanded` state (default false), chevron rotates 90deg. When expanded, renders `BacklinkItem` for each entry. Entries computed via `useMemo` mapping backlinks through `extractContext`.

**V&C:** `git add src/renderer/src/panels/editor/BacklinksPanel.tsx && git commit -m "feat: add BacklinksPanel with context extraction and navigation"`

---

### Task 49: Integrate toolbar, breadcrumb, frontmatter, and backlinks into EditorPanel

**Files:**
- Modify: `src/renderer/src/store/editor-store.ts`
- Modify: `src/renderer/src/panels/editor/EditorPanel.tsx`
- Modify: `src/renderer/src/panels/editor/RichEditor.tsx`

**Install:** `cd /Users/caseytalbot/Projects/thought-engine && npm install @tiptap/extension-task-list @tiptap/extension-task-item @tiptap/extension-link --cache /tmp/npm-cache-te`

- [ ] **Step 1: Add cursor position state and action to editor-store**

```typescript
// Add to editor-store state interface:
cursorLine: number
cursorCol: number
setCursorPosition: (line: number, col: number) => void

// Add to initial state:
cursorLine: 1,
cursorCol: 1,

// Add to actions:
setCursorPosition: (line: number, col: number) => set({ cursorLine: line, cursorCol: col }),
```

- [ ] **Step 2: Modify RichEditor to accept editor prop**

In `src/renderer/src/panels/editor/RichEditor.tsx`:
- Remove the internal `useEditor` call and its associated imports (`useEditor`, `StarterKit`, etc.)
- Change props from `{ content: string; onChange: (c: string) => void }` to `{ editor: Editor | null }`
- Keep the `EditorContent` render with styling
- Import `Editor` type from `@tiptap/react` if not already imported

- [ ] **Step 3: Replace EditorPanel with integrated version**

```typescript
// src/renderer/src/panels/editor/EditorPanel.tsx
import { useCallback, useRef, useMemo } from 'react'
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

interface EditorPanelProps { onNavigate: (id: string) => void }

export function EditorPanel({ onNavigate }: EditorPanelProps) {
  const { activeNoteId, activeNotePath, mode, content, setMode, setContent } = useEditorStore()
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const artifacts = useVaultStore((s) => s.artifacts)

  // Lift useEditor into EditorPanel so toolbar and RichEditor share one instance
  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false }),
    ],
    content,
    onUpdate: ({ editor: e }) => { setContent(e.getHTML()) },
    onSelectionUpdate: ({ editor: e }) => {
      const { from } = e.state.selection
      const textBefore = e.state.doc.textBetween(0, from, '\n')
      const lines = textBefore.split('\n')
      useEditorStore.getState().setCursorPosition(lines.length, (lines.at(-1)?.length ?? 0) + 1)
    },
  })

  const artifact = activeNoteId ? artifacts.find((a) => a.id === activeNoteId) ?? null : null
  const { push, goBack, goForward, canGoBack, canGoForward } = useNavigationHistory()

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

  // Backlinks via vault-store action (uses graph.edges, not fragile index cast)
  const backlinks = useMemo(() => {
    if (!activeNoteId) return []
    return useVaultStore.getState().getBacklinks(activeNoteId)
  }, [activeNoteId, useVaultStore((s) => s.graph)])

  if (!artifact) {
    return (
      <div className="h-full flex items-center justify-center"
        style={{ backgroundColor: colors.bg.base, color: colors.text.muted }}>
        <div className="text-center">
          <p className="text-lg mb-2">No note selected</p>
          <p className="text-sm">Select a note from the sidebar or press Cmd+N to create one</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: colors.bg.base }}>
      <EditorBreadcrumb filePath={activeNotePath} vaultPath={vaultPath}
        onNavigateBack={handleNavigateBack} onNavigateForward={handleNavigateForward}
        canGoBack={canGoBack} canGoForward={canGoForward} />
      <EditorToolbar editor={editor} mode={mode} onToggleMode={handleToggleMode} />
      <FrontmatterHeader artifact={artifact} mode={mode} />
      <div className="flex-1 overflow-hidden">
        {mode === 'rich' ? <RichEditor editor={editor} /> : <SourceEditor content={content} onChange={setContent} />}
      </div>
      <BacklinksPanel currentNoteId={activeNoteId!} backlinks={backlinks} onNavigate={onNavigate} />
    </div>
  )
}
```

- [ ] **Step 4: Run typecheck and tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck && npm test`

**V&C:** `git add src/renderer/src/store/editor-store.ts src/renderer/src/panels/editor/EditorPanel.tsx src/renderer/src/panels/editor/RichEditor.tsx && git commit -m "feat: integrate toolbar, breadcrumb, frontmatter, and backlinks into EditorPanel"`

---

### Task 50: Create StatusBar component

**Files:**
- Create: `src/renderer/src/components/StatusBar.tsx`

- [ ] **Step 1: Implement context-sensitive status bar**

Component reads from vault-store, editor-store, graph-store. Structure:

- `useGitStatus(vaultPath)`: returns `{ branch: string | null, isDirty: boolean }`. TODO stubs for `vault:git-branch` and `vault:git-status` IPC calls (not yet implemented). Returns `{ branch: null, isDirty: false }` for now.
- `EditorStatus({ content, cursorLine, cursorCol })`: word count via `content.trim().split(/\s+/).length`, displays `Ln X, Col Y`, word count, `UTF-8`.
- `GraphStatus({ nodeCount, edgeCount, selectedNodeName })`: displays counts and optional selected node name.
- `StatusBar()`: h-6 bar with `colors.bg.surface`, border-top. Left: vault name, note count, optional git branch with status dot. Right: context-sensitive (editor vs graph status based on `contentView`).

Cursor position reads `cursorLine`/`cursorCol` from editor-store (set by EditorPanel's `onSelectionUpdate` in Task 49).

> **Note**: For SourceEditor (CodeMirror), add an equivalent `EditorView.updateListener` that calls `setCursorPosition`.

**V&C:** `git add src/renderer/src/components/StatusBar.tsx && git commit -m "feat: add context-sensitive StatusBar with editor/graph modes"`

---

### Task 51: Replace inline StatusBar in App.tsx with new component

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Replace inline StatusBar with import**

Add import: `import { StatusBar } from './components/StatusBar'`

Remove the entire inline `function StatusBar() { ... }` block (the one using `useState`, `useEffect`, `useVaultStore` for git branch fetching).

- [ ] **Step 2: Run typecheck and tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck && npm test`

**V&C:** `git add src/renderer/src/App.tsx && git commit -m "refactor: replace inline StatusBar with extracted component"`

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
    expect(neighbor?.id).toBe('g2')
  })

  it('finds nearest neighbor downward', () => {
    const neighbor = findNearestNeighbor(nodes[1], nodes, edges, 'ArrowDown')
    expect(neighbor?.id).toBe('c1')
  })

  it('returns null when no neighbor in that direction', () => {
    const neighbor = findNearestNeighbor(nodes[1], nodes, edges, 'ArrowLeft')
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

interface PositionedNode { id: string; title: string; x: number; y: number }
type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

export function sortNodesAlphabetically<T extends { title: string }>(
  nodes: readonly T[]
): readonly T[] {
  return [...nodes].sort((a, b) => a.title.localeCompare(b.title))
}

export function findNearestNeighbor(
  current: PositionedNode,
  allNodes: readonly PositionedNode[],
  edges: readonly { source: string; target: string; kind: string }[],
  direction: ArrowKey
): PositionedNode | null {
  const connectedIds = new Set<string>()
  for (const edge of edges) {
    const sourceId = typeof edge.source === 'string' ? edge.source : (edge.source as any).id
    const targetId = typeof edge.target === 'string' ? edge.target : (edge.target as any).id
    if (sourceId === current.id) connectedIds.add(targetId)
    if (targetId === current.id) connectedIds.add(sourceId)
  }

  const neighbors = allNodes.filter(
    (n) => connectedIds.has(n.id) && n.x !== undefined && n.y !== undefined
  )
  if (neighbors.length === 0) return null

  const candidates = neighbors.filter((n) => {
    const dx = n.x - current.x
    const dy = n.y - current.y
    switch (direction) {
      case 'ArrowRight': return dx > 0 && Math.abs(dx) >= Math.abs(dy)
      case 'ArrowLeft':  return dx < 0 && Math.abs(dx) >= Math.abs(dy)
      case 'ArrowDown':  return dy > 0 && Math.abs(dy) >= Math.abs(dx)
      case 'ArrowUp':    return dy < 0 && Math.abs(dy) >= Math.abs(dx)
      default: return false
    }
  })
  if (candidates.length === 0) return null

  let closest = candidates[0]
  let closestDist = Infinity
  for (const c of candidates) {
    const dist = Math.hypot(c.x - current.x, c.y - current.y)
    if (dist < closestDist) { closestDist = dist; closest = c }
  }
  return closest
}
```

`useGraphKeyboard` hook: accepts `{ nodes, edges, selectedNodeId, onSelectNode, onOpenNode, onToggleSelect, enabled }`. Key bindings:

| Key | Action |
|-----|--------|
| Tab / Shift+Tab | Cycle through `sortNodesAlphabetically` list |
| Arrow keys | `findNearestNeighbor` among connected nodes |
| Enter | `onOpenNode(selectedNodeId)` |
| Space | `onToggleSelect(selectedNodeId)` |
| Escape | `onSelectNode(null)` |

Returns `{ handleKeyDown }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/graph-keyboard.test.ts`

**V&C:** `git add src/renderer/src/panels/graph/useGraphKeyboard.ts tests/engine/graph-keyboard.test.ts && git commit -m "feat: add useGraphKeyboard hook with Tab cycling and arrow key navigation"`

---

### Task 53: Integrate keyboard navigation into GraphPanel

**Files:**
- Modify: `src/renderer/src/panels/graph/GraphPanel.tsx`

- [ ] **Step 1: Add keyboard handler integration, tabIndex, and focus management**

Import `useGraphKeyboard` and add `useState`, `useMemo` to React imports.

Add type guard before the component:

```typescript
interface SimNode { id: string; title: string; x?: number; y?: number }
function hasPosition(n: SimNode): n is SimNode & { x: number; y: number } {
  return n.x !== undefined && n.y !== undefined
}
```

Inside component, after existing `handleClick`:

```typescript
const [isFocused, setIsFocused] = useState(false)
const graph = useVaultStore((s) => s.graph)

const positionedNodes = useMemo(
  () => nodesRef.current.filter(hasPosition).map((n) => ({ id: n.id, title: n.title, x: n.x, y: n.y })),
  [graph]
)

const handleOpenNode = useCallback((id: string) => { setSelectedNode(id); onNodeClick(id) }, [setSelectedNode, onNodeClick])
const handleToggleSelect = useCallback((id: string) => { setSelectedNode(selectedNodeId === id ? null : id) }, [selectedNodeId, setSelectedNode])

const { handleKeyDown: graphKeyDown } = useGraphKeyboard({
  nodes: positionedNodes, edges: edgesRef.current, selectedNodeId,
  onSelectNode: setSelectedNode, onOpenNode: handleOpenNode,
  onToggleSelect: handleToggleSelect, enabled: isFocused,
})

useEffect(() => {
  if (!isFocused) return
  const handler = (e: KeyboardEvent) => graphKeyDown(e)
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [isFocused, graphKeyDown])
```

Update canvas wrapper div: add `tabIndex={0}`, `className="h-full relative focus-ring"`, `onFocus={() => setIsFocused(true)}`, `onBlur={() => setIsFocused(false)}`.

- [ ] **Step 2: Run typecheck and tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck && npm test`

**V&C:** `git add src/renderer/src/panels/graph/GraphPanel.tsx && git commit -m "feat: integrate keyboard navigation into GraphPanel with focus management"`

---

### Task 54: Add animation helpers to GraphRenderer

**Files:**
- Modify: `src/renderer/src/panels/graph/GraphRenderer.ts`

- [ ] **Step 1: Add reduced motion detection and animation timing utilities**

Add after existing imports:

```typescript
import { animations } from '../../design/tokens'

let _prefersReducedMotion: boolean | null = null
export function prefersReducedMotion(): boolean {
  if (_prefersReducedMotion === null) {
    _prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
      _prefersReducedMotion = e.matches
    })
  }
  return _prefersReducedMotion
}

export function parseAnimationMs(timing: string): number {
  const match = timing.match(/^(\d+)ms/)
  return match ? parseInt(match[1], 10) : 0
}

export const ANIMATION_MS = {
  nodeHoverGlow: () => prefersReducedMotion() ? 0 : parseAnimationMs(animations.graphNodeHoverGlow),
  networkReveal: () => prefersReducedMotion() ? 0 : parseAnimationMs(animations.graphNetworkReveal),
  networkDim: () => prefersReducedMotion() ? 0 : parseAnimationMs(animations.graphNetworkDim),
  nodeEnter: () => prefersReducedMotion() ? 0 : parseAnimationMs(animations.graphNodeEnter),
  nodeExit: () => prefersReducedMotion() ? 0 : parseAnimationMs(animations.graphNodeExit),
  spatialTransition: () => prefersReducedMotion() ? 0 : parseAnimationMs(animations.spatialTransition),
} as const
```

- [ ] **Step 2: Run typecheck and tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck && npm test`

**V&C:** `git add src/renderer/src/panels/graph/GraphRenderer.ts && git commit -m "feat: add reduced motion detection and animation timing utilities to GraphRenderer"`

---

### Task 55: Audit and replace hardcoded hex colors with design tokens

**Files:**
- Modify: Multiple renderer source files

- [ ] **Step 1: Search for hardcoded hex colors in renderer source**

Run: `cd /Users/caseytalbot/Projects/thought-engine && grep -rn '#[0-9A-Fa-f]\{6\}' src/renderer/src/ --include='*.tsx' --include='*.ts' | grep -v 'tokens.ts' | grep -v 'node_modules' | grep -v '.test.'`

- [ ] **Step 2: Replace hardcoded colors with token references**

Mapping table:

| Hardcoded | Token |
|-----------|-------|
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

For any hex color not in the table, add it to `tokens.ts` first. Import `colors`/`ARTIFACT_COLORS` from `../../design/tokens` in each modified file.

- [ ] **Step 3: Verify no remaining hardcoded colors**

Run: `cd /Users/caseytalbot/Projects/thought-engine && grep -rn '#[0-9A-Fa-f]\{6\}' src/renderer/src/ --include='*.tsx' --include='*.ts' | grep -v 'tokens.ts' | grep -v 'node_modules' | grep -v '.test.' | grep -v '\.css'`

Expected: No output

- [ ] **Step 4: Run typecheck and tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck && npm test`

**V&C:** `git add src/renderer/src/ && git commit -m "refactor: replace hardcoded hex colors with design token references"`

---

### Task 56: Add tests for Phase 4 component pure logic functions

**Files:**
- Create: `tests/editor/editor-components.test.ts`
- Create: `tests/components/status-bar.test.ts`

**Signal:** `untested`

- [ ] **Step 1: Write tests for editor component logic**

```typescript
// tests/editor/editor-components.test.ts
import { describe, it, expect } from 'vitest'

describe('parseBreadcrumb', () => {
  it('parses a file path into breadcrumb segments', async () => {
    const { parseBreadcrumb } = await import('../../src/renderer/src/panels/editor/EditorBreadcrumb')
    const segments = parseBreadcrumb('/vault/folder/note.md', '/vault')
    expect(segments).toHaveLength(2)
    expect(segments[0]).toEqual({ name: 'folder', path: '/vault/folder', isFile: false })
    expect(segments[1]).toEqual({ name: 'note.md', path: '/vault/folder/note.md', isFile: true })
  })

  it('handles deeply nested paths', async () => {
    const { parseBreadcrumb } = await import('../../src/renderer/src/panels/editor/EditorBreadcrumb')
    const segments = parseBreadcrumb('/vault/a/b/c/d.md', '/vault')
    expect(segments).toHaveLength(4)
    expect(segments[3].isFile).toBe(true)
    expect(segments[0].isFile).toBe(false)
  })

  it('handles root-level file', async () => {
    const { parseBreadcrumb } = await import('../../src/renderer/src/panels/editor/EditorBreadcrumb')
    const segments = parseBreadcrumb('/vault/root.md', '/vault')
    expect(segments).toHaveLength(1)
    expect(segments[0].isFile).toBe(true)
    expect(segments[0].name).toBe('root.md')
  })
})

describe('buildMetadataEntries', () => {
  it('builds entries from artifact fields', async () => {
    const { buildMetadataEntries } = await import('../../src/renderer/src/panels/editor/FrontmatterHeader')
    const artifact = {
      id: 'test-1', type: 'gene' as const, title: 'Test Gene', signal: 'core' as const,
      created: '2026-03-01', modified: '2026-03-12', tags: ['ai', 'design'],
      connections: [], clusters_with: [], tensions_with: [], appears_in: [], body: 'test body',
    }
    const entries = buildMetadataEntries(artifact)
    expect(entries.length).toBeGreaterThanOrEqual(5)
    expect(entries[0]).toMatchObject({ key: 'Type', value: 'gene' })
    expect(entries.find((e) => e.key === 'Tags')?.value).toBe('ai, design')
  })

  it('omits optional fields when absent', async () => {
    const { buildMetadataEntries } = await import('../../src/renderer/src/panels/editor/FrontmatterHeader')
    const artifact = {
      id: 'test-2', type: 'note' as const, title: 'Minimal', signal: 'untested' as const,
      created: '2026-03-01', modified: '2026-03-01', tags: [],
      connections: [], clusters_with: [], tensions_with: [], appears_in: [], body: '',
    }
    const entries = buildMetadataEntries(artifact)
    expect(entries.find((e) => e.key === 'Source')).toBeUndefined()
    expect(entries.find((e) => e.key === 'Tags')).toBeUndefined()
  })
})

describe('extractContext', () => {
  it('extracts context around target ID in body', async () => {
    const { extractContext } = await import('../../src/renderer/src/panels/editor/BacklinksPanel')
    const body = 'Some text before the target-id and some text after'
    const result = extractContext(body, 'target-id')
    expect(result).toContain('target-id')
    expect(result.length).toBeLessThanOrEqual(120)
  })

  it('returns fallback when target not found in body', async () => {
    const { extractContext } = await import('../../src/renderer/src/panels/editor/BacklinksPanel')
    const body = 'This body does not contain the reference anywhere'
    const result = extractContext(body, 'nonexistent-id')
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThanOrEqual(103)
  })
})
```

> **Note**: `parseBreadcrumb`, `buildMetadataEntries`, and `extractContext` must have `export` keywords in their respective files.

- [ ] **Step 2: Write tests for StatusBar word count and graph keyboard helpers**

```typescript
// tests/components/status-bar.test.ts
import { describe, it, expect } from 'vitest'

describe('StatusBar word count', () => {
  function countWords(content: string): number {
    const trimmed = content.trim()
    if (trimmed.length === 0) return 0
    return trimmed.split(/\s+/).length
  }

  it('counts words in normal text', () => { expect(countWords('hello world foo bar')).toBe(4) })
  it('returns 0 for empty content', () => { expect(countWords('')).toBe(0); expect(countWords('   ')).toBe(0) })
  it('handles single word', () => { expect(countWords('hello')).toBe(1) })
  it('handles multiple whitespace', () => { expect(countWords('hello    world')).toBe(2) })
  it('handles newlines and tabs', () => { expect(countWords('hello\nworld\tfoo')).toBe(3) })
})

describe('sortNodesAlphabetically (graph keyboard)', () => {
  it('sorts nodes alphabetically by title', async () => {
    const { sortNodesAlphabetically } = await import('../../src/renderer/src/panels/graph/useGraphKeyboard')
    const nodes = [
      { id: 'c1', title: 'Constraint', x: 100, y: 200 },
      { id: 'g1', title: 'Alpha Gene', x: 0, y: 0 },
      { id: 'n1', title: 'Zeta Note', x: 300, y: 300 },
    ]
    const sorted = sortNodesAlphabetically(nodes)
    expect(sorted.map((n) => n.title)).toEqual(['Alpha Gene', 'Constraint', 'Zeta Note'])
  })

  it('returns empty array for empty input', async () => {
    const { sortNodesAlphabetically } = await import('../../src/renderer/src/panels/graph/useGraphKeyboard')
    expect(sortNodesAlphabetically([])).toEqual([])
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/editor/editor-components.test.ts tests/components/status-bar.test.ts`

**V&C:** `git add tests/editor/editor-components.test.ts tests/components/status-bar.test.ts && git commit -m "test: add unit tests for Phase 4 component pure logic functions"`

---

### Task 57: Final verification and integration test

**Files:** None

- [ ] **Step 1: Full typecheck**
Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`

- [ ] **Step 2: Full test suite**
Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All tests passing (original 35 + new tests from this plan)

- [ ] **Step 3: Verify app builds**
Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run build`

- [ ] **Step 4: Final commit (if any fixups needed)**
`git add src/ tests/ && git commit -m "chore: final Phase 4 verification and fixups"`

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
| 6 | 4 (Polish) | 42-57 | Design tokens, CSS system, editor toolbar/breadcrumb/frontmatter/backlinks, status bar, animation standards, graph keyboard nav, color audit, component tests, final verification |

### Execution Order

Chunks must be executed in order (1 through 6). Within each chunk, tasks are ordered by dependency. Each task leaves the app in a working state with all tests passing.

### Key Invariants

- All 35 existing tests pass at every commit boundary
- No IPC calls outside the typed `window.api` surface after Chunk 1
- No hardcoded hex colors after Chunk 6 (all reference tokens)
- `prefers-reduced-motion` respected for all CSS and Canvas2D animations
- Files stay under 800 lines; immutable data patterns throughout
- Commit format: `<type>: <description>`
