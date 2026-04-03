# Librarian Redesign

## Context

The Librarian button on the canvas action bar was unwired — a race condition cleared the session ID before the tmux monitor could detect it (fixed in `4bbd340`). Beyond that bug, the Librarian's architecture was wrong: it referenced MCP tools that aren't available in a tmux CLI session, and it was placed on the canvas action bar despite not being a canvas operation.

This redesign rewires the Librarian as a vault-level operation that runs Claude directly in the vault folder using native file tools. Inspired by Andrej Karpathy's LLM knowledge base workflow where the LLM owns the wiki — compiling sources, linting for consistency, maintaining connections, and keeping the index current.

## Core Principle

The Librarian operates on the **vault/folder** directly. It reads and writes markdown files using Claude's native tools (`Read`, `Write`, `Edit`, `Glob`, `Grep`). It has no awareness of the canvas, card positions, or spatial layout.

Canvas actions (Compile, Think) are different — they are spatial-aware and produce canvas mutation plans. The Librarian is not a canvas action.

## Prompt

The system prompt encodes the full AK knowledge base workflow:

1. **Compile** — find `origin: source` artifacts with no compiled derivatives. Read them, extract key concepts, write structured wiki articles with proper frontmatter (`origin: agent`, `sources`, `tags`).
2. **Lint** — find inconsistent data across articles, conflicting claims, broken wikilinks, inconsistent tags. Fix them directly.
3. **Connect** — find articles discussing related topics without explicit links. Add wikilinks. Identify co-occurrence patterns that suggest missing edges.
4. **Fill gaps** — high ghost-reference-count topics that deserve their own articles. Thin coverage areas relative to their importance. Impute missing data where possible.
5. **Index** — update `_index.md` with total article count by type, key concepts, recent additions, coverage gaps, and suggested research directions.

Key prompt characteristics:
- No MCP tool references. Claude uses native file tools in the vault directory.
- Autonomous writes. No "ask permission" language. Git is the safety net.
- Output contract preserved: `origin: agent`, proper frontmatter, wikilinks in body text.
- Prioritization: compile unprocessed sources first, then lint existing content, then connect and fill gaps, index last.

The prompt lives at `src/main/services/default-librarian-prompt.md` (bundled default) with user override at `.machina/librarian-prompt.md`.

## Spawn Mechanics

### Wrapper script change

`agent-wrapper.sh` currently runs `claude --print "$PROMPT"`. Change to:

```bash
claude -p "$PROMPT" --allowedTools Read,Write,Edit,Glob,Grep,Bash
```

This gives Claude tool access in non-interactive mode. The `--cwd` is already the vault path.

### Fan-out

**Threshold: 25 markdown files.** Below 25, single agent. Above 25, spawn parallel scoped agents.

**Scoping strategy:** Split by top-level tags from the existing tag index (`src/shared/engine/tag-index.ts`).

Implementation in `AgentSpawner`:
1. New `spawnLibrarian(vaultPath: string)` method
2. Count `.md` files in the vault (excluding `.machina/` and system directories)
3. If <= 25: single spawn with full prompt
4. If > 25: read tag index, partition tags into N groups (2-4 agents), spawn each with a scoped prompt: "Focus on articles tagged [X, Y, Z]"
5. One additional "index agent" runs after scoped agents finish to update `_index.md`
6. Each agent is a separate tmux session — the monitor picks them all up

### What stays the same

- tmux session spawn via `AgentSpawner` + `ShellService` + `TmuxService`
- `TmuxMonitor` polling for session state (3-second interval)
- `useAgentStates` hook with the seen-before-clearing race condition fix
- Sessions visible in workbench panel
- `agent-wrapper.sh` sidecar convention (status tracking)

## UI

### Remove from canvas action bar

Delete the Librarian `ActionButton` from `CanvasActionBar.tsx`. It is not a canvas operation.

### Add book icon to canvas toolbar

Add to `CanvasToolbar.tsx` (the vertical rail on the left):
- Inline SVG book icon using `canvas-toolbtn` class
- Tooltip: "Librarian"
- When running: accent color or `te-pulse` animation on the icon
- Click while running: stops all librarian session(s)
- Separated from spatial tools by a divider

### Files to modify

- `src/renderer/src/panels/canvas/CanvasToolbar.tsx` — add book icon button
- `src/renderer/src/panels/canvas/CanvasActionBar.tsx` — remove Librarian button
- `src/renderer/src/panels/canvas/CanvasView.tsx` — pass librarian state to toolbar instead of action bar

## Vault Watcher Integration

No new wiring needed. When the Librarian writes files, the existing chokidar watcher picks up changes:

```
Disk change -> vault-watcher -> IPC: vault:files-changed-batch
  -> vault-worker -> parse + graph rebuild -> store update -> UI re-renders
```

Canvas, sidebar, graph view, and ghost panel all update automatically. Multiple simultaneous agents writing files are handled by the watcher's existing event batching.

## Files to Modify

| File | Change |
|------|--------|
| `src/main/services/default-librarian-prompt.md` | Rewrite prompt for native file tools, full AK workflow |
| `scripts/agent-wrapper.sh` | Change `--print` to `-p` with `--allowedTools` |
| `src/main/services/agent-spawner.ts` | Add `spawnLibrarian()` with fan-out logic |
| `src/renderer/src/panels/canvas/CanvasToolbar.tsx` | Add book icon button |
| `src/renderer/src/panels/canvas/CanvasActionBar.tsx` | Remove Librarian button |
| `src/renderer/src/panels/canvas/CanvasView.tsx` | Route librarian state to toolbar |
| `src/renderer/src/hooks/use-agent-orchestrator.ts` | Update trigger to use `spawnLibrarian()` |
| `src/main/ipc/agents.ts` | Add `agent:spawn-librarian` IPC channel |
| `src/shared/ipc-channels.ts` | Declare new channel type |
| `src/preload/index.ts` | Expose new channel |
| `src/shared/agent-action-types.ts` | Remove `librarian` from `AgentActionName` |

## Verification

1. **Single agent**: Open a vault with < 25 files. Click the book icon. Verify a tmux session spawns, the icon shows active state, and Claude reads/writes files in the vault. Verify new/modified files appear in the sidebar and canvas automatically.
2. **Fan-out**: Open a vault with > 25 files. Click the book icon. Verify multiple tmux sessions spawn (visible in workbench). Verify each agent scopes to its tag partition.
3. **Stop**: Click the book icon while running. Verify all librarian sessions are killed.
4. **Git safety**: After a librarian run, `git diff` shows all changes. `git checkout .` reverts everything cleanly.
5. **Tests**: Existing agent spawn tests pass. Add test for fan-out threshold logic.
