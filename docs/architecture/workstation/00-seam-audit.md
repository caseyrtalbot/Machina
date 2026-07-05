# Workstation Phase 0 — Seam Audit

Re-verification of the extractability audit against the working tree (2026-07-05, HEAD
`7735644`). Every claim below carries file:line evidence from this tree, not from the prior
audit session. This document is the work order for Phase 1 (tracer bullet) of the
agentic-workstation plan; the companion contracts live in `01-interface-contracts.md`.

## 1. Lift modules are notes-kernel-free — confirmed

Runtime import graphs (type-only imports excluded):

| Module | Imports |
| --- | --- |
| `src/main/services/pty-service.ts` | `./pty-write-queue`, `./ring-buffer`, `./session-paths`, `child_process`, `node-pty` |
| `src/main/services/pty-write-queue.ts` | — |
| `src/main/services/ring-buffer.ts` | — |
| `src/main/services/session-router.ts` | `electron` |
| `src/main/services/block-watcher.ts` | `@shared/engine/block-detector`, `@shared/engine/block-model`, `@shared/engine/terminal-text` |
| `src/main/services/shell-hook-installer.ts` | `fs`, `path` |
| `src/main/services/hitl-gate.ts` | `electron` |
| `src/main/services/audit-logger.ts` | `node:fs/promises`, `node:path` |
| `src/main/services/path-guard.ts` | `../utils/paths`, `@shared/agent-types` |
| `src/shared/engine/block-detector.ts` | — |
| `src/shared/engine/block-model.ts` | `./secrets` |
| `src/shared/engine/terminal-text.ts` | — |

None of these touch the notes kernel (`parser`, `graph-builder`, `ghost-index`,
`search-engine`) or any vault service. The PTY core, block protocol, and safety trio lift
into a workspace-generic world without surgery.

## 2. Workspace-generalization work order

The single-vault assumption is smaller than expected — one module-level singleton plus one
config key:

**The singleton.** `src/main/ipc/filesystem.ts:34-36` — `setActiveVault(vaultPath)` builds a
module-level `activePathGuard` + `activeVaultRoot` on `vault:load`
(`filesystem.ts:188-194`), with an `onVaultReady` callback hook (`filesystem.ts:26-29`).
This is the object the Workspace service replaces.

**`lastVaultPath` production reads/writes (3 sites + tests):**

- `src/main/ipc/cli-thread.ts:28` — spawn-on-demand cwd for persisted CLI threads
- `src/renderer/src/App.tsx:198` — persisted on every vault load
- `src/renderer/src/components/FirstRunScreen.tsx:18,24` — boot resolution / clear
- `src/renderer/src/components/__tests__/FirstRunScreen.test.tsx` — test stubs

**PathGuard call sites (rename `resolveInVault` → workspace-rooted; behavior unchanged):**
`src/main/ipc/filesystem.ts`, `src/main/ipc/ghost-emerge.ts`, `src/main/mcp-cli.ts`,
`src/main/services/mcp-lifecycle.ts`, `src/main/services/machina-native-tools/context.ts:90`
(`resolveInVault`, used by `note-tools.ts` ×4 and `canvas-tools.ts`),
`src/main/services/vault-query-facade.ts`, `src/main/utils/asset-import.ts`.

**Already per-instance, no surgery needed:**

- `ThreadStorage` takes its root in the constructor (`thread-storage.ts:26`,
  `constructor(private readonly vaultPath: string)`).
- `ShellService.create(cwd, …)` already accepts a per-session cwd
  (`shell-service.ts:36-45`) — spawn-terminal-anywhere is a renderer affordance away, not a
  service change.
- `cli-thread:spawn` already takes `cwd` from the renderer (`cli-thread.ts:19-21`); only the
  spawn-on-demand fallback (`cli-thread.ts:28`) hardcodes the config key.

**MCP tool names to alias `vault.*` → `workspace.*`:** `src/main/services/mcp-server.ts:77`
(`vault.read_file`), `:224` (`vault.write_file`), `:280` (`vault.create_file`).

## 3. Gate-parity work order (CLI-agent write path)

Confirmed: **CLI-agent writes bypass gate, audit, and PathGuard entirely.** The full path:

1. `cli-thread-spawner.ts:147` spawns a plain shell PTY via `ShellService.create`.
2. `formatCliInvocation` (`cli-thread-spawner.ts:64-97`) builds
   `claude --print --verbose --output-format stream-json '<prompt>'` (codex/gemini
   equivalents) and `sendUserMessage` writes it into the PTY
   (`cli-thread-spawner.ts:188`, via `writeAgentInput`).
3. The CLI child process writes to disk directly, at the user's full permission level. No
   `HitlGate`, no `AuditLogger`, no `PathGuard` anywhere on this path.

**The only mitigation is the pre-run snapshot**: `commitPreAgentSnapshot(cwd, threadId)` at
spawn (`cli-thread-spawner.ts:135`, impl `vault-git.ts:32`) — `git add -A` + commit, with
structured no-ops for non-repo / `.machina/no-auto-commit` opt-out / clean tree / git
failure.

**New finding — snapshot granularity is PTY-lifetime, not turn.** `input()` only respawns
(and thus only re-snapshots) when no live session is bound
(`cli-thread-spawner.ts:164-167`); turns 2..n on a live PTY run with no fresh snapshot.
Rollback today can lose earlier approved-in-spirit turns along with a bad final turn.
Commit-per-approval (Phase 1 step 4) fixes this properly; until then this is a known
limitation, not a regression to introduce.

**Interception constraint.** The CLI runs as an independent child process — its writes
cannot be routed through `HitlGate` in-process. Gate parity therefore means post-hoc
interception: watch → diff → approval queue → commit-or-revert. The mechanism is specified
in `01-interface-contracts.md` §4. Per-CLI native hooks (Claude Code
`--permission-prompt-tool`) are a later, adapter-specific upgrade.

## 4. PTY survival across webview teardown — statically confirmed

- PTYs are owned by the main process (`pty-service.ts`); the terminal webview is a renderer
  surface with its own preload (`src/preload/terminal-webview.ts`).
- `session-router.ts` maps `sessionId → webContentsId` and auto-cleans destroyed
  webContents on lookup (`getWebContents`, returns null rather than throwing) — output for
  an unprojected session is dropped, not fatal, and the ring buffer
  (`ring-buffer.ts`, wired in `pty-service.ts`) retains scrollback for replay.
- `terminal:reconnect` already exists as an IPC channel (`ipc-channels.ts:115`) — re-attach
  is a supported flow today, which is exactly the projection re-parenting primitive Q8
  needs.

Remaining manual check (needs a display; not runnable in CI): live dock↔canvas migration
of a session with an active foreground process, verifying no dropped output during the
re-attach window. Tracked as a Phase 1 step-3 acceptance item.

## 5. Coordination with the production-grade plan

`docs/refactor/production-grade-plan.md` (Wave 1 ground rule) gives item 1.9 exclusive
ownership of `src/shared/ipc-channels.ts`, `src/preload/index.ts`, and
`src/main/index.ts`, and forbids other Wave 1 items from adding IPC channels. The
workstation track adds channels (contracts §5) — sequence any Phase 1 implementation that
touches those three files after Wave 1 item 1.9 lands, or rebase over it. Item 1.1's
PathGuard hardening of `shell:*`/`fs:*` handlers overlaps §2 above and should land first;
the workspace rename then picks it up wholesale.

Lessons log location: this track uses the existing `docs/refactor/` convention (the plan
draft said `docs/refactor-log/`; that directory does not exist — reconciled here).
