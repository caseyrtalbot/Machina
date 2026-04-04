# Machina

Local-first knowledge engine for spatial thinking. Point it at a folder of markdown files and get an explorable knowledge graph with connections, clusters, and tensions -- all running on your machine, no cloud required.

<!-- TODO: Add screenshot here -->
<!-- ![Machina screenshot](docs/assets/screenshot.png) -->

## What it does

Machina parses your markdown vault, extracts relationships from wikilinks, tags, and frontmatter, and renders everything as an interactive spatial canvas. You can see how your ideas connect, where the gaps are, and what's worth exploring next.

- **Knowledge graph**: Automatic relationship extraction (wikilinks, tags, co-occurrence, frontmatter sources) with force-directed layout
- **Infinite canvas**: Pan-zoom workspace with 12 card types (notes, code, terminals, PDFs, images, system artifacts, and more) powered by PixiJS 8
- **Rich editor**: Tiptap 3 with markdown round-tripping, slash commands, callouts, mermaid diagrams, and wikilink navigation
- **Ghost detection**: Surfaces unresolved wikilinks -- ideas you've referenced but haven't written yet, ranked by how many notes point to them
- **Ontology grouping**: Automatically organizes canvas cards into semantic regions based on shared tags and link structure
- **MCP server**: Exposes your vault to AI agents via Model Context Protocol with read/write tools and HITL approval gates
- **Agent system**: Spawn Claude Code sessions as managed tmux processes with live session monitoring and milestone tracking
- **Terminal cards**: Embedded terminal sessions on the canvas via xterm.js in isolated webview processes
- **Vault agents**: Built-in librarian (audits vault quality) and curator (acts on audit findings) agents

## Getting started

### Prerequisites

- **Node.js** >= 20
- **npm** >= 10
- **macOS** (primary platform; Linux and Windows builds are available but less tested)

### Build from source

```bash
git clone https://github.com/caseyrtalbot/Machina.git
cd Machina
npm install
```

**Run in development** (with hot reload):

```bash
npm run dev
```

**Build the app**:

```bash
# macOS
npm run build:mac

# Package a local .app (fastest for testing)
npm run package

# Linux
npm run build:linux

# Windows
npm run build:win
```

On macOS, `npm run package` produces `dist/mac-arm64/Machina.app` which you can drag to `/Applications`.

### Open a vault

Launch Machina and point it at any folder containing markdown files. It will index the vault and build a knowledge graph from the relationships it finds. The vault stays on disk as plain markdown -- Machina stores its own state in a `.machina/` directory alongside your files.

## Architecture

Electron app with three process boundaries:

```
Main Process (Node.js)          Preload (Bridge)           Renderer (Browser)
  IPC handlers                    window.api                 React 19 + Zustand
  File I/O, vault indexing        Typed namespaces           PixiJS canvas
  MCP server, agent spawner                                  Tiptap editor
  Document manager                                           Web Workers
```

Heavy computation runs off the main thread in Web Workers: vault parsing, graph physics (D3-force), ontology grouping, and project map analysis.

**Key technologies**: Electron 39, React 19, PixiJS 8, Tiptap 3, Zustand, D3-force, Tailwind v4, Vitest, Playwright

## Development

```bash
npm run dev          # Start with HMR
npm run check        # Lint + typecheck + tests (quality gate)
npm test             # Unit tests (Vitest)
npm run typecheck    # TypeScript check (node + web configs)
npm run lint         # ESLint
```

### Project structure

```
src/
  main/           # Main process: IPC handlers, services, MCP server
  preload/        # Bridge: typed IPC exposure to renderer
  renderer/src/   # UI: React app, panels, stores, design system
  shared/         # Importable from all processes: types, IPC contracts
    engine/       # Pure domain kernel (zero Electron/React deps)
```

The shared engine kernel (`src/shared/engine/`) has no framework dependencies. Both the main process and the renderer import these same modules for parsing, graph building, and search.

## Status

Machina is in active development and open for testing. Expect rough edges. If you find bugs or have ideas, open an issue.

**Coming soon**: auto-updates with in-app notifications, pre-built release downloads.

## License

[MIT](LICENSE)
