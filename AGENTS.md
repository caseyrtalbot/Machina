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

Electron app with three process boundaries:

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

`typedHandle('channel', handler)` in main → `typedInvoke('channel', args)` in preload → `window.api.namespace.method()` in renderer. Namespaces: `fs`, `vault`, `config`, `document`, `shell`, `terminal`, `claude`, `agent`, `agentNative`, `thread`, `cliThread`, `canvas`, `health`, `app`, `lifecycle`, `on` (events).

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

Single owner of all open file content. Renderer views are thin IPC clients via `useDocument(path)`. Channels: `doc:open/close/update/save/save-content`; events: `doc:external-change/conflict/saved`. Self-write suppression via `_pendingWrites`. Conflict detection uses content comparison (not mtime) for cloud sync compatibility.

### Canvas Mutations (Snapshot-and-Plan)

Automated canvas changes (folder map, ontology, agents) use optimistic concurrency:
1. `canvas:get-snapshot` → current file + mtime
2. Build `CanvasMutationPlan` (`canvas-mutation-types.ts`) with add/move/resize/remove ops
3. `canvas:apply-plan` with `expectedMtime` — rejects `'stale'` if file changed
4. `filterCanvasAdditions()` deduplicates against existing state

### MCP Server

Twelve tools: `vault.read_file`, `search.query`, `graph.get_neighbors`, `graph.get_ghosts`, `project.map_folder`, `canvas.get_snapshot` (reads); `vault.write_file`, `vault.create_file`, `canvas.apply_plan` (writes gated by TimeoutHitlGate + WriteRateLimiter). The three `vault.*` tools are also registered under `workspace.*` aliases (same handlers; the invoked name flows into the Spotlighting envelope and gate prompt). Auto-denies after 30s with no user response. Tools that return raw vault-derived content (`vault.read_file`, `graph.get_ghosts`, `project.map_folder`, `canvas.get_snapshot`) wrap results in Spotlighting trust markers; structured-JSON tools (`search.query`, `graph.get_neighbors`) do not. `mcp-cli.ts` provides headless stdio mode and registers reads only (7 tools — no writes, no gate). The in-process MCP server in `mcp-lifecycle.ts` is built but not transport-connected in production. See `docs/architecture/safety-subsystem.md` for the full safety story (HITL gate, audit, Spotlighting, PathGuard) and known gaps.

### Terminal Webview Isolation

Terminal runs in an Electron `<webview>` with its own preload (`src/preload/terminal-webview.ts`) and separate IPC bridge. Keeps xterm.js and PTY data off the main renderer thread.

### Block Protocol (structured shell sessions)

Shell hooks (`resources/shell-hooks/te.{zsh,bash,fish}`) emit OSC `1337;te-…` markers around prompts and commands so the engine can convert the raw PTY stream into structured `Block` records (prompt + command + output + exit + cwd). `PtyService` exports `TE_SESSION_ID` so hooks activate inside thought-engine PTYs only. `BlockDetector` (`src/shared/engine/block-detector.ts`, pure) parses markers; `BlockWatcher` (`src/main/services/block-watcher.ts`) folds events into `Block` snapshots via the immutable transitions in `src/shared/engine/block-model.ts`. Each transition fires a `block:update` IPC event (`window.api.on.blockUpdate`). The renderer consumes these via a module-level `window.api.on.blockUpdate` subscription in `block-store` (per-session ordered list), and projects entries onto the canvas via the `terminal-block` card type. Secret spans flagged by `scanSecrets` are masked at render time using `block.outputText` offsets and `block-output-segments`; a per-card click-to-reveal toggle un-masks for that one card only. Wire format and degraded-mode behavior in `docs/architecture/block-protocol.md`. Hooks no-op when `TE_SESSION_ID` is unset, so they're safe in shared rc files.

### PTY Write Arbitration

All `PtyService` writes route through a per-session `PtyWriteQueue` (`src/main/services/pty-write-queue.ts`) with single-flight drain. `PtyWrite` is a discriminated union of `bytes | agent-input`, exposed as `write` / `sendRawKeys` / `writeAgentInput`. Use `writeAgentInput` for agent-originated input — keeps it distinguishable from human keystrokes for future policy gating.

### Coordinated Quit (2-phase)

```
before-quit → preventDefault → typedSend('app:will-quit')
  → renderer flushes state + canvas + dirty docs → 'app:quit-ready'
  → main: documentManager.flushAll() + cleanup → app.quit()
```

### Key Subsystems

- **Knowledge Engine** (`src/shared/engine/`): parser.ts (gray-matter, JS disabled) → graph-builder.ts (7 relationship kinds with provenance: `connection`, `cluster`, `tension`, `appears_in`, `related`, `co-occurrence`, `derived_from` — `RELATIONSHIP_KINDS` in `src/shared/types.ts`) → ghost-index.ts. search-engine.ts: MiniSearch (title x10, tags x5, body x1). All runs in vault-worker.ts Web Worker.
- **Canvas** (`panels/canvas/`): React DOM with a CSS-transform pan-zoom layer (`CanvasSurface.tsx`: `translate(x,y) scale(zoom)`), **not** Pixi — Pixi.js drives only the graph view (`panels/graph/graph-renderer.ts`). 12 card types (`CanvasNodeType` in `src/shared/canvas-types.ts`): `text`, `note`, `terminal`, `code`, `markdown`, `image`, `pdf`, `project-file`, `system-artifact`, `file-view`, `project-folder`, `terminal-block`. Click-to-focus, click-again-to-interact. `terminal-block` cards project an entry in `block-store`; pinned via the `+` action on a `TerminalCard`.
- **Ontology** (`engine/ontology-*`): Tag-first grouping with link-analysis fallback, computed in ontology-worker.ts. `GroupProvenance` tracks source (user tags, links, AI).
- **Agents**: Two paths. (1) In-app Anthropic SDK agent via `machina-native-agent.ts` (`@anthropic-ai/sdk` `messages.stream` with a tool loop over `NATIVE_TOOLS` / `machina-native-tools.ts`). IPC: `window.api.agentNative`. (2) CLI thread spawner via `cli-thread-spawner.ts` — owns a per-thread PTY running `cli-claude` / `cli-codex` / `cli-gemini` as `<binary> --print "<prompt>"`. IPC: `window.api.thread`. Both run outside the MCP safety subsystem, but not equally: path (1) carries its own guards — PathGuard (`resolveInVault`) on note ops, per-write HITL approval (skipped under autoAccept, but forced when the per-run write-velocity limiter trips), and append-only audit logging on every successful write; no read-time Spotlighting. `write_note`/`edit_note` route their final write through the shared `writeStampedNote` helper (`src/main/utils/note-write.ts`) — the single safe-write mechanics now also used by `VaultQueryFacade.writeFile` — so native writes stamp `modified_by`/`modified_at` provenance and suppress the vault-watcher self-echo via `DocumentManager.registerExternalWrite` (injected as an optional `documentManager` `ToolContext` field); the body is preserved verbatim (a leading `---` is never re-parsed). Canvas writes use a strict id regex (`CANVAS_ID_RE`, fast first reject) and then route through PathGuard (`resolveInVault`) for the symlink/traversal backstop. Path (2) is trusted to the user's level (no PathGuard, no pre-write gate); its workspace writes are contained after the fact by the post-persistence approvals gate — `cli-turn-registry.ts` attributes each turn's writes, `agent-write-watcher.ts` routes them into the approval queue, and resolving from the tray commits with `Machina-Agent`/`Machina-Session` trailers (`git-service.ts:commitApproved`), reverts via git (`discard`), or undoes an agent wholesale (`revertAgent`); the pre-run snapshot (`commitPreAgentSnapshot`) was retired in workstation step 5 after the G1–G8 evidence gate (`docs/architecture/workstation/03-snapshot-retirement-evidence.md`). PTY agent monitoring stays live via `pty-monitor.ts` → `agent:get-states` / `agent:states-changed`. See `docs/architecture/safety-subsystem.md`; the decision to keep path (1) on `@anthropic-ai/sdk` (no Claude Agent SDK migration) is recorded in `docs/architecture/adr/0001-native-agent-stays-on-anthropic-sdk.md`.
- **Block Protocol**: shell hooks → OSC markers → `BlockDetector` → `BlockWatcher` → `block:update` IPC → renderer `block-store` → `terminal-block` `BlockCard` (DOM, not Pixi). See dedicated subsection above and `docs/architecture/block-protocol.md`.
- **System Artifacts**: Structured markdown in `.machina/artifacts/{sessions,patterns,tensions}/`. Schemas in `system-artifacts.ts`.
- **Web Workers**: vault-worker (parse+graph), graph-physics-worker (D3-force), ontology-worker (grouping+layout), project-map-worker (filesystem→canvas).

### Panel Architecture

KeepAlive: panels mount once, then `display: none` on tab switch (preserves terminal state). Heavy panels (Canvas, GraphView, Ghosts) use `React.lazy`.

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
| settings-store | Accent (preset id + custom hex), opacity, blur, font sizes, density/radii/backgroundTint/canvasGrid (localStorage) |
| claude-status-store | Claude CLI availability/status |
| sidebar-filter-store | Sidebar file-tree filter state |
| sidebar-selection-store | Sidebar selection state |
| vault-health-store | Vault health monitor results |

Persistence: `vault-persist.ts` → `.machina/state.json` on 1s debounce. See Coordinated Quit for shutdown.

### Rich Text Editor

Tiptap 3 with markdown round-tripping. Extensions: slash commands, bubble menu, callouts (`> [!TYPE]`), highlights (`==text==`), concept nodes (`<node>term</node>`), wikilinks (`[[title]]` with CMD+click), mermaid, drag handles. Only ship block types with clean markdown round-trip.

### Design System

Three-layer material: canvas void (darkest) → cards (semi-transparent + blur) → glass overlays (floating UI). **Dark-only**, with a runtime-selectable accent: `ACCENT_PRESETS` in `design/accent-presets.ts` (default `ember`, `#ff8c5a`) plus a `custom` hex, stored as `accentId`/`customAccentHex` in `settings-store` and applied via `applyAccentCssVars` (`design/apply-accent.ts`). `EnvironmentSettings` (`design/themes.ts`) exposes opacity, header darkness, blur, grid-dot visibility, font sizes, `density`, `radii`, `backgroundTint`, and `canvasGrid`. OKLCH palette is used for per-artifact colors via `getArtifactColor(type)`.

- Import from `design/tokens.ts` — never hardcode hex or px
- Theme CSS vars: `--color-bg-base`, `--color-text-primary`, `--color-accent-default`, etc. — resolved at startup; only accent vars are reapplied (via `applyAccentCssVars`) when the user changes accent
- `getArtifactColor(type)` for per-type colors
- Animation keyframes prefixed `te-`
- For Pixi / mermaid / other non-CSS consumers that need a resolved hex, read CSS vars via `getComputedStyle`; note accent vars can change at runtime when the user picks a new accent

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

Always preserve across context compaction:
- IPC channel contracts and process ownership (main vs renderer vs preload)
- Active plan file paths, current step, and completion status
- Process boundary and data flow decisions
- Verification evidence (test output, build results, type-check results)
- Error corrections and root causes, especially IPC or Electron-specific
- Design system token values and theme decisions
