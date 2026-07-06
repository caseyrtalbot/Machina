# Parallel work order — steps 3 + 4 (written post step 2, `3198ddd`)

Two sessions can run these steps simultaneously: step 3 (gate parity) and step 4 (dock
IDE shell) touch almost disjoint code, and both depend only on work that has already
landed. Each session: read `HANDOFF.md` in this folder first (the cold start), then your
step's section in `02-phase-1-specs.md` and your contracts section in
`01-interface-contracts.md`. This file adds only what two simultaneous sessions need to
avoid colliding — it restates nothing. Delete it once both steps have landed and their
doc-sync passes are done.

AGENTS.md regeneration is deliberately parked — do not do it, do not block on it.

## Session A — step 3, gate parity (the safety-critical one)

You are building the producers that fill the approval queue step 2 shipped empty:
`CliTurnRegistry` (turn windows with linger + degraded PTY-alive fallback),
`AgentWriteWatcher` (own chokidar, OWN ignore policy — never vault-watcher's),
`QueueHitlGate` (unit-tested convergence seam, not wired over the MCP gate this step),
and the renderer `ApprovalsTray` with the honest post-persistence copy. Spec: step 3 in
`02-phase-1-specs.md`; contract: `01-interface-contracts.md` §4 (v1.1.1). Consume step
2's seams exactly as HANDOFF.md "What step 2 changed under you" describes:
`getApprovalQueue()` from `src/main/ipc/git.ts`, `recordWrites`, `enqueueGateConfirm`,
`headSha` for the headMoved tripwire. The pre-run snapshot stays wired — step 5 retires
it, not you.

Files you own (session B stays out): `cli-turn-registry.ts`, `agent-write-watcher.ts`,
`queue-hitl-gate.ts` (all new), `cli-thread-spawner.ts`, `cli-agent-thread-bridge.ts`,
`src/main/ipc/git.ts` / `ipc/shell.ts`, the `hasPendingWrite` seam in
`document-manager.ts`, `approvals-store.ts` + `ApprovalsTray.tsx` and its AgentShell
mount.

## Session B — step 4, minimal dock IDE shell

You are building the terminal strip, migration affordances, and file-open: strip store +
`TerminalStrip.tsx`, dock↔canvas migration via the existing `terminal:reconnect` seam,
`fs:select-file`, palette items, ctrl+backquote. Spec: step 4 in `02-phase-1-specs.md`;
contract: `01-interface-contracts.md` §3 (projection = existing seam; no new subsystem).
Two cautions from the docs: `thread-store.ts` is at 825 lines — exactly the three
surgical touches the spec lists, nothing else; and the final migration acceptance
(tick-counter continuity across strip→canvas→strip) is Casey observing the running app —
schedule that with him, everything else is yours to verify. If it fits naturally, fold in
the known FilesDockAdapter split-brain fix (HANDOFF.md "Known follow-ups": route
`handleOpenVaultPicker`/`handleSelectVault` through `workspace.open()`); if it does not
fit, leave it and say so in your handoff update.

Files you own (session A stays out): `terminal-strip-store.ts`, `TerminalStrip.tsx`,
`terminal-webview-src.ts`, `terminal-migration.ts` (all new), `thread-types`,
`thread-store.ts`, `TerminalDockAdapter.tsx`, `FilesDockAdapter.tsx`, `canvas-store.ts`,
`TerminalCard`, `SideDockRibbon`, palette, keybindings, `src/main/ipc/filesystem.ts`.

## Coordination contract

- **Isolation**: one Conductor worktree per session (the established pattern for this
  repo), merged to main when green; verify `git worktree list` shows only the canonical
  clone afterward. If only one session runs at a time, work directly in
  `~/Projects/thought-engine` on main as usual.
- **Shared hotspots — append-only**: both steps add to `ipc-channels.ts` and
  `src/preload/index.ts` (A: optional `agentId` on `cli-thread:spawn`/`input`; B:
  `fs:select-file`). Append within each file, never reorder, and the eventual merge is
  trivial. `AgentShell` is touched by both (A mounts the tray, B mounts the strip in
  SurfaceDock) — keep each mount a single self-contained insertion.
- **Landing order**: first session to a fully green gate lands on main. The second
  rebases onto it, re-runs the FULL gate fresh (`npm run check`, `npm run build`,
  `npm run test:e2e`, your step's smoke), and only then lands. Never land on a red or
  stale gate run.
- **Do not run two app instances at once**: non-packaged runs (dev, e2e, Playwright
  probes) share `~/Library/Application Support/Electron/` for electron-store and
  localStorage. Stagger e2e runs and smoke probes between the sessions, or they will
  pollute each other's state.
- **Before committing**: `git restore e2e/fixtures/test-vault/.machina/state.json` (e2e
  dirties the fixture), and leave the untracked `.agents/` directory alone.
- **On landing, same commit or an immediate docs commit**: mark your step DONE in
  `02-phase-1-specs.md`, add a "What step N changed under you" section to `HANDOFF.md`
  for whoever runs steps 5–6, and amend `01-interface-contracts.md` (with a §8 changelog
  entry) for any deliberate deviation. When both steps are done, delete this file.
