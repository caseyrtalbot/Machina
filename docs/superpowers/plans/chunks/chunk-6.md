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
