# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Electron app with HMR (renderer at localhost:5173)
npm run build        # Typecheck + build all (main, preload, renderer)
npm run build:mac    # Build + package for macOS
npm test             # Run all tests (vitest)
npm test -- tests/engine/parser.test.ts   # Run a single test file
npm run test:watch   # Watch mode
npm run typecheck    # Check both node and web tsconfigs
npm run check        # lint + typecheck + test (all three)
npm run lint         # ESLint (flat config)
npm run format       # Prettier
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
│   ├── watcher.ts                 namespaces              ├── panels/ (UI sections)
│   ├── workbench.ts                                       └── design/ (tokens, primitives)
│   └── shell.ts
└── services/
    ├── file-service.ts
    ├── vault-watcher.ts
    ├── shell-service.ts
    ├── project-watcher.ts
    └── project-session-parser.ts
```

**Shared contracts** live in `src/shared/`: `types.ts` (Artifact, KnowledgeGraph), `canvas-types.ts` (CanvasNode, CanvasEdge), `workbench-types.ts` (session events, milestones), `system-artifacts.ts` (session/pattern/tension types), `ipc-channels.ts` (typed channels).

### IPC Pattern

Main registers `ipcMain.handle('channel', handler)` → Preload wraps with `ipcRenderer.invoke('channel')` → Renderer calls `window.api.namespace.method()`. Namespaces: `fs`, `vault`, `config`, `window`, `shell`, `workbench`, `terminal`, `on` (events), plus `getHomePath()` and `getFilePath()`.

### Knowledge Engine (`src/renderer/src/engine/`)

Parses markdown into typed Artifacts and builds a KnowledgeGraph:

- **parser.ts**: gray-matter frontmatter → Artifact. Strips `[[wikilinks]]` from `related:` field via `stripWikilinks()`. Extracts body `[[wikilinks]]` into `bodyLinks` (derived, not persisted). Type defaults to `note`, signal defaults to `untested`.
- **graph-builder.ts**: Artifacts → nodes + edges. Phase 1: explicit frontmatter edges (connection, cluster, tension, appears_in, related) + body wikilinks. Phase 2: co-occurrence edges from shared tags/concepts above 0.3 weight threshold. Ghost nodes for unresolved references.
- **concept-extractor.ts**: Extracts `<node>term</node>` inline tags from body text for co-occurrence.
- **vault-worker.ts**: Web Worker for bulk parsing with incremental updates on file change.
- **claude-md-template.ts**: Generates CLAUDE.md for new vaults with frontmatter schema, edge semantics, and `/connect-vault` command.

### Relationship System

Six edge types in the graph:

| Kind | Source | Signal |
|------|--------|--------|
| `connection` | frontmatter `connections:` | Neutral relatedness |
| `cluster` | frontmatter `clusters_with:` | Mutual reinforcement |
| `tension` | frontmatter `tensions_with:` | Productive contradiction (most valuable) |
| `appears_in` | frontmatter `appears_in:` | Composition (directional) |
| `related` | frontmatter `related:` + body `[[wikilinks]]` | Obsidian-native connections |
| `co-occurrence` | shared tags/`<node>` concepts | Inferred from shared vocabulary |

Body `[[wikilinks]]` are extracted into `bodyLinks` (read-only, not written to disk by `serializeArtifact`). Frontmatter `related:` values have `[[brackets]]` stripped at parse time.

### Canvas System (`src/renderer/src/panels/canvas/`)

Infinite pan-zoom canvas with typed cards and edges:

- **CanvasSurface.tsx**: Pan/zoom viewport with SVG dot grid. Transform via `translate(x,y) scale(zoom)`.
- **CardShell.tsx**: Wrapper for all card types. Title bar with action buttons.
- **EdgeLayer.tsx**: SVG bezier edges with kind-based colors.
- **card-registry.ts**: `LazyCards` maps `CanvasNodeType` → lazy-loaded component. Nine types: `text`, `note`, `terminal`, `code`, `markdown`, `image`, `pdf`, `project-file`, `system-artifact`.
- **TerminalCard.tsx**: Real PTY session in a canvas card. Culling and LOD bypassed to preserve sessions. Uses `metadata.initialCommand` for auto-commands (e.g., `claude`). Counter-scales for 1:1 pixel rendering.
- **CanvasToolbar.tsx**: Orange button spawns a terminal card with `initialCommand: 'claude'` on the canvas.
- **EdgeDots.tsx**: Off-screen connection indicators. Colored dots at viewport edges point toward connected cards not currently visible. Click to pan to the target card.
- **CardShell.tsx pointer-events gating**: Unfocused cards have a transparent overlay blocking content interaction. First click focuses the card, second click interacts with content. Prevents accidental input into terminal sessions.

### Terminal Persistence

Terminal cards on the canvas survive view switches (KeepAlive + CSS hiding). The bottom terminal panel is always mounted at a stable React tree position and hidden via CSS `width: 0` when collapsed, preserving PTY sessions across toggle. Canvas tab close confirms when active terminal sessions exist.

### Workbench System (`src/renderer/src/panels/workbench/`)

Project-scoped canvas showing Claude session activity, file cards, and system artifacts. Uses "store swap" pattern: saves vault canvas on mount, loads workbench, restores on unmount. Auto-detects project root, parses Claude sessions, lays out file/terminal cards.

### State Management (Zustand)

- **vault-store**: Files, artifacts, graph, parse errors, vault path/config/state, discoveredTypes
- **editor-store**: Active note, mode (rich|source), dirty state, content, cursor, tabs, fileMtimes (conflict detection), conflictPath
- **canvas-store**: Nodes, edges, viewport, selection, hover, card context menu
- **graph-view-store**: Viewport, hover/selected node, simulation state, display settings, force params
- **terminal-store**: Active sessions, titles
- **settings-store**: Theme, accent color, font size, font family, editor mode (persisted to localStorage)
- **tab-store**: View tabs (`editor | canvas | graph | skills | workbench`), persisted state
- **workbench-actions-store**: Bridge pattern for cross-component toolbar actions
- **terminal-actions-store**: Bridge pattern with pending activation for Claude launch

### View System

Views are managed by `tab-store` and rendered via `KeepAliveSlot` (CSS `display: none`, not unmount). This preserves all component state and running processes across tab switches. Panels: sidebar, editor, graph, terminal, canvas, skills, onboarding, workbench.

### Settings and Theming

Six themes (Midnight, Slate, Obsidian, Nord, Opal, Light) with eight retro neon accent colors. `GoogleFontLoader` applies font settings to `document.body`. Settings persisted to localStorage.

### Design System

Three-layer material model:
- **Canvas void** (darkest): The infinite workspace background. Defined per theme in `themes.ts` canvas.surface.
- **Cards** (mid-tone, semi-transparent): Content surfaces. `rgba()` values with `backdrop-filter: blur(20px)`. Float above the canvas via shadow.
- **Glass overlays** (translucent): All floating UI (sidebar, toolbar, minimap, palettes) shares `floatingPanel.glass.bg` (`rgba(20,20,24,0.78)`) and `floatingPanel.glass.blur` (`blur(20px) saturate(1.3)`).

Card colors use `rgba()` across all themes so they inherit temperature from the canvas beneath them.

### Rich Text Editor (`src/renderer/src/panels/editor/`)

Tiptap 3 (ProseMirror-based) with markdown round-tripping via `@tiptap/markdown` (uses `marked` v17). All content serializes to portable `.md` files.

**Extensions** (in `panels/editor/extensions/`):
- **slash-command.tsx**: Type `/` on an empty line for a block-type command palette. Uses `@tiptap/suggestion` + `@floating-ui/react`. Glass popup with keyboard navigation.
- **EditorBubbleMenu.tsx**: Floating toolbar on text selection: Bold, Italic, Strike, Code, Highlight, Link, Concept Node. Uses Tiptap's built-in BubbleMenu.
- **callout-block.ts**: `> [!TYPE]` admonition blocks (note, warning, tip, important). Custom `marked` tokenizer. Tinted glass backgrounds with colored left borders. Obsidian/GitHub compatible.
- **highlight-mark.ts**: `==text==` highlight syntax. Amber tint background. Cmd+Shift+H shortcut.
- **concept-node-mark.ts**: `<node>term</node>` inline concept tags. Custom tokenizer with v3 `parseMarkdown`/`renderMarkdown` API.
- **mermaid-code-block.tsx**: Mermaid diagram rendering via ReactNodeViewRenderer.
- **Block handles**: `@tiptap/extension-drag-handle` for drag-to-reorder blocks.

**Extension registries**: `tiptap-config.ts` (shared base for editor + canvas cards), EditorPanel adds editor-only extensions (slash commands, bubble menu, drag handle).

**Markdown rule**: Only add block types that have clean markdown representations. No text color, no multi-column layouts. If it can't round-trip through `.md`, don't ship it.

### File Write Conflict Detection

Editor tracks `fileMtimes` per open file. Before autosave, checks current mtime against stored mtime. If the file was modified externally (e.g., by a Claude agent), an amber banner offers "Reload from disk" or "Keep my version". Mtime entries are pruned on tab close.

### File System

All file I/O through `FileService` in main process (atomic writes via temp+rename). File watching via chokidar (`VaultWatcher`), emits `vault:file-changed` IPC events. Vault structure:

```text
vault/
├── .thought-engine/       # App config/state
│   ├── config.json
│   ├── state.json
│   └── artifacts/         # System artifacts (sessions, patterns, tensions)
└── **/*.md                # Knowledge artifacts with frontmatter
```

## Code Style

- **Prettier**: single quotes, no semicolons, 100 char width, no trailing commas
- **TypeScript**: Strict mode. Path aliases: `@renderer/*`, `@shared/*`, `@engine/*`
- **Tailwind v4**: Via Vite plugin. Dark theme with CSS variables. Token system in `design/tokens.ts`
- **Immutable data**: Return new copies, never mutate in-place
- **Files under 800 lines**, organized by feature/domain
- **Testing**: Vitest with happy-dom. Pure functions with dependency injection for testability. Action stores use bridge pattern for cross-component communication.
