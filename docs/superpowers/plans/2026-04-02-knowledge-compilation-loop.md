# Knowledge Compilation Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Thought Engine into an LLM-compiled knowledge base with output contract, provenance, /compile action, vault-scope thinking, librarian agent, and canvas action bar.

**Architecture:** Six features built sequentially on existing primitives. Adds `origin` and `sources` fields to Artifact, a `derived_from` graph edge kind, agent system prompt templates, a `/compile` action strategy, vault-scope context extraction, a librarian agent type, and a canvas action bar component. Two new files, ~13 modified files, zero new panels.

**Tech Stack:** TypeScript, Vitest, React, Zustand, Pixi.js, Electron IPC, tmux agent spawning

---

### Task 1: Add `origin` and `sources` to Artifact type

**Files:**
- Modify: `src/shared/types.ts:54-75` (Artifact interface)
- Modify: `src/shared/types.ts:77-84` (RELATIONSHIP_KINDS)
- Test: `src/shared/engine/__tests__/shared-engine.test.ts`

- [ ] **Step 1: Write failing tests for origin and sources parsing**

Add to `src/shared/engine/__tests__/shared-engine.test.ts`:

```typescript
describe('shared engine: parseArtifact origin and sources', () => {
  it('parses origin field from frontmatter', () => {
    const md = `---
id: compiled-article
title: Compiled Article
type: research
origin: agent
sources:
  - "[[Paper A]]"
  - "[[Paper B]]"
created: 2026-04-02
modified: 2026-04-02
---

Compiled content.
`
    const result = parseArtifact(md, 'compiled-article.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.origin).toBe('agent')
    expect(result.value.sources).toEqual(['Paper A', 'Paper B'])
  })

  it('defaults origin to human when absent', () => {
    const result = parseArtifact(SAMPLE_MD, 'test-note.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.origin).toBe('human')
    expect(result.value.sources).toEqual([])
  })

  it('accepts source and agent as valid origins', () => {
    const md = `---
title: Raw Paper
origin: source
---

Raw content.
`
    const result = parseArtifact(md, 'raw.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.origin).toBe('source')
  })

  it('defaults invalid origin to human', () => {
    const md = `---
title: Bad Origin
origin: invalid
---

Content.
`
    const result = parseArtifact(md, 'bad.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.origin).toBe('human')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/engine/__tests__/shared-engine.test.ts`
Expected: FAIL with "Property 'origin' does not exist on type 'Artifact'"

- [ ] **Step 3: Add origin and sources to Artifact type**

In `src/shared/types.ts`, add to the `Artifact` interface after the `body` field:

```typescript
  /** Provenance: who created this artifact. */
  readonly origin: 'human' | 'source' | 'agent'
  /** Wikilink titles of source artifacts this was derived from. */
  readonly sources: readonly string[]
```

Add `'derived_from'` to the `RELATIONSHIP_KINDS` array:

```typescript
export const RELATIONSHIP_KINDS = [
  'connection',
  'cluster',
  'tension',
  'appears_in',
  'related',
  'co-occurrence',
  'derived_from'
] as const
```

- [ ] **Step 4: Update parser to extract origin and sources**

In `src/shared/engine/parser.ts`, add after the `VALID_SIGNALS` set:

```typescript
const VALID_ORIGINS = new Set<string>(['human', 'source', 'agent'])
```

In the `parseArtifact` return value, add after `frontmatter`:

```typescript
      origin: VALID_ORIGINS.has(data?.origin) ? (data.origin as 'human' | 'source' | 'agent') : 'human',
      sources: stripWikilinks(toStringArray(data?.sources)),
```

In `serializeArtifact`, add after the `frame` check:

```typescript
  if (artifact.origin !== 'human') frontmatter.origin = artifact.origin
  if (artifact.sources.length > 0) frontmatter.sources = [...artifact.sources]
```

Add `'origin'` and `'sources'` to the `EXPLICIT_KEYS` set in `serializeArtifact`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/shared/engine/__tests__/shared-engine.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`
Expected: Type errors in files that construct Artifact objects without `origin`/`sources`. Note which files need updating.

- [ ] **Step 7: Fix type errors across the codebase**

Every file that constructs an `Artifact` literal now needs `origin: 'human'` and `sources: []`. The parser already handles this. Check:
- `src/shared/engine/__tests__/shared-engine.test.ts` (any test helpers building Artifacts)
- `src/renderer/src/panels/workbench/workbench-artifacts.ts` (builds session/pattern/tension artifacts)
- Any mock/fixture Artifact objects in test files

For each, add `origin: 'human', sources: []` to the object literal.

- [ ] **Step 8: Run full quality gate**

Run: `npm run check`
Expected: PASS (zero lint errors, zero type errors, all tests pass)

- [ ] **Step 9: Commit**

```bash
git add src/shared/types.ts src/shared/engine/parser.ts src/shared/engine/__tests__/shared-engine.test.ts
git add -u  # catch any type-error fixes
git commit -m "feat: add origin and sources fields to Artifact type"
```

---

### Task 2: Add `derived_from` edges in graph-builder

**Files:**
- Modify: `src/shared/engine/graph-builder.ts:99-119` (Phase 1 edges)
- Test: `src/shared/engine/__tests__/shared-engine.test.ts`

- [ ] **Step 1: Write failing test for derived_from edges**

Add to `src/shared/engine/__tests__/shared-engine.test.ts`:

```typescript
describe('shared engine: buildGraph derived_from edges', () => {
  it('creates derived_from edges from sources field', () => {
    const sourceArtifact = parseArtifact(`---
id: paper-a
title: Paper A
type: research
origin: source
---

Raw paper content.
`, 'paper-a.md')

    const compiledArtifact = parseArtifact(`---
id: compiled-concept
title: Compiled Concept
type: research
origin: agent
sources:
  - "[[Paper A]]"
---

Compiled concept article.
`, 'compiled-concept.md')

    expect(sourceArtifact.ok && compiledArtifact.ok).toBe(true)
    if (!sourceArtifact.ok || !compiledArtifact.ok) return

    const graph = buildGraph([sourceArtifact.value, compiledArtifact.value])
    const derivedEdges = graph.edges.filter((e) => e.kind === 'derived_from')
    expect(derivedEdges).toHaveLength(1)
    expect(derivedEdges[0].source).toBe('compiled-concept')
    expect(derivedEdges[0].target).toBe('paper-a')
    expect(derivedEdges[0].provenance?.source).toBe('frontmatter')
  })

  it('does not create derived_from edges when sources is empty', () => {
    const artifact = parseArtifact(`---
id: plain-note
title: Plain Note
type: note
---

Just a note.
`, 'plain-note.md')

    expect(artifact.ok).toBe(true)
    if (!artifact.ok) return

    const graph = buildGraph([artifact.value])
    const derivedEdges = graph.edges.filter((e) => e.kind === 'derived_from')
    expect(derivedEdges).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/engine/__tests__/shared-engine.test.ts`
Expected: FAIL (no `derived_from` edges created)

- [ ] **Step 3: Add derived_from edge creation to graph-builder**

In `src/shared/engine/graph-builder.ts`, after the bodyLinks loop in Phase 1 (around line 118), add:

```typescript
    // derived_from edges from sources field
    for (const sourceTitle of a.sources) {
      const resolvedTarget = lowerToId.get(sourceTitle.toLowerCase()) ?? sourceTitle
      addEdge(a.id, resolvedTarget, 'derived_from', frontmatterProvenance)
    }
```

Also update the `hasExplicitEdge` function to include `'derived_from'` in the kinds array:

```typescript
  function hasExplicitEdge(source: string, target: string): boolean {
    const sorted = [source, target].sort()
    const pairKey = sorted.join('<->')
    for (const kind of ['connection', 'cluster', 'tension', 'appears_in', 'related', 'derived_from'] as const) {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/engine/__tests__/shared-engine.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run quality gate**

Run: `npm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/engine/graph-builder.ts src/shared/engine/__tests__/shared-engine.test.ts
git commit -m "feat: create derived_from graph edges from sources field"
```

---

### Task 3: Add `derived_from` to edge color tokens

**Files:**
- Modify: `src/renderer/src/design/tokens.ts:124-135` (EDGE_KIND_COLORS)

- [ ] **Step 1: Add derived_from color**

In `src/renderer/src/design/tokens.ts`, add to `EDGE_KIND_COLORS`:

```typescript
  derived_from: '#5b8dd9',  // oklch(0.65 0.12 260) muted blue — same as imports (lineage relationship)
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/design/tokens.ts
git commit -m "feat: add derived_from edge color token"
```

---

### Task 4: Create default agent prompt template

**Files:**
- Create: `src/main/services/default-agent-prompt.md`
- Modify: `src/main/services/agent-spawner.ts`

- [ ] **Step 1: Write the default agent prompt template**

Create `src/main/services/default-agent-prompt.md`:

```markdown
# Thought Engine Agent

You are an AI agent working inside a knowledge vault managed by Thought Engine.

## Output Contract

When you produce knowledge (answers, summaries, compiled articles, synthesis), write it as a markdown file using the `vault.create_file` MCP tool. Do NOT leave your output as terminal text only.

Every artifact you create MUST include this frontmatter:

\`\`\`yaml
---
title: <descriptive title>
type: <one of: gene, constraint, research, output, note, index, tension>
origin: agent
tags:
  - <relevant tags, consistent with existing vault tags>
sources:
  - "[[Source Title 1]]"
  - "[[Source Title 2]]"
created: <today's date YYYY-MM-DD>
modified: <today's date YYYY-MM-DD>
---
\`\`\`

### Field guidelines

- **title**: Descriptive, concise. For concept articles: "Concept: <Name>". For Q&A: "Q: <Question>".
- **type**: Match the content. `research` for compiled knowledge, `tension` for contradictions/gaps, `output` for Q&A answers, `note` for general.
- **origin**: Always `agent` for content you create.
- **tags**: Use existing tags from the vault when possible. Check the tag tree for consistency.
- **sources**: Wikilink titles (`[[Title]]`) of every artifact you read or cited. This creates lineage edges in the knowledge graph.

### File naming

Slugify the title: lowercase, hyphens for spaces, no special characters. Place at vault root unless the vault has a clear directory structure.

Example: `concept-attention-mechanisms.md`

## Available MCP Tools

- `vault.read_file` — Read a file from the vault
- `search.query` — Full-text search across the vault
- `graph.get_neighbors` — Get nodes connected to a given node
- `graph.get_ghosts` — Get unresolved wikilinks (ideas referenced but not yet written)
- `vault.create_file` — Create a new file (requires approval)
- `vault.write_file` — Update an existing file (requires approval)

## Principles

- Your outputs accumulate in the knowledge base. Write for future reference, not just the current question.
- Use `[[wikilinks]]` in your body text to connect to existing articles.
- Check ghosts before creating new articles — you may be able to resolve an existing unresolved reference.
- When you discover contradictions or gaps, write tension artifacts rather than ignoring them.
```

- [ ] **Step 2: Update agent-spawner to read the prompt template**

In `src/main/services/agent-spawner.ts`, add imports and modify the `spawn` method:

```typescript
import { randomUUID } from 'crypto'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import type { ShellService } from './shell-service'
import type { AgentSpawnRequest } from '@shared/agent-types'
import type { SessionId } from '@shared/types'
import { TE_DIR } from '@shared/constants'

/** Shell-escape a string by wrapping in single quotes and escaping embedded quotes. */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

/**
 * Read the agent prompt template from .machina/agent-prompt.md if it exists,
 * otherwise fall back to the bundled default.
 */
function readAgentPrompt(vaultRoot: string): string | null {
  const userPromptPath = join(vaultRoot, TE_DIR, 'agent-prompt.md')
  if (existsSync(userPromptPath)) {
    try {
      return readFileSync(userPromptPath, 'utf-8')
    } catch {
      // Fall through to default
    }
  }

  const defaultPath = join(__dirname, 'default-agent-prompt.md')
  // In packaged app, check resources directory
  const packagedPath = __dirname.includes('.asar')
    ? join(process.resourcesPath, 'default-agent-prompt.md')
    : defaultPath
  const pathToRead = existsSync(packagedPath) ? packagedPath : defaultPath
  if (existsSync(pathToRead)) {
    try {
      return readFileSync(pathToRead, 'utf-8')
    } catch {
      return null
    }
  }
  return null
}
```

Modify the `spawn` method to prepend the prompt:

```typescript
  spawn(request: AgentSpawnRequest): SessionId {
    const sessionId = randomUUID()
    const wrapperPath = __dirname.includes('.asar')
      ? join(process.resourcesPath, 'scripts', 'agent-wrapper.sh')
      : join(__dirname, '../../scripts/agent-wrapper.sh')

    // Build the full prompt: agent template + user request
    const agentPrompt = readAgentPrompt(this.vaultRoot)
    const fullPrompt = agentPrompt && request.prompt
      ? `${agentPrompt}\n\n---\n\n# User Request\n\n${request.prompt}`
      : request.prompt ?? agentPrompt ?? undefined

    const args = [
      'bash',
      shellEscape(wrapperPath),
      '--session-id',
      shellEscape(sessionId),
      '--vault-root',
      shellEscape(this.vaultRoot),
      '--cwd',
      shellEscape(request.cwd)
    ]

    if (fullPrompt) {
      args.push('--prompt', shellEscape(fullPrompt))
    }

    const label = `agent:${sessionId.slice(0, 8)}`

    return this.shellService.create(
      request.cwd,
      undefined,
      undefined,
      args.join(' '),
      label,
      this.vaultRoot
    )
  }
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/services/default-agent-prompt.md src/main/services/agent-spawner.ts
git commit -m "feat: add agent output contract prompt template"
```

---

### Task 5: Add origin-based icon colors to sidebar file tree

**Files:**
- Modify: `src/renderer/src/panels/sidebar/origin-utils.ts`

- [ ] **Step 1: Extend origin-utils for three-origin model**

Replace the contents of `src/renderer/src/panels/sidebar/origin-utils.ts`:

```typescript
import type { FlatTreeNode } from './buildFileTree'

/** Icon colors for the three-origin model. human uses default (no override). */
export const ORIGIN_COLORS = {
  source: '#60a5fa',   // blue — raw ingested material
  agent: '#4ade80',    // green — LLM-produced content
  human: undefined     // default icon color
} as const

export type ArtifactOrigin = 'human' | 'source' | 'agent'

/** Get the icon color override for a file based on its origin, or undefined for default. */
export function getOriginColor(origin: ArtifactOrigin | undefined): string | undefined {
  if (!origin || origin === 'human') return undefined
  return ORIGIN_COLORS[origin]
}

export function isFolderOrigin(
  folderPath: string,
  origins: Map<string, string> | undefined,
  nodes: FlatTreeNode[]
): boolean {
  if (!origins || origins.size === 0) return false
  const children = nodes.filter((n) => !n.isDirectory && n.parentPath === folderPath)
  return children.length > 0 && children.every((c) => origins.has(c.path))
}
```

- [ ] **Step 2: Run typecheck and check for callers**

Run: `npm run typecheck`
Check that `FileTree.tsx` still compiles. It references `ORIGIN_FILE_COLOR` and `ORIGIN_FOLDER_COLOR` which we removed. Grep for these constants and update the import to use `ORIGIN_COLORS.agent` and `ORIGIN_COLORS.source` respectively, or use `getOriginColor()` with the artifact's origin.

- [ ] **Step 3: Update FileTree.tsx to use the new API**

Find where `ORIGIN_FILE_COLOR` and `ORIGIN_FOLDER_COLOR` are referenced in `FileTree.tsx` and replace with the new `getOriginColor()` function, passing the artifact's `origin` field from the vault store.

- [ ] **Step 4: Run quality gate**

Run: `npm run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/panels/sidebar/origin-utils.ts src/renderer/src/panels/sidebar/FileTree.tsx
git commit -m "feat: extend sidebar file tree icon colors for three-origin model"
```

---

### Task 6: Add origin display to FrontmatterHeader

**Files:**
- Modify: `src/renderer/src/panels/editor/FrontmatterHeader.tsx:392-399`

- [ ] **Step 1: Add origin and sources display after the type badge**

In `FrontmatterHeader.tsx`, after the type badge `<div>` (around line 416-434), add an origin indicator when origin is not `human`:

```typescript
      {/* Origin indicator (only for source/agent) */}
      {artifact?.origin && artifact.origin !== 'human' && (
        <div style={{
          marginTop: '0.5rem',
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          color: colors.text.muted,
          letterSpacing: '0.08em'
        }}>
          <span style={{ textTransform: 'uppercase' }}>
            {artifact.origin === 'source' ? 'source material' : 'agent-compiled'}
          </span>
          {artifact.sources.length > 0 && (
            <span style={{ marginLeft: '0.75rem', color: colors.text.secondary }}>
              from{' '}
              {artifact.sources.map((src, i) => (
                <span key={src}>
                  {i > 0 && ', '}
                  <span
                    onClick={() => onNavigate?.(src)}
                    style={{
                      cursor: onNavigate ? 'pointer' : 'default',
                      textDecoration: 'underline',
                      textDecorationColor: `${colors.text.muted}40`,
                      textUnderlineOffset: '2px'
                    }}
                    onMouseEnter={(e) => {
                      if (onNavigate) e.currentTarget.style.color = colors.text.primary
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = colors.text.secondary
                    }}
                  >
                    {src}
                  </span>
                </span>
              ))}
            </span>
          )}
        </div>
      )}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (Artifact now has `origin` and `sources`)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/panels/editor/FrontmatterHeader.tsx
git commit -m "feat: show origin and source links in editor frontmatter header"
```

---

### Task 7: Add origin-based CSS class to canvas cards

**Files:**
- Modify: `src/renderer/src/panels/canvas/CardShell.tsx` (or the card wrapper component)

The exact file depends on where the card container `<div>` is rendered. Find the component that wraps all canvas card types and adds the outer container styles.

- [ ] **Step 1: Look up the card container component**

Run: `grep -rn 'className.*card' src/renderer/src/panels/canvas/CardShell.tsx | head -10`

Identify where the card's outer `<div>` applies CSS classes.

- [ ] **Step 2: Add origin class to the card container**

In the card shell component, read the artifact's `origin` from the card's metadata or resolved artifact data. Apply a CSS class:

```typescript
// Add data attribute for origin-based styling
const originClass = artifact?.origin && artifact.origin !== 'human'
  ? `card-origin-${artifact.origin}`
  : ''
```

Add `card-origin-source` and `card-origin-agent` CSS rules. Use thin left-border accents (not pill badges):

```css
.card-origin-source {
  border-left: 2px solid rgba(96, 165, 250, 0.5); /* blue accent, matches sidebar source color */
}
.card-origin-agent {
  border-left: 2px solid rgba(74, 222, 128, 0.4); /* green accent, matches sidebar agent color */
}
```

These are subtle thin accent lines on the left edge of the card, consistent with the design spec requirement for "clean, integrated, not pill badges."

- [ ] **Step 3: Run typecheck and visual check**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/panels/canvas/CardShell.tsx
git commit -m "feat: add subtle origin accent to canvas cards"
```

---

### Task 8: Add `/compile` to agent action registry and strategy  

**Files:**
- Modify: `src/shared/agent-action-types.ts:16-45` (AGENT_ACTIONS)
- Modify: `src/main/services/agent-action-runner.ts:269-289` (ACTION_INSTRUCTIONS)

- [ ] **Step 1: Add compile to AGENT_ACTIONS registry**

In `src/shared/agent-action-types.ts`, add to the `AGENT_ACTIONS` array before the `as const`:

```typescript
  {
    id: 'compile',
    label: '/compile',
    description: 'Compile sources into wiki articles',
    requiresSelection: 1,
    keywords: ['compile', 'synthesize', 'wiki', 'article', 'summarize']
  },
```

- [ ] **Step 2: Add compile instructions to action runner**

In `src/main/services/agent-action-runner.ts`, add to `ACTION_INSTRUCTIONS`:

```typescript
  compile:
    'You are a knowledge compiler. Read the selected source cards and compile them into structured ' +
    'wiki articles. For each key concept, claim, or theme in the sources, create a new card with a ' +
    'descriptive title, appropriate type, and tags consistent with the vault. Include sources in the ' +
    'metadata field as an array of the source card titles (e.g. {"sources": ["Paper A", "Paper B"]}). ' +
    'Set metadata.origin to "agent". Position new cards near their source cards, offset to form a ' +
    'visible cluster. Connect new articles to their sources with edges, and to each other where ' +
    'concepts relate.',
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run existing agent action tests (if any)**

Run: `npx vitest run src/shared/__tests__/` 
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/agent-action-types.ts src/main/services/agent-action-runner.ts
git commit -m "feat: add /compile agent action registry entry and strategy"
```

---

### Task 8: Update `/challenge` and `/emerge` to support vault-scope (requiresSelection: 0)

**Files:**
- Modify: `src/shared/agent-action-types.ts:16-30`
- Modify: `src/main/services/agent-action-runner.ts:269-289`

- [ ] **Step 1: Update requiresSelection to 0**

In `src/shared/agent-action-types.ts`, change `challenge` and `emerge` entries:

```typescript
  {
    id: 'challenge',
    label: '/challenge',
    description: 'Stress-test ideas, surface contradictions and assumptions',
    requiresSelection: 0,
    keywords: ['challenge', 'question', 'contradict', 'assumption', 'stress']
  },
  {
    id: 'emerge',
    label: '/emerge',
    description: 'Surface hidden connections, synthesize across content',
    requiresSelection: 0,
    keywords: ['emerge', 'connect', 'synthesize', 'discover', 'link']
  },
```

- [ ] **Step 2: Add vault-scope instructions to action runner**

In `src/main/services/agent-action-runner.ts`, update `ACTION_INSTRUCTIONS` to branch on context. Update `buildPrompt` to detect vault-scope (when `context.selectedCards` contains summaries from `buildVaultScopeContext`). The simplest approach: add a `vaultScope` flag to `AgentContext`.

First, add to `src/shared/agent-action-types.ts` in the `AgentContext` interface:

```typescript
  readonly vaultScope?: boolean
```

Then update `ACTION_INSTRUCTIONS` to be functions that check context:

Actually, simpler: add vault-scope instruction variants directly in the prompt builder. In `agent-action-runner.ts`, update `buildPrompt`:

```typescript
const VAULT_SCOPE_PREAMBLE =
  'You are operating at VAULT SCOPE. Instead of selected cards, you have been given a structural ' +
  'overview of the entire vault: artifact summaries (title, type, signal, tags), the tag tree, and ' +
  'unresolved references (ghosts). Identify the most important areas to address and produce your ' +
  'output as new cards positioned in open canvas space.\n\n'

export function buildPrompt(action: AgentActionName, context: AgentContext): string {
  const instructions = ACTION_INSTRUCTIONS[action]
  const vaultScopePrefix = context.vaultScope ? VAULT_SCOPE_PREAMBLE : ''
  // ... rest unchanged, just prepend vaultScopePrefix to instructions in the template
```

In the template string, change `${instructions}` to `${vaultScopePrefix}${instructions}`.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/shared/agent-action-types.ts src/main/services/agent-action-runner.ts
git commit -m "feat: enable vault-scope mode for /challenge and /emerge actions"
```

---

### Task 9: Add `buildVaultScopeContext` to agent-context.ts

**Files:**
- Modify: `src/renderer/src/panels/canvas/agent-context.ts`
- Test: `src/renderer/src/panels/canvas/__tests__/agent-context.test.ts` (create)

- [ ] **Step 1: Write failing test for vault-scope context**

Create `src/renderer/src/panels/canvas/__tests__/agent-context.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildVaultScopeContext } from '../agent-context'
import type { Artifact } from '@shared/types'
import type { TagTreeNode } from '@shared/engine/tag-index'
import type { GhostEntry } from '@shared/engine/ghost-index'

describe('buildVaultScopeContext', () => {
  it('builds context from artifact summaries, tag tree, and ghosts', () => {
    const artifacts: Pick<Artifact, 'id' | 'title' | 'type' | 'signal' | 'tags' | 'origin'>[] = [
      { id: 'note-1', title: 'Note 1', type: 'note', signal: 'emerging', tags: ['ai'], origin: 'human' },
      { id: 'paper-a', title: 'Paper A', type: 'research', signal: 'untested', tags: ['ai', 'ml'], origin: 'source' }
    ]

    const tagTree: TagTreeNode[] = [
      { name: 'ai', fullPath: 'ai', count: 2, children: [] }
    ]

    const ghosts: GhostEntry[] = [
      { id: 'Unresolved Concept', referenceCount: 3, references: [] }
    ]

    const context = buildVaultScopeContext('challenge', artifacts, tagTree, ghosts, {
      viewportBounds: { x: 0, y: 0, width: 1000, height: 800 },
      totalCardCount: 5
    })

    expect(context.action).toBe('challenge')
    expect(context.vaultScope).toBe(true)
    expect(context.selectedCards.length).toBe(2)
    expect(context.selectedCards[0].body).toContain('Note 1')
    expect(context.selectedCards[0].body).toContain('tags: ai')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/panels/canvas/__tests__/agent-context.test.ts`
Expected: FAIL (buildVaultScopeContext not exported)

- [ ] **Step 3: Implement buildVaultScopeContext**

Add to `src/renderer/src/panels/canvas/agent-context.ts`:

```typescript
import type { AgentActionName, AgentContext, AgentCardContext } from '@shared/agent-action-types'
import type { TagTreeNode } from '@shared/engine/tag-index'
import type { GhostEntry } from '@shared/engine/ghost-index'

interface ArtifactSummary {
  readonly id: string
  readonly title: string
  readonly type: string
  readonly signal: string
  readonly tags: readonly string[]
  readonly origin: string
}

/**
 * Build agent context from vault-wide summaries (no card selection).
 * Used for vault-scope /challenge and /emerge.
 */
export function buildVaultScopeContext(
  action: AgentActionName,
  artifacts: readonly ArtifactSummary[],
  tagTree: readonly TagTreeNode[],
  ghosts: readonly GhostEntry[],
  canvasMeta: {
    viewportBounds: { x: number; y: number; width: number; height: number }
    totalCardCount: number
  }
): AgentContext {
  // Encode each artifact summary as a pseudo-card with structured body text
  const selectedCards: AgentCardContext[] = artifacts.map((a, i) => ({
    id: a.id,
    type: 'text' as const,
    title: a.title,
    body: `[${a.type}] ${a.title} (signal: ${a.signal}, origin: ${a.origin}, tags: ${a.tags.join(', ') || 'none'})`,
    tags: a.tags,
    position: { x: 0, y: i * 20 },
    size: { width: 200, height: 40 }
  }))

  // Encode tag tree as a neighbor for context
  const tagSummary = tagTree
    .map((t) => `${t.fullPath} (${t.count})`)
    .join(', ')

  // Encode ghosts as another neighbor
  const ghostSummary = ghosts
    .slice(0, 20)
    .map((g) => `${g.id} (${g.referenceCount} refs)`)
    .join(', ')

  const neighbors = [
    ...(tagSummary
      ? [{
          id: '_tag_tree',
          title: `Tag Tree: ${tagSummary}`,
          tags: [] as readonly string[],
          edgeKind: 'metadata'
        }]
      : []),
    ...(ghostSummary
      ? [{
          id: '_ghost_index',
          title: `Unresolved References: ${ghostSummary}`,
          tags: [] as readonly string[],
          edgeKind: 'metadata'
        }]
      : [])
  ]

  return {
    action,
    vaultScope: true,
    selectedCards,
    neighbors,
    edges: [],
    canvasMeta
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/panels/canvas/__tests__/agent-context.test.ts`
Expected: PASS

- [ ] **Step 5: Run quality gate**

Run: `npm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/panels/canvas/agent-context.ts src/renderer/src/panels/canvas/__tests__/agent-context.test.ts
git commit -m "feat: add buildVaultScopeContext for vault-wide agent actions"
```

---

### Task 10: Add `/librarian` registry entry and prompt template

**Files:**
- Create: `src/main/services/default-librarian-prompt.md`
- Modify: `src/shared/agent-action-types.ts`
- Modify: `src/main/services/agent-spawner.ts`

- [ ] **Step 1: Write the librarian prompt template**

Create `src/main/services/default-librarian-prompt.md`:

```markdown
# Librarian

You are the librarian for this knowledge vault. Your job is to maintain, compile, and enhance the knowledge base.

## Available Tools

- `vault.read_file` — Read any file in the vault
- `search.query` — Full-text search across all vault content
- `graph.get_neighbors` — Get nodes connected to a given node in the knowledge graph
- `graph.get_ghosts` — Get unresolved wikilinks (ideas referenced but not yet written)
- `vault.create_file` — Create a new file (requires user approval)
- `vault.write_file` — Update an existing file (requires user approval)

## Standing Responsibilities

### 1. Compile unprocessed sources

Find artifacts with `origin: source` in their frontmatter that have no compiled derivatives. For each, read the full content and compile it into structured wiki articles:
- Extract key concepts and claims
- Write articles with proper frontmatter (origin: agent, sources linking back)
- Use existing tags for consistency

### 2. Discover contradictions and gaps

Review the vault for:
- Conflicting claims across articles (write tension artifacts)
- Topics with thin coverage relative to their reference count
- High-frequency ghost references that deserve their own articles

### 3. Maintain connections

Look for articles that discuss related topics but lack explicit connections. Suggest new wikilinks or relationship edges.

### 4. Update the vault index

Write or update `_index.md` with:
- Total article count by type
- Key concepts and their article counts
- Recent additions
- Coverage gaps and suggested research directions

### 5. Suggest next questions

Based on what you find, create tension artifacts suggesting research directions the user might explore.

## Output Contract

All output follows the standard output contract. Every artifact you create must include `origin: agent`, appropriate `type`, `tags`, and `sources` in frontmatter. Use wikilinks in body text to connect to existing articles.
```

- [ ] **Step 2: Add librarian to the action registry**

In `src/shared/agent-action-types.ts`, add to `AGENT_ACTIONS`:

```typescript
  {
    id: 'librarian',
    label: '/librarian',
    description: 'Launch librarian agent to compile, maintain, and enhance the vault',
    requiresSelection: 0,
    keywords: ['librarian', 'maintain', 'compile', 'index', 'health']
  },
```

- [ ] **Step 3: Update agent-spawner to handle librarian prompt**

In `src/main/services/agent-spawner.ts`, add a function to read the librarian prompt:

```typescript
function readLibrarianPrompt(vaultRoot: string): string | null {
  const userPromptPath = join(vaultRoot, TE_DIR, 'librarian-prompt.md')
  if (existsSync(userPromptPath)) {
    try {
      return readFileSync(userPromptPath, 'utf-8')
    } catch {
      // Fall through to default
    }
  }

  const defaultPath = join(__dirname, 'default-librarian-prompt.md')
  const packagedPath = __dirname.includes('.asar')
    ? join(process.resourcesPath, 'default-librarian-prompt.md')
    : defaultPath
  const pathToRead = existsSync(packagedPath) ? packagedPath : defaultPath
  if (existsSync(pathToRead)) {
    try {
      return readFileSync(pathToRead, 'utf-8')
    } catch {
      return null
    }
  }
  return null
}
```

Update the `spawn` method to detect librarian requests and use the librarian prompt. Add an optional `action` field check on the request:

```typescript
  spawn(request: AgentSpawnRequest): SessionId {
    const sessionId = randomUUID()
    const wrapperPath = __dirname.includes('.asar')
      ? join(process.resourcesPath, 'scripts', 'agent-wrapper.sh')
      : join(__dirname, '../../scripts/agent-wrapper.sh')

    // Choose prompt based on action type
    const isLibrarian = request.prompt?.includes('/librarian') ?? false
    const basePrompt = isLibrarian
      ? readLibrarianPrompt(this.vaultRoot)
      : readAgentPrompt(this.vaultRoot)
    const userPrompt = isLibrarian ? undefined : request.prompt

    const fullPrompt = basePrompt && userPrompt
      ? `${basePrompt}\n\n---\n\n# User Request\n\n${userPrompt}`
      : basePrompt ?? userPrompt ?? undefined

    // ... rest unchanged
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/default-librarian-prompt.md src/shared/agent-action-types.ts src/main/services/agent-spawner.ts
git commit -m "feat: add /librarian agent with specialized prompt template"
```

---

### Task 11: Create CanvasActionBar component

**Files:**
- Create: `src/renderer/src/panels/canvas/CanvasActionBar.tsx`
- Modify: `src/renderer/src/panels/canvas/CanvasView.tsx`

- [ ] **Step 1: Create the CanvasActionBar component**

Create `src/renderer/src/panels/canvas/CanvasActionBar.tsx`:

```tsx
import { useMemo } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { useCanvasStore } from '../../store/canvas-store'
import { colors } from '../../design/tokens'
import type { AgentActionName } from '@shared/agent-action-types'

interface CanvasActionBarProps {
  onTriggerAction: (action: AgentActionName) => void
  librarianRunning: boolean
}

const actionLabelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  letterSpacing: '0.06em',
  color: colors.text.muted,
  cursor: 'pointer',
  padding: '4px 0',
  transition: 'color 150ms ease-out',
  background: 'none',
  border: 'none',
  outline: 'none',
  position: 'relative'
}

export function CanvasActionBar({ onTriggerAction, librarianRunning }: CanvasActionBarProps) {
  const artifacts = useVaultStore((s) => s.artifacts)
  const selectedIds = useCanvasStore((s) => s.selectedIds)

  // Count unprocessed sources: origin=source with no derived_from edges pointing to them
  const unprocessedSourceCount = useMemo(() => {
    const graph = useVaultStore.getState().graph
    if (!graph) return 0

    const sourceArtifactIds = new Set<string>()
    for (const [id, artifact] of Object.entries(artifacts)) {
      if (artifact.origin === 'source') sourceArtifactIds.add(id)
    }

    // Find sources that are targets of derived_from edges
    const compiledSourceIds = new Set<string>()
    for (const edge of graph.edges) {
      if (edge.kind === 'derived_from' && sourceArtifactIds.has(edge.target)) {
        compiledSourceIds.add(edge.target)
      }
    }

    return sourceArtifactIds.size - compiledSourceIds.size
  }, [artifacts])

  const hasAnyContent = Object.keys(artifacts).length > 0
  const hasSelection = selectedIds.size > 0
  const showCompile = unprocessedSourceCount > 0 || hasSelection

  // Dark cockpit: hide actions that aren't applicable
  if (!hasAnyContent && !showCompile) return null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1.25rem',
        marginLeft: 'auto'
      }}
    >
      {showCompile && (
        <button
          type="button"
          style={actionLabelStyle}
          onClick={() => onTriggerAction('compile')}
          onMouseEnter={(e) => { e.currentTarget.style.color = colors.text.primary }}
          onMouseLeave={(e) => { e.currentTarget.style.color = colors.text.muted }}
        >
          Compile
          {unprocessedSourceCount > 0 && (
            <span style={{
              color: 'var(--color-accent-default)',
              marginLeft: '0.35rem',
              fontSize: '10px'
            }}>
              {unprocessedSourceCount}
            </span>
          )}
        </button>
      )}

      {hasAnyContent && (
        <button
          type="button"
          style={actionLabelStyle}
          onClick={() => onTriggerAction(hasSelection ? 'challenge' : 'challenge')}
          onMouseEnter={(e) => { e.currentTarget.style.color = colors.text.primary }}
          onMouseLeave={(e) => { e.currentTarget.style.color = colors.text.muted }}
        >
          Think
        </button>
      )}

      {hasAnyContent && (
        <button
          type="button"
          style={{
            ...actionLabelStyle,
            ...(librarianRunning ? {
              color: 'var(--color-accent-default)',
            } : {})
          }}
          onClick={() => onTriggerAction('librarian')}
          onMouseEnter={(e) => {
            if (!librarianRunning) e.currentTarget.style.color = colors.text.primary
          }}
          onMouseLeave={(e) => {
            if (!librarianRunning) e.currentTarget.style.color = colors.text.muted
          }}
        >
          Librarian
          {librarianRunning && (
            <span style={{
              display: 'inline-block',
              width: '100%',
              height: '1px',
              background: 'var(--color-accent-default)',
              position: 'absolute',
              bottom: 0,
              left: 0,
              animation: 'te-pulse 2s ease-in-out infinite'
            }} />
          )}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Mount CanvasActionBar in CanvasView**

In `src/renderer/src/panels/canvas/CanvasView.tsx`, import the component:

```typescript
import { CanvasActionBar } from './CanvasActionBar'
```

Find the canvas header/tab area and add the action bar. This will be rendered inside the canvas view's top bar, right-aligned. The exact mount point depends on the current header structure — look for where the canvas tab label is rendered and add `<CanvasActionBar>` after it with `marginLeft: 'auto'` to push it right.

Wire `onTriggerAction` to the existing `useAgentOrchestrator` trigger:

```tsx
<CanvasActionBar
  onTriggerAction={(action) => triggerAction(action)}
  librarianRunning={false}  // TODO: wire to tmux monitor in a later iteration
/>
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/panels/canvas/CanvasActionBar.tsx src/renderer/src/panels/canvas/CanvasView.tsx
git commit -m "feat: add canvas action bar for knowledge compilation loop"
```

---

### Task 12: Add origin border/shape to graph panel nodes

**Files:**
- Modify: `src/renderer/src/panels/graph/` (node rendering component)

- [ ] **Step 1: Find the graph node rendering component**

Run: `grep -rn 'GraphNode\|nodeRadius\|node.*fill\|node.*stroke' src/renderer/src/panels/graph/ | head -20`

Identify where graph nodes are drawn (likely in a D3-based renderer or a React component that produces SVG/canvas elements).

- [ ] **Step 2: Add origin-based border/shape variant**

For nodes where the backing artifact has `origin: 'source'`, apply a dashed stroke. For `origin: 'agent'`, apply a double-stroke or distinct border style. This is orthogonal to the fill color (which comes from `getArtifactColor(type)`).

```typescript
// Example for an SVG-based renderer:
const strokeDasharray = artifact?.origin === 'source' ? '4,2' : undefined
const strokeWidth = artifact?.origin === 'agent' ? 2 : 1
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/panels/graph/
git commit -m "feat: add origin-based border style to graph panel nodes"
```

---

### Task 13: Add origin-based grouping mode to ontology

**Files:**
- Modify: `src/shared/engine/ontology-grouping.ts`
- Modify: `src/shared/engine/ontology-types.ts` (if grouping mode enum exists)

- [ ] **Step 1: Check existing grouping modes**

Read `src/shared/engine/ontology-types.ts` to understand how grouping modes are configured. Look for any `GroupBy` or `GroupingMode` type.

- [ ] **Step 2: Add origin as a grouping dimension**

In `ontology-grouping.ts`, add a branch that groups cards by their artifact's `origin` field instead of by tags. When `groupBy: 'origin'` is set:
- Create three groups: `source`, `agent`, `human`
- Assign each card to its origin group
- Skip the tag-based grouping and link-analysis fallback

```typescript
// In the grouping function, add early return for origin mode:
if (groupBy === 'origin') {
  return groupByOrigin(input)
}

function groupByOrigin(input: OntologyGroupingInput): OntologySnapshot {
  const groups = new Map<string, string[]>()  // origin -> card ids
  for (const card of input.cards) {
    const artifact = input.artifacts[input.fileToId[card.content] ?? '']
    const origin = (artifact as { origin?: string })?.origin ?? 'human'
    const list = groups.get(origin) ?? []
    list.push(card.id)
    groups.set(origin, list)
  }
  // Build OntologySnapshot from groups...
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/shared/engine/ontology-grouping.ts src/shared/engine/ontology-types.ts
git commit -m "feat: add origin-based grouping mode to ontology system"
```

---

### Task 14: Final integration verification

**Files:** None (verification only)

- [ ] **Step 1: Run full quality gate**

Run: `npm run check`
Expected: PASS (zero lint errors, zero type errors, all tests pass)

- [ ] **Step 2: Run the app**

Run: `npm run dev`
Verify:
- App launches without errors
- Canvas action bar appears in canvas header when vault has content
- Action bar hides when vault is empty (dark cockpit)
- Clicking "Think" triggers the agent orchestrator
- No visual regressions in sidebar, editor, or canvas

- [ ] **Step 3: Final commit (if any fixups)**

```bash
git add -u
git commit -m "fix: integration fixups for knowledge compilation loop"
```
