# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Electron app with HMR
npm run dev:debug    # Dev with CDP debugging port (REMOTE_DEBUGGING_PORT=9222)
npm run build        # Typecheck + build all (main, preload, renderer)
npm run build:mac    # Build + package for macOS
npm test             # Run all tests (vitest)
npm run test:watch   # Vitest in watch mode
npm run test:e2e     # Build + run Playwright e2e tests
npm run test:live    # CDP health checks against running dev app
npm run check        # lint + typecheck + test (quality gate)
npm run typecheck    # Check both node and web tsconfigs
npm run lint         # ESLint (flat config)
npm run format       # Prettier
npm run package      # Fast local .app build (no typecheck, no DMG)
npm run package:install  # Package + copy to /Applications
npm run mcp-server   # Build + run headless MCP CLI server
```

Run a single test file: `npx vitest run path/to/file.test.ts`

**npm workaround**: Cache has root-owned files. Use `--cache /tmp/npm-cache-te` for installs.

## Architecture

Electron app with three process boundaries:

```text
Main Process (Node.js)          Preload (Bridge)           Renderer (Browser)
─────────────────────           ────────────────           ──────────────────
src/main/                       src/preload/               src/renderer/src/
├── index.ts (entry)            └── index.ts               ├── main.tsx (entry)
├── ipc/ (handlers)                exposes                 ├── App.tsx (shell)
│   ├── filesystem.ts              window.api              ├── store/ (Zustand)
│   ├── config.ts                  with typed              ├── engine/ (re-exports shared)
│   ├── watcher.ts                 namespaces              ├── hooks/
│   ├── documents.ts                                       ├── panels/ (UI sections)
│   ├── workbench.ts                                       └── design/ (tokens, primitives)
│   ├── shell.ts
│   ├── canvas.ts
│   ├── mcp.ts
│   └── agents.ts
└── services/
    ├── document-manager.ts    # Owns all open file content
    ├── file-service.ts        # Atomic disk I/O
    ├── vault-watcher.ts       # chokidar file watching
    ├── vault-indexing.ts      # Full vault index build
    ├── vault-query-facade.ts  # Query layer for MCP
    ├── mcp-server.ts          # MCP tool definitions
    ├── mcp-lifecycle.ts       # MCP server lifecycle management
    ├── hitl-gate.ts           # HITL dialog, timeout gate, write rate limiter
    ├── path-guard.ts          # Path traversal prevention
    ├── shell-service.ts
    ├── agent-spawner.ts       # Agent process spawning (tmux)
    ├── tmux-service.ts        # tmux session management
    ├── tmux-monitor.ts        # Live tmux observation
    ├── tmux-paths.ts          # tmux socket/log path helpers
    ├── session-tailer.ts      # Tails agent session logs
    ├── session-router.ts      # Routes session events
    ├── session-utils.ts       # Session parsing helpers
    ├── project-watcher.ts     # Project directory watching
    ├── project-session-parser.ts
    ├── session-milestone-grouper.ts
    ├── quit-coordinator.ts    # 2-phase coordinated quit
    ├── gitignore-filter.ts    # Respects .gitignore for indexing
    ├── event-batcher.ts       # Generic event batching
    └── audit-logger.ts        # MCP write audit log

src/shared/                    ← importable from ALL three processes
├── ipc-channels.ts            # Canonical typed IPC contract
├── types.ts                   # Core domain types (Artifact, KnowledgeGraph)
├── canvas-types.ts            # Canvas file format, node/edge types
├── canvas-mutation-types.ts   # Snapshot-and-plan canvas mutation ops
├── workbench-types.ts         # Session events, milestones
├── agent-types.ts
├── system-artifacts.ts        # Session/pattern/tension artifact schemas
├── constants.ts               # TE_DIR (.machina / .machina-dev)
├── format-elapsed.ts          # Duration formatting utility
└── engine/                    # Pure domain kernel (no Electron/React deps)
    ├── parser.ts              # Markdown → Artifact
    ├── graph-builder.ts       # Artifacts → KnowledgeGraph
    ├── ghost-index.ts         # Unresolved wikilink ghosts
    ├── indexer.ts             # VaultIndex for MCP queries
    ├── search-engine.ts       # MiniSearch wrapper
    ├── tag-index.ts           # Hierarchical tag tree
    ├── concept-extractor.ts   # Concept extraction from content
    ├── ontology-types.ts      # Semantic grouping types + agent contract
    ├── ontology-grouping.ts   # Tag-first card grouping algorithm
    ├── ontology-layout.ts     # Group frame + card position computation
    ├── project-map-types.ts   # Folder → canvas node/edge types
    ├── project-map-analyzers.ts # Import/reference extraction
    ├── rename-links.ts        # Wikilink rename across vault
    ├── id-generator.ts        # Deterministic ID generation
    └── posix-path.ts          # Cross-platform path normalization
```

**Shared engine kernel**: `src/shared/engine/` has zero Electron or React dependencies. Both the main process (MCP server, vault indexing) and the renderer (Web Worker) import these same modules. Engine code must stay dependency-free.

**Renderer `src/renderer/src/engine/`** re-exports from `@shared/engine/` for convenience. Canonical implementations live in `src/shared/engine/`.

### Dev/Prod State Separation

`TE_DIR` in `src/shared/constants.ts` resolves to `.machina-dev` during `npm run dev` and `.machina` in production/tests. This prevents development from corrupting production vault state.

### Path Aliases

| Alias | Resolves to | Available in |
|---|---|---|
| `@shared/*` | `src/shared/*` | main, preload, renderer |
| `@renderer/*` | `src/renderer/src/*` | renderer only |
| `@engine/*` | `src/renderer/src/engine/*` | renderer only |

### IPC Pattern

`typedHandle('channel', handler)` in main, `typedInvoke('channel', args)` in preload, `window.api.namespace.method()` in renderer. Namespaces: `fs`, `vault`, `config`, `document`, `window`, `shell`, `workbench`, `terminal`, `agent`, `canvas`, `on` (events).

**Adding a new IPC channel (4 steps):**
1. Declare in `IpcChannels` or `IpcEvents` in `src/shared/ipc-channels.ts`
2. Register `typedHandle(...)` in the appropriate `src/main/ipc/*.ts` file
3. Expose in `src/preload/index.ts` under the right namespace
4. Call via `window.api.namespace.method()` in renderer

TypeScript catches mismatches at every step since all four sites are bound to the same generic map.

### Data Flow: Vault File Changes

```
Disk (chokidar) → vault-watcher.ts (batches events)
  → IPC: vault:files-changed-batch
  → vault-event-hub.ts (single IPC crossing, fans out to subscribers)
  → App.tsx batch subscriber → useVaultWorker (Web Worker)
  → vault-worker.ts: parseArtifact + buildGraph off main thread
  → postMessage WorkerResult → vault-store.setWorkerResult (atomic update)
```

### Data Flow: Document Editing

```
User types → editor-store.setContent (dirty=true)
  → window.api.document.update (IPC: doc:update)
  → DocumentManager (authoritative content, 1s autosave debounce)
  → file-service.ts (atomic write to disk)
  → vault-watcher sees change → suppressed via _pendingWrites (no echo)
```

Content pushes happen in user-action callbacks (`handleUpdate`, `onFrontmatterChange`), never via useEffect.

### DocumentManager (main process)

Single owner of all open file content. Renderer views are thin IPC clients via `useDocument(path)` hook.

- `doc:open/close/update/save/get-content` channels; `doc:external-change/conflict/saved` events
- Autosave: 1s debounce per Document. Self-write suppression via `_pendingWrites` set.
- Conflict detection: content comparison (not just mtime) for cloud sync compatibility

### Knowledge Engine

Parses markdown into typed Artifacts and builds a KnowledgeGraph:
- **parser.ts**: gray-matter frontmatter (JS engine disabled) into Artifact. Extracts `[[wikilinks]]` into `bodyLinks`. Title: frontmatter TITLE > first H1 > filename stem.
- **graph-builder.ts**: Artifacts into nodes + edges. Six edge types: `connection`, `cluster`, `tension`, `appears_in`, `related`, `co-occurrence`. Edge provenance tracks source (frontmatter, wikilink, co-occurrence, agent, manual).
- **ghost-index.ts**: Builds ghost entries (unresolved wikilinks) sorted by reference count, filters path-style ghosts.
- **vault-worker.ts**: Web Worker for bulk parse + graph build with incremental updates.
- **graph-physics-worker.ts**: D3-force simulation off main thread for graph panel.
- **vault-event-hub.ts**: Singleton dispatching batched watcher events to three subscriber tiers (batch, any-file, path-specific).
- **search-engine.ts**: MiniSearch (title x10, tags x5, body x1).
- **tag-index.ts**: Hierarchical tag tree with aggregate counts.
- **rename-links.ts**: Updates wikilinks across vault when an artifact is renamed.

### Canvas Mutations (Snapshot-and-Plan)

Canvas changes from automated sources (folder map, ontology, agents) use optimistic concurrency:
1. `canvas:get-snapshot` returns current file + mtime
2. Build a `CanvasMutationPlan` (defined in `canvas-mutation-types.ts`) with add/move/resize/remove ops
3. `canvas:apply-plan` sends plan + `expectedMtime`; rejects with `'stale'` if file changed since snapshot
4. `filterCanvasAdditions()` deduplicates nodes/edges against existing canvas state

### Ontology System

Semantic grouping layer that organizes canvas cards into bounded regions:
- **ontology-grouping.ts**: Tag-first algorithm groups cards by shared tags, with link-analysis fallback
- **ontology-layout.ts**: Computes `GroupFrame` positions and card placement within groups
- **ontology-types.ts**: `OntologySnapshot` (semantic layer) + `OntologyLayoutResult` (geometry). `GroupProvenance` tracks whether grouping came from user tags, link analysis, or AI inference
- **ontology-worker.ts**: Web Worker for off-thread grouping + layout computation
- **OntologyPreview.tsx / SectionOverlay.tsx**: Visual rendering of group regions on canvas

### Project Map

Visualizes folder structure as canvas cards with import/reference edges:
- **project-map-types.ts**: `ProjectMapSnapshot` with `contains`/`imports`/`references` edge kinds
- **project-map-analyzers.ts**: Extracts imports and references from source files
- **project-map-worker.ts**: Web Worker for filesystem analysis
- **folder-map-orchestrator.ts**: Coordinates snapshot → layout → canvas mutation plan pipeline

### System Artifacts

Structured markdown documents stored in `.machina/artifacts/{sessions,patterns,tensions}/`:
- **Session artifacts**: Track Claude Code session activity (files touched, commands run, milestones)
- **Pattern artifacts**: Reusable workflows with terminal launch specs
- **Tension artifacts**: Open questions/hypotheses with evidence tracking
- Schemas and rendering in `src/shared/system-artifacts.ts`

### MCP Server

Exposes vault to AI agents via Model Context Protocol:
- Six tools: `vault.read_file`, `search.query`, `graph.get_neighbors`, `graph.get_ghosts` (reads); `vault.write_file`, `vault.create_file` (writes gated by TimeoutHitlGate → ElectronHitlGate + WriteRateLimiter). TimeoutHitlGate auto-denies after 30s when no user response (prevents agent stalls when app is backgrounded).
- Read results wrapped in Spotlighting trust markers for prompt injection mitigation
- `mcp-cli.ts` provides headless stdio mode for Claude Desktop integration
- `mcp-lifecycle.ts` manages server start/stop lifecycle

### Terminal Webview Isolation

The terminal panel runs inside an Electron `<webview>` tag with its own preload (`src/preload/terminal-webview.ts`) and HTML entry (`src/renderer/terminal-webview/index.html`). This keeps xterm.js rendering and PTY data off the main renderer thread. The webview communicates with the main process via its own IPC bridge, separate from the main renderer's `window.api`.

### Agent System

Agents are spawned as tmux sessions via `agent-spawner.ts`. The system includes:
- **tmux-service.ts / tmux-monitor.ts**: Session management and live observation
- **session-tailer.ts**: Tails agent session logs in real-time, emits `SessionMilestone` events
- **session-router.ts / session-milestone-grouper.ts**: Routes and groups session events into milestones
- **use-agent-observer.ts / use-agent-states.ts**: Renderer hooks for agent lifecycle
- IPC namespace: `window.api.agent` with `agent:get-states`, `agent:spawn` channels

### Workbench Panel

Live session monitoring and system artifact management:
- **WorkbenchPanel.tsx**: Displays session thread, milestones, and system artifact cards
- **SessionThreadPanel.tsx**: Real-time view of active Claude session activity
- **workbench-artifacts.ts**: Generates system artifact content from session data
- **workbench-artifact-placement.ts**: Positions artifact cards on canvas
- **workbench-migration.ts**: Migrates older workbench state formats

### Coordinated Quit (2-phase)

```
before-quit → event.preventDefault
  → typedSend(mainWindow, 'app:will-quit')
  → renderer flushes vault state + canvas + dirty docs
  → signals app:quit-ready
  → main: documentManager.flushAll() + service cleanup
  → app.quit()
```

### Web Workers

Heavy computation runs off the renderer main thread:
- **vault-worker.ts**: Bulk markdown parse + graph build (incremental updates via `WorkerCommand`)
- **graph-physics-worker.ts**: D3-force simulation for graph panel layout
- **ontology-worker.ts**: Card grouping + group frame layout computation
- **project-map-worker.ts**: Filesystem analysis for folder-to-canvas mapping

### Canvas System (`src/renderer/src/panels/canvas/`)

Infinite pan-zoom canvas (Pixi.js 8) with typed cards and edges. Nine card types: `text`, `note`, `terminal`, `code`, `markdown`, `image`, `pdf`, `project-file`, `system-artifact`. Pointer-events gating (click to focus, click again to interact).

### Panel Architecture

KeepAlive pattern: panels are mounted once on first visit, then hidden via `display: none` on tab switch (preserves terminal state). Heavy panels (Canvas, Workbench, GraphView, Ghosts) use `React.lazy` imports.

### State Management (Zustand)

- **vault-store**: Files, artifacts, graph, vault path/config/state, fileToId map
- **editor-store**: Active note, mode (rich|source), dirty state, content, cursor, tabs, nav history
- **canvas-store**: Nodes, edges, viewport, selection, split editor state
- **canvas-autosave**: Debounced canvas file persistence
- **graph-view-store**: Viewport, hover/selected node, force params
- **ui-store**: Per-note UI state (backlink expansion), persisted via IPC
- **tab-store**: View tabs, persisted state
- **view-store**: Active panel/view routing
- **settings-store**: Theme, accent, fonts (localStorage)
- **sidebar-filter-store**: File tree filtering state
- **workbench-store / workbench-actions-store**: Session monitoring and workbench UI state

**Persistence**: `vault-persist.ts` gathers state from stores and writes to `.machina/state.json` via IPC on 1s debounce. See "Coordinated Quit" above for shutdown sequence.

### Rich Text Editor

Tiptap 3 with markdown round-tripping. Extensions: slash commands, bubble menu, callouts (`> [!TYPE]`), highlights (`==text==`), concept nodes (`<node>term</node>`), wikilinks (`[[title]]` with CMD+click navigate), mermaid diagrams, drag handles. Only ship block types with clean markdown round-trip.

### Design System

Three-layer material model: canvas void (darkest), cards (semi-transparent with blur), glass overlays (floating UI). Six themes, eight accent colors. OKLCH perceptual palette.

- Import from `design/tokens.ts`, never hardcode hex or px values
- Theme-aware values use CSS variables (`--color-bg-base`, `--color-text-primary`, `--color-accent-default`, etc.)
- Use `getArtifactColor(type)` for per-type colors
- Animation keyframes prefixed `te-` (e.g., `te-fade-in`, `te-slide-up`)

## Type Conventions

- **`Result<T>`**: Engine returns `{ ok: true; value: T } | { ok: false; error: string }` instead of throwing. Defined in `src/shared/engine/types.ts`.
- **Branded types**: `SessionId = string & { readonly __brand: 'SessionId' }` with constructor `sessionId(id)`. Prevents mixing IDs at compile time.
- **Enum-like constants**: `as const` arrays with derived union type and `satisfies Record<...>` for exhaustiveness.

## Testing

- **Unit**: Vitest with happy-dom (1650+ tests, 158 files). `tests/` mirrors `src/` for pure logic; `src/**/__tests__/` for colocated component tests.
- **Integration**: Override with `// @vitest-environment node` at file top for tests needing real Node APIs.
- **Store tests**: Reset via `store.setState(store.getInitialState())` in `beforeEach`.
- **E2E**: Playwright with `workers:1`, `test.describe.serial`, `beforeAll/afterAll` lifecycle. Test vault at `e2e/fixtures/test-vault/`.
- **Live**: CDP connection to running app via `test:live`.
- **Quality gate**: `npm run check` must pass clean (zero lint errors, zero type errors).

## Code Style

- **Prettier**: single quotes, no semicolons, 100 char width
- **TypeScript**: Strict mode. `_`-prefixed names exempt from unused-vars lint.
- **Tailwind v4**: Via Vite plugin. Token system in `design/tokens.ts`.
- **Immutable data**: Return new copies, never mutate in-place.
- **Files under 800 lines**, organized by feature/domain.
- **IPC timeouts**: Wrap critical IPC calls with `withTimeout(call, ms, label)` to prevent renderer hangs.
- **Buffer shim**: `main.tsx` shims `globalThis.Buffer` before gray-matter import. Renderer lacks Node globals; this polyfill is required for frontmatter parsing in the browser context.

## Compact Instructions

Always preserve:
- IPC channel contracts and which process owns each responsibility (main vs renderer vs preload)
- Active plan file paths, current step, and completion status
- Architectural decisions about process boundaries and data flow
- Verification evidence (test output, build results, type-check results)
- Error corrections and root causes, especially IPC or Electron-specific issues
- Design system token values and theme decisions
