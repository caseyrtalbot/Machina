# Librarian & Curator

Two vault-level operations. Both spawn Claude CLI as child processes against the vault directory. Completely separate from canvas MCP agent actions.

## Librarian

Read-only 5-pass audit. Outputs a single consolidated markdown report to `_librarian/YYYY-MM-DD-audit.md`. Never edits existing vault files. May only create/edit files inside `_librarian/`.

### Prompt

```
You are the Librarian for this knowledge vault -- a directory of interconnected
markdown files. Scan the vault and produce a single consolidated report to
`_librarian/YYYY-MM-DD-audit.md`.

Start by reading `_index.md` if it exists, then Glob `**/*.md` to survey the
vault. Read files as needed to complete each pass.

Run these passes in order:

## Pass 1: Contradictions
Scan for factual claims that conflict across articles. For each, cite both
sources with file paths and line numbers, include quotes, and flag confidence
(hard contradiction vs. ambiguous tension).

## Pass 2: Gaps
Identify claims missing citations, articles missing expected sections relative
to peer articles, and entities referenced but never defined. For each gap,
propose resolution with a markdown diff.

## Pass 3: Connections
Find concept pairs that share substantial semantic overlap but lack cross-links.
Propose: (a) new backlinks, (b) new bridging articles, (c) merges of redundant
articles. Justify each with specific overlapping claims.

## Pass 4: Staleness
Flag articles whose source material is older than 6 months or where the domain
has likely evolved. Prioritize by impact on downstream articles that depend on
them.

## Pass 5: Forward Questions
Propose 5-10 research questions the wiki cannot yet answer but plausibly should,
ranked by how much existing material they'd connect.

Rules:
- Never edit existing vault files. Only create or edit files inside `_librarian/`.
- Cite article paths and line numbers for every finding.
- If a pass produces zero findings, say so and move on.
- Format the report in clean markdown with headers per pass.
```

### Infrastructure

Uses existing `spawnLibrarian()` in `agent-spawner.ts`. Fix: attach `child.stdout` listener to capture output for progress display. The LibrarianMonitor, IPC wiring, and state pipeline already work.

### UI

- Existing book icon in `CanvasToolbar.tsx`
- Pulse animation while running (already works)
- Add: progress indicator showing the process is active (stdout capture)
- Files in `_librarian/` render on canvas with a distinct icon color, visually separate from regular vault files

## Curator

Applies approved librarian proposals to vault files. Additive-only: may insert new sections, append content, add wikilinks, add frontmatter fields. Never deletes or modifies existing text.

### Trigger

Second toolbar button (new icon). On click, shows a popup with selectable modes:

| Mode | Purpose |
|------|---------|
| Challenge | Stress-test ideas, surface contradictions and assumptions |
| Emerge | Surface hidden connections, synthesize across content |
| Research | Identify gaps, propose research directions |
| Learn | Extract learning points, create study materials |

Modes are customizable (prompt-driven, same pattern as librarian prompt override).

### Spawn

Same pattern as librarian: `child_process.spawn` of Claude CLI with `cwd: vaultPath`. Reads `_librarian/` contents as input, applies approved changes to vault files. Uses the same `LibrarianMonitor` pattern for lifecycle tracking (generalize to `VaultProcessMonitor` or reuse directly).

### Prompt structure

```
You are the Curator for this knowledge vault. Your job is to [MODE DESCRIPTION].

Read the librarian report(s) in `_librarian/` and the vault files they reference.
Apply the approved proposals to the vault.

Rules:
- ADDITIVE ONLY. Never delete or modify existing text in vault files.
- You may add new sections, append content, insert wikilinks, and add frontmatter fields.
- You may create new files if proposals call for bridging articles or new entries.
- Cite what librarian finding you are addressing in a comment or commit-style note.
```

### Lifecycle

1. User reviews librarian report in `_librarian/`, deletes proposals they reject
2. User clicks Curator button, selects mode from popup
3. Curator spawns, reads remaining `_librarian/` contents, applies to vault
4. `_librarian/` contents remain until user manually deletes them

## Files to modify

| File | Change |
|------|--------|
| `src/main/services/default-librarian-prompt.md` | Replace with 5-pass audit prompt |
| `src/main/services/agent-spawner.ts` | Attach stdout listener, add `spawnCurator()` |
| `src/main/services/librarian-monitor.ts` | Reuse or generalize for curator process |
| `src/main/ipc/agents.ts` | Add curator dispatch to `agent:spawn` handler |
| `src/shared/agent-types.ts` | Add `'curator'` to spawn request type |
| `src/renderer/src/panels/canvas/CanvasToolbar.tsx` | Add curator button with mode popup |
| `src/renderer/src/panels/canvas/CanvasView.tsx` | Wire curator state + popup |
| Canvas card rendering | Distinct icon color for `_librarian/` path prefix |

## What this does NOT touch

- Canvas MCP agent actions (challenge, emerge, organize, tidy, compile)
- Agent action runner / mutation plan pipeline
- Tmux agent system
- Any existing IPC channels beyond `agent:spawn` type discriminator

## Supersedes

`docs/superpowers/specs/2026-04-02-librarian-redesign.md` (prompt and UI sections only; spawn mechanics from that spec are already implemented and reused here).
