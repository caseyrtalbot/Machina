# Work order: Phase 2 steps 5 ∥ 6 (parallel sessions, rebase discipline)

Delete this file in the docs commit that stamps the SECOND of the two steps DONE —
its content migrates into the step DONE blocks and HANDOFF.md, exactly like
`HANDOFF-PARALLEL-STEPS-5-6.md` did in Phase 1.

Base for both sessions: `c54a6d6` (main, 2026-07-07). Cold-start order for each
session: `HANDOFF.md` → your step's section in `04-phase-2-specs.md` → the contracts
sections it names in `01-interface-contracts.md` (now **v1.2.4**) → this file's
discipline rules. PLAN.md decisions are locked.

## Why this pair needs a discipline file (4∥7 didn't)

The spec calls 5 and 6 "sequential" because they genuinely collide on ONE file:
`ApprovalsTray.tsx` (step 5 mounts `RevertAgentSection` in the popover; step 6 adds
the breaker-tripped notice row). Everything else is disjoint or append-only. Phase 1
ran its own steps 5+6 in parallel with a rebase discipline and it worked (step 6
landed first, step 5 rebased on fresh evidence). Same play here.

## Landing order and versions (pre-assigned, do not negotiate)

- **Step 5 lands FIRST** (smaller scope), contracts **v1.2.5**.
- **Step 6 lands SECOND**, contracts **v1.2.6** — write your changelog entry as
  v1.2.6 even though you will not see v1.2.5 in your tree.
- Changelog entries go at the TOP of the §8 changelog (reverse-chronological — the
  4∥7 "append at end" rule caused avoidable churn; top-insert conflicts are equally
  trivial and need no post-merge reorder).
- The step-6 session rebases onto main after step 5 lands and re-runs the FULL fresh
  gate (`npm run check` + `npm run build`) on the rebased tree before landing.

## File ownership

- `ApprovalsTray.tsx`: **step 5 owns the file.** Step 6 keeps its tray changes to a
  single self-contained inserted block (notice row rendered by its own component
  file) added in ONE hunk, and expects to hand-resolve that hunk on rebase. Build
  the actual UI in `agent-breaker-*.tsx` component files so the tray edit is a
  mount-only insertion.
- `palette-sources.ts`: step 5 only (revert entries). Step 6 does not touch it.
- `ThreadInputBar.tsx` / `ThreadPanel.tsx` header (kill switch): step 6 only.
- `ipc-channels.ts`, `preload/index.ts`: append-only at the very end of the relevant
  blocks, both sessions, never regroup existing entries (worked cleanly for 4∥7).
- `harness-service.ts` / `harness-types.ts` / `harness-run-registry.ts` /
  `agent-write-watcher.ts` / `cli-turn-registry.ts`: step 6 only. **Step 6
  restructures `listHarnesses` around step 7's `inspectHarness` composition** — do
  not resurrect the pre-step-7 skip-not-throw shape, and note the spec's line
  anchors for these files predate step 7's landing: `rg` everything first.
- `git-service.ts` / `ipc/git.ts` / `RevertAgentSection.tsx`: step 5 only.
- Neither session touches `HANDOFF.md` (orchestrator reconciles post-merge), this
  file, `thread-store.ts`, `CLAUDE.md`/`AGENTS.md`, or the untracked `.agents/`.

## Scope gates carried from the spec + open questions

- **Step 6: EXCLUDE the workspace-switch visibility graft** (the ApprovalsTray
  "live PTYs from a non-active root" note + per-thread kill). OQ8 is NOT ratified
  by Casey as of 2026-07-07. The spec marks it severable; step 6 lands green
  without it and the graft becomes its own small follow-up commit after the call.
- Step 6 budgets semantics are pre-decided in the spec — per-thread-per-slug,
  snapshot-at-bind, the two never-trip negative rules. Do not re-litigate; test them.
- Step 5's confirm-dialog copy must follow the §4 containment framing: revert
  creates new commits, it is not protection and does not delete history.

## Verification discipline (lessons paid for by 4∥7 — do not rediscover)

- Worktree sessions run `npm run check` + `npm run build` fresh before their
  commit. **Do NOT run `npm run test:e2e` or any Playwright probe in a worktree**:
  non-packaged runs share `~/Library/Application Support/Electron/`; parallel e2e
  runs poison each other. Write your built-app probe spec; the orchestrator
  executes all e2e sequentially post-merge.
- When writing probes, the evidence mechanisms that actually work (4∥7 shipped
  plausible-but-unrunnable probes and lost a fix cycle):
  - PTY shells have an EMPTY argv — find them with `lsof -a -d cwd` on the
    realpath'd workspace root, never `pgrep -f <path>`.
  - xterm renders to a WebGL canvas: terminal text is NOT in the DOM. Read it via
    the guest-scoped `window.__terminalText()` hook in `TerminalApp.tsx`.
  - Every spec helper must use the boot-settle guard pattern (wait for app shell OR
    FirstRunScreen before seeding `lastWorkspacePath` and reloading) — see the
    helpers in `e2e/watcher-health.spec.ts` / `e2e/agent-projection.spec.ts` /
    `e2e/harness-lint.spec.ts`; copy one.
  - Clicking a deliberately `aria-disabled` element needs `{ force: true }`.
  - `git restore e2e/fixtures/test-vault` if anything dirties it.
- One commit per step on your branch: `feat: Phase 2 step N — <summary>
  (contracts v1.2.X)`, contracts amendment + your DONE block in
  `04-phase-2-specs.md` in the SAME commit. Deviations recorded honestly.

## Exit reminders (full statements in the spec)

- Step 5: Playwright probe on a throwaway repo — two agents' commits grouped, UI
  revert of A leaves B intact, list refreshes to exclude reverted shas.
  Casey-observed: tray revert without the DevTools console.
- Step 6: breaker trip matrix ⇒ kill exactly once + audit + event; the two negative
  tests (never trip on degraded-alone, never kill on `concurrentTurns`); budgets
  snapshot-at-bind (post-bind SKILL.md edits affect the next run only).

## Still pending Casey (do not resolve, do not block on)

OQ7 (before step 8), OQ8 (step-6 graft), the observed acceptances listed in
HANDOFF.md "Next work order", dependabot triage (GitHub: 4 vulns, 2 moderate 2 low;
`npm audit --omit=dev`: 1 moderate js-yaml).
