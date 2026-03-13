# Thought Engine UI Redesign: Design Specification

**Date**: 2026-03-12
**Status**: Approved
**Project**: `/Users/caseytalbot/Projects/thought-engine/`

## Product Vision

Thought Engine is a visual IDE for structured thinking where the "compiler" is an LLM agent and the "code" is interconnected markdown documents. Three co-equal surfaces drive the core interaction loop:

- **Graph** (center): The knowledge navigator. Shows topology, clustering, and gaps so the user can direct the agent's next move. Primary navigation paradigm. The graph is alive: nodes appear in real-time as the agent writes files.
- **Terminal** (right): The agent interaction surface. Claude Code running inside the app. Not a convenience panel, but the core of the workflow.
- **File tree** (left): The agent's output. Structured markdown artifacts organized in a hierarchical vault on the local filesystem.

**The loop**: Orient (graph) > Inspect (editor) > Direct (terminal/agent) > Observe (new nodes appear) > Reorient (graph).

Relationships between ideas are the primary object. Documents are substrate that generates the graph.

## Approach

**Hybrid: Foundation Then Function.** Four phases, each a complete horizontal slice that leaves the app in a working, improved state.

| Phase | Name | Focus |
|-------|------|-------|
| 1 | Foundation | Custom titlebar + three-panel layout skeleton |
| 2 | Function | Filesystem tree, graph controls, terminal tabs, basic settings |
| 3 | Interaction | Neon highlights, physics sliders, real-time graph, Graph/Skills toggle |
| 4 | Polish | Theme coherence, transitions, typography, editor toolbar, status bar |

## Phase 1: Foundation

### Custom Titlebar

Replace the OS-native window chrome with a custom titlebar component.

**Electron main process changes** (`src/main/index.ts`):
- `titleBarStyle: 'hidden'` on BrowserWindow config
- `trafficLightPosition: { x: 12, y: 12 }` for macOS traffic light inset
- `titleBarOverlay` config for Windows compatibility
- New IPC handlers: `window:minimize`, `window:maximize`, `window:close`

**New component: `Titlebar.tsx`**
- Height: 38px
- macOS traffic lights occupy the left ~70px (OS-rendered, not custom)
- `-webkit-app-region: drag` on the entire titlebar for window movement
- Vault tab: single tab showing current vault name with accent dot, close button (non-functional in V1, visual only)
- Settings gear icon at far right, opens SettingsModal
- All clickable elements inside the drag region get `-webkit-app-region: no-drag`

### Layout Structure

```
App (h-screen w-screen, flex column)
├── Titlebar (38px, flex-shrink-0)
├── SplitPane (flex-1, overflow-hidden)
│   ├── Sidebar (240px default, resizable)
│   ├── ContentArea (flex-1)
│   │   ├── GraphControls (overlay toggle)
│   │   └── GraphPanel | EditorPanel | SkillsPlaceholder
│   └── TerminalPanel (320px default, resizable)
├── StatusBar (24px, flex-shrink-0)
└── CommandPalette (overlay)
    SettingsModal (overlay)
```

The existing `SplitPane` component handles resizable dividers. The viewport is now: titlebar (38px) + panels (flex) + status bar (24px).

**What stays the same**: all panel internals, all four Zustand stores, all IPC handlers, existing tests.

### Files

| Action | File |
|--------|------|
| Create | `src/renderer/src/components/Titlebar.tsx` |
| Create | `src/renderer/src/components/SettingsModal.tsx` (stub) |
| Modify | `src/main/index.ts` (BrowserWindow config + IPC) |
| Modify | `src/renderer/src/App.tsx` (titlebar above split layout) |

## Phase 2: Function

### 2A: Sidebar Filesystem Tree

Replace the flat file list with a hierarchical filesystem tree matching the vault's directory structure.

**File tree behavior**:
- Reads directory structure from vault filesystem (already available via IPC watcher)
- Collapsible folders with chevron indicators (right-pointing collapsed, down-pointing expanded)
- Item counts next to each folder name
- Vault root name with total file count at the top
- Active file highlighted with `accent.muted` background
- Each file item shows: artifact type color dot, truncated filename, relative timestamp
- Artifact type dot color derived from frontmatter `type` field or filename prefix

**Action bar** (top of sidebar, below search):
- New file button (triggers IPC to create on disk, watcher picks up change)
- New folder button
- Sort dropdown: Modified (default), Name, Type

**Search bar**: existing component, no changes in this phase.

**State management**:
- Collapse state: local `Map<string, boolean>` in FileTree component (UI-only, not Zustand)
- Sort preference: stored in vault store

**Files**:

| Action | File |
|--------|------|
| Modify | `src/renderer/src/panels/sidebar/FileTree.tsx` (hierarchy, folders, counts) |
| Modify | `src/renderer/src/panels/sidebar/Sidebar.tsx` (action bar, sort dropdown) |

### 2B: Graph Controls Panel

An Obsidian-style settings overlay for the graph, sliding in from the right edge of the center panel.

**Sections**:

**Filters**:
- Orphans toggle (show/hide disconnected nodes)
- Existing files only toggle (hide broken links)

**Groups** (collapsible):
- Maps to artifact type coloring configuration

**Display**:
- Node size slider (base radius)
- Link opacity slider
- Link thickness slider
- Arrows toggle (directional edges)
- Text fade threshold slider (zoom level at which labels appear)
- Animate button (toggles `simulation.alpha(1).restart()` vs `simulation.stop()`)

**Forces** (all sliders):
- Center force: maps to `d3.forceCenter()`
- Repel force: maps to `d3.forceManyBody().strength()`
- Link force: maps to `d3.forceLink().strength()`
- Link distance: maps to `d3.forceLink().distance()`

**Toggle behavior**: small icon in the top-right corner of the graph area opens/closes the panel. Panel overlays the graph, does not push content.

**Persistence**: all values stored in `graph-settings-store.ts` with Zustand persist middleware (localStorage).

**Files**:

| Action | File |
|--------|------|
| Create | `src/renderer/src/panels/graph/GraphSettingsPanel.tsx` |
| Create | `src/renderer/src/store/graph-settings-store.ts` |
| Modify | `src/renderer/src/panels/graph/GraphPanel.tsx` (consume settings) |

### 2C: Terminal Tabs

Restyle the existing terminal tab bar to match the target design.

**Tab bar**:
- Active tab: elevated background (`bg.elevated`) + colored dot (green for shell, purple for Claude)
- Inactive tabs: muted text, dot still visible
- Close button (x) on each tab, hidden on the last remaining tab
- "+" button to create a new session
- Tab auto-names based on running process (detect "claude" in command for purple accent)

**Implementation**: the terminal already supports multiple sessions via `terminal-store`. This is a styling and UX upgrade, not a functional rewrite.

**Files**:

| Action | File |
|--------|------|
| Modify | `src/renderer/src/panels/terminal/TerminalPanel.tsx` |

### 2D: Basic Settings Modal

A tabbed modal opened from the titlebar settings gear.

**5 tabs**:

| Tab | Settings |
|-----|----------|
| Appearance | Theme (dark only for now, toggle infrastructure), font size, font family |
| Editor | Default edit mode (rich/source), autosave interval, spell check toggle |
| Graph | Default force/display values (reads/writes same store as GraphSettingsPanel) |
| Terminal | Default shell path, font size |
| Vault | Vault path display, re-index button |

**Behavior**:
- Settings apply immediately on change (no save button)
- Escape key or backdrop click closes modal
- Persisted to localStorage via Zustand persist middleware

**Files**:

| Action | File |
|--------|------|
| Create | `src/renderer/src/components/SettingsModal.tsx` (full implementation, replacing Phase 1 stub) |
| Create | `src/renderer/src/store/settings-store.ts` |
| Modify | `src/renderer/src/App.tsx` (wire modal open from titlebar) |

## Phase 3: Interaction

### 3A: Node Selection with Neon Highlight

Three interaction layers on graph nodes:

**Idle state**:
- Nodes are small by default (base radius ~3-5px)
- All nodes have a faint ambient glow (very low-intensity SVG gaussian blur filter)
- Edges are dim, low opacity
- Constellation aesthetic

**Hover (transient)**:
- Mousing over a node triggers network reveal:
  - Hovered node brightens, glow intensifies
  - Connected edges brighten to accent color (purple/violet), opacity ~0.7, slightly thicker
  - Connected neighbor nodes brighten with neon glow at their artifact type color
  - Non-connected nodes and edges dim to ~0.08-0.15 opacity
  - Labels appear on hovered node and its neighbors
- Mouse-leave: everything returns to idle state
- Transition in: 200ms ease-out. Transition out: 300ms ease-out (slower fade-out feels natural)

**Click (persistent)**:
- Same visual as hover but stays locked until clicking empty canvas or another node
- Useful for inspecting a neighborhood without holding the mouse still

**Double-click**:
- Opens the clicked node's file in the editor panel (transitions `contentView` to `'editor'`)

**SVG implementation**:
- Neon glow via `<filter>` element: `feGaussianBlur` + `feColorMatrix` + `feMerge`
- Each artifact color gets its own pre-defined filter
- Selected node gets a subtle outer ring (`stroke` circle at larger radius, low opacity)
- Non-connected elements dimmed via opacity attribute, not visibility (preserves layout)

**Files**:

| Action | File |
|--------|------|
| Create | `src/renderer/src/panels/graph/useGraphHighlight.ts` (hover/click selection logic) |
| Modify | `src/renderer/src/panels/graph/GraphPanel.tsx` (SVG filters, event handlers, opacity management) |

### 3B: Real-Time Graph Updates

When the agent writes a file via the terminal, the graph updates reactively.

**Data pipeline** (already partially exists):
1. Agent writes file to disk
2. Chokidar watcher (via `registerWatcherIpc`) detects the change
3. IPC sends file change event to renderer
4. `vault-store` updates `files[]`
5. `GraphPanel` diffs previous vs current file list

**New node entry animation**:
- Opacity: 0 to 1 over 400ms
- Scale: 0.5 to 1 over 400ms
- Position: gentle drift from graph center
- D3 simulation: `alpha(0.3).restart()` (gentle re-settle, not full re-layout)

**Removed node exit**: fade out over 200ms, then removed from simulation.

**Files**:

| Action | File |
|--------|------|
| Create | `src/renderer/src/panels/graph/useGraphAnimation.ts` (enter/exit transitions) |
| Modify | `src/renderer/src/panels/graph/GraphPanel.tsx` (diff logic, animation integration) |

### 3C: Graph/Skills Toggle

Extends the center panel's content view to include a Skills lens.

**Content view states**: `'graph' | 'editor' | 'skills'`

**Toggle UI**: pill-style toggle centered at the top of the content area. Active tab has `accent.muted` background. Two options: "Graph" and "Skills".

**Skills view (placeholder)**: minimal component with icon, title "Skills", and description "Agent capabilities and automation recipes. Coming soon." Clean placeholder ready for future implementation.

**Keyboard**: existing `Cmd+G` cycles graph > skills > graph. Editor is accessed via node double-click or file tree selection.

**Files**:

| Action | File |
|--------|------|
| Create | `src/renderer/src/panels/graph/SkillsPlaceholder.tsx` |
| Modify | `src/renderer/src/store/graph-store.ts` (add `'skills'` to contentView union) |
| Modify | `src/renderer/src/App.tsx` (ContentArea renders SkillsPlaceholder) |

### 3D: Enhanced Node Sizing

Node size is configurable via a mode selector in the Graph Settings Panel.

**Three modes**:

| Mode | Formula | Effect |
|------|---------|--------|
| Connection count | `r = baseSize + Math.sqrt(connectionCount) * scaleFactor` | Hub nodes larger, leaf nodes smaller |
| Uniform | `r = baseSize` | All nodes same size, color differentiates |
| Content length | `r = baseSize + Math.log(charCount / 100) * scaleFactor` | Larger files appear bigger (log scale prevents extremes) |

The "Node size" slider in the controls panel sets `baseSize`. The mode selector (dropdown) determines the scaling function. Default mode: connection count. Default base size: small (3-5px range).

**Files**:

| Action | File |
|--------|------|
| Modify | `src/renderer/src/store/graph-settings-store.ts` (node size mode) |
| Modify | `src/renderer/src/panels/graph/GraphPanel.tsx` (sizing logic) |
| Modify | `src/renderer/src/panels/graph/GraphSettingsPanel.tsx` (mode dropdown) |

## Phase 4: Polish

### 4A: Theme Coherence

Audit and unify all visual styling across every component.

**Actions**:
- Replace all hardcoded hex colors with token references from `tokens.ts`
- Panel dividers: replace hard 1px borders with subtle gradient separators (`bg.surface` to transparent)
- Standardize border-radius: 6px for containers, 4px for inline elements, 50% for dots/avatars
- All interactive elements get `bg.elevated` hover state with 150ms transition
- Focus rings: `accent.default` at 0.3 opacity, 2px offset, for keyboard navigation
- Scrollbar styling: thin, `bg.elevated` thumb, transparent track

### 4B: Typography System

Extend `tokens.ts` with a complete type scale.

**Display font (Inter)**:

| Role | Size | Weight | Color |
|------|------|--------|-------|
| Page title | 20px | 600 | text.primary |
| Section heading | 15px | 600 | text.primary |
| Body | 13px | 400 | text.primary |
| Secondary | 12px | 400 | text.secondary |
| Label/caption | 11px | 400 | text.muted |

Labels use `text-transform: uppercase` and `letter-spacing: 0.05em`.

**Mono font (JetBrains Mono)**:

| Role | Size |
|------|------|
| Terminal output, code blocks | 13px |
| Editor source mode | 12px |
| Inline code, file paths | 11px |

**Settings-driven**: font family and base size come from settings store. All other sizes are relative. Exposed as CSS custom properties (`--font-body`, `--text-sm`, etc.) for Tailwind consumption.

### 4C: Editor Toolbar

New toolbar and breadcrumb for the editor panel.

**Breadcrumb** (`EditorBreadcrumb.tsx`):
- Back/forward navigation arrows
- File path: `folder / filename.md`
- Clicking a folder segment could navigate to that folder in the file tree (stretch goal)

**Toolbar** (`EditorToolbar.tsx`):
- Undo / Redo
- Separator
- H2 / H3 / H4 heading toggles
- Separator
- Bold / Italic / Strikethrough
- Separator
- Bullet list / Ordered list / Checkbox list
- Separator
- Code block / Link
- Right-aligned: Source mode toggle button

**Behavior**:
- Toolbar buttons map to Tiptap editor commands
- Active formatting reflected in button state (e.g., Bold highlighted when selection is bold)
- Toolbar hides when in source mode (CodeMirror has its own conventions)

**Files**:

| Action | File |
|--------|------|
| Create | `src/renderer/src/panels/editor/EditorToolbar.tsx` |
| Create | `src/renderer/src/panels/editor/EditorBreadcrumb.tsx` |
| Modify | `src/renderer/src/panels/editor/EditorPanel.tsx` (integrate toolbar + breadcrumb) |

### 4D: Enhanced Status Bar

Extract from inline in App.tsx to its own component with context-sensitive content.

**Left side** (always visible):
- Vault name
- Note count
- Git branch with status dot (green = clean, yellow = dirty)

**Right side** (context-sensitive):
- Editor mode: cursor position (Ln/Col), word count, encoding (UTF-8)
- Graph mode: node count, edge count, selected node name (if any)

**Files**:

| Action | File |
|--------|------|
| Create | `src/renderer/src/components/StatusBar.tsx` |
| Modify | `src/renderer/src/App.tsx` (replace inline StatusBar) |

### 4E: Transition and Animation Standards

All animations cataloged with consistent timing.

**Micro-interactions**:
- Hover states: 150ms ease-out
- Panel divider drag: immediate (no transition)
- Tooltip appear: 100ms ease-in
- Focus ring: 100ms ease-out

**Panel transitions**:
- Graph to Editor crossfade: 200ms
- Settings panel slide: 250ms ease-out
- Modal overlay: 200ms fade-in
- Command palette: 150ms scale + fade

**Graph animations**:
- Node hover glow: 200ms ease-out
- Network reveal (hover): 200ms ease-out
- Network dim (mouse-leave): 300ms ease-out
- New node enter: 400ms fade + scale
- Node exit: 200ms fade

**Principles**:
- Never block interaction with animation
- Exit faster than enter
- No animations over 400ms
- Respect `prefers-reduced-motion` media query

**Implementation**: add `transitions` and `animations` sections to `tokens.ts` as named constants. Components reference these rather than inline timing values.

## Design System Summary

### Color Tokens (existing, preserved)

```typescript
// Backgrounds
bg.base: '#0A0A0B'     // Graph canvas, app base
bg.surface: '#111113'   // Sidebar, terminal, titlebar, status bar
bg.elevated: '#1A1A1D'  // Active tabs, hover states, modals

// Text
text.primary: '#EDEDEF'
text.secondary: '#8B8B8E'
text.muted: '#5A5A5E'

// Accent
accent.default: '#6C63FF'
accent.hover: '#7B73FF'
accent.muted: 'rgba(108, 99, 255, 0.12)'

// Borders
border.default: '#2A2A2E'

// Artifact types
gene: '#6C63FF'
constraint: '#EF4444'
research: '#2DD4BF'
output: '#EC4899'
note: '#8B8B8E'
index: '#38BDF8'

// Semantic
cluster: '#34D399'
tension: '#F59E0B'
```

### New Stores

| Store | Purpose | Persistence |
|-------|---------|-------------|
| `graph-settings-store` | Graph display/force slider values, filter toggles, node size mode | localStorage |
| `settings-store` | App preferences (appearance, editor, terminal, vault) | localStorage |

### File Inventory

**New files (13)**:
- `src/renderer/src/components/Titlebar.tsx`
- `src/renderer/src/components/SettingsModal.tsx`
- `src/renderer/src/components/StatusBar.tsx`
- `src/renderer/src/panels/graph/GraphSettingsPanel.tsx`
- `src/renderer/src/panels/graph/SkillsPlaceholder.tsx`
- `src/renderer/src/panels/graph/useGraphHighlight.ts`
- `src/renderer/src/panels/graph/useGraphAnimation.ts`
- `src/renderer/src/panels/editor/EditorToolbar.tsx`
- `src/renderer/src/panels/editor/EditorBreadcrumb.tsx`
- `src/renderer/src/store/graph-settings-store.ts`
- `src/renderer/src/store/settings-store.ts`
- `src/preload/window-controls.ts` (IPC for minimize/maximize/close)
- (None cross 800-line limit; each is a focused, single-purpose module)

**Modified files (10)**:
- `src/main/index.ts` (BrowserWindow config + window control IPC)
- `src/renderer/src/App.tsx` (titlebar, layout restructure, StatusBar extraction)
- `src/renderer/src/panels/sidebar/FileTree.tsx` (hierarchy, folders, counts)
- `src/renderer/src/panels/sidebar/Sidebar.tsx` (action bar, sort dropdown)
- `src/renderer/src/panels/graph/GraphPanel.tsx` (settings, sizing, highlights, animation)
- `src/renderer/src/panels/terminal/TerminalPanel.tsx` (tab styling)
- `src/renderer/src/panels/editor/EditorPanel.tsx` (toolbar + breadcrumb)
- `src/renderer/src/store/graph-store.ts` ('skills' in contentView)
- `src/renderer/src/design/tokens.ts` (type scale, animation constants)
- `src/renderer/src/assets/index.css` (CSS custom properties)

## Constraints

- Immutable data: return new copies, never mutate in-place
- All files under 800 lines, organized by feature/domain
- No hardcoded secrets; use env vars
- Commits: `<type>: <description>` format
- npm workaround: use `--cache /tmp/npm-cache-te` for installs
- Existing 35 tests must continue passing throughout all phases
