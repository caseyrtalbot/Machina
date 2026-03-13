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
