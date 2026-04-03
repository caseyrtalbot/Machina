# Librarian Redesign

## Context

The Librarian button on the canvas action bar was unwired — a race condition cleared the session ID before the tmux monitor could detect it (fixed in `4bbd340`). Beyond that bug, the Librarian's architecture was wrong: it referenced MCP tools that aren't available in a tmux CLI session, and it was placed on the canvas action bar despite not being a canvas operation.

This redesign rewires the Librarian as a vault-level operation that runs Claude directly in the vault folder using native file tools. Inspired by Andrej Karpathy's LLM knowledge base workflow where the LLM owns the wiki — compiling sources, linting for consistency, maintaining connections, and keeping the index current.

## Council Review (2026-04-02)

A 3-member council (Technical Engineer, First Principles Architect, AK Vision Advocate) reviewed the original spec. Key findings:

**Convergence (all 3 agreed):**
- Prompt must not travel as a shell argument. Write to temp file.
- Fan-out should not ship in v1. Defer until real usage data exists.
- Session ID mismatch between AgentSpawner and ShellService is a real bug.

**Key changes from original spec:**
- Drop tmux for the Librarian. Use `child_process.spawn` directly. The Librarian is a headless batch job, not an interactive terminal session.
- Drop the wrapper script. Status tracking is ~50 lines of Node.js.
- Drop fan-out from v1. Single agent, cold-start, full vault scan.
- No new IPC channel. Use existing `agent:spawn` with type discriminator.
- Processing manifest deferred to Increment 2.

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

### Direct child_process.spawn (no tmux)

The Librarian bypasses the tmux/ShellService stack entirely. `AgentSpawner` gains a `spawnLibrarian()` method that:

1. Generates a single UUID used everywhere (process tracking, sidecar, renderer state)
2. Writes the prompt to `.machina/tmp/librarian-{sessionId}.md`
3. Spawns `claude -p --allowedTools Read,Write,Edit,Glob,Grep,Bash` with `{ cwd: vaultPath }` via `child_process.spawn`
4. Pipes the prompt file path as an argument
5. Tracks the child process in a lightweight `LibrarianMonitor`

### LibrarianMonitor

A ~50-line class that tracks the spawned child process and emits `AgentSidecarState`-shaped updates via the existing `agent:states-changed` IPC event. The workbench panel and toolbar see it identically to tmux sessions.

Responsibilities:
- Track PID, status (alive/exited), start time
- Clean up temp prompt file on exit
- Emit state changes through the existing agent state pipeline

### No fan-out in v1

Single agent, cold-start, full vault scan. Fan-out deferred to Increment 2 (when processing manifest exists to scope dirty files).

### No new IPC channel

Use the existing `agent:spawn` channel. Add a `type?: 'agent' | 'librarian'` discriminator to `AgentSpawnRequest`. The handler dispatches to either the existing tmux path or the new `spawnLibrarian()` path.

## UI

### Remove from canvas action bar

Delete the Librarian `ActionButton` from `CanvasActionBar.tsx`.

### Add book icon to canvas toolbar

Add to `CanvasToolbar.tsx` (the vertical rail on the left):
- Inline SVG book icon using `canvas-toolbtn` class
- Tooltip: "Librarian"
- When running: accent color or `te-pulse` animation on the icon
- Click while running: stops the librarian process
- Separated from spatial tools by a divider

## Vault Watcher Integration

No new wiring needed. When the Librarian writes files, the existing chokidar watcher picks up changes:

```
Disk change -> vault-watcher -> IPC: vault:files-changed-batch
  -> vault-worker -> parse + graph rebuild -> store update -> UI re-renders
```

## Files to Modify

| File | Change |
|------|--------|
| `src/main/services/default-librarian-prompt.md` | Rewrite prompt for native file tools, full AK workflow |
| `src/main/services/agent-spawner.ts` | Add `spawnLibrarian()` with child_process.spawn, temp-file prompt |
| `src/main/services/librarian-monitor.ts` | New: lightweight process monitor emitting AgentSidecarState |
| `src/main/ipc/agents.ts` | Dispatch librarian spawns to new path, integrate LibrarianMonitor |
| `src/shared/agent-types.ts` | Add `type?: 'librarian'` to AgentSpawnRequest |
| `src/shared/ipc-channels.ts` | Update request type |
| `src/preload/index.ts` | No change needed (existing channel) |
| `src/renderer/src/panels/canvas/CanvasToolbar.tsx` | Add book icon button |
| `src/renderer/src/panels/canvas/CanvasActionBar.tsx` | Remove Librarian button |
| `src/renderer/src/panels/canvas/CanvasView.tsx` | Route librarian state to toolbar |
| `src/renderer/src/hooks/use-agent-orchestrator.ts` | Update trigger to pass type discriminator |
| `src/shared/agent-action-types.ts` | Remove `librarian` from AgentActionName |

## Increment 2 (deferred)

1. Processing manifest at `.machina/librarian-state.json` — content hashes, last-processed timestamps
2. Delta processing — Librarian prompt receives only dirty files
3. Fan-out — when manifest shows > 25 dirty files, split into scoped agents
4. Q&A output filing — mechanism for query results to flow back into the wiki

## Verification

1. **Single agent**: Open a vault with files. Click the book icon. Verify a child process spawns, the icon shows active state, and Claude reads/writes files in the vault. Verify new/modified files appear in the sidebar and canvas automatically.
2. **Stop**: Click the book icon while running. Verify the librarian process is killed.
3. **Git safety**: After a librarian run, `git diff` shows all changes. `git checkout .` reverts everything cleanly.
4. **Workbench visibility**: Verify the librarian session appears in workbench panel via the agent state system.
5. **Tests**: Add test for LibrarianMonitor lifecycle. Add test for type discriminator dispatch.
