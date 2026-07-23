# AGENTS.md

Codex-specific instructions for `/Users/caseytalbot/Projects/thought-engine`.
`CLAUDE.md` remains the fuller project reference. This file is a curated subset, not a
byte-identical mirror — but wherever both documents cover the same ground, the wording
must be identical: one source of truth, twice named. When an architecture fact changes,
update both files with the same words in the same change. `npm run sync:agents` is a
no-op guard so the scoped instructions cannot be overwritten accidentally.

## Plan of record

The only active plan is `docs/PLAN.md` (layered track: Integrity → Foundations → Signal
→ Engine → Face; the track's exit bar is Loop Runner v0, decision D6). The identity —
Machina is the governed workbench for agents you don't own — is recorded across
`docs/architecture/adr/0003-canvas-becomes-a-document-type.md` (canvas is a document
type; no supervisor lens),
`docs/architecture/adr/0004-spatial-authoring-descoped-canvas-becomes-projection.md`
(spatial authoring descoped; the canvas's future is a system-arranged projection
surface), and
`docs/architecture/adr/0005-design-constitution-constants-over-configuration.md`
(appearance is ratified constants, not preferences).
`docs/architecture/interface-contracts.md` is the contract reference for shipped
subsystems ("contracts §N / vX.Y" in code comments points there); all other build-track
records were removed 2026-07-21 and live in git history only. Do not take scope from any
other document; if you find a conflicting plan, stop and flag it.

Current position and next step: `docs/HANDOFF.md`.

Trust files on disk over memory, older drafts, or stale line numbers. Use `rg` to
re-locate symbols before editing.

## Working protocol

- **Single source per fact.** Every architecture fact lives in exactly one canonical
  document; everything else points at it and never restates it. Canonical homes:
  `docs/PLAN.md` (scope, sequence, gates), `docs/architecture/overview.md` (system map,
  data flows, renderer shell, store/worker inventory),
  `docs/architecture/safety-subsystem.md` (trust boundaries, gates, audit, MCP surface),
  `docs/architecture/block-protocol.md` (wire format),
  `docs/architecture/interface-contracts.md` (shipped interfaces),
  `docs/architecture/adr/` (decisions). This file holds conventions and pointers only.
- **The plan is canonical and stays untouched during execution.** `docs/PLAN.md` changes
  only at a layer boundary (marking items complete, with date and evidence pointer) or
  by an explicitly ratified amendment. Never restructure it mid-layer; on conflict, stop
  and flag.
- **Doc-reconciliation in the same commit.** A change that alters an architecture fact
  updates that fact's canonical home in the same commit. A claim assertable in CI
  (counts, invariants, contrast ratios) gets a test, not a sentence.
- **Clean handoffs.** Work concludes only at a green checkpoint (`npm run check` plus
  the item's verify gate). Conclude by overwriting `docs/HANDOFF.md` — a single file,
  never appended, git history is the archive — with: position in the plan, what shipped
  (commits + verification evidence), the exact next step, and landmines. A fresh agent
  must be able to start from `docs/PLAN.md` + `docs/HANDOFF.md` + this file alone.
- **Greppable gates define done.** No item is complete until its verify gate passes
  in-tree; no checkbox without the gate.
- **Lean docs.** Delete superseded content outright; no historical banners or
  deprecation stubs — git history is the archive.

## Multi-agent workflow

- When two or more workstreams are independent, dispatch them in one wave with explicit,
  non-overlapping file ownership. Keep integration and final decisions in the primary thread.
- Give every delegated task its source-of-truth documents, acceptance criteria, and required
  evidence. Agents may spawn narrower helpers, but they must not duplicate another agent's edits.
- Use an independent cold read for changes to trust boundaries, attribution, harness scopes,
  verification gates, or the built-in agent roster. Findings need file:line evidence and an
  explicit clean/no-finding result for reviewed areas.
- Review every agent diff before accepting it. Fresh verification is required after integration;
  an agent's green focused test is evidence, not a completion claim for the combined tree.

## Commands

```bash
npm run dev          # Start Electron app with HMR
npm run dev:debug    # Dev with CDP debugging port (REMOTE_DEBUGGING_PORT=9222)
npm run build        # Typecheck + build all (main, preload, renderer)
npm run build:mac    # Build + package for macOS
npm test             # Run all tests (vitest)
npm run test:e2e     # Build + run Playwright e2e tests
npm run test:live    # CDP health checks against running dev app
npm run check        # lint + typecheck + test (quality gate)
npm run package:install  # Package + copy to /Applications
npm run mcp-server   # Build + run headless MCP CLI server
```

Single test: `npx vitest run path/to/file.test.ts`

**npm workaround**: Cache has root-owned files. Use `--cache /tmp/npm-cache-te` for installs.

## Git workflow

- Commit directly to `main` per completed task. This explicitly overrides the global branch-before-commit rule (solo-dev decision by Casey; branches add ceremony without payoff here).
- Mandatory pre-commit gate before every commit: full `npm run check` + build + dependency audit + visual verification. No shortcuts.
- **Skip-worktree gotcha**: some files may be flagged skip-worktree, so Write/Edit changes are silently ignored by git. Check with `git ls-files -v | grep ^S` and clear with `git update-index --no-skip-worktree <file>`.
- E2E can dirty `e2e/fixtures/test-vault/.machina/state.json`; never include that runtime
  mutation in a product change.
- Never weaken or bypass a red gate. Record exact failures and root causes.

## Working discipline

- No features, refactors, or abstractions beyond what the task requires. Do the simplest thing that works well — no designing for hypothetical futures, no premature abstraction, no half-finished implementations.
- No error handling, fallbacks, or validation for scenarios that cannot happen. Trust internal code and framework guarantees; validate only at system boundaries (user input, external APIs). No feature flags or backwards-compatibility shims when you can just change the code.
- Delegate independent subtasks to subagents and keep working while they run; intervene when a subagent drifts or is missing relevant context.
- Agent capability routing: Sonnet or Opus for rudimentary/mechanical tasks; Fable for anything complex or requiring sophistication. Bias toward the more capable, especially when unsure.

## Final summaries

- Terse shorthand between tool calls is fine (that's thinking out loud); the final summary is for a reader who saw none of it.
- After a long unattended stretch, write the final message as a re-grounding, not a continuation: outcome first in one sentence, then supporting detail, then the one or two things needed from Casey, each explained as if new.
- Drop working shorthand: complete sentences, spelled-out terms, no arrow chains, no labels invented mid-session. Choose clear over short.

## Architecture

| Process | Entry | Source |
|---------|-------|--------|
| Main (Node.js) | `src/main/index.ts` | IPC handlers (`ipc/`), services (`services/`) |
| Preload (Bridge) | `src/preload/index.ts` | Exposes `window.api` with typed namespaces |
| Renderer (Browser) | `src/renderer/src/main.tsx` | React app: `panels/`, `hooks/`, `store/`, `design/` |
| Shared | (imported by all) | `src/shared/` — types, IPC contracts, pure engine kernel |

**Engine kernel** (`src/shared/engine/`): pure TypeScript — zero Electron/React/Node imports; consumed by main, renderer Web Workers, and the headless CLI. `src/renderer/src/engine/` re-exports it. Must stay dependency-free.

**Dev/prod isolation**: `TE_DIR` (`src/shared/constants.ts`) resolves to `.machina-dev` in dev, `.machina` in production/tests. Never hardcode `.machina`.

### Path aliases

| Alias | Resolves to | Available in |
|---|---|---|
| `@shared/*` | `src/shared/*` | main, preload, renderer |
| `@renderer/*` | `src/renderer/src/*` | renderer only |
| `@engine/*` | `src/renderer/src/engine/*` | renderer only |

### IPC pattern

`typedHandle('channel', handler)` in main → `typedInvoke('channel', args)` in preload → `window.api.namespace.method()` in renderer. Adding a channel is a 4-step, compile-checked change:

1. Declare in `IpcChannels` or `IpcEvents` in `src/shared/ipc-channels.ts`
2. Register `typedHandle(...)` in the appropriate `src/main/ipc/*.ts` file
3. Expose in `src/preload/index.ts` under the right namespace
4. Call via `window.api.namespace.method()` in renderer

Wrap critical renderer→main calls with `withTimeout(call, ms, label)`.

Main owns workspace roots and security-relevant decisions. Do not trust renderer-supplied
roots, harness identities, or approval state when main can resolve them authoritatively.

### Canonical detail docs

Read before working in an area; never restate their content here:

- System map, data flows, workers, renderer shell, store inventory: `docs/architecture/overview.md`
- Agent trust boundaries, gates, audit, Spotlighting, MCP surface (live Streamable HTTP endpoint on 127.0.0.1:41627): `docs/architecture/safety-subsystem.md`
- Terminal Block Protocol wire format and degraded mode: `docs/architecture/block-protocol.md`
- Shipped subsystem interfaces: `docs/architecture/interface-contracts.md`

### Standing invariants

- All agent-originated note writes route through `writeStampedNote` (`src/main/utils/note-write.ts`); all agent-originated PTY input through the spawner's `writeAgentInput` — never raw PTY writes.
- Safety posture only moves toward parity: approvals gate, audit, PathGuard, and Spotlighting behavior never regress.
- **Shared TabBar primitive** (`components/tabbar/TabBar.tsx`): every real tab row renders through it — skins via `variant` (`underline|chrome|pill`), behavior via optional props. `role="tab"`/`tablist` and the `te-tab*` CSS vocabulary exist only there; new tab UIs must use it; mode switches/segmented controls use `aria-pressed`, not `role="tab"`.
- **One menu primitive** (`components/ContextMenu.tsx`): every menu popup renders through it — `role="menu"`/`role="menuitem"` exist only there. Menu content is authored as `ContextMenuEntry[]` (inline or in a `*-menu-entries.ts` builder), never as a wrapper component with its own item model. Anchored pickers that aren't menus (AgentPicker) use `role="listbox"`.
- **One empty/loading vocabulary** (`components/emptystate/`): panel empty states render through `EmptyState` (eyebrow → title → body → actions → hint; `card`/`plain` variants), ring spinners through `Spinner` (`.te-spinner`, currentColor), plain-text loading blocks through `LoadingState`. No bespoke `animate-spin` rings or hand-rolled empty-state cards; the check-circle glyph lives only in `CheckCircleIcon`.
- **One panel header pattern** (`components/panelheader/PanelHeader.tsx`): panel-top chrome renders through `PanelHeader` — `bar` (44px hairline-bottom, label-left/actions-right, `flush` for full-bleed content) and `masthead` (content-flow heading) — and the `te-panel-header*` CSS vocabulary exists only there. Detached floating chrome (canvas toolrail, graph chips/buttons) takes its chip recipe from `.te-float-chip`, never inline glass styles.
- **Singleton editor surface**: the dock holds at most ONE editor tab (`{ kind: 'editor' }`, kind-keyed, no path). Note identity lives only in editor-store; open notes via `openNoteInEditor(path, { preview?, title? })` from dock-store — never by constructing an editor DockTab with a path and never by pairing `setActiveNote` with a manual dock open. Agent-driven editor opens carry the note as `DockAction.notePath`, not on the tab.
- Stores own one domain each (inventory in overview.md). Extend existing stores, IPC maps, adapters, and dock patterns; never create a parallel implementation.
- Design: dark-only; import from `design/tokens.ts`, never hardcode hex or px; accent applied at runtime via `applyAccentCssVars`. Target state is ADR 0005 (constants over configuration; lands in PLAN Layer 1). Non-CSS consumers (Pixi, mermaid) read resolved values via `getComputedStyle`.
- Editor: Tiptap 3 with markdown round-trip; only ship block types with clean round-trip. Content pushes happen in user-action callbacks, never via `useEffect`.

## Agent safety invariants

- CLI-agent containment is post-persistence, not write prevention. Writes are already on
  disk when reviewed; Approve commits them and Reject reverts them through git. UI and
  docs must describe this honestly.
- Rollback coverage is the approvals gate. Do not reintroduce the retired pre-run snapshot
  or weaken watcher/queue/revert coverage without an equivalent evidence gate.
- `AgentWriteWatcher` has its own ignore policy. Reusing vault-watcher ignores would blind
  dotfiles, `.env`, and harness verification files.
- The deliberate hardcoded-path exception is `HARNESS_PROTECTED_GLOBS`, which covers both
  `.machina` and `.machina-dev`.
- Harness creation is refuse-before-write. Calls with `overrides` constructively union
  mandatory protected globs before validation; template-only calls must instead refuse a
  defective template that omits them. In both paths, validate scope, lint, and prove the
  generated frontmatter round-trips before `mkdir` or file output.
- `HarnessRunRegistry` is the thread-to-agent attribution authority. Thread frontmatter is
  display/persistence input, not authority. Bindings snapshot the authoritative adapter;
  a positively known adapter/identity mismatch fails closed before PTY input.
- Ad-hoc `cli-raw` remains a plain PTY with structured input disabled. A harness-bound raw
  turn requires a main-validated, single-line invocation template containing a standalone
  `{prompt}` command word; every placeholder is unquoted/unescaped in one hook-observable
  simple command. Reject controls, DEL/C1 bytes, lone UTF-16 surrogates, arithmetic/
  subscript contexts, unstable spacing/escapes, interactive history expansion, and
  unquoted literal arguments after the executable. Prompt substitution is single-quoted,
  the final PTY command is validated, and the executable is alias-stabilized. Same-named
  shell functions remain an explicit shell-resolution caveat. The template is snapshotted
  in the main-owned binding, never trusted from renderer thread state.
- All agent-originated PTY input continues through the spawner and `writeAgentInput` so
  write arbitration and attribution-window ordering remain intact; never write a raw
  harness command directly to a PTY. Queue refusal must roll back both the raw expectation
  and the turn window.
- A harness run lints, prompts, and binds from one main-read snapshot. Required harness
  files and `handoffs/` must remain regular, realpath-confined entries; never follow a leaf
  symlink into prompt or verification content.
- Preserve degrade-not-fail semantics where the contracts require them, but surface
  degraded containment visibly and audit the coverage gap.
- Renderer IPC timeouts are non-cancelling. A timed-out agent delivery, spawn, harness run,
  or thread save is `indeterminate`, not retryable success/failure. Keep the late operation
  attached, replay Stop onto late native run ids when possible, and keep sending blocked
  until main-originated completion/refusal settles it. Thread deletion/close must tombstone
  late work; workspace switches fence stale dispatch state without auto-killing
  old-workspace PTYs unless OQ8 is separately ratified.
## Type conventions

- **`Result<T>`**: `{ ok: true; value: T } | { ok: false; error: string }` — engine returns these instead of throwing (`src/shared/engine/types.ts`)
- **Branded types**: `SessionId = string & { readonly __brand: 'SessionId' }` with constructor `sessionId(id)`.
- **Enum-like constants**: `as const` arrays + derived union type + `satisfies Record<...>` for exhaustiveness.

## Testing

- **Unit**: Vitest with happy-dom. `tests/` mirrors `src/` for pure logic; `src/**/__tests__/` for colocated component tests.
- **Integration**: `// @vitest-environment node` at file top for tests needing real Node APIs.
- **Store tests**: Reset via `store.setState(store.getInitialState())` in `beforeEach`.
- **E2E**: Playwright with `workers:1`, `test.describe.serial`. Test vault at `e2e/fixtures/test-vault/`.
- **Quality gate**: `npm run check` must pass clean (zero lint errors, zero type errors).
- **Claude drives DevTools**: Casey is unfamiliar with this project's DevTools/localStorage/CDP workflows. Never hand him "open DevTools, run X" steps. Prefer code paths over runtime toggles; drive the `npm run dev:debug` CDP target directly. Frame visual-verify asks in user-visible terms ("click the thread sidebar's +"), not inspector terms.
- Test contracts and failure behavior, not only successful rendering. Security-relevant
  input paths need negative tests that prove nothing was written.
- Built-app probes should wait for boot/reload to settle before `page.evaluate`; locator
  waits survive navigation, evaluate contexts do not.
- Non-packaged Electron runs share Application Support state. Treat surprising persisted
  state as a possible test contaminant before changing product behavior.
- Drive CDP/Playwright checks directly. Ask Casey only for genuinely visual acceptance,
  phrased as user-visible actions rather than DevTools or localStorage instructions.

## Code style

- **Prettier**: single quotes, no semicolons, 100 char width
- **TypeScript**: Strict mode. `_`-prefixed names exempt from unused-vars lint.
- **Tailwind v4**: via Vite plugin — scheduled for removal (ADR 0005); converge on tokens + `te-` classes.
- **Immutable data**: return new copies, never mutate in-place.
- **Files under 800 lines**, organized by feature/domain.
- **Buffer shim**: `main.tsx` shims `globalThis.Buffer` before gray-matter import — required for frontmatter parsing in browser context.
- `thread-store.ts` is already over the file-size threshold; do not grow it.
- Preserve terminal/block behavior and latency; PTY migration reprojects a live session
  and must not silently kill or duplicate it.

## Compact instructions

Always preserve across context compaction:
- IPC channel contracts and process ownership (main vs renderer vs preload)
- Active plan file paths, current layer/item, and completion status
- Process boundary and data flow decisions
- Verification evidence (test output, build results, type-check results)
- Error corrections and root causes, especially IPC or Electron-specific
- Design system token values and theme decisions
