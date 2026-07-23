# Handoff

Single-file handoff: **overwritten** at every clean checkpoint, never appended — git
history is the archive. A fresh agent starts here after reading `docs/PLAN.md` (the
canonical plan; do not restructure it) and `AGENTS.md` (conventions + working protocol).

**Position:** Layer 0 (Integrity) complete 2026-07-22. Next: Layer 1 (Foundations).

## What shipped last

- `be71003` — Layer 0 item 2: per-launch bearer token on the MCP endpoint. Admission
  on 127.0.0.1:41627 is now Host check + required `Authorization: Bearer <token>`
  (fresh each launch, never persisted, constant-time compare, 401 on missing/wrong).
  `mcp:status` exposes the token; Settings → MCP Server copies a full
  `claude mcp add` connect command including it. Tool registration untouched
  (`MCP_TOOL_COUNT` 12).
- `0be971a` — Layer 0 item 3: dead-code deletions. `vendor/tmux` +
  `resources/tmux.conf` gone (plus an inert `tmux-service` mock in
  `tests/main/shell-ipc.test.ts`); `ElectronHitlGate` and `TimeoutHitlGate` deleted
  from `hitl-gate.ts` (TimeoutHitlGate verified test-only first, per the prior
  handoff's decision point); `ClusterDraftSchema`/`ClusterDraft` + test deleted;
  librarian/curator renderer residue removed (FilesDockAdapter agent detection,
  FileTree action colors, tokens.ts librarian color).
- Item 1 (false MCP transport claims) had shipped in `debe976`; its residual-claim
  grep was re-run clean after items 2–3, and all three items are now marked complete
  in PLAN.md.
- Verification: `npm run check` green (331 files, 4063 tests), production build green,
  deleted-name greps clean across src/tests/e2e + living docs, knip strictly improved
  vs its pre-deletion baseline, `npm audit --omit=dev` reviewed (pre-existing findings
  only, see landmines), built-app e2e `mcp-gate-confirm.spec.ts` green with the token,
  and a built-app visual probe confirmed the Settings MCP section and sidebar render.

## Next step: PLAN.md Layer 1 (Foundations)

Start with item 1 (remaining Phase 2 primitive slices: `PanelHeader`, `EmptyState`,
ContextMenu consolidation — same migrate-all-consumers-per-slice method as the
completed Modal/Overlay and TabBar slices). Do not re-derive scope here; execute the
items as written in the plan.

## Landmines

- **PLAN factual error (needs Casey's eyes, not a silent fix):** Layer 0 item 3 called
  `section-rewriter`/`section-rematch`/`section-projection` "consumers with no
  producer". They are live: `FileViewCard.tsx` (registered canvas card `'file-view'`,
  created in `CanvasView.tsx`) imports all three. Only `ClusterDraftSchema` was dead.
  Deletion was scoped accordingly; the item's completion note in PLAN.md records the
  exception.
- **Librarian/curator follow-up (unratified, deliberately not done):** the removed
  FilesDockAdapter detection was the ONLY writer of `sidebar-selection-store`'s
  `agentActive`/`activeAgentLabel`, which gate the sole `markAgentModified` caller
  (App.tsx) feeding the file-tree "agent modified" badging pipeline
  (FileTree/FileContextMenu/Sidebar). That whole pipeline is now dormant — no action
  registry produces any of its labels (challenge/emerge/organize/tidy/compile either).
  Ripping it out is a coherent follow-up but exceeds Layer 0's "confirmed-dead"
  mandate; ratify before executing.
- **eslint uses `--cache`:** it masked a pre-existing `react-hooks/set-state-in-effect`
  error in FilesDockAdapter that only surfaced when the file changed. Full
  `npx eslint --no-cache .` is clean as of `0be971a`; if an "unrelated" lint error
  appears after editing a long-untouched file, suspect the cache, not your edit.
- The prior handoff claimed knip was "currently clean" — it wasn't (≈70 findings:
  unused exports/types/deps, all pre-existing). Baseline discipline: deletions must
  not add findings. `ClusterSectionSchema` is knip-flagged (pre-existing) but its
  inferred `ClusterSection` type is consumed by live section code.
- `npm audit --omit=dev` has pre-existing advisories: `@hono/node-server` (moderate,
  via `@modelcontextprotocol/sdk`; fix requires SDK major bump), `adm-zip` (high, via
  `onnxruntime-node`/`@huggingface/transformers`, no fix), `body-parser` (fixable).
  None introduced by Layer 0; triage separately.
- MCP clients now NEED the bearer token: a bare URL connect gets 401. E2E/probes must
  read `token` from `mcp:status` and send `Authorization: Bearer` (see
  `e2e/mcp-gate-confirm.spec.ts` for the pattern). The token rotates every launch, so
  externally configured clients (e.g. `claude mcp add`) must be re-added after each
  app restart — a known UX cost; revisit only with an explicit decision.
- `CLAUDE.md` is gitignored (local operator doc). `AGENTS.md` is its tracked twin;
  where they cover the same ground the wording must stay identical.
- Skip-worktree gotcha: `git ls-files -v | grep ^S` before assuming an edit landed.
- npm installs need `--cache /tmp/npm-cache-te` (root-owned cache files).
