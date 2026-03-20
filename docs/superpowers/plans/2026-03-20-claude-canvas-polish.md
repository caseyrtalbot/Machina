# Claude Config Canvas Production Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the ~/.claude/ Config Canvas from cluttered prototype to production-grade quality by fixing bugs, suppressing noise edges, and compacting low-value cards.

**Architecture:** Four targeted changes: fix the terminal displacement race condition, fix the false-edge substring matching bug, suppress semantically-empty settings-controls edges, and shrink Settings/Memory cards into a compact zone. No layout algorithm rewrite. Individual skill/agent/team/command cards remain fully interactive.

**Tech Stack:** React, TypeScript, Zustand, CSS

---

## Context

Council deliberation (5 Opus agents, 2 rounds) identified four priority changes. User confirmed: skill, agent, team, and command cards are valuable for authoring workflows and must remain as individual interactive cards. Settings and Memory cards provide low value and should be compacted. Rule cards have moderate value and stay as-is.

## File Map

| File | Role | Change |
|------|------|--------|
| `src/renderer/src/panels/claude-config/ClaudeConfigPanel.tsx` | Panel mount, viewport init | Fix containerSize race |
| `src/renderer/src/engine/claude-relationship-extractor.ts` | Edge extraction | Fix substring matching, suppress settings-controls |
| `src/renderer/src/panels/canvas/claude/claude-canvas-layout.ts` | Layout algorithm | Compact Settings/Memory zone |
| `src/renderer/src/panels/canvas/claude/ClaudeSettingsCard.tsx` | Settings card | Shrink to compact variant |
| `src/renderer/src/panels/canvas/claude/ClaudeMemoryCard.tsx` | Memory card | Shrink to compact variant |
| `src/renderer/src/panels/canvas/EdgeLayer.tsx` | Edge rendering | Support hover-reveal edges |
| `src/renderer/src/panels/canvas/CardShell.tsx` | Card wrapper | Wire hoveredNodeId to store |
| `src/shared/canvas-types.ts` | Edge + card types | Add `hidden` flag, update min/default sizes |
| `tests/canvas/claude-relationship-extractor.test.ts` | Edge tests | New test file |

---

### Task 1: Fix terminal displacement on cold load

The `centerOnNode` call in `ClaudeConfigPanel.tsx` fires before the `ResizeObserver` reports real container dimensions. `containerSize` is still the sentinel `{ width: 1920, height: 1080 }`, so the viewport math is wrong. The terminal appears displaced on every first load.

**Files:**
- Modify: `src/renderer/src/panels/claude-config/ClaudeConfigPanel.tsx`

- [ ] **Step 1: Read the current load logic**

In `ClaudeConfigPanel.tsx`, the load effect (around lines 155-210) calls `centerOnNode(terminalNode, containerSize)` immediately. The issue: `containerSize` starts as `{ width: 1920, height: 1080 }` and only updates after `ResizeObserver` fires asynchronously.

- [ ] **Step 2: Gate centering on real dimensions**

In the load effect, add a guard that skips viewport centering if containerSize still equals the sentinel value. Add a second effect that runs centering once containerSize changes from sentinel to real dimensions.

```tsx
// In the load effect, replace the centerOnNode call:
// OLD: immediately call centerOnNode(terminalNode, containerSize)
// NEW: store the terminal node ref, defer centering

const terminalNodeRef = useRef<CanvasNode | null>(null)
const hasCenteredRef = useRef(false)

// In the load effect, after injecting terminal node:
terminalNodeRef.current = terminalNode
hasCenteredRef.current = false

// New effect: center once real dimensions arrive
useEffect(() => {
  if (!terminalNodeRef.current || hasCenteredRef.current) return
  // Skip sentinel value
  if (containerSize.width === 1920 && containerSize.height === 1080) return
  const vp = centerOnNode(terminalNodeRef.current, containerSize)
  useCanvasStore.getState().setViewport(vp)
  hasCenteredRef.current = true
}, [containerSize])
```

- [ ] **Step 3: Verify handleRefresh still works**

`handleRefresh` calls `fitViewportToNodes` which already uses real `containerSize` (called after mount). No change needed there. Verify by reading the refresh path.

- [ ] **Step 4: Run typecheck and test**

```bash
npm run typecheck && npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/panels/claude-config/ClaudeConfigPanel.tsx
git commit -m "fix(claude-canvas): gate terminal centering on real container dimensions"
```

---

### Task 2: Fix skill-references substring matching

The `extractRelationships` function in `claude-relationship-extractor.ts` uses substring matching on skill names to generate `skill-references` and `agent-uses-tool` edges. Names longer than 3 characters trigger matches, so a skill named "research" matches every description containing "research". This creates false edges.

**Files:**
- Modify: `src/renderer/src/engine/claude-relationship-extractor.ts`
- Create: `tests/canvas/claude-relationship-extractor.test.ts`

- [ ] **Step 1: Write failing test for false matches**

```ts
// tests/canvas/claude-relationship-extractor.test.ts
import { describe, it, expect } from 'vitest'
import { extractRelationships } from '../../src/renderer/src/engine/claude-relationship-extractor'
import type { ClaudeConfig } from '@shared/claude-config-types'
import type { CanvasNode } from '@shared/canvas-types'

function makeNode(id: string, type: CanvasNode['type'], metadata: Record<string, unknown>): CanvasNode {
  return { id, type, position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, content: '', metadata }
}

function makeConfig(overrides: Partial<ClaudeConfig> = {}): ClaudeConfig {
  return {
    basePath: '/tmp/.claude',
    projectPath: null,
    settings: null,
    agents: [],
    skills: [],
    rules: [],
    commands: [],
    teams: [],
    memories: [],
    ...overrides
  }
}

describe('extractRelationships', () => {
  it('should not create false skill-references from short substring matches', () => {
    const config = makeConfig({
      skills: [
        { name: 'research', description: 'Multi-agent research tool', filePath: '', scope: 'global', promptFiles: [], referenceFiles: [] },
        { name: 'research-team', description: 'Orchestrates the research council', filePath: '', scope: 'global', promptFiles: [], referenceFiles: [] }
      ]
    })
    const nodes: CanvasNode[] = [
      makeNode('s1', 'claude-skill', { skillName: 'research' }),
      makeNode('s2', 'claude-skill', { skillName: 'research-team' })
    ]
    const edges = extractRelationships(config, nodes)
    // "research-team" description contains "research" but that should NOT
    // create a skill-references edge from research-team to research
    const skillRefs = edges.filter(e => e.kind === 'skill-references')
    expect(skillRefs.length).toBe(0)
  })

  it('should match explicit skill invocations with slash prefix', () => {
    const config = makeConfig({
      skills: [
        { name: 'extract', description: 'Extract wisdom from content', filePath: '', scope: 'global', promptFiles: [], referenceFiles: [] },
        { name: 'enrich', description: 'Uses /extract to pipe data', filePath: '', scope: 'global', promptFiles: [], referenceFiles: [] }
      ]
    })
    const nodes: CanvasNode[] = [
      makeNode('s1', 'claude-skill', { skillName: 'extract' }),
      makeNode('s2', 'claude-skill', { skillName: 'enrich' })
    ]
    const edges = extractRelationships(config, nodes)
    const skillRefs = edges.filter(e => e.kind === 'skill-references')
    // "enrich" explicitly invokes "/extract"
    expect(skillRefs.length).toBe(1)
    expect(skillRefs[0].fromNode).toBe('s2')
    expect(skillRefs[0].toNode).toBe('s1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/canvas/claude-relationship-extractor.test.ts
```

Expected: First test FAILS (false edge is created from substring match).

- [ ] **Step 3: Fix the matching logic**

In `claude-relationship-extractor.ts`, update the skill-references matching (around lines 146-165) and agent-uses-tool matching (around lines 120-140):

Replace bare substring matching with word-boundary or slash-prefix matching:

```ts
// Helper function at module level
function mentionsName(text: string, name: string): boolean {
  if (name.length <= 4) return false
  const lower = text.toLowerCase()
  const target = name.toLowerCase()
  // Match slash-prefix invocations: /skillname
  if (lower.includes(`/${target}`)) return true
  // Match word-boundary mentions (not as substring of longer word)
  const regex = new RegExp(`\\b${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  return regex.test(text)
}
```

Replace all `text.toLowerCase().includes(name.toLowerCase())` calls in the skill-references and agent-uses-tool sections with `mentionsName(text, name)`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/canvas/claude-relationship-extractor.test.ts
```

Expected: Both tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm run typecheck && npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/engine/claude-relationship-extractor.ts tests/canvas/claude-relationship-extractor.test.ts
git commit -m "fix(claude-canvas): use word-boundary matching for skill/agent edges"
```

---

### Task 3: Suppress settings-controls edges by default

The `settings-controls` edges connect the single Settings node to every agent (15+ edges). This relationship is semantically empty (of course settings govern agents) and creates the primary visual tangle. These edges should be hidden by default and only revealed on hover/select of the Settings card.

**Files:**
- Modify: `src/shared/canvas-types.ts`
- Modify: `src/renderer/src/engine/claude-relationship-extractor.ts`
- Modify: `src/renderer/src/panels/canvas/EdgeLayer.tsx`
- Modify: `src/renderer/src/panels/canvas/CardShell.tsx`

Note: `canvas-store.ts` already has `hoveredNodeId` and `setHoveredNode`. No changes needed there.

- [ ] **Step 1: Add `hidden` flag to CanvasEdge**

In `src/shared/canvas-types.ts`, add optional `hidden` to `CanvasEdge`:

```ts
export interface CanvasEdge {
  readonly id: string
  readonly fromNode: string
  readonly toNode: string
  readonly fromSide: CanvasSide
  readonly toSide: CanvasSide
  readonly kind?: CanvasEdgeKind | (string & {})
  readonly label?: string
  readonly hidden?: boolean  // <-- add this
}
```

- [ ] **Step 2: Mark settings-controls edges as hidden**

In `claude-relationship-extractor.ts`, in the settings-controls section (around lines 69-75), set `hidden: true` on the created edges:

```ts
// In the settings-controls loop, the createClaudeEdge call:
// Add hidden: true to the returned edge
return { ...createCanvasEdge(fromNode, toNode, fromSide, toSide), kind, hidden: true }
```

Since `createClaudeEdge` spreads `createCanvasEdge`, update the function to accept and pass `hidden`:

```ts
function createClaudeEdge(
  fromNode: string,
  toNode: string,
  fromSide: CanvasEdge['fromSide'],
  toSide: CanvasEdge['toSide'],
  kind: ClaudeRelationshipKind,
  hidden?: boolean
): ClaudeEdge {
  return { ...createCanvasEdge(fromNode, toNode, fromSide, toSide), kind, hidden }
}
```

Call with `hidden: true` only for `settings-controls` edges.

- [ ] **Step 3: Filter hidden edges in EdgeLayer unless endpoint is hovered/selected**

In `EdgeLayer.tsx`, update `EdgePath` to check `edge.hidden`:

```tsx
function EdgePath({ edge, nodes }: { edge: CanvasEdge; nodes: readonly CanvasNode[] }) {
  const isSelected = useCanvasStore((s) => s.selectedEdgeId === edge.id)
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds)
  const hoveredNodeId = useCanvasStore((s) => s.hoveredNodeId)

  // Hidden edges only show when their endpoint is hovered or selected
  if (edge.hidden) {
    const endpointActive =
      selectedNodeIds.has(edge.fromNode) ||
      selectedNodeIds.has(edge.toNode) ||
      hoveredNodeId === edge.fromNode ||
      hoveredNodeId === edge.toNode
    if (!endpointActive && !isSelected) return null
  }

  // ... rest of existing render logic
```

- [ ] **Step 4: Wire hoveredNodeId from CardShell**

Check that `CardShell` already calls `setHoveredNode` on hover. If not, add it. Looking at the current code, `CardShell` has `onMouseEnter={() => setHovered(true)}` but this is local state, not store state. Add store calls:

In `CardShell.tsx`, add:
```tsx
const setHoveredNode = useCanvasStore((s) => s.setHoveredNode)

// In the outer div:
onMouseEnter={() => { setHovered(true); setHoveredNode(node.id) }}
onMouseLeave={() => { setHovered(false); setHoveredNode(null) }}
```

- [ ] **Step 5: Run typecheck and tests**

```bash
npm run typecheck && npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/shared/canvas-types.ts src/renderer/src/engine/claude-relationship-extractor.ts src/renderer/src/panels/canvas/EdgeLayer.tsx src/renderer/src/panels/canvas/CardShell.tsx
git commit -m "feat(claude-canvas): suppress settings-controls edges, reveal on hover"
```

---

### Task 4: Compact Settings and Memory zone

Settings (1 card, 340x200) and Memory (~10 cards, 260x160 each) provide low value but consume significant canvas space. Shrink them into a compact zone with smaller cards.

**Files:**
- Modify: `src/renderer/src/panels/canvas/claude/claude-canvas-layout.ts`
- Modify: `src/renderer/src/panels/canvas/claude/ClaudeSettingsCard.tsx`
- Modify: `src/renderer/src/panels/canvas/claude/ClaudeMemoryCard.tsx`
- Modify: `src/shared/canvas-types.ts` (update default sizes)

- [ ] **Step 1: Lower min sizes in canvas-types.ts**

In `src/shared/canvas-types.ts`, update the `MIN_SIZES` and `DEFAULT_SIZES` for `claude-settings` and `claude-memory`:

```ts
// MIN_SIZES:
// OLD: 'claude-settings': { width: 280, height: 180 }
// NEW: 'claude-settings': { width: 220, height: 60 }
// OLD: 'claude-memory': { width: 240, height: 140 }
// NEW: 'claude-memory': { width: 200, height: 80 }

// DEFAULT_SIZES:
// OLD: 'claude-settings': { width: 340, height: 240 }
// NEW: 'claude-settings': { width: 260, height: 80 }
// OLD: 'claude-memory': { width: 300, height: 200 }
// NEW: 'claude-memory': { width: 260, height: 120 }
```

- [ ] **Step 2: Reduce Settings card size in layout**

In `claude-canvas-layout.ts`, reduce Settings dimensions:

```ts
// OLD:
const SETTINGS_W = 340
const SETTINGS_H = 200

// NEW:
const SETTINGS_W = 260
const SETTINGS_H = 80
```

- [ ] **Step 3: Update ClaudeSettingsCard to compact layout**

In `ClaudeSettingsCard.tsx`, redesign to a single-line compact card:

```tsx
// Replace the current multi-section layout with a compact horizontal layout:
// [settings.json badge] [Permissions: 12 | Env Vars: 3 | MCP: 4]
// All on one line, no vertical sections
```

Remove the MCP server name chips (they take too much space). Show only: badge + 3 inline stats. The eye icon in CardShell title bar still opens the full file.

- [ ] **Step 4: Reduce Memory card size**

In `claude-canvas-layout.ts`:

```ts
// For memory items in the layout, use CARD_H_SMALL (120) instead of CARD_H_MEDIUM (160)
// In the Row 3 memory section:
// OLD: cardH: CARD_H_MEDIUM
// NEW: cardH: CARD_H_SMALL
```

- [ ] **Step 5: Update ClaudeMemoryCard to compact layout**

In `ClaudeMemoryCard.tsx`:
- Remove the link count row (low value)
- Reduce content preview from `line-clamp-3` to `line-clamp-2`
- Keep the type badge (it's color-coded and meaningful)

- [ ] **Step 6: Reorganize layout: move Settings into Row 3 compact zone**

In `claude-canvas-layout.ts`, move Settings from Row 2 (where it sits between Agents and Skills) into Row 3 alongside Commands/Teams/Memory. This frees Row 2 for just Agents and Skills (the two most-used zones for authoring).

```ts
// Row 2: Agents (left) | Skills (right) — the authoring workspace
// Row 3: Commands | Teams | Settings + Memory (compact strip)
```

Update the zone positions accordingly. Settings joins the Row 3 compact strip instead of occupying prime Row 2 real estate.

- [ ] **Step 7: Run typecheck and tests**

```bash
npm run typecheck && npm test
```

- [ ] **Step 8: Visual verification**

Run the app and verify:
- Settings card is compact (single row of stats)
- Memory cards are shorter
- Row 2 is cleaner with just Agents and Skills
- Row 3 has Commands, Teams, Settings, Memory in compact form

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/panels/canvas/claude/claude-canvas-layout.ts src/renderer/src/panels/canvas/claude/ClaudeSettingsCard.tsx src/renderer/src/panels/canvas/claude/ClaudeMemoryCard.tsx src/shared/canvas-types.ts
git commit -m "feat(claude-canvas): compact Settings and Memory zone, promote Agents/Skills to Row 2"
```

---

## Verification Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes (375+ tests)
- [ ] Visual: Terminal is centered on cold load (no displacement)
- [ ] Visual: No false skill-references edges from substring matches
- [ ] Visual: settings-controls edges are hidden by default
- [ ] Visual: Settings-controls edges appear on Settings card hover
- [ ] Visual: Settings card is compact (single line)
- [ ] Visual: Memory cards are shorter with 2-line preview
- [ ] Visual: Row 2 is Agents + Skills only (authoring workspace)
- [ ] Regression: Skill cards still clickable with eye icon
- [ ] Regression: Terminal still runs claude REPL
- [ ] Regression: Inspector panel still opens on card click

## Deferred

- Radial/hierarchical layout redesign (evaluate after this pass)
- Progressive edge disclosure for remaining edge types
- Drag-selection coordinate fix (lower priority after edge cleanup)
- Rule card content summarization
- Count-aware column algorithm
