# AGENTS.md

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

Single test: `npx vitest run path/to/file.test.ts`

**npm workaround**: Cache has root-owned files. Use `--cache /tmp/npm-cache-te` for installs.

## Architecture

Electron app with three process boundaries plus shared pure logic:

| Process | Entry | Source |
|---------|-------|--------|
| Main (Node.js) | `src/main/index.ts` | IPC handlers (`ipc/`), services (`services/`) |
| Preload (Bridge) | `src/preload/index.ts` | Exposes `window.api` with typed namespaces |
| Renderer (Browser) | `src/renderer/src/main.tsx` | React app: `panels/`, `hooks/`, `store/`, `design/` |
| Shared | (imported by all) | `src/shared/` — types, IPC contracts, pure engine kernel |

**Engine kernel** (`src/shared/engine/`): Zero Electron/React dependencies. Both main process and renderer Web Workers import from here. Must stay dependency-free. `src/renderer/src/engine/` re-exports from `@shared/engine/`.

**Dev/prod isolation**: `TE_DIR` (`src/shared/constants.ts`) resolves to `.machina-dev` in dev, `.machina` in production/tests.

### Path Aliases

| Alias | Resolves to | Available in |
|---|---|---|
| `@shared/*` | `src/shared/*` | main, preload, renderer |
| `@renderer/*` | `src/renderer/src/*` | renderer only |
| `@engine/*` | `src/renderer/src/engine/*` | renderer only |

### IPC Pattern

`typedHandle('channel', handler)` in main → `typedInvoke('channel', args)` in preload → `window.api.namespace.method()` in renderer. Namespaces: `fs`, `vault`, `config`, `document`, `window`, `shell`, `workbench`, `terminal`, `agent`, `canvas`, `on` (events).

**Adding a new IPC channel (4 steps):**
1. Declare in `IpcChannels` or `IpcEvents` in `src/shared/ipc-channels.ts`
2. Register `typedHandle(...)` in the appropriate `src/main/ipc/*.ts` file
3. Expose in `src/preload/index.ts` under the right namespace
4. Call via `window.api.namespace.method()` in renderer

All four sites bind to the same generic map — TypeScript catches mismatches at every step.

### Data Flow: Vault File Changes

```
Disk (chokidar) → vault-watcher.ts (batches)
  → IPC: vault:files-changed-batch → vault-event-hub.ts (fans out)
  → useVaultWorker → vault-worker.ts (parse + graph off main thread)
  → postMessage → vault-store.setWorkerResult (atomic update)
```

### Data Flow: Document Editing

```
User types → editor-store.setContent (dirty=true)
  → window.api.document.update → DocumentManager (1s autosave debounce)
  → file-service.ts (atomic write) → vault-watcher suppressed via _pendingWrites
```

Content pushes happen in user-action callbacks (`handleUpdate`, `onFrontmatterChange`), **never via useEffect**.

### DocumentManager (main process)

Single owner of all open file content. Renderer views are thin IPC clients via `useDocument(path)`. Channels: `doc:open/close/update/save/get-content`; events: `doc:external-change/conflict/saved`. Self-write suppression via `_pendingWrites`. Conflict detection uses content comparison (not mtime) for cloud sync compatibility.

### Canvas Mutations (Snapshot-and-Plan)

Automated canvas changes (folder map, ontology, agents) use optimistic concurrency:
1. `canvas:get-snapshot` → current file + mtime
2. Build `CanvasMutationPlan` (`canvas-mutation-types.ts`) with add/move/resize/remove ops
3. `canvas:apply-plan` with `expectedMtime` — rejects `'stale'` if file changed
4. `filterCanvasAdditions()` deduplicates against existing state

### MCP Server

Nine tools total. Reads: `vault.read_file`, `search.query`, `graph.get_neighbors`, `graph.get_ghosts`, `project.map_folder`, `canvas.get_snapshot`. Writes: `vault.write_file`, `vault.create_file`, `canvas.apply_plan`, gated by `TimeoutHitlGate` + `WriteRateLimiter` with 30s auto-deny. Raw vault-derived read results (`vault.read_file`, `graph.get_ghosts`, `project.map_folder`, `canvas.get_snapshot`) use Spotlighting trust markers; structured JSON reads (`search.query`, `graph.get_neighbors`) do not. `mcp-cli.ts` is headless stdio and registers reads only. The in-process `mcp-lifecycle.ts` server is built but not transport-connected in production. Safety details live in `docs/architecture/safety-subsystem.md`.

### Terminal Webview Isolation

Terminal runs in an Electron `<webview>` with its own preload (`src/preload/terminal-webview.ts`) and separate IPC bridge. Keeps xterm.js and PTY data off the main renderer thread.

### Block Protocol (structured shell sessions)

Shell hooks (`resources/shell-hooks/te.{zsh,bash,fish}`) emit OSC `1337;te-...` markers only when `TE_SESSION_ID` is set by `PtyService`. `BlockDetector` parses PTY markers in pure engine code; `BlockWatcher` folds them through immutable block-model transitions and emits `block:update` IPC. Renderer flow: `useBlockUpdates` -> `block-store` -> `terminal-block` cards. Secret spans from `scanSecrets` are masked by render offsets with per-card click-to-reveal. See `docs/architecture/block-protocol.md`.

### PTY Write Arbitration

All PTY writes go through a per-session `PtyWriteQueue` with single-flight drain. `PtyWrite` is `command | bytes | agent-input`, exposed as `write`, `sendRawKeys`, and `writeAgentInput`; use `writeAgentInput` for agent-originated text so future policy can distinguish it from human keystrokes.

### Coordinated Quit (2-phase)

```
before-quit → preventDefault → typedSend('app:will-quit')
  → renderer flushes state + canvas + dirty docs → 'app:quit-ready'
  → main: documentManager.flushAll() + cleanup → app.quit()
```

### Key Subsystems

- **Knowledge Engine** (`src/shared/engine/`): parser.ts (gray-matter, JS disabled) → graph-builder.ts (7 relationship kinds in `RELATIONSHIP_KINDS`, each with provenance) → ghost-index.ts. search-engine.ts uses MiniSearch weights: title x10, tags x5, body x1. Runs in vault-worker.ts.
- **Canvas** (`panels/canvas/`): React DOM pan/zoom via `translate(x,y) scale(zoom)` in `CanvasSurface.tsx`; Pixi.js is only for the graph renderer. 12 `CanvasNodeType` card types include `terminal-block`, which projects a `block-store` entry and can be pinned from `TerminalCard`. Click-to-focus, click-again-to-interact.
- **Ontology** (`engine/ontology-*`): Tag-first grouping with link-analysis fallback, computed in ontology-worker.ts. `GroupProvenance` tracks source (user tags, links, AI).
- **Agents**: Three paths outside the MCP safety subsystem. (1) PTY Claude via `agent-spawner.ts` → `ShellService` → node-pty, with `session-tailer.ts` milestones, `window.api.agent`, and pre-spawn `commitPreAgentSnapshot`. (2) Native Anthropic SDK agent via `machina-native-agent.ts`, using `messages.stream` and `NATIVE_TOOLS`; it has PathGuard (`resolveInVault`) on note ops, per-write HITL approval except under `autoAccept` until the per-run write limiter trips, append-only audit logging on successful writes, no read-time Spotlighting. Canvas writes use a strict id regex (`CANVAS_ID_RE`, fast first reject) and then route through PathGuard (`resolveInVault`) for the symlink/traversal backstop. IPC: `window.api.agentNative`. (3) CLI thread PTYs via `cli-thread-spawner.ts` running `cli-claude` / `cli-codex` / `cli-gemini` as `<binary> --print "<prompt>"`; IPC `window.api.thread`. Paths (1) and (3) are trusted to the user's level. See `docs/architecture/adr/0001-native-agent-stays-on-anthropic-sdk.md`.
- **Block Protocol**: Shell hooks → OSC markers → `BlockDetector` → `BlockWatcher` → `block:update` IPC → renderer `block-store` → DOM `terminal-block` cards.
- **System Artifacts**: Structured markdown in `.machina/artifacts/{sessions,patterns,tensions}/`. Schemas in `system-artifacts.ts`.
- **Web Workers**: vault-worker (parse+graph), graph-physics-worker (D3-force), ontology-worker (grouping+layout), project-map-worker (filesystem→canvas).

### Panel Architecture

KeepAlive: panels mount once, then `display: none` on tab switch (preserves terminal state). Heavy panels (Canvas, Workbench, GraphView, Ghosts) use `React.lazy`.

### State Management (Zustand)

| Store | Owns |
|-------|------|
| vault-store | Files, artifacts, graph, vault path/config, fileToId map |
| editor-store | Active note, mode (rich\|source), dirty, content, cursor, tabs, nav history |
| canvas-store | Nodes, edges, viewport, selection, split editor |
| graph-view-store | Viewport, hover/selected node, force params |
| thread-store | Threads, messages, streaming, dock tabs/layout, in-flight + runId per thread |
| block-store | Per-session ordered terminal `Block` records |
| ui-store | Per-note UI state (backlink expansion), persisted via IPC |
| settings-store | Translucency, opacity, blur, font sizes (localStorage) |
| claude-status-store | Claude CLI availability/status |
| sidebar-filter-store | Sidebar file-tree filter state |
| sidebar-selection-store | Sidebar selection state |
| vault-health-store | Vault health monitor results |

Persistence: `vault-persist.ts` → `.machina/state.json` on 1s debounce. See Coordinated Quit for shutdown.

### Rich Text Editor

Tiptap 3 with markdown round-tripping. Extensions: slash commands, bubble menu, callouts (`> [!TYPE]`), highlights (`==text==`), concept nodes (`<node>term</node>`), wikilinks (`[[title]]` with CMD+click), mermaid, drag handles. Only ship block types with clean markdown round-trip.

### Design System

Three-layer material: canvas void (darkest) → cards (semi-transparent + blur) → glass overlays (floating UI). Dark-only UI with one hardcoded accent, `ACCENT_HEX = '#ff8c5a'` (Ember coral) in `design/themes.ts`. `settings-store` v3→v4 removed `theme` and `accentColor`; runtime settings are translucency, opacity, blur, and font sizes only. OKLCH remains for per-artifact colors.

- Import from `design/tokens.ts` — never hardcode hex or px
- Theme CSS vars: `--color-bg-base`, `--color-text-primary`, `--color-accent-default`, etc. resolve once at startup and are not reassigned
- `getArtifactColor(type)` for per-type colors
- Animation keyframes prefixed `te-`
- For Pixi, mermaid, or other non-CSS consumers needing hex values, read CSS vars once via `getComputedStyle` and memoize; no Zustand subscription is needed because vars are static at runtime

## Type Conventions

- **`Result<T>`**: `{ ok: true; value: T } | { ok: false; error: string }` — engine returns these instead of throwing (`src/shared/engine/types.ts`)
- **Branded types**: `SessionId = string & { readonly __brand: 'SessionId' }` with constructor `sessionId(id)`. Prevents mixing IDs at compile time.
- **Enum-like constants**: `as const` arrays + derived union type + `satisfies Record<...>` for exhaustiveness.

## Testing

- **Unit**: Vitest with happy-dom. `tests/` mirrors `src/` for pure logic; `src/**/__tests__/` for colocated component tests.
- **Integration**: `// @vitest-environment node` at file top for tests needing real Node APIs.
- **Store tests**: Reset via `store.setState(store.getInitialState())` in `beforeEach`.
- **E2E**: Playwright with `workers:1`, `test.describe.serial`. Test vault at `e2e/fixtures/test-vault/`.
- **Quality gate**: `npm run check` must pass clean (zero lint errors, zero type errors).

## Code Style

- **Prettier**: single quotes, no semicolons, 100 char width
- **TypeScript**: Strict mode. `_`-prefixed names exempt from unused-vars lint.
- **Tailwind v4**: Via Vite plugin. Token system in `design/tokens.ts`.
- **Immutable data**: Return new copies, never mutate in-place.
- **Files under 800 lines**, organized by feature/domain.
- **IPC timeouts**: Wrap critical IPC calls with `withTimeout(call, ms, label)` to prevent renderer hangs.
- **Buffer shim**: `main.tsx` shims `globalThis.Buffer` before gray-matter import — required for frontmatter parsing in browser context.

## Compact Instructions

When compacting context, preserve IPC contracts and process ownership, active plan paths/status, process-boundary and data-flow decisions, verification evidence, error corrections/root causes, and design token/theme decisions.
