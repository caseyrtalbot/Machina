# ADR 0002: In-process MCP server connects a localhost Streamable HTTP transport

- Status: accepted
- Date: 2026-06-10
- Plan item: production-grade plan 2.3 (a superseded 2026-06 plan, removed 2026-07-21; see git history — plan of record is now `docs/PLAN.md`)

## Context

Since its introduction, the in-process MCP server (`McpLifecycle.createForVault` in
`src/main/services/mcp-lifecycle.ts`) was built with all nine tools registered but never
connected to a transport. No external client could reach it; `isRunning()` was always
false in production, the `mcp:status` IPC channel was deleted in plan item 1.9 because
nothing could call it, and the hardcoded `_toolCount = 6` had drifted from the real
tool registry (9: six reads + three gated writes).

The only working MCP surface was `mcp-cli.ts`: a headless stdio server that Claude Code
spawns as a subprocess. It is deliberately read-only — without Electron there is no
dialog for the HITL gate — so the gated-write half of the safety subsystem
(TimeoutHitlGate, WriteRateLimiter, audit log, Spotlighting) was unreachable from any
external agent.

A second freshness problem compounded this: the main-process `VaultIndex`/`SearchEngine`
were built once at vault open and never updated, so MCP `search.query`, `graph.*`, and
ghost results were frozen at vault-open time.

## Decision

Connect the in-process server to a **Streamable HTTP transport bound to 127.0.0.1**,
rather than deleting it or attempting stdio.

- **Why not stdio:** the in-process server lives inside the Electron main process. Stdio
  transports require the client to own the server's stdin/stdout, which is impossible
  for a GUI app the user launches — there is no client on the other end of the pipe.
  Stdio remains the right transport for the subprocess case, which `mcp-cli.ts` already
  covers (read-only).
- **Why not delete:** gated writes approved by the human in the running app are the
  differentiator. Claude Code / Claude Desktop connecting over HTTP get
  `vault.write_file`, `vault.create_file`, and `canvas.apply_plan` behind the same
  ElectronHitlGate dialog, rate limiter, and audit log the rest of the safety subsystem
  uses. Deleting `createForVault` would strand that capability permanently.

Mechanics:

- `McpLifecycle` owns a `node:http` server on `127.0.0.1`, default port **41627**
  (`MACHINA_MCP_PORT` env override; falls back to an ephemeral port on `EADDRINUSE`,
  e.g. a second Machina instance). Endpoint path: `/mcp`.
- Each MCP session gets its own `McpServer` instance from a per-vault factory
  (the SDK binds one transport per server). The `VaultQueryFacade`, HITL gate,
  `WriteRateLimiter`, and `AuditLogger` are shared across sessions so safety state is
  vault-scoped, not session-scoped.
- Vault switches swap the factory and close existing sessions; the listener stays up.
- Requests with a non-localhost `Host` header are rejected (DNS-rebinding guard on top
  of the loopback bind).
- `mcp:status` is re-exposed (channel + preload + Settings surface) reporting
  `{ running, toolCount, url, vaultRoot }`; the stale `_toolCount` is replaced by
  `MCP_TOOL_COUNT = 12` (9 tools + 3 `workspace.*` aliases), guarded by a lifecycle test
  that lists tools over the transport.
- Index freshness: watcher batches feed `createLiveIndexUpdater` (vault-indexing.ts),
  and `VaultQueryFacade.writeFile`/`createFile` refresh the index inline so agents read
  their own writes before the watcher echo lands.

External client setup: `claude mcp add --transport http --header "Authorization: Bearer <token>" machina http://127.0.0.1:41627/mcp`
(Settings → MCP Server copies the full command, token included).

## Consequences

- External MCP clients gain live search/graph/ghost reads and human-gated writes
  against the open vault. Write confirms surface in the running app; an unattended
  app auto-denies after 30s (today via `QueueHitlGate`; the original dialog-based
  gates were deleted 2026-07-22, Layer 0).
- The endpoint shipped unauthenticated (loopback bind + Host allowlist only); a
  per-launch bearer token was added 2026-07-22 (`docs/PLAN.md` Layer 0). Current
  admission posture is canonical in `docs/architecture/safety-subsystem.md`.
- `mcp-cli.ts` stays as-is for headless/subprocess use; it remains read-only.
- The HTTP listener keeps running across vault switches; status reports the current
  vault root.
