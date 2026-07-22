# Handoff

Single-file handoff: **overwritten** at every clean checkpoint, never appended — git
history is the archive. A fresh agent starts here after reading `docs/PLAN.md` (the
canonical plan; do not restructure it) and `AGENTS.md` (conventions + working protocol).

**Position:** Plan ratified, workspace sanitized. Build not started. Next: Layer 0.

## What shipped last

- `debe976` — vision ratified: `docs/PLAN.md` restructured as the layered track (exit
  bar D6 = Loop Runner v0), ADRs 0004/0005 added, stale identity and false safety
  claims repaired across README, AGENTS.md, package.json, overview, getting-started,
  and safety-subsystem; `safety-subsystem.md` newly tracked (was gitignored).
- Verification: `npm run check` green — lint, both typechecks, 4067/4067 tests.

## Next step: PLAN.md Layer 0 (Integrity)

Execute the Layer 0 items as written in the plan; do not re-derive scope here.
State of the three items:

1. False MCP doc claims — **shipped in `debe976`** (mark complete in PLAN.md at layer
   close). Re-run the residual-claim grep after Layer 0's code changes land.
2. Per-launch bearer token on the MCP endpoint — open.
3. Dead-code deletions — open.

## Landmines

- `CLAUDE.md` is gitignored (local operator doc). `AGENTS.md` is its tracked twin;
  where they cover the same ground the wording must stay identical.
- Skip-worktree gotcha: `git ls-files -v | grep ^S` before assuming an edit landed.
- npm installs need `--cache /tmp/npm-cache-te` (root-owned cache files).
- Item 2: `MCP_TOOL_COUNT` (12) is pinned by a transport-level test — the bearer-token
  change must not alter tool registration. The admission chokepoint is the Host check
  in `mcp-lifecycle.ts`.
- Item 3: `TimeoutHitlGate` sits beside `ElectronHitlGate` in `hitl-gate.ts` and is
  also production-orphaned on the MCP path — verify test-only usage before deciding
  whether it joins the deletion.
- Item 3: the sidebar `activeVaultAgent` state has consumers in `FileTree.tsx` and
  `FilesDockAdapter.tsx` — delete the consumers with the state, not just the state.
- Item 3: re-run `npx knip` after deletions (currently clean; keep it clean).
- Doc-reconciliation: item 3 touches rows in `safety-subsystem.md`'s code-map table
  (the `ElectronHitlGate`/`TimeoutHitlGate` rows) — update in the same commit.
