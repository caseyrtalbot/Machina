# Architecture Overview

Machina is a local-first Electron app: a governed agent workbench over a markdown vault on disk. Three agent surfaces converge on one attribution and approval layer, alongside a rich editor, knowledge graph, spatial canvas, and embedded terminal, all built around one pure knowledge engine. This document is the end-to-end map for anyone evaluating or contributing to the codebase.

## Process model

Electron gives us three process boundaries plus a shared layer imported by all of them:

| Process | Entry | Owns |
|---------|-------|------|
| Main (Node.js) | `src/main/index.ts` | IPC handlers (`src/main/ipc/`), services (`src/main/services/`): file watching, document ownership, PTYs, agents, MCP |
| Preload (bridge) | `src/preload/index.ts` | Exposes `window.api` with typed namespaces; the only path between renderer and main |
| Renderer (browser) | `src/renderer/src/main.tsx` | React app: `panels/`, `hooks/`, `store/`, `design/`, Web Workers |
| Shared | imported by all | `src/shared/`: types, IPC contracts, and the pure engine kernel |

Dev and production state never collide: `TE_DIR` (`src/shared/constants.ts`) resolves to `.machina-dev` in dev and `.machina` in production and tests.

### Typed IPC

Every channel is declared once and type-checked at all four sites:

1. Declare the channel in `IpcChannels` or `IpcEvents` (`src/shared/ipc-channels.ts`)
2. Register `typedHandle('channel', handler)` in the matching `src/main/ipc/*.ts` file
3. Expose it in `src/preload/index.ts` under the right namespace
4. Call `window.api.namespace.method()` in the renderer

All four bind to the same generic map, so a signature mismatch is a compile error, not a runtime surprise. Critical calls wrap in `withTimeout(call, ms, label)` to keep the renderer from hanging on a stuck main process.

## Engine kernel

`src/shared/engine/` is a dependency-free TypeScript kernel: zero Electron, zero React, zero DOM. Both the main process and renderer Web Workers import it directly (`src/renderer/src/engine/` re-exports it as `@engine/*`).

The core pipeline:

```
markdown files
  -> parser.ts          (gray-matter frontmatter, JS execution disabled)
  -> graph-builder.ts   (7 relationship kinds, each with provenance)
  -> ghost-index.ts     (unresolved [[wikilinks]] become ghost nodes)
  -> search-engine.ts   (MiniSearch: title x10, tags x5, body x1; PDF page hints)
```

Other kernel modules follow the same rule (pure functions, `Result<T>` instead of throws): `block-detector.ts` and `block-model.ts` for the terminal Block Protocol, `secrets.ts` for pattern-based secret scanning, `pdf-extractor.ts` for per-page PDF text, `ontology-grouping.ts` for tag-first clustering, `unlinked-mentions.ts` for backlink suggestions.

Purity is what lets the same code run in four Web Workers without ceremony:

| Worker | File | Computes |
|--------|------|----------|
| Vault | `src/renderer/src/engine/vault-worker.ts` | Parse + graph build + search index, off the main thread |
| Graph physics | `src/renderer/src/engine/graph-physics-worker.ts` | D3-force layout for the Pixi graph view |
| Ontology | `src/renderer/src/panels/canvas/ontology-worker.ts` | Grouping + layout for canvas ontology |
| Project map | `src/renderer/src/workers/project-map-worker.ts` | Filesystem tree to canvas folder maps |

## Data flows

### Vault file changes

Disk is the source of truth; everything downstream reacts to it.

```
Disk (chokidar) -> vault-watcher.ts (main, batches changes)
  -> IPC: vault:files-changed-batch
  -> vault-event-hub.ts (renderer, fans out)
  -> useVaultWorker -> vault-worker.ts (parse + graph, off main thread)
  -> postMessage -> vault-store.setWorkerResult (one atomic store update)
```

### Document editing

`DocumentManager` (`src/main/services/document-manager.ts`) is the single owner of all open file content. Renderer views are thin IPC clients via `useDocument(path)`.

```
User types -> editor-store.setContent (dirty=true)
  -> window.api.document.update -> DocumentManager (1s autosave debounce)
  -> file-service.ts (atomic write)
  -> vault-watcher self-echo suppressed via _pendingWrites
```

Conflict detection compares content, not mtime, so cloud-synced vaults (iCloud, Dropbox) don't trigger false conflicts. External changes and conflicts surface as `doc:external-change` / `doc:conflict` events. Content pushes happen in user-action callbacks, never in `useEffect`.

### Canvas mutations: snapshot-and-plan

Automated canvas changes (folder maps, ontology, agents) use optimistic concurrency instead of locks:

1. `canvas:get-snapshot` returns the current file plus its mtime
2. The caller builds a `CanvasMutationPlan` (`src/shared/canvas-mutation-types.ts`) of add/move/resize/remove ops
3. `canvas:apply-plan` carries `expectedMtime` and rejects with `'stale'` if the file changed underneath
4. `filterCanvasAdditions()` deduplicates against existing state

A rejected plan is cheap to rebuild from a fresh snapshot; a corrupted canvas is not.

## Agents

Three surfaces, with deliberately different trust models.

### Native agent (in-app)

`src/main/services/machina-native-agent.ts` runs a tool loop on `@anthropic-ai/sdk` (`messages.stream`) over twelve vault and canvas tools (`machina-native-tools.ts`). The decision to stay on the raw SDK rather than the Claude Agent SDK is recorded in [ADR 0001](adr/0001-native-agent-stays-on-anthropic-sdk.md).

Its writes are guarded in depth, summarized here at a high level:

- Per-write human approval (HITL), and the per-run write-velocity limiter forces approval even when auto-accept is on
- Path validation (PathGuard's `resolveInVault`) confines reads and writes to the vault, including symlink and traversal attempts
- Every successful write lands in an append-only audit log; note writes additionally stamp provenance (`modified_by` / `modified_at`) via the shared `writeStampedNote` helper (`src/main/utils/note-write.ts`)

### CLI agent threads

`src/main/services/cli-thread-spawner.ts` spawns `claude`, `codex`, or `gemini` CLIs in per-thread PTYs with session continuity (resume support). These run at the user's own trust level: the CLIs bring their own permission models, so Machina does not pre-gate them. Their workspace writes are contained after the fact: each turn's filesystem writes are attributed (`cli-turn-registry.ts` + `agent-write-watcher.ts`) and queued for review in the approvals tray — approving records a commit with `Machina-Agent`/`Machina-Session` trailers, rejecting reverts the files via git, and `git-service.ts:revertAgent` undoes an agent's approved commits wholesale. `pty-monitor.ts` keeps live agent state (`agent:get-states` / `agent:states-changed`) for presence badges.

### MCP server

`src/main/services/mcp-server.ts` registers nine distinct tools: six reads and three writes (`vault.write_file`, `vault.create_file`, `canvas.apply_plan`); the three `vault.*` tools are additionally registered under `workspace.*` aliases (same handlers — the invoked name flows into the Spotlighting envelope and gate prompt). Writes only register when a HITL gate is supplied; `mcp-lifecycle.ts` supplies a `QueueHitlGate` that rides the global approval queue — write approvals appear as gate-confirm rows in the approvals tray, failing closed after 30 seconds with no response — plus a `WriteRateLimiter`. The headless stdio CLI (`src/main/mcp-cli.ts`) passes no gate and therefore stays reads-only.

In production the server is live over an in-process Streamable HTTP transport bound to 127.0.0.1 (default port 41627, path `/mcp`), started from `src/main/index.ts`. Raw-content read tools wrap results in Spotlighting trust markers so downstream models can distinguish vault content from instructions. Transport rationale and the localhost hardening details are in [ADR 0002](adr/0002-in-process-mcp-streamable-http.md).

## Block Protocol

The embedded terminal converts raw PTY bytes into structured command blocks. Shell hooks (`resources/shell-hooks/te.{zsh,bash,fish}`) emit OSC `1337;te-...` markers around prompts and commands; the pure `BlockDetector` parses them, `BlockWatcher` (main) folds events into immutable `Block` snapshots, and `block:update` IPC events feed the renderer's `block-store`. Blocks are pinnable to the canvas as `terminal-block` cards, with secret spans masked at render time. Hooks no-op without `TE_SESSION_ID`, so they are safe in shared rc files, and a missing hook degrades to a plain terminal, never fake blocks.

Full wire format, throttling, and degraded-mode behavior: [block-protocol.md](block-protocol.md).

## Renderer shell

`AgentShell.tsx` (`src/renderer/src/panels/agent-shell/`) composes the fixed shell: titlebar (drag region, breadcrumb, approvals tray, panel toggles) → left `ThreadSidebar` → fixed-width chat column (`ThreadPanel`) → center `SurfaceDock` (per-thread dock tabs, kinds `canvas|editor|graph|ghosts|health`, plus bottom `TerminalStrip`) → right `SideDockRibbon` icon rail → `Statusbar`. Floating: `CommandPalette`, `HarnessGallery`, dialogs. Dock tabs are keyed per thread (`dock-store.dockTabsByThreadId`).

KeepAlive: panels mount once, then `display: none` on tab switch (preserves terminal state); heavy panels (Canvas, GraphView, Ghosts) load via `React.lazy`. The canvas is React DOM under a CSS-transform pan-zoom layer with 12 card types (`CanvasNodeType`, `src/shared/canvas-types.ts`); Pixi.js drives only the graph view. Tab rows render through the shared `TabBar` primitive; overlays through the shared `Modal`/`Overlay` primitive (`src/renderer/src/components/`).

## State management

Renderer state lives in Zustand stores (`src/renderer/src/store/`), each owning one domain:

| Store | Owns |
|-------|------|
| `vault-store` | Files, artifacts, graph, vault path/config, fileToId map |
| `editor-store` | Note identity for the singleton editor surface: active note, open note tabs, preview tab, mode, dirty, content, cursor, nav history |
| `dock-store` | Per-thread dock tabs + active index + collapse, `openNoteInEditor` helper, dock-state seed/validate/flush |
| `canvas-store` | Per-canvas factory (`createCanvasStore()`): nodes, edges, viewport, selection, split editor |
| `graph-view-store` | Graph viewport, hover/selected node, force params |
| `thread-store` | Threads, messages, streaming, chat layout, in-flight + runId per thread |
| `block-store` | Per-session ordered terminal `Block` records |
| `ui-store` | Per-note UI state (backlink expansion), persisted via IPC |
| `settings-store` | Editor mode, autosave interval, spell check, graph edge/node brightness, template + daily-note + canvas-save folders, semantic-search opt-in (localStorage, persist v15; all appearance axes deleted per ADR 0005) |
| `claude-status-store` | Claude CLI availability/status |
| `sidebar-filter-store`, `sidebar-selection-store` | Sidebar file-tree filter and selection |
| `vault-health-store` | Vault health monitor results |
| `approvals-store` | Renderer mirror of main's ApprovalQueue: pending items, badge count, resolve |
| `agent-breaker-store` | Circuit-breaker mirror: tripped threads + signal-source flag |
| `agent-dispatch-store` | Thread start/dispatch status, harness launch guards |
| `cli-session-store` | Which live PTY backs each CLI thread (single source of truth) |
| `enrichment-run-store` | Graph enrichment run progress |
| `harness-store` | Synchronous harness summaries for the command palette |
| `terminal-strip-store` | Terminal strip sessions + active tab |

`canvas-store` is the exception to the singleton pattern: `createCanvasStore()` (`canvas-store.ts`) is a factory, and each canvas gets its own store instance, which is what makes real multi-canvas work. Persistence flows through `vault-persist.ts` to `.machina/state.json` on a 1s debounce, and a coordinated two-phase quit flushes dirty documents and canvas state before the app exits.

## Testing

- ~4,000 unit and integration tests (vitest + happy-dom), in `tests/` mirroring `src/` for pure logic and `src/**/__tests__/` for colocated component tests
- Tests needing real Node APIs opt in with `// @vitest-environment node`
- `npm run check` is the quality gate: lint + dual typecheck (node and web tsconfigs) + full test run, expected to pass clean
- Playwright e2e (`npm run test:e2e`) runs serially against a fixture vault in `e2e/fixtures/test-vault/`

The engine kernel's purity pays off here: parser, graph builder, search, block detector, and secret scanner all test as plain functions with no Electron harness.

## Further reading

- [Plan of record](../PLAN.md) — the only active plan; identity decision in [ADR 0003](adr/0003-canvas-becomes-a-document-type.md)
- [Block Protocol wire format](block-protocol.md)
- [ADR 0001: native agent stays on @anthropic-ai/sdk](adr/0001-native-agent-stays-on-anthropic-sdk.md)
- [ADR 0002: in-process MCP over Streamable HTTP](adr/0002-in-process-mcp-streamable-http.md)
