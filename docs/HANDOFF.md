# Handoff

Single-file handoff: **overwritten** at every clean checkpoint, never appended — git
history is the archive. A fresh agent starts here after reading `docs/PLAN.md` (the
canonical plan; do not restructure it) and `CLAUDE.md` (conventions + working protocol).

**Position:** Layer 1 (Foundations) **item 5 — one index authority — COMPLETE**
(2026-07-24; PLAN.md item 5 carries the completion note). **Next: Layer 1 item 6 —
surface registry** (collapse the five-touchpoint surface enumeration — ribbon, palette
sources, keybindings, `DockTabContent` switch, `dock-types.ts` — into one registry;
execute D3, Health → status-bar popover, as the first registry change; verify gate:
adding or removing a surface is a one-site change).

## What shipped last (item 5 — one index authority)

Two sequential implementers (main lane, then renderer lane) + orchestrator (gate test,
docs, spotcheck-driven fixes), spotcheck-verified. Uncommitted at handoff-write time;
this checkpoint's commit is the whole diff (22 files: 19 modified + 3 new).

Before: main (`VaultIndex` for MCP/native) and the renderer vault-worker each read and
parsed the ENTIRE vault independently with the same shared kernel — the renderer via
one `fs:read-file` IPC round-trip per note — and `system-artifact-runtime.ts` ran a
third, partial inline parse. After: main parses once; the renderer projects.

**Changes:**

- **`src/shared/index-delta.ts` (new)** — the wire contract:
  `VaultIndexEntry { path; artifact: Artifact | null; error: ParseError | null }`
  (artifact null iff parse failed) and `VaultIndexDelta { upserts; removes }` (absolute
  paths).
- **New IPC**: channel `vault:index-snapshot` (returns all current entries; handler in
  new `src/main/ipc/vault-index.ts`, deps supplied via the established setter pattern
  from `reconfigureForVault`) and event `vault:index-delta` (emitted after each watcher
  batch is applied to the index, in batch order, inside `createLiveIndexUpdater`'s
  serialization chain). Preload: `window.api.vault.indexSnapshot()` +
  `window.api.on.indexDelta(cb)`. `vault:files-changed-batch` is unchanged and still
  serves path-level subscribers (open-doc sync, sidebar lists) — never ingestion.
- **Main is the sole parser**: `VaultIndex.addFile/updateFile` now return
  `IngestResult { artifact, error }` so parse failures surface (previously dropped);
  `vault-indexing.ts` keeps an `entriesByPath` map for snapshots, returns the applied
  delta from `applyIndexEvents`, and ingests system artifacts
  (`<vault>/<TE_DIR>/artifacts/{sessions,patterns,tensions}/`) at init. The only
  `parseArtifact(` invocation in src/ is `src/shared/engine/indexer.ts`.
- **Watcher carve-out** (`vault-watcher.ts`): the system-artifact subtree under the TE
  dir is now watched; everything else under TE_DIR (state.json, threads/, embeddings/,
  audit) stays ignored — integration-tested (artifact .md fires, state.json/audit
  fire nothing).
- **Renderer worker is a projection** (`vault-worker-helpers.ts`): message protocol is
  now `load {entries}` / `append {entries}` / `apply-delta {upserts, removes}` (+
  unchanged `search`, `index-pdf`); `parseArtifact` import and id-collision suffixing
  deleted (main's ids are canonical); `buildGraph` + `SearchEngine` remain as pure
  projections; `WorkerResult` shape unchanged, so vault-store consumers are untouched.
- **App.tsx hydration**: per-file read loop deleted; orchestrateLoad fetches the
  snapshot (wrapped in `withTimeout`, 30s) and chunks it into the worker with the
  existing progressive-hydration pattern; a lifetime `indexDelta` subscription buffers
  during hydration and flushes in a `finally` (a failed snapshot fetch cannot strand
  the buffer flag). The old batch subscription's re-read/`updateMany` is gone; its
  sidebar file-list maintenance remains, now routing system-artifact paths to
  `systemFiles` instead of leaking them into `files` (spotcheck catch).
- **`syncSystemArtifactFromDisk` deleted** (`system-artifact-runtime.ts` is now just
  `openArtifactInEditor`; editor-store call site removed). It was a partial ingestion
  that skipped `ghostIndex`/`artifactById`/`edgeCountByArtifactId` — that bug dies
  with it. System-artifact edits now ride watcher → index → delta like every note.
- **New CI gate:** `tests/main/index-authority.test.ts` — `parseArtifact` invoked only
  from `indexer.ts`; `buildGraph` only from `indexer.ts` + `vault-worker-helpers.ts`;
  worker imports no parser/gray-matter and ingests `VaultIndexEntry`; system-artifact
  runtime has no parse/readFile; App.tsx hydrates via snapshot+delta with no
  `fs.readFile` ingestion.
- **Docs (same commit):** `overview.md` (worker table row + vault-file-changes data
  flow rewritten around the single parse authority), `interface-contracts.md`
  (agent-write-watcher paragraph's vault-watcher contrast updated for the carve-out),
  local CLAUDE.md (new one-index-authority invariant line), PLAN.md item 5 completion
  note.

**Behavior change (intended, ratified by "single truth"):** main's index now includes
system artifacts, so MCP `search.query` / `graph.get_neighbors` / `graph.get_ghosts`
see sessions/patterns/tensions for the first time. The renderer already ingested them
pre-change (files + systemFiles hydration), so renderer graph/search/enrichment corpus
is unchanged.

**Verify evidence:** full `npm run check` green — **337 files / 4135 tests** (baseline
4122 + 13, +1 file), zero lint, zero type errors (re-run green after the two
spotcheck fixes). `npm run build` exit 0. New gate passes 5/5. Spotcheck-verifier
pass: checks 1–4, 6, 8 PASS; its check-5 finding (sidebar leak) and check-7 finding
(strandable hydration flag) fixed as above; its check-9 "probable regression"
(system artifacts inflating enrichment/graph counts) dismissed with evidence — old
App.tsx:198 already fed `files + systemFiles` to the worker. `npm audit`: 16 vulns
(2 low / 4 moderate / 10 high), all in the pre-existing sharp/libvips chain — count
rose from 7 since last handoff because NEW advisories published; no dependency files
changed in this diff.

## Landmines

- **`tests/main/index-authority.test.ts` is a permanent gate** alongside write-spine
  and tool-surface: any new markdown→Artifact parse site outside `indexer.ts`, any
  worker-side parsing, or any renderer content-read ingestion path trips it.
- **Facade read-your-writes does not emit deltas**: `VaultQueryFacade.refreshIndex`
  updates the index inline for the agent lane but does not touch `entriesByPath` or
  emit `vault:index-delta`; the watcher echo (~350ms) re-applies idempotently and
  carries both. Renderer view of an agent write lags by the echo — same as before.
- **Snapshot before vault init returns `{ entries: [] }`** by design; the only caller
  (orchestrateLoad) runs strictly after vault init. A new caller must keep that
  ordering.
- **Delta consumers must tolerate `artifact: null` entries** (parse failures now
  travel the wire instead of being dropped) and treat upserts as replace-by-path.
- **App.tsx's batch handler file-list logic is untested** (inline in the component);
  the system-artifact routing fix there has no dedicated regression test — check the
  sidebar when next in the app (a session/pattern write must appear under system
  files, not the regular tree).
- **Visual verification gap:** hydration + live-delta flow is unit/integration tested
  but not eyeballed in a live run. Cheap check when next in `npm run dev`: vault loads
  with graph populated, editing a note updates the graph within ~1s, editing a session
  artifact in the editor updates its card/graph presence.
- Spotcheck's "git status blind spot on this machine" finding was a false alarm: the
  two "invisible" doc files were the orchestrator's own edits landing mid-run.
- All prior landmines hold (design gates, visual baselines darwin-only, e2e fixture
  `state.json` rewrite — restore before commit; git index.lock retries; npm installs
  need `--cache /tmp/npm-cache-te`; skip-worktree check `git ls-files -v | grep ^S`;
  native PATH_OUT_OF_VAULT denials unaudited; MCP apply_plan renderer double-apply
  idempotence).
