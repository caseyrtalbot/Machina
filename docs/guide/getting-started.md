# Getting Started

Machina is a local-first thinking environment for macOS: your notes are plain markdown files on disk, arranged on an infinite canvas, connected in a knowledge graph, and searchable from one palette. Agents work inside the same vault; the in-app agent asks your approval on every write.

This guide takes you from clone to a working session in about ten minutes.

## Requirements

- **macOS on Apple Silicon.** This is the supported, tested platform. Intel Macs are untested; Windows and Linux are unsupported.
- **Node.js and npm** to build and run from source. There are no pre-built downloads yet.
- **For agent features** (optional): an Anthropic API key for the in-app agent, or one of the `claude`, `codex`, or `gemini` CLIs installed for CLI agent threads. Everything else (editor, canvas, graph, search, terminal) works without any key.

## Install

```bash
git clone https://github.com/caseyrtalbot/Machina.git
cd Machina
npm install
npm run dev
```

`npm run dev` starts the app with hot reload, which is the fastest way to try it. To install it as a regular app instead:

```bash
npm run package:install   # builds the .app and copies it to /Applications
```

Builds are unsigned and not notarized, so macOS will warn on first launch of a packaged build.

## Point it at a vault

A vault is any folder of markdown files. On first launch, click **Open Folder** and pick one: an existing Obsidian vault, a notes directory, or an empty folder you'll grow into.

Machina reads plain `.md` files with standard YAML frontmatter and never converts them to a proprietary format. It keeps its own state (canvas layouts, artifacts, settings) in a `.machina` folder inside the vault (`.machina-dev` when running via `npm run dev`, so dev sessions never touch your real state), and your notes stay portable.

## First-run setup

After opening a vault, a short setup walkthrough appears. It asks for one thing: an Anthropic API key (`sk-ant-...`), which powers the in-app agent. The key is stored encrypted via Electron safeStorage and never written anywhere else.

You have two alternatives:

- **Install the Claude CLI instead.** The walkthrough switches to a CLI path: install Claude Code, run `claude auth login`, and Machina detects it automatically.
- **Skip for now.** Everything except the agents works without a key. You can re-run setup any time from the command palette (Cmd+K) or Settings.

## Your first ten minutes

A guided loop through every major surface. Keyboard reference: [shortcuts.md](shortcuts.md).

### 1. Open a note

The files panel on the right lists your vault (Cmd+Shift+V toggles it). Click any note to open it in the editor: rich text with full markdown round-trip, `[[wikilinks]]` with autocomplete as you type `[[`, and a slash menu (`/`) for callouts, code blocks, and tables (mermaid diagrams render inside code blocks). Cmd+N creates a new note; the calendar at the top of the files panel opens daily notes.

### 2. Pin it to the canvas

Open the canvas with Cmd+K and "Open canvas", then drag the note from the files panel onto it. The canvas is infinite: pan, zoom, and arrange cards spatially. Right-click empty canvas to add other card types (text, code, markdown, image, PDF, terminal), or press `n` to drop a quick note at the cursor. Everything you move, duplicate, or delete is undoable with Cmd+Z.

### 3. See the graph

Cmd+K, "Open graph view". Your notes appear as a force-directed graph built from wikilinks, tags, and co-occurrence. Dashed ghost nodes are `[[wikilinks]]` that don't resolve to a file yet: ideas your vault references but hasn't written down. If you added an API key, the **Enrich vault** action on the graph view runs the agent over unconnected files to propose links.

### 4. Run a search

Cmd+K and start typing. Full-text search runs over your whole vault and returns results with snippets; Enter opens the note. For meaning-based search, enable local embeddings in Settings: it names the model download size up front, runs entirely on your machine, and merges semantic hits into the same results. If you skip it, lexical search covers everything.

### 5. Talk to the agent

Cmd+Shift+N starts a thread with the in-app agent (requires the API key from setup). Ask it about your vault: it can read and search notes, write and edit them, and pin cards to the canvas. Every write shows you the change and waits for your approval before touching disk, and successful writes land in an append-only audit log. If you use the `claude`, `codex`, or `gemini` CLIs instead, the new-thread menu spawns them in their own terminal sessions with session continuity.

### 6. Pin a terminal block

Right-click the canvas, choose **Terminal** under Tools, and you get a real shell in a card. The first time, a banner offers one-click shell hook installation (zsh, bash, and fish); accept it, then open a fresh terminal card so the new session picks the hooks up. With hooks active, every command becomes a structured block: command, output, exit code, working directory. Run something, then click the pin button on the card to pin the latest block to the canvas as its own card. Detected secrets in output are masked by default, with per-card click-to-reveal.

## Where next

- [Keyboard shortcuts](shortcuts.md): the complete reference.
- [Block Protocol](../architecture/block-protocol.md): how shell sessions become structured blocks.
- [README](../../README.md): feature overview and architecture.
