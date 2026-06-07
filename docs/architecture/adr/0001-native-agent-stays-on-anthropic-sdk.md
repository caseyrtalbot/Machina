# ADR 0001: Native in-app agent stays on `@anthropic-ai/sdk` (no Claude Agent SDK migration)

- **Status:** Accepted (2026-06-06)
- **Deciders:** Casey (solo)
- **Area:** agents, native-agent, safety-subsystem

## Context

Machina runs three agent paths (see `CLAUDE.md` → Key Subsystems → Agents):

1. **PTY Claude** (`agent-spawner.ts`) — spawns the Claude Code CLI in a real PTY.
2. **Native in-app agent** (`machina-native-agent.ts`) — an in-process `@anthropic-ai/sdk`
   `messages.stream` tool loop over `NATIVE_TOOLS`.
3. **CLI thread spawner** (`cli-thread-spawner.ts`) — a per-thread PTY running
   `cli-claude` / `cli-codex` / `cli-gemini`.

Path 2 exists specifically to run *inside the Electron main process*. Its tool loop
(`callTool`) drives in-process bridges directly:

- **emit / approval** — `emitPending` + `awaitApproval` surface the per-write HITL gate
  in the renderer.
- **dock** — `emitDockAction` drives the surface dock from the agent.
- **canvas** — `dispatchCanvasPlan` pushes mutations into the renderer's in-memory canvas
  store so a debounced autosave can't clobber an agent write.

The optimization survey asked: should path 2 migrate to the **Claude Agent SDK**
(`@anthropic-ai/claude-agent-sdk`)?

## Decision

**No.** The native agent stays on `@anthropic-ai/sdk`.

The Claude Agent SDK is a client over the **Claude Code CLI runtime** (verified 2026-06-06
via Context7: every SDK variant describes itself as "interacting with Claude Code CLI").
Adopting it for path 2 means depending on the Claude Code CLI being present and driving its
agent loop, replacing the current footprint, which needs only an Anthropic **API key**
(`resolveAnthropicKey`) and no CLI on the user's machine.

That CLI-runtime model is exactly what paths 1 and 3 already provide. Path 2 is deliberately
the minimal, in-process, API-key-only path, and its whole reason to exist is the in-process
emit / dock / canvas bridges above. We own its tool loop, so the iteration and token caps and
the error classification (`classifyError`) stay under our control.

## Pinned facts (verified 2026-06-06 against `machina-native-agent.ts`)

| Fact | Value | Source |
|---|---|---|
| SDK | `@anthropic-ai/sdk` `0.92.0` | `package.json` (`^0.92.0`), installed `0.92.0` |
| API surface | `client.messages.stream(...)` (streaming) | `machina-native-agent.ts:220` |
| Tool-loop cap | `MAX_TOOL_ITERATIONS = 8` | `machina-native-agent.ts:17` |
| Output cap | `MAX_TOKENS = 4096` | `machina-native-agent.ts:16` |
| Model | injected per run (`opts.model`), not hardcoded | `machina-native-agent.ts:22` |
| Auth | API key only (`resolveAnthropicKey`) | `machina-native-agent.ts:4` |

## Consequences

- The native path keeps its in-process safety guards: PathGuard on note and canvas ops,
  per-write HITL approval (forced under autoAccept when the write-velocity limiter trips), and
  append-only audit logging on every successful write. See `docs/architecture/safety-subsystem.md`.
- We do not get the Agent SDK's built-in context management, subagents, or session features for
  free. If those become load-bearing for the in-app agent, this decision should be revisited.

## Revisit if

- We want the native path to run tools out-of-process anyway (for example, to add a sandbox
  boundary), accepting the loss of the in-process bridges.
- The Agent SDK gains an in-process / library mode that does not require the Claude Code CLI
  runtime.
