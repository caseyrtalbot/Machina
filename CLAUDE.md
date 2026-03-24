# CLAUDE.md

## Commands

```bash
npm run dev          # Start Electron app with HMR
npm run dev:debug    # Dev with CDP debugging port (REMOTE_DEBUGGING_PORT=9222)
npm run build        # Typecheck + build all (main, preload, renderer)
npm run build:mac    # Build + package for macOS
npm test             # Run all tests (vitest)
npm run test:e2e     # Build + run Playwright e2e tests (16 tests, ~5s)
npm run test:live    # CDP health checks against running dev app
npm run check        # lint + typecheck + test (quality gate)
npm run typecheck    # Check both node and web tsconfigs
npm run lint         # ESLint (flat config)
npm run format       # Prettier
npm run package      # Fast local .app build (no typecheck, no DMG)
npm run package:install  # Package + copy to /Applications
```

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
│   ├── config.ts                  with typed              ├── engine/ (parser/indexer)
│   ├── watcher.ts                 namespaces              ├── hooks/ (useDocument, etc.)
│   ├── documents.ts                                       ├── panels/ (UI sections)
│   ├── workbench.ts                                       └── design/ (tokens, primitives)
│   └── shell.ts
└── services/
    ├── document-manager.ts    # Owns all open file content
    ├── file-service.ts        # Atomic disk I/O
    ├── vault-watcher.ts       # chokidar file watching
    └── shell-service.ts
```

### DocumentManager (main process)

Single owner of all open file content. Renderer views are thin IPC clients via `useDocument(path)` hook. Validated by research across Obsidian, Logseq, Zettlr, and SiYuan.

- `doc:open/close/update/save/get-content` request/response channels
- `doc:external-change/conflict/saved` broadcast events
- Autosave: 1s debounce timer on each Document object
- Self-write suppression: `_pendingWrites` set prevents echo from watcher
- Conflict detection: content comparison (not just mtime) for cloud sync compatibility
- Content pushes happen directly in user-action callbacks (`handleUpdate`, `onFrontmatterChange`), never via useEffect

### IPC Pattern

`typedHandle('channel', handler)` in main → `typedInvoke('channel', args)` in preload → `window.api.namespace.method()` in renderer. Namespaces: `fs`, `vault`, `config`, `document`, `window`, `shell`, `workbench`, `terminal`, `on` (events).

### Knowledge Engine (`src/renderer/src/engine/`)

Parses markdown into typed Artifacts and builds a KnowledgeGraph:
- **parser.ts**: gray-matter frontmatter → Artifact. Extracts body `[[wikilinks]]` into `bodyLinks`.
- **graph-builder.ts**: Artifacts → nodes + edges. Frontmatter edges + body wikilinks + co-occurrence.
- **vault-worker.ts**: Web Worker for bulk parsing with incremental updates.
- **vault-event-hub.ts**: Renderer-side singleton dispatching watcher events to path-indexed subscribers.
- **search-engine.ts**: MiniSearch full-text search (title boost 10, tags boost 5, body boost 1).
- **tag-index.ts**: Hierarchical tag tree with aggregate counts.

### Relationship System

Six edge types: `connection`, `cluster`, `tension`, `appears_in`, `related`, `co-occurrence`.

### Canvas System (`src/renderer/src/panels/canvas/`)

Infinite pan-zoom canvas with typed cards and edges. Nine card types: `text`, `note`, `terminal`, `code`, `markdown`, `image`, `pdf`, `project-file`, `system-artifact`. Pointer-events gating (click to focus, click again to interact). Terminal cards survive view switches via KeepAlive + CSS hiding.

### State Management (Zustand)

- **vault-store**: Files, artifacts, graph, vault path/config/state
- **editor-store**: Active note, mode (rich|source), dirty state, content, cursor, tabs
- **canvas-store**: Nodes, edges, viewport, selection, split editor state
- **graph-view-store**: Viewport, hover/selected node, force params
- **ui-store**: Per-note UI state (backlink expansion), persisted via IPC
- **tab-store**: View tabs, persisted state
- **settings-store**: Theme, accent, fonts (localStorage)

### Rich Text Editor

Tiptap 3 with markdown round-tripping. Extensions: slash commands, bubble menu, callouts (`> [!TYPE]`), highlights (`==text==`), concept nodes (`<node>term</node>`), wikilinks (`[[title]]` with CMD+click navigate), mermaid diagrams, drag handles. Only ship block types with clean markdown round-trip.

### Design System

Three-layer material model: canvas void (darkest), cards (semi-transparent with blur), glass overlays (floating UI). Six themes, eight accent colors. OKLCH perceptual palette.

### Testing

- **Unit**: Vitest with happy-dom (695+ tests, 68 files)
- **E2E**: Playwright with `workers:1`, `test.describe.serial`, `beforeAll/afterAll` lifecycle (16 tests)
- **Live**: CDP connection to running app via `test:live` (no new Electron instances)
- **Quality gate**: `npm run check` must pass clean (zero lint errors, zero type errors)

## Code Style

- **Prettier**: single quotes, no semicolons, 100 char width
- **TypeScript**: Strict mode. Aliases: `@renderer/*`, `@shared/*`, `@engine/*`
- **Tailwind v4**: Via Vite plugin. Token system in `design/tokens.ts`
- **Immutable data**: Return new copies, never mutate in-place
- **Files under 800 lines**, organized by feature/domain
