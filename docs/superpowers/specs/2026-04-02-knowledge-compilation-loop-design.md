# Knowledge Compilation Loop

> Design spec for turning Thought Engine into an LLM-compiled knowledge base. Inspired by AK's workflow: raw sources compiled into a structured wiki by AI agents, with Q&A, vault-scale thinking, and continuous knowledge accumulation. All built on existing TE primitives.

## Reference

AK's workflow (the target use case): raw data from sources is collected, then compiled by an LLM into a markdown wiki, then operated on by various CLIs to do Q&A and incrementally enhance the wiki. "You rarely ever write or edit the wiki manually, it's the domain of the LLM."

## Scope

Six features, built in order. Each independently useful. The full AK loop is realized when all six ship.

1. **Output Contract** -- agent work becomes vault artifacts, not terminal text
2. **Provenance System** -- visual origin tracking (human / source / agent)
3. **`/compile` Agent Action** -- scoped compilation of sources into wiki articles
4. **Vault-Scope Agent Actions** -- existing actions at vault level without selection
5. **Librarian Agent** -- background agent for maintenance, compilation, and thinking
6. **Canvas Action Bar** -- visible, intuitive entry point for the entire knowledge loop

**In scope:**
- Frontmatter schema additions (`origin`, `sources`)
- New `derived_from` graph edge kind
- Agent system prompt templates (`.machina/agent-prompt.md`, `.machina/librarian-prompt.md`)
- New `/compile` agent action (registry entry + strategy)
- Vault-scope context extraction for `/challenge` and `/emerge`
- Librarian agent session type with specialized prompt
- Canvas action bar component for discoverability
- Subtle visual provenance treatment on canvas cards, editor, and graph

**Out of scope:**
- Auto-launching agents (user-initiated only)
- Web clipper / browser extension for source ingestion
- RAG / vector database (vault scale stays in LLM context window range)
- New panels or tabs (no Q&A panel, no vault health panel)
- Chat interface (terminal-native Q&A only)
- Redesign of existing pill/button aesthetic across the app (separate initiative, but new elements follow the refined standard)

## Design Decisions

| Decision | Rationale |
|---|---|
| Flat vault with provenance metadata over separate directories | Simpler data model. Ontology handles visual separation. No structural opinion forced on the user. |
| Terminal-native Q&A over dedicated panel | The input is just text. The innovation is the output contract, not the input mechanism. The canvas is for output (spatial awareness), not input. |
| "Thinking" via existing actions at vault scope over new lint feature | /challenge and /emerge already do what AK calls "linting." The gap is scope, not functionality. |
| Single-pass vault-scope context (summaries, not full bodies) | Keeps action runner consistent. Vault-scope is a scout, not a deep researcher. User runs scoped actions on flagged areas. |
| Librarian as a regular agent session, not a daemon | User-initiated only (validated design principle from Phase 1). Same tmux/HITL infrastructure. No new process type. |
| Canvas action bar over CMD+K-only discovery | CMD+K is a power-user escape hatch, not a product. Users need visible, labeled entry points. |
| Subtle typographic provenance indicators over pill badges | Consistent with the app's dark material aesthetic. Felt more than seen during normal use, readable when you look for it. |

---

## 1. Output Contract

The behavioral agreement between agents and the system. When an agent produces knowledge, it writes a vault artifact with structured frontmatter. The system automatically integrates it.

### Agent Side (enforced via system prompt)

When producing knowledge (answers, synthesis, compiled articles), the agent:
1. Writes a markdown file via MCP `vault.create_file`
2. Includes frontmatter with: `title`, `type`, `tags`, `origin: agent`, and `sources` (wikilink titles of cited/compiled material)
3. Names the file as a slugified title, placed at vault root or in a subdirectory matching the type

### System Side

Already works with minor additions:
- Vault watcher picks up the new file
- Parser extracts frontmatter into a typed Artifact
- Graph builder creates the node + edges from `sources` wikilinks
- Search engine indexes it
- The artifact is available for canvas placement

### Artifact Type Additions

```typescript
// Additions to Artifact in src/shared/types.ts
origin: 'human' | 'source' | 'agent'  // default 'human' when omitted
sources: string[]                       // wikilink titles this was derived from
```

- `human` -- written by the user. Default when `origin` is absent in frontmatter (backward compatible with all existing vault files).
- `source` -- raw ingested material (articles, papers, clips). Set by the user or ingestion tooling.
- `agent` -- produced by an agent (compiled article, Q&A answer, emerged connection, tension).

### New Edge Kind

`derived_from`: when the parser sees a `sources` field in frontmatter, graph-builder creates `derived_from` edges from the artifact to each cited source. This makes compilation lineage traversable in the graph.

Added to the existing edge kind union in `src/shared/types.ts` alongside `connection`, `cluster`, `tension`, `appears_in`, `related`, `co-occurrence`.

### System Prompt Template

New file: `.machina/agent-prompt.md`. Read by agent-spawner and prepended to every agent session launched from TE. Contains:
- The output contract instructions (when to write artifacts, frontmatter schema, naming conventions)
- Available MCP tools and their purpose
- The vault's conventions (artifact types, signal levels, tag structure)

User-editable. Ships with a sensible default. The default template is embedded in the app source (`src/main/services/default-agent-prompt.md`) and written to `.machina/agent-prompt.md` on vault initialization if it doesn't already exist. Same pattern for `.machina/librarian-prompt.md`.

### What Changes

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `origin` and `sources` to Artifact type. Add `derived_from` to edge kind union. |
| `src/shared/engine/parser.ts` | Extract `origin` (default `'human'`) and `sources` (default `[]`) from frontmatter. |
| `src/shared/engine/graph-builder.ts` | Create `derived_from` edges when `sources` is non-empty. |
| `src/main/services/agent-spawner.ts` | Read `.machina/agent-prompt.md` and prepend to agent session prompt. |
| `src/main/services/default-agent-prompt.md` | Default template embedded in source. Written to `.machina/agent-prompt.md` on vault init. |

---

## 2. Provenance System

Visual treatment of the `origin` field across canvas, editor, and graph. Answers "who made this?" at a glance.

### Sidebar File Tree Treatment

The file tree already has origin-based icon coloring (blue/green). This extends to the three-origin model:
- `human` -- default icon color (no modifier)
- `source` -- distinct icon color indicating raw material
- `agent` -- distinct icon color indicating LLM-produced content

The color choice must make it immediately obvious at a glance which files are sources, which are agent-compiled, and which are human-written. This is the primary place users scan to understand "what's in my vault and where did it come from." The agents must properly set the `origin` field in frontmatter (enforced by the output contract) so the file tree colors work automatically.

### Canvas Treatment

Different origins get distinct visual treatment on existing card components. Not a new card type. A subtle visual modifier:
- `human` -- default appearance, no modifier
- `source` -- subtle accent indicator (thin border accent or small typographic label)
- `agent` -- distinct subtle accent indicator, different from source

Implemented as a CSS class on the card component, keyed off the artifact's `origin` field. The treatment must be clean and integrated with the three-layer material model: thin accent lines, typographic cues, opacity shifts. Not pill badges or chunky borders.

### Editor Treatment

`FrontmatterHeader.tsx` shows the origin and links to source artifacts (from the `sources` field). Clicking a source link navigates to that artifact. Compilation lineage is browsable from the editor.

### Graph Treatment

In the graph panel, `origin` maps to node border style. Source nodes, agent nodes, and human nodes are visually distinguishable. Orthogonal to the existing `getArtifactColor(type)` fill coloring: origin affects border/shape, type affects fill.

### Ontology Integration

`ontology-grouping.ts` gains an optional origin-based grouping mode. When toggled, the ontology produces bounded regions for `source`, `agent`, and `human` artifacts. Uses the existing `GroupProvenance` infrastructure.

### What Changes

| File | Change |
|---|---|
| `src/renderer/src/panels/sidebar/` (file tree) | Extend existing origin icon coloring to three-origin model (human/source/agent). |
| `src/renderer/src/panels/canvas/` (card component) | Read `origin` from artifact, apply CSS class for visual treatment. |
| `src/renderer/src/design/tokens.ts` | Origin-specific accent tokens (icon colors, card accents for source and agent). |
| `src/renderer/src/panels/editor/FrontmatterHeader.tsx` | Display origin label and clickable source links. |
| `src/renderer/src/panels/graph/` (node renderer) | Border/shape variant by origin. |
| `src/shared/engine/ontology-grouping.ts` | Optional origin-based grouping mode. |

---

## 3. `/compile` Agent Action

Scoped, user-triggered compilation. Select source cards on canvas, trigger `/compile`, agent reads sources and produces structured wiki articles.

### Fits Existing Agent Action Architecture

One new registry entry + one new `ActionStrategy`. Same flow as all Phase 1 actions: trigger (CMD+K, context menu, or action bar) -> context extraction -> main process LLM call -> canvas mutation plan -> ghost preview -> apply.

### Registry Entry

```typescript
{
  id: 'compile',
  label: '/compile',
  description: 'Compile sources into wiki articles',
  requiresSelection: 1,
  keywords: ['compile', 'synthesize', 'wiki', 'article', 'summarize']
}
```

### Context Extraction

`/compile` needs richer context than other actions. In addition to selected cards + 1-hop neighbors:
- Full body content of all selected cards (not just title + tags)
- The vault's existing tag tree (so the agent categorizes consistently)
- Ghost index entries (so the agent resolves existing broken links rather than creating duplicates)

### Agent Output

The `CompileStrategy` prompt instructs the LLM to:
1. Read the selected source content
2. Identify key concepts, claims, and relationships
3. Produce a `CanvasMutationPlan` that adds:
   - New wiki article cards with full frontmatter (`origin: agent`, `sources: [...]`, appropriate `type` and `tags`)
   - `derived_from` edges from new articles back to source cards
   - `connection` edges between new articles where concepts relate
4. Position new cards near their source cards, offset to form a visible compiled cluster

Ghost preview works as-is. Apply/cancel and Cmd+Z undo are inherited from the Phase 1 pipeline.

### What Changes

| File | Change |
|---|---|
| `src/shared/agent-action-types.ts` | Add `compile` to `AGENT_ACTIONS` registry. |
| `src/main/services/agent-action-runner.ts` | Add `CompileStrategy` with prompt template and validation. |
| `src/renderer/src/panels/canvas/agent-context.ts` | Extend context extraction for `/compile` (full body, tag tree, ghost index). |

---

## 4. Vault-Scope Agent Actions

Existing `/challenge` and `/emerge` gain the ability to run against the full vault without card selection. The "thinking" phase of the knowledge loop.

### Two Modes Per Action

- **Scoped** (cards selected): Works exactly as today. Context is selected cards + 1-hop neighbors.
- **Vault-scope** (no selection): Broader context. Agent gets structural overview and decides where to focus.

### Vault-Scope Context (Single-Pass)

Vault-scope cannot serialize the entire vault into context. The strategy is a single-pass scout:

1. **Tag tree with counts** -- compact structural overview
2. **Ghost index** -- unresolved links sorted by reference count, top N
3. **Artifact summaries** -- title + type + signal + tags for every artifact (no body text). At ~100 bytes per artifact, a 500-artifact vault fits in ~50K tokens.

The agent produces higher-level output from this overview: tensions for contradictions, connection candidates, article stubs for high-frequency ghosts. The user then runs scoped actions on flagged areas for depth.

### Vault-Scope Output

The mutation plan produces:
- Tension cards for discovered contradictions or gaps
- Connection edges between existing cards
- Article stubs (ghost-resolving cards for high-frequency unresolved wikilinks)
- Positioned in an open area of the canvas, grouped by theme

### CMD+K Behavior

When nothing is selected:
- `/challenge` shows "Vault-wide: find contradictions and gaps"
- `/emerge` shows "Vault-wide: discover connections"

When cards are selected, shows "Challenge selected cards (N selected)" as today.

### What Changes

| File | Change |
|---|---|
| `src/shared/agent-action-types.ts` | Update `challenge` and `emerge` to `requiresSelection: 0`. |
| `src/main/services/agent-action-runner.ts` | Branch in `ChallengeStrategy` and `EmergeStrategy` for vault-scope context when no cards selected. |
| `src/renderer/src/panels/canvas/agent-context.ts` | New `buildVaultScopeContext()` assembling summaries + tag tree + ghosts. |

---

## 5. Librarian Agent

A Claude Code tmux session with a specialized system prompt and standing responsibilities. Not a daemon. Not auto-started. A task the user launches when they want vault maintenance.

### Responsibilities

1. **Detect unprocessed sources**: Find artifacts with `origin: source` and no inbound `derived_from` edges. Compile them.
2. **Maintain indexes**: Write/update an `_index.md` artifact summarizing the vault (articles by type, key concepts, recent additions).
3. **Vault-scale thinking**: Run the equivalent of `/challenge` and `/emerge` against vault summaries. Produce tension artifacts and connection candidates.
4. **Suggest next questions**: Based on gaps (high ghost counts, thin topic areas), suggest research directions as tension artifacts.

### How It's Spawned

From CMD+K or the canvas action bar: `/librarian` starts a session. Agent spawner reads `.machina/librarian-prompt.md` (user-editable, ships with default) and launches a tmux session with that prompt plus the standard output contract from `.machina/agent-prompt.md`.

### HITL Gating

All writes go through the existing HITL gate. The librarian proposes file creations, the user approves or denies. Gating infrastructure is unchanged.

### Session Lifetime

The librarian runs until done or killed. It's a task, not a daemon: "review the vault, compile what's new, flag what's inconsistent, update the index." When finished, the session ends and activity is captured as a session artifact. The user re-launches when needed (e.g., after adding a batch of sources, after a Q&A session).

### System Prompt Structure

`.machina/librarian-prompt.md`:

```markdown
# Librarian

You are the librarian for this knowledge vault. Your job is to maintain,
compile, and enhance the knowledge base.

## Tools
- vault.read_file, search.query, graph.get_neighbors, graph.get_ghosts (reads)
- vault.create_file, vault.write_file (writes, HITL gated)

## Standing Responsibilities
1. Find source artifacts with no compiled derivatives. Compile them into
   structured wiki articles with proper frontmatter.
2. Review the vault for contradictions and gaps. Write tension artifacts.
3. Discover connections between articles. Create connection edges.
4. Update _index.md with a current vault summary.
5. Suggest research directions based on coverage gaps.

## Output Contract
All output follows the standard output contract in agent-prompt.md.
Every artifact you create must have origin, type, tags, and sources
in frontmatter.
```

### What Changes

| File | Change |
|---|---|
| `.machina/librarian-prompt.md` | New template file (user-editable, ships with default). |
| `src/shared/agent-action-types.ts` | Add `librarian` to registry (CMD+K launchable). |
| `src/main/services/agent-spawner.ts` | When action is `librarian`, read librarian prompt and prepend to session. |

---

## 6. Canvas Action Bar

The visible, intuitive entry point for the entire knowledge loop. Integrated into the canvas view header. This is how users discover, understand, and drive the workflow.

### Actions

Three labeled actions, right-aligned in the canvas header:
- **Compile** -- click to compile selected source cards. Shows inline count of unprocessed sources when they exist. Hidden entirely when no sources are in the vault.
- **Think** -- opens a small inline menu with two choices: "Challenge" (find contradictions/gaps) and "Emerge" (discover connections). When cards are selected, scopes to selection. Keeps the two actions distinct (different prompts, different output) while presenting them under a single conceptual umbrella.
- **Librarian** -- launches the librarian agent. Shows running indicator when active. Hidden when no vault content exists.

### Design Treatment

These are typographic actions integrated into the header, consistent with the app's dark material layer system:
- Text labels at reduced opacity that brighten on hover
- Hairline separators or spacing, not pill borders or button backgrounds
- Count indicator as a small inline numeral in the accent color, not a badge
- Librarian running state as a subtle animated indicator (slow pulse or thin underline), not a spinner
- The bar is the same material layer as the canvas tab bar

### Interaction States

- **Default**: Muted text, part of the header chrome
- **Hover**: Text brightens subtly
- **Active/running** (librarian): Thin accent underline or gentle pulse
- **Not applicable**: Hidden entirely. Dark cockpit: if there's nothing to do, don't show it.

### Contextual Intelligence

- Compile is only visible when `origin: source` artifacts exist in the vault
- Count updates live as sources are added/compiled
- Think inline menu reflects scope based on canvas selection state
- Librarian reflects active session state from tmux monitor

### What Changes

| File | Change |
|---|---|
| `src/renderer/src/panels/canvas/CanvasView.tsx` | Mount action bar in canvas header. |
| `src/renderer/src/panels/canvas/CanvasActionBar.tsx` | New component. Reads vault-store, canvas-store, agent store. |
| `src/renderer/src/design/tokens.ts` | Action bar typography and interaction state tokens. |

---

## Implementation Order

```
Step 1: Output Contract
  ├── Artifact type additions (origin, sources)
  ├── Parser extraction
  ├── Graph builder (derived_from edges)
  ├── Agent prompt template (.machina/agent-prompt.md)
  └── Agent spawner reads prompt template

Step 2: Provenance System
  ├── Sidebar file tree icon coloring (three-origin model)
  ├── Canvas card visual treatment (CSS class by origin)
  ├── Design tokens for origin accents (icon colors + card accents)
  ├── Editor frontmatter header (origin + source links)
  ├── Graph node border/shape by origin
  └── Ontology origin-based grouping mode

Step 3: /compile Agent Action
  ├── Registry entry in agent-action-types.ts
  ├── CompileStrategy in agent-action-runner.ts
  └── Extended context extraction (full body, tags, ghosts)

Step 4: Vault-Scope Agent Actions
  ├── Update requiresSelection to 0 for challenge/emerge
  ├── Vault-scope context builder (summaries + tags + ghosts)
  └── Strategy branching for scoped vs vault-scope

Step 5: Librarian Agent
  ├── Librarian prompt template (.machina/librarian-prompt.md)
  ├── Registry entry for CMD+K launch
  └── Spawner reads librarian prompt

Step 6: Canvas Action Bar
  ├── CanvasActionBar.tsx component
  ├── Mount in CanvasView header
  ├── Design tokens for action bar states
  └── Wire to vault-store, canvas-store, agent store
```

## New Files Summary

| File | Purpose |
|---|---|
| `src/main/services/default-agent-prompt.md` | Default system prompt template, written to `.machina/agent-prompt.md` on vault init |
| `src/main/services/default-librarian-prompt.md` | Default librarian prompt, written to `.machina/librarian-prompt.md` on vault init |
| `src/renderer/src/panels/canvas/CanvasActionBar.tsx` | Canvas action bar component |

## Modified Files Summary

| File | Change |
|---|---|
| `src/shared/types.ts` | `origin`, `sources` on Artifact. `derived_from` edge kind. |
| `src/shared/engine/parser.ts` | Extract `origin` and `sources` from frontmatter. |
| `src/shared/engine/graph-builder.ts` | Create `derived_from` edges from `sources`. |
| `src/shared/agent-action-types.ts` | Add `compile` and `librarian`. Update `challenge`/`emerge` to `requiresSelection: 0`. |
| `src/main/services/agent-action-runner.ts` | `CompileStrategy`. Vault-scope branching in `ChallengeStrategy`/`EmergeStrategy`. |
| `src/main/services/agent-spawner.ts` | Read prompt templates and prepend to sessions. |
| `src/renderer/src/panels/canvas/agent-context.ts` | `/compile` context + `buildVaultScopeContext()`. |
| `src/renderer/src/panels/canvas/CanvasView.tsx` | Mount `CanvasActionBar`. |
| `src/renderer/src/design/tokens.ts` | Origin accent tokens (icon colors + card accents). Action bar state tokens. |
| `src/renderer/src/panels/sidebar/` (file tree) | Extend origin icon coloring to three-origin model. |
| `src/renderer/src/panels/canvas/` (card CSS) | Origin-based visual class on cards. |
| `src/renderer/src/panels/editor/FrontmatterHeader.tsx` | Origin label + clickable source links. |
| `src/renderer/src/panels/graph/` (node renderer) | Border/shape by origin. |
| `src/shared/engine/ontology-grouping.ts` | Optional origin-based grouping mode. |
