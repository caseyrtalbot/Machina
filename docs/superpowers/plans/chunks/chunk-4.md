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
