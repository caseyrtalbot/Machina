<div align="center">

<pre>
███╗   ███╗ █████╗  ██████╗██╗  ██╗██╗███╗   ██╗ █████╗ 
████╗ ████║██╔══██╗██╔════╝██║  ██║██║████╗  ██║██╔══██╗
██╔████╔██║███████║██║     ███████║██║██╔██╗ ██║███████║
██║╚██╔╝██║██╔══██║██║     ██╔══██║██║██║╚██╗██║██╔══██║
██║ ╚═╝ ██║██║  ██║╚██████╗██║  ██║██║██║ ╚████║██║  ██║
╚═╝     ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝
</pre>

**A local-first knowledge engine for spatial thinking**

![License: MIT](https://img.shields.io/badge/License-MIT-ebebeb?style=flat-square)
![Platform](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon-111111?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-39-2b2e3b?style=flat-square)
![React](https://img.shields.io/badge/React-19-149eca?style=flat-square)
![Status](https://img.shields.io/badge/status-active%20development-f59e0b?style=flat-square)

</div>

Arrange your markdown notes as cards on an infinite canvas, watch a knowledge graph assemble itself from your links and tags, and bring AI agents to the work without handing your notes to the cloud.

Machina is a macOS desktop app. Your notes are plain `.md` files on your disk. The engine reads them, never owns them.

![Multi-provider AI chat beside a spatial canvas](docs/assets/agent-canvas.png)

## Why Machina

Most note apps store ideas in a list. Thinking is not a list. Machina treats your vault as a graph of typed relationships and gives you three ways to work with it at once: a freeform spatial canvas, a force-directed graph view, and a rich markdown editor, all backed by a single dependency-free engine kernel.

- Local-first: notes stay on disk as portable markdown; the engine parses, it does not lock in.
- Spatial: lay out cards on a pannable, zoomable surface and let related ideas cluster into labeled regions.
- Connected: relationships are extracted automatically from wikilinks, frontmatter, tags, and co-occurrence.
- Honest about gaps: unresolved `[[wikilinks]]` surface as "ghosts," ideas you have referenced but not yet written.
- AI-ready: a built-in agent talks to the Anthropic API with per-write approval, and you can run third-party coding CLIs inside the app's terminal.

## Feature showcase

### Spatial canvas

An infinite, freeform canvas where you arrange and edit cards on a pannable, zoomable surface.

- Rendered as plain React DOM inside a single CSS translate/scale container, with viewport culling, level-of-detail previews, and a minimap so large canvases stay responsive. (The canvas is not a WebGL/Pixi surface; Pixi.js drives only the separate graph view.)
- Pan with middle-click or Space+drag, scroll-pan with trackpad or wheel, and zoom toward the cursor with Cmd/Ctrl+wheel, clamped to 0.1x through 3.0x.
- Click a card to focus it, click again to interact with its content, double-click to lock focus so scroll and pointer input route into the card until you double-click out.
- Exactly **12 card types**: `text`, `note` (vault note), `terminal`, `code`, `markdown`, `image`, `pdf`, `project-file`, `system-artifact`, `file-view`, `project-folder`, and `terminal-block`. Each maps to a lazy-loaded React component.
- Five card types are creatable from the right-click menu (text, code, markdown, image, terminal). The other seven require external context (a file path, a vault link, a terminal session, a folder map) and are produced by drag-drop, folder mapping, or block-pin flows.
- Canvas edges come in four kinds: `connection`, `cluster`, `tension`, `causal`.

### Knowledge graph

A force-directed view of your vault, where notes are nodes and typed relationships are edges.

![Force-directed knowledge graph](docs/assets/graph.png)

- The engine builds the graph from your notes and emits seven distinct edge kinds: `connection`, `cluster`, `tension`, `appears_in`, `related`, `derived_from`, and `co-occurrence`. Six come from frontmatter and body wikilinks; co-occurrence is auto-detected.
- Every edge carries provenance (`frontmatter`, `wikilink`, or `co-occurrence`), and co-occurrence edges include a confidence score.
- Co-occurrence linking is tuned to be useful, not noisy: terms appearing in 20 or more files are skipped as too generic, terms in fewer than 2 files are ignored, edge weight uses inverse-log term frequency (`1 / log2(frequency)`), and only pairs scoring at least 0.3 (and not already explicitly linked) earn an edge.
- Missing link targets become placeholder ghost nodes so the graph shows what you intended to connect, not just what exists.
- Graph physics runs off the main thread in a dedicated worker (D3-force), and the panel renders with Pixi.js for smooth interaction on dense graphs.

### Rich markdown editor

A Tiptap 3 editor that edits `.md` notes as formatted rich text and round-trips back to clean markdown on disk.

![Rich markdown editor](docs/assets/editor.png)

- A two-tab bar toggles each file between a rich-text WYSIWYG view (Tiptap) and a raw markdown source view (a full CodeMirror 6 editor with line numbers, markdown highlighting, search, and history). This is a Rich/Source toggle, not a side-by-side preview.
- YAML frontmatter is preserved verbatim, and custom block and inline types only ship when they have working parse and serialize hooks, so saved files stay clean markdown.
- Slash menu: type `/` at the start of an empty line for **11 commands** (Heading 1 through 3, bullet, numbered, and task lists, code block, blockquote, callout, divider, and a 3x3 table).
- Selection bubble menu: bold, italic, strikethrough, inline code, highlight, link, and concept-node tagging.
- Callouts: `> [!TYPE]` blocks that map roughly 25 keywords (note, tip, warning, danger, important, and more) onto 6 color palettes, with unknown types falling back to neutral.
- Highlights with `==text==`, toggled via Cmd+Shift+H.
- Concept nodes: tag selected text as a concept, serialized as `<node>term</node>` in markdown. The knowledge graph reads these tags.
- Wikilinks: `[[title]]` and `[[title|alias]]` render as inline links; Cmd+click resolves and navigates, and `[[Note#heading]]` scrolls to the heading on arrival.
- Live Mermaid diagrams (lazy-loaded on first use, dark theme), task lists, GFM tables (parse, render, round-trip, and basic insert), and block drag handles.
- Backlinks panel: a collapsible bar lists every note that links to the current one, derived from the in-memory knowledge graph edges (excluding self-edges and `appears_in`), each with a context snippet.
- Conflict resolution: when the open file changes on disk (for example, via cloud sync), a warning bar offers Reload from disk or Keep my version.

### Embedded terminal with Block Protocol

Machina embeds a full xterm.js terminal inside an isolated Electron `<webview>`, backed by in-process `node-pty` sessions.

- Each terminal runs as a real xterm.js session with `contextIsolation` and `sandbox` enabled and a dedicated preload: truecolor theme, JetBrains Mono, 200,000-line scrollback, search (Cmd+F), web links, Unicode 11, and a WebGL renderer with silent DOM fallback.
- Sessions are spawned directly via `node-pty` under your `$SHELL` and live in the main process, so they survive the webview being torn down and recreated. No tmux or external multiplexer.
- Every session captures output into an 8 MB ring buffer; when a webview reattaches it gets the full scrollback replayed plus any output that arrived while disconnected (reconnect queue capped at 1000 chunks). Session metadata persists to disk for discovery on startup.
- All writes to a PTY route through a per-session FIFO queue with single-flight drain, so keystrokes, control bytes, and agent-originated input never interleave mid-write.
- **Block Protocol**: shell hook scripts for `zsh`, `bash`, and `fish` emit OSC `1337;te-` markers around each prompt and command. A dependency-free `BlockDetector` parses the raw byte stream into structured command records (command, output, exit code, cwd), folding them into immutable pending to running to completed transitions in the main process. The detector passes foreign OSC sequences (for example, iTerm2's) through untouched.

> Setup note: the Block Protocol hooks ship with the app but must be sourced into your shell config by hand (for example, source `resources/shell-hooks/te.zsh` in `~/.zshrc`). There is no in-app installer yet. The hooks no-op unless `TE_SESSION_ID` is set, so they are safe to keep in shared rc files. Main-process block detection is live; the renderer-side consumption that would turn live commands into on-canvas `terminal-block` cards (with secret masking and pin-to-canvas) is built and tested but not yet wired in production.

A pure, pattern-based secret scanner flags 7 secret shapes (Anthropic `sk-ant-`, AWS access and secret keys, generic `KEY=` env vars, OpenAI `sk-`, GitHub PAT `ghp_`, and JWTs) with priority-based overlap resolution.

### Multi-provider AI agents

Machina runs AI three distinct ways. Only Anthropic's API is called by the app itself; the third-party CLIs run as external shell binaries the app detects and pipes prompts to.

| Path | What it is | Approval model |
|---|---|---|
| In-app native agent | Built-in chat agent calling the Anthropic API directly (default model `claude-sonnet-4-6`). The default and most-developed path. | Per-write Allow/Reject preview diff, on by default; optional per-thread auto-accept |
| Third-party coding CLIs | Run installed CLIs inside the app's terminal: Claude Code (`claude --print`), Codex (`codex exec`), Gemini (`gemini -p`). The app detects which are installed and shows install hints for the rest. | None in-app; same filesystem reach as you |
| PTY Claude spawner | Spawns a Claude Code session in a managed `node-pty` terminal with a composed system prompt, plus live session monitoring and milestone tracking via JSONL transcript tailing. | Pre-spawn git snapshot for rollback (no gate) |

The native in-app agent exposes **12 tools**: `read_note`, `list_vault`, `search_vault`, `write_note`, `edit_note`, `read_canvas`, `pin_to_canvas`, `unpin_from_canvas`, `list_canvases`, `focus_canvas`, `open_dock_tab`, `close_dock_tab`. Reads and writes are confined to the vault via path checks; canvas writes route through a serialized queue. The agent streams replies live, runs up to 8 tool-use rounds per turn, and times out after 60s of inactivity.

The Anthropic API key is read from `ANTHROPIC_API_KEY` or stored encrypted via Electron `safeStorage`. The app refuses to persist the key in plaintext when OS encryption is unavailable. No secret lives in code or config.

Two bundled vault agents ship as prompts: a **librarian** that audits vault quality and writes its findings, and a **curator** that acts on those findings.

### MCP server with human-in-the-loop safety

Machina exposes vault content to external MCP clients through a standalone, headless stdio server.

- Run it with `npm run mcp-server` (or `mcp-cli.js <vault>`) to connect an external MCP client to a vault. This server registers **read tools only**: `vault.read_file`, `search.query`, `graph.get_neighbors`, `graph.get_ghosts`, `project.map_folder`, `canvas.get_snapshot`. It has no write tools and no approval gate by design, since there is no UI to confirm writes. This is the only MCP server reachable today.
- Read tools that return raw vault text wrap content in trust markers (Spotlighting) so the LLM treats it as data, not instructions.

A fuller in-process MCP server is built but not transport-connected in production. It defines 9 tools total (the 6 reads plus `vault.write_file`, `vault.create_file`, `canvas.apply_plan`) and a safety stack: a human-in-the-loop approval gate that fails closed on a 30s timeout, an advisory write-rate limiter, an append-only NDJSON audit log, and path scoping. Because nothing connects it to a transport yet, those write tools and gates are dormant. This README does not advertise live read/write MCP; treat the gated write path as work in progress.

### Ghost detection

Surfaces unresolved `[[wikilinks]]` and frontmatter references, the ideas you have referenced but not yet written.

- Lists every note that points at each missing target, with a roughly 100-character context snippet, ranked by reference count.
- Folder-path-style links (those containing `/`) are excluded as structural navigation, not idea gaps.
- Suggests a target folder for the missing note based on where it is referenced from.

### Ontology grouping

Automatically organizes canvas cards into colored, labeled regions based on shared tags and link structure. This is tag-first and link-analysis based, not AI-driven.

- Notes group primarily by their tags; multi-tag notes are scored by graph-neighbor tag overlap, tag depth, and canvas frequency to pick a primary group. Nesting is capped at 2 levels.
- Within each tag group, a link-analysis fallback finds tightly-linked clusters (weighted connected components, minimum size 3) and breaks them into child groups named after the most-connected note.
- Inter-group edges aggregate the underlying note-to-note graph into weighted edges between regions, tracking the distribution of edge kinds per pair.
- Region overlays and floating cluster labels render behind grouped cards; at very low zoom only the colored regions show. An ontology preview bar offers Apply, Cancel, and Run-Agent actions.

Full-text search across the vault runs on MiniSearch with fuzzy, prefix matching and field boosting (title 10x, tags 5x, body 1x, fuzziness 0.2), plus query-aware snippet extraction centered on the first match.

## Tech stack

| Layer | Technologies |
|---|---|
| Shell | Electron 39, electron-vite 5, Vite 7 |
| UI | React 19.2, TypeScript 5.9 (strict), Tailwind CSS v4.2, Zustand 5 |
| Canvas | React DOM + CSS transforms, viewport culling, level-of-detail |
| Graph view | Pixi.js 8, d3-force / d3-quadtree 3 |
| Editor | Tiptap 3, ProseMirror, CodeMirror 6, mermaid 11 |
| Terminal | xterm.js 6, node-pty 1, Electron `<webview>`, OSC 1337 protocol |
| Engine kernel | Dependency-free TypeScript, gray-matter (JS engine disabled), MiniSearch 7 |
| AI / MCP | @anthropic-ai/sdk 0.92, @modelcontextprotocol/sdk 1.28, Zod 4 |
| Files / search | chokidar 5, ripgrep (with JS fallback), pdfjs-dist 5 |
| Tooling | Vitest 4 + happy-dom 20, Playwright 1.58, ESLint 9 (flat) + Prettier 3, electron-builder 26 |

The shared engine kernel under `src/shared/engine/` has no framework dependencies. Parsing, graph building, concept extraction, ghost indexing, ontology grouping, the block detector, and search are all plain TypeScript with 104 passing engine tests, importable on their own.

## Install and dev quickstart

### Platform support

| Platform | Status |
|---|---|
| macOS, Apple Silicon (arm64) | Supported and tested |
| macOS, Intel (x64) | Untested |
| Windows / Linux | Not supported |

The `package` and `package:install` scripts hardcode the `dist/mac-arm64` output, and there is no Windows or Linux build target. Builds are unsigned and not notarized (`notarize: false`, no code-signing config).

### Prerequisites

- macOS on Apple Silicon (M1/M2/M3/M4)
- Node.js and npm (no `engines` field is declared in `package.json`; recent LTS Node 20+ and npm 10+ are recommended but not enforced)

### Install the app

```bash
git clone https://github.com/caseyrtalbot/Machina.git
cd Machina
npm install
npm run package:install   # builds the .app and copies it to /Applications
```

The installed app stores its own state in a `.machina/` directory alongside your notes.

### Develop

```bash
npm run dev          # Electron with hot module reload (state isolated in .machina-dev/)
npm run dev:debug    # same, plus Chrome DevTools remote debugging on port 9222
npm run check        # ESLint + dual TypeScript typechecks (node + web) + Vitest
npm run package      # fast unsigned .app build (no typecheck, no DMG)
npm run build:mac    # typecheck + electron-vite build + DMG
npm run mcp-server   # headless read-only MCP stdio server
```

Dev runs write all state under `.machina-dev/` so development never touches a real vault. Production and tests use `.machina/`.

## Architecture overview

Machina builds three separate process bundles from a single electron-vite config, plus a second preload for the isolated terminal webview.

```
+---------------------------------------------------------------+
|  Main process (Node.js)                                       |
|  - PTY service + write queue + block watcher                  |
|  - DocumentManager (autosave, conflict detection)             |
|  - Native Anthropic agent (12 tools, per-write approval)      |
|  - MCP servers (headless read-only live; gated in-process)    |
|  - PathGuard, audit log, login-shell PATH recovery, CSP       |
+-------------------------+-------------------------------------+
                          | typed IPC
+-------------------------v-------------------------------------+
|  Preload bridge (contextIsolation)                            |
|  - exposes window.api; separate preload for terminal webview  |
+-------------------------+-------------------------------------+
                          |
+-------------------------v-------------------------------------+
|  Renderer (React 19 + Zustand)                                |
|  - DOM canvas (CSS transforms) + Pixi.js graph view           |
|  - Tiptap editor / CodeMirror source mode                     |
|  - xterm.js terminal in isolated <webview>                    |
+-------------------------+-------------------------------------+
                          | imports
+-------------------------v-------------------------------------+
|  Shared engine kernel (src/shared/engine/, no framework deps) |
|  parser - concept-extractor - graph-builder - ghost-index     |
|  search-engine - ontology-grouping - block-detector - secrets |
+---------------------------------------------------------------+
```

Heavy computation runs off the main thread in four Web Workers: vault parsing and graph building (vault-worker), graph physics (graph-physics-worker, D3-force), ontology grouping (ontology-worker), and project/folder mapping (project-map-worker). A separate pdf.js worker handles PDF rendering.

In packaged builds the main process spawns a login shell to recover your full PATH (Homebrew, nvm, pyenv), since Finder-launched apps otherwise inherit launchd's minimal PATH. Production injects a strict Content-Security-Policy allowing self plus Google Fonts and blob workers.

## Project structure

```
Machina/
├── src/
│   ├── main/                      # Electron main process (Node.js)
│   │   ├── services/              # PTY, agents, MCP, watchers, document manager
│   │   ├── ipc/                   # typed IPC handlers
│   │   ├── mcp-cli.ts             # headless read-only MCP stdio entry
│   │   └── index.ts
│   ├── preload/                   # context-isolated bridge
│   ├── renderer/
│   │   ├── src/
│   │   │   ├── panels/
│   │   │   │   ├── canvas/         # DOM canvas, cards, overlays, terminal cards
│   │   │   │   ├── editor/         # Tiptap + CodeMirror, extensions, backlinks
│   │   │   │   └── graph/          # Pixi.js graph renderer
│   │   │   ├── engine/             # worker wiring (useVaultWorker, etc.)
│   │   │   └── store/              # Zustand stores
│   │   └── terminal-webview/       # isolated xterm.js app + its preload
│   └── shared/
│       ├── engine/                # dependency-free kernel + tests
│       ├── canvas-types.ts        # 12 card types, 4 edge kinds
│       └── types.ts               # RelationshipKind, EdgeProvenance
├── resources/shell-hooks/         # te.zsh / te.bash / te.fish (Block Protocol)
├── docs/                          # architecture notes, assets
├── electron.vite.config.ts
├── electron-builder.yml
└── package.json
```

## Status and active development

Machina is a working daily-driver app under active development. The features above are implemented and tested unless explicitly flagged. Some areas are deliberately partial, and this README calls them out rather than hiding them:

- Block Protocol detection works in the main process, but on-canvas `terminal-block` cards from live sessions (with secret masking and pin-to-canvas) are built and tested yet not wired into production.
- Shell hooks must be installed manually; there is no in-app installer.
- The write-capable, gated in-process MCP server is built but not transport-connected. Only the headless read-only MCP server is reachable today.
- Origin-based and AI-inference ontology grouping exist at the type or unit-test level but are not reachable from the running app. Grouping in production is tag-first plus link-analysis.

Coming soon: auto-updates with in-app notifications and pre-built release downloads. Auto-update is not functional today (the publish URL is a placeholder and there is no updater runtime), so it stays firmly in this list rather than the feature set above.

## License

[MIT](LICENSE)
