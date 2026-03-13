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
